"""
Cross-Sectional Pipeline — Step 3: Train + Backtest
=====================================================
1. Walk-forward XGBoost classification for 8 models (4 horizons x 2 labels)
2. Out-of-sample predictions → portfolio construction
3. Long top decile, short bottom decile, equal-weight, dollar-neutral
4. Compute PnL, Sharpe, drawdown, turnover

Outputs:
  xs_pipeline/results/model_metrics.pkl
  xs_pipeline/results/portfolio_returns.parquet
  xs_pipeline/results/backtest_summary.pkl
"""

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score
from pathlib import Path
import pickle
import time
import gc
import warnings

warnings.filterwarnings('ignore')

BASE = Path("Path(os.environ.get("DATA_DIR", "."))")
LABEL_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "labels"
RESULT_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

HORIZONS = [22, 66, 150, 252]
LABEL_TYPES = ['label_return', 'label_drawdown']
N_FOLDS = 5
LONG_PCTILE = 90   # Long top 10%
SHORT_PCTILE = 10   # Short bottom 10%

XGB_PARAMS = {
    'objective': 'binary:logistic',
    'eval_metric': 'auc',
    'max_depth': 5,
    'learning_rate': 0.02,
    'subsample': 0.8,
    'colsample_bytree': 0.3,
    'min_child_weight': 50,
    'reg_alpha': 1.0,
    'reg_lambda': 5.0,
    'tree_method': 'hist',
    'device': 'cpu',
}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def train_walk_forward(dataset, feature_cols, label_col, n_folds=N_FOLDS):
    """
    Walk-forward training on cross-sectional dataset.
    Split by DATE (not random) — each fold is a temporal block.
    Returns OOS predictions for all rows.
    """
    dates = sorted(dataset['date'].unique())
    n_dates = len(dates)
    fold_size = n_dates // (n_folds + 1)

    oos_probs = np.full(len(dataset), np.nan, dtype=np.float64)
    fold_metrics = []

    for fold in range(n_folds):
        # Train on dates[:train_end], validate on dates[val_start:val_end]
        train_end_idx = (fold + 1) * fold_size
        val_start_idx = train_end_idx
        val_end_idx = min((fold + 2) * fold_size, n_dates)

        train_dates = set(dates[:train_end_idx])
        val_dates = set(dates[val_start_idx:val_end_idx])

        train_mask = dataset['date'].isin(train_dates).values
        val_mask = dataset['date'].isin(val_dates).values

        X_train = dataset.loc[train_mask, feature_cols].values.astype(np.float32)
        y_train = dataset.loc[train_mask, label_col].values.astype(np.float64)
        X_val = dataset.loc[val_mask, feature_cols].values.astype(np.float32)
        y_val = dataset.loc[val_mask, label_col].values.astype(np.float64)

        # Remove NaN labels
        train_valid = ~np.isnan(y_train)
        val_valid = ~np.isnan(y_val)

        if train_valid.sum() < 500 or val_valid.sum() < 100:
            log(f"    Fold {fold+1}: skipped (train={train_valid.sum()}, val={val_valid.sum()})")
            continue

        X_tr = np.nan_to_num(X_train[train_valid], nan=0.0)
        y_tr = y_train[train_valid]
        X_vl = np.nan_to_num(X_val[val_valid], nan=0.0)
        y_vl = y_val[val_valid]

        pos_rate = np.mean(y_tr)
        if pos_rate < 0.01 or pos_rate > 0.99:
            log(f"    Fold {fold+1}: skipped (degenerate label rate {pos_rate:.3f})")
            continue

        scale_pos = (1 - pos_rate) / max(pos_rate, 1e-6)
        params = {**XGB_PARAMS, 'scale_pos_weight': scale_pos}

        # Early stopping split within training data
        split = int(len(y_tr) * 0.85)
        dtrain = xgb.DMatrix(X_tr[:split], label=y_tr[:split])
        dval_es = xgb.DMatrix(X_tr[split:], label=y_tr[split:])
        dpred = xgb.DMatrix(np.nan_to_num(X_val, nan=0.0))

        model = xgb.train(
            params, dtrain,
            num_boost_round=500,
            evals=[(dval_es, 'val')],
            early_stopping_rounds=30,
            verbose_eval=False
        )

        fold_probs = model.predict(dpred)
        oos_probs[val_mask] = fold_probs

        # Evaluate
        if len(np.unique(y_vl)) > 1:
            auc = roc_auc_score(y_vl, fold_probs[val_valid])
            fold_metrics.append({
                'fold': fold + 1,
                'auc': auc,
                'n_train': int(train_valid.sum()),
                'n_val': int(val_valid.sum()),
                'pos_rate_train': float(pos_rate),
                'pos_rate_val': float(np.mean(y_vl)),
                'train_dates': f"{min(train_dates).date()}-{max(train_dates).date()}",
                'val_dates': f"{min(val_dates).date()}-{max(val_dates).date()}",
            })
            log(f"    Fold {fold+1}: AUC={auc:.4f}  train={train_valid.sum():,}  val={val_valid.sum():,}  "
                f"pos_train={pos_rate:.1%}  pos_val={np.mean(y_vl):.1%}  "
                f"val: {min(val_dates).date()}-{max(val_dates).date()}")

        # Feature importance (top 20)
        imp = model.get_score(importance_type='gain')
        top_imp = sorted(imp.items(), key=lambda x: x[1], reverse=True)[:20]

        del model, dtrain, dval_es, dpred
        gc.collect()

    return oos_probs, fold_metrics


def construct_portfolio(dataset, return_probs, drawdown_probs, horizon):
    """
    Construct long/short portfolio using model predictions.
    At each rebalance date:
      - Score = average of return_prob and drawdown_prob
      - Long top decile, short bottom decile
      - Hold until next rebalance (horizon // 2 days or 22d, whichever is less)
    Returns: portfolio returns per rebalance period.
    """
    dataset = dataset.copy()
    dataset['return_prob'] = return_probs
    dataset['drawdown_prob'] = drawdown_probs
    dataset['score'] = (dataset['return_prob'] + dataset['drawdown_prob']) / 2.0

    # Only use rows with valid predictions
    scored = dataset.dropna(subset=['score'])
    if len(scored) == 0:
        return pd.DataFrame()

    rebal_dates = sorted(scored['date'].unique())
    portfolio_records = []

    for rd_idx, rd in enumerate(rebal_dates):
        snapshot = scored[scored['date'] == rd].copy()
        if len(snapshot) < 20:
            continue

        # Rank by combined score
        snapshot['score_rank'] = snapshot['score'].rank(pct=True)

        # Long top decile, short bottom decile
        long_mask = snapshot['score_rank'] >= (LONG_PCTILE / 100)
        short_mask = snapshot['score_rank'] <= (SHORT_PCTILE / 100)

        n_long = long_mask.sum()
        n_short = short_mask.sum()

        if n_long == 0 or n_short == 0:
            continue

        # Forward terminal return (already computed in the dataset)
        long_ret = snapshot.loc[long_mask, 'fwd_terminal'].mean()
        short_ret = snapshot.loc[short_mask, 'fwd_terminal'].mean()

        # Long/short PnL (equal weight, dollar neutral)
        ls_ret = (long_ret - short_ret) / 2.0  # Divide by 2 for dollar neutrality

        # Long only PnL
        long_only_ret = long_ret

        # Market return (equal-weight all stocks)
        mkt_ret = snapshot['fwd_terminal'].mean()

        portfolio_records.append({
            'date': rd,
            'ls_return': ls_ret,
            'long_return': long_ret,
            'short_return': short_ret,
            'long_only': long_only_ret,
            'market': mkt_ret,
            'n_long': int(n_long),
            'n_short': int(n_short),
            'n_universe': len(snapshot),
            'avg_long_score': float(snapshot.loc[long_mask, 'score'].mean()),
            'avg_short_score': float(snapshot.loc[short_mask, 'score'].mean()),
        })

    return pd.DataFrame(portfolio_records)


def compute_portfolio_metrics(returns, label=''):
    """Compute portfolio performance metrics."""
    if len(returns) < 5:
        return {}

    rets = returns.values if isinstance(returns, pd.Series) else returns
    rets = rets[~np.isnan(rets)]
    if len(rets) < 5:
        return {}

    cum = np.cumprod(1 + rets)
    total_ret = cum[-1] - 1

    # Annualize based on rebalance frequency
    periods_per_year = 252 / 22  # ~11.5 rebalances per year
    n_periods = len(rets)
    n_years = n_periods / periods_per_year

    ann_ret = (1 + total_ret) ** (1 / max(n_years, 0.01)) - 1
    ann_vol = np.std(rets) * np.sqrt(periods_per_year)
    sharpe = ann_ret / ann_vol if ann_vol > 0 else 0

    downside = rets[rets < 0]
    downside_vol = np.std(downside) * np.sqrt(periods_per_year) if len(downside) > 0 else 1
    sortino = ann_ret / downside_vol if downside_vol > 0 else 0

    peak = np.maximum.accumulate(cum)
    max_dd = np.min((cum - peak) / peak)

    win_rate = np.mean(rets > 0)
    hit_rate = np.mean(rets > 0)

    return {
        'label': label,
        'total_return': float(total_ret),
        'ann_return': float(ann_ret),
        'ann_vol': float(ann_vol),
        'sharpe': float(sharpe),
        'sortino': float(sortino),
        'max_drawdown': float(max_dd),
        'win_rate': float(win_rate),
        'n_periods': int(n_periods),
        'n_years': float(n_years),
        'avg_return': float(np.mean(rets)),
        'median_return': float(np.median(rets)),
    }


def main():
    t0 = time.time()
    log("Cross-Sectional Training + Backtest")

    all_model_metrics = {}
    all_portfolio_metrics = {}
    all_portfolio_returns = {}

    for horizon in HORIZONS:
        dataset_path = LABEL_DIR / f"dataset_{horizon}d.parquet"
        if not dataset_path.exists():
            log(f"\n  WARNING: {dataset_path.name} not found, skipping")
            continue

        log(f"\n{'='*80}")
        log(f"HORIZON: {horizon}d")
        log(f"{'='*80}")

        dataset = pd.read_parquet(dataset_path)
        dataset['date'] = pd.to_datetime(dataset['date'])
        log(f"  Dataset: {len(dataset):,} rows, {dataset['ticker'].nunique()} stocks, "
            f"{dataset['date'].nunique()} dates")

        # Identify feature columns (raw + cross-sectional ranks + macro)
        exclude_cols = {'date', 'ticker', 'fwd_max_ret', 'fwd_max_dd', 'fwd_terminal',
                        'ret_rank', 'dd_rank', 'label_return', 'label_drawdown',
                        'label_combined', 'n_stocks'}
        feature_cols = [c for c in dataset.columns if c not in exclude_cols]
        log(f"  Feature cols: {len(feature_cols)}")

        # ── Train models ───────────────────────────────────────────────────
        oos_probs = {}
        for label_type in LABEL_TYPES:
            model_name = f"{horizon}d_{label_type}"
            log(f"\n  --- Training {model_name} ---")

            probs, metrics = train_walk_forward(dataset, feature_cols, label_type)
            oos_probs[label_type] = probs
            all_model_metrics[model_name] = metrics

            n_valid = np.sum(~np.isnan(probs))
            log(f"    OOS predictions: {n_valid:,} / {len(probs):,}")
            if n_valid > 0:
                valid_p = probs[~np.isnan(probs)]
                log(f"    Prob distribution: mean={np.mean(valid_p):.4f}  "
                    f"P10={np.percentile(valid_p,10):.4f}  P50={np.percentile(valid_p,50):.4f}  "
                    f"P90={np.percentile(valid_p,90):.4f}")

        # ── Construct portfolio ────────────────────────────────────────────
        log(f"\n  --- Portfolio Construction ---")
        port_df = construct_portfolio(
            dataset,
            oos_probs.get('label_return', np.full(len(dataset), np.nan)),
            oos_probs.get('label_drawdown', np.full(len(dataset), np.nan)),
            horizon
        )

        if len(port_df) > 0:
            log(f"    Portfolio: {len(port_df)} rebalance periods")

            # Metrics for different strategies
            for strat, col in [('L/S', 'ls_return'), ('Long Only', 'long_only'), ('Market', 'market')]:
                m = compute_portfolio_metrics(port_df[col], label=f"{horizon}d {strat}")
                if m:
                    log(f"    {strat:12s}: AnnRet={m['ann_return']:>+8.2%}  "
                        f"Sharpe={m['sharpe']:>6.3f}  MaxDD={m['max_drawdown']:>7.2%}  "
                        f"WinRate={m['win_rate']:>6.1%}  TotRet={m['total_return']:>+8.2%}")
                    all_portfolio_metrics[f"{horizon}d_{strat}"] = m

            all_portfolio_returns[f"{horizon}d"] = port_df
        else:
            log(f"    WARNING: No portfolio constructed")

        del dataset
        gc.collect()

    # ── Summary ────────────────────────────────────────────────────────────
    log(f"\n\n{'='*100}")
    log("BACKTEST SUMMARY")
    log(f"{'='*100}")

    log(f"\n{'Strategy':<25s} {'AnnRet':>8s} {'Sharpe':>8s} {'Sortino':>8s} {'MaxDD':>8s} {'WinRate':>8s} {'TotRet':>10s}")
    log("-" * 80)

    for key in sorted(all_portfolio_metrics.keys()):
        m = all_portfolio_metrics[key]
        log(f"{m['label']:<25s} {m['ann_return']:>+8.2%} {m['sharpe']:>8.3f} {m['sortino']:>8.3f} "
            f"{m['max_drawdown']:>8.2%} {m['win_rate']:>8.1%} {m['total_return']:>+10.2%}")

    # ── Model AUC Summary ──────────────────────────────────────────────────
    log(f"\n\n{'='*100}")
    log("MODEL AUC SUMMARY")
    log(f"{'='*100}")

    for model_name, metrics in sorted(all_model_metrics.items()):
        aucs = [m['auc'] for m in metrics]
        if aucs:
            log(f"  {model_name:30s}: mean AUC={np.mean(aucs):.4f}  "
                f"per fold: {[f'{a:.4f}' for a in aucs]}")

    # ── Save ───────────────────────────────────────────────────────────────
    with open(RESULT_DIR / "model_metrics.pkl", 'wb') as f:
        pickle.dump(all_model_metrics, f)
    with open(RESULT_DIR / "backtest_summary.pkl", 'wb') as f:
        pickle.dump(all_portfolio_metrics, f)
    for key, port_df in all_portfolio_returns.items():
        port_df.to_parquet(RESULT_DIR / f"portfolio_returns_{key}.parquet", index=False)

    log(f"\nSaved results to {RESULT_DIR}")

    elapsed = time.time() - t0
    log(f"\nTraining + Backtest COMPLETE in {elapsed/60:.1f} minutes")


if __name__ == "__main__":
    main()

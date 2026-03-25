"""
Cross-Sectional Pipeline — Step 4: Exhaustive Strategy Search
===============================================================
After models are trained, exhaustively test:
  - Top K stocks: K = 5, 10, 15, 20, 30, 50, 100
  - Model combinations: return-only, drawdown-only, combined, weighted combos
  - Horizons: 22d, 66d, 150d, 252d
  - Entry thresholds: P70, P80, P90 of model scores
  - Long only, long/short, market-neutral

Saves ALL results to disk after each test. Visual output.
"""

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import roc_auc_score
from pathlib import Path
import pickle
import time
import gc
import warnings
import json
from itertools import product

warnings.filterwarnings('ignore')

BASE = Path("Path(os.environ.get("DATA_DIR", "."))")
LABEL_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "labels"
RESULT_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

HORIZONS = [22, 66, 150, 252]
K_VALUES = [5, 10, 15, 20, 30, 50, 100]
N_FOLDS = 5

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


def train_models_for_horizon(dataset, feature_cols, label_col):
    """Walk-forward train, return OOS probabilities aligned to dataset index."""
    dates = sorted(dataset['date'].unique())
    n_dates = len(dates)
    fold_size = n_dates // (N_FOLDS + 1)

    oos_probs = np.full(len(dataset), np.nan, dtype=np.float64)
    fold_aucs = []

    for fold in range(N_FOLDS):
        train_end = (fold + 1) * fold_size
        val_start = train_end
        val_end = min((fold + 2) * fold_size, n_dates)

        train_dates = set(dates[:train_end])
        val_dates = set(dates[val_start:val_end])

        train_mask = dataset['date'].isin(train_dates).values
        val_mask = dataset['date'].isin(val_dates).values

        y_train = dataset.loc[train_mask, label_col].values
        y_val = dataset.loc[val_mask, label_col].values

        train_valid = ~np.isnan(y_train)
        val_valid = ~np.isnan(y_val)

        if train_valid.sum() < 500 or val_valid.sum() < 100:
            continue

        X_tr = np.nan_to_num(dataset.loc[train_mask, feature_cols].values[train_valid], nan=0.0).astype(np.float32)
        y_tr = y_train[train_valid]

        pos_rate = np.mean(y_tr)
        if pos_rate < 0.01 or pos_rate > 0.99:
            continue

        params = {**XGB_PARAMS, 'scale_pos_weight': (1 - pos_rate) / max(pos_rate, 1e-6)}

        split = int(len(y_tr) * 0.85)
        dtrain = xgb.DMatrix(X_tr[:split], label=y_tr[:split])
        dval_es = xgb.DMatrix(X_tr[split:], label=y_tr[split:])
        dpred = xgb.DMatrix(np.nan_to_num(dataset.loc[val_mask, feature_cols].values, nan=0.0).astype(np.float32))

        model = xgb.train(params, dtrain, num_boost_round=500,
                          evals=[(dval_es, 'val')], early_stopping_rounds=30, verbose_eval=False)

        fold_probs = model.predict(dpred)
        oos_probs[val_mask] = fold_probs

        y_vl = y_val[val_valid]
        if len(np.unique(y_vl)) > 1:
            auc = roc_auc_score(y_vl, fold_probs[val_valid])
            fold_aucs.append(auc)

        del model, dtrain, dval_es, dpred
        gc.collect()

    return oos_probs, fold_aucs


def backtest_topK(dataset, scores, K, direction='long', use_terminal=True):
    """
    At each rebalance date, pick top-K (or bottom-K) stocks by score.
    Compute equal-weight portfolio return over the forward period.
    """
    dataset = dataset.copy()
    dataset['score'] = scores

    scored = dataset.dropna(subset=['score'])
    rebal_dates = sorted(scored['date'].unique())

    ret_col = 'fwd_terminal' if use_terminal else 'fwd_max_ret'
    records = []

    for rd in rebal_dates:
        snap = scored[scored['date'] == rd].copy()
        if len(snap) < K * 2:
            continue

        snap = snap.sort_values('score', ascending=(direction == 'short'))

        if direction == 'long':
            selected = snap.tail(K)  # Top K scores
        elif direction == 'short':
            selected = snap.head(K)  # Bottom K scores
        else:  # long_short
            long_sel = snap.tail(K)
            short_sel = snap.head(K)
            long_ret = long_sel[ret_col].mean()
            short_ret = short_sel[ret_col].mean()
            ls_ret = (long_ret - short_ret) / 2.0
            records.append({
                'date': rd, 'return': ls_ret, 'n': K * 2,
                'long_ret': long_ret, 'short_ret': short_ret,
                'n_universe': len(snap),
            })
            continue

        port_ret = selected[ret_col].mean()
        records.append({
            'date': rd, 'return': port_ret, 'n': K, 'n_universe': len(snap),
        })

    return pd.DataFrame(records)


def compute_metrics(returns):
    """Compute annualized portfolio metrics."""
    rets = returns.dropna().values if isinstance(returns, pd.Series) else returns
    rets = rets[~np.isnan(rets)]
    if len(rets) < 5:
        return None

    cum = np.cumprod(1 + rets)
    periods_per_year = 252 / 22
    n_years = len(rets) / periods_per_year

    ann_ret = (cum[-1]) ** (1 / max(n_years, 0.01)) - 1
    ann_vol = np.std(rets) * np.sqrt(periods_per_year)
    sharpe = ann_ret / ann_vol if ann_vol > 0 else 0

    down = rets[rets < 0]
    down_vol = np.std(down) * np.sqrt(periods_per_year) if len(down) > 0 else 1
    sortino = ann_ret / down_vol

    peak = np.maximum.accumulate(cum)
    max_dd = np.min((cum - peak) / peak)
    win_rate = np.mean(rets > 0)

    return {
        'ann_return': ann_ret, 'sharpe': sharpe, 'sortino': sortino,
        'max_drawdown': max_dd, 'win_rate': win_rate, 'total_return': cum[-1] - 1,
        'n_periods': len(rets), 'n_years': n_years, 'ann_vol': ann_vol,
    }


def main():
    t0 = time.time()
    log("EXHAUSTIVE STRATEGY SEARCH")
    log(f"K values: {K_VALUES}")
    log(f"Horizons: {HORIZONS}")

    all_results = []  # List of dicts, one per strategy test
    model_cache = {}  # Cache trained model probabilities

    for horizon in HORIZONS:
        dataset_path = LABEL_DIR / f"dataset_{horizon}d.parquet"
        if not dataset_path.exists():
            log(f"WARNING: {dataset_path.name} not found, skipping")
            continue

        log(f"\n{'='*80}")
        log(f"HORIZON: {horizon}d")
        log(f"{'='*80}")

        dataset = pd.read_parquet(dataset_path)
        dataset['date'] = pd.to_datetime(dataset['date'])

        exclude = {'date', 'ticker', 'fwd_max_ret', 'fwd_max_dd', 'fwd_terminal',
                   'ret_rank', 'dd_rank', 'label_return', 'label_drawdown',
                   'label_combined', 'n_stocks'}
        feature_cols = [c for c in dataset.columns if c not in exclude]

        log(f"  Dataset: {len(dataset):,} rows, {dataset['ticker'].nunique()} stocks, "
            f"{dataset['date'].nunique()} dates, {len(feature_cols)} features")

        # ── Train 3 models: return, drawdown, combined ─────────────────────
        for label_type in ['label_return', 'label_drawdown', 'label_combined']:
            cache_key = f"{horizon}d_{label_type}"

            if cache_key in model_cache:
                probs = model_cache[cache_key]
            else:
                log(f"\n  Training {cache_key}...")
                probs, aucs = train_models_for_horizon(dataset, feature_cols, label_type)
                model_cache[cache_key] = probs

                n_valid = np.sum(~np.isnan(probs))
                mean_auc = np.mean(aucs) if aucs else 0
                log(f"    OOS: {n_valid:,} preds, mean AUC={mean_auc:.4f}, "
                    f"per fold: {[f'{a:.4f}' for a in aucs]}")

                # Save model probs to disk incrementally
                prob_save = {'probs': probs, 'aucs': aucs, 'label': label_type, 'horizon': horizon}
                with open(RESULT_DIR / f"model_probs_{cache_key}.pkl", 'wb') as f:
                    pickle.dump(prob_save, f)

        # ── Score combinations ─────────────────────────────────────────────
        ret_probs = model_cache[f"{horizon}d_label_return"]
        dd_probs = model_cache[f"{horizon}d_label_drawdown"]
        comb_probs = model_cache[f"{horizon}d_label_combined"]

        score_variants = {
            'return_only': ret_probs,
            'drawdown_only': dd_probs,
            'combined_model': comb_probs,
            'avg_ret_dd': (np.nan_to_num(ret_probs, nan=0) + np.nan_to_num(dd_probs, nan=0)) / 2,
            'weighted_70ret_30dd': 0.7 * np.nan_to_num(ret_probs, nan=0) + 0.3 * np.nan_to_num(dd_probs, nan=0),
            'weighted_30ret_70dd': 0.3 * np.nan_to_num(ret_probs, nan=0) + 0.7 * np.nan_to_num(dd_probs, nan=0),
            'min_ret_dd': np.minimum(np.nan_to_num(ret_probs, nan=0), np.nan_to_num(dd_probs, nan=0)),
            'max_ret_dd': np.maximum(np.nan_to_num(ret_probs, nan=0), np.nan_to_num(dd_probs, nan=0)),
            'product_ret_dd': np.nan_to_num(ret_probs, nan=0) * np.nan_to_num(dd_probs, nan=0),
        }

        # ── Test all combinations ──────────────────────────────────────────
        log(f"\n  Testing {len(score_variants)} score variants x {len(K_VALUES)} K values x 3 directions...")

        for score_name, scores in score_variants.items():
            for K in K_VALUES:
                for direction in ['long', 'short', 'long_short']:
                    port_df = backtest_topK(dataset, scores, K, direction)

                    if len(port_df) < 10:
                        continue

                    metrics = compute_metrics(port_df['return'])
                    if metrics is None:
                        continue

                    result = {
                        'horizon': horizon,
                        'score': score_name,
                        'K': K,
                        'direction': direction,
                        **metrics,
                    }
                    all_results.append(result)

            # Also test market (equal weight all stocks)
            mkt_df = backtest_topK(dataset, np.ones(len(dataset)), len(dataset), 'long')
            if len(mkt_df) > 10:
                mkt_metrics = compute_metrics(mkt_df['return'])
                if mkt_metrics:
                    all_results.append({
                        'horizon': horizon, 'score': 'MARKET_EW', 'K': 'all',
                        'direction': 'long', **mkt_metrics,
                    })

        # Save incrementally
        results_df = pd.DataFrame(all_results)
        results_df.to_parquet(RESULT_DIR / "strategy_search_results.parquet", index=False)
        log(f"  Saved {len(results_df)} strategy results so far")

        del dataset
        gc.collect()

    # ── Final Summary ──────────────────────────────────────────────────────
    results_df = pd.DataFrame(all_results)
    results_df.to_parquet(RESULT_DIR / "strategy_search_results.parquet", index=False)

    log(f"\n\n{'='*120}")
    log("FULL RESULTS — SORTED BY SHARPE RATIO")
    log(f"{'='*120}")

    sorted_df = results_df.sort_values('sharpe', ascending=False)

    log(f"\n{'Horizon':>8s} {'Score':<25s} {'K':>5s} {'Dir':<12s} {'AnnRet':>8s} {'Sharpe':>8s} "
        f"{'Sortino':>8s} {'MaxDD':>8s} {'WinRate':>8s} {'TotRet':>10s}")
    log("-" * 120)

    for _, row in sorted_df.head(50).iterrows():
        log(f"{row['horizon']:>6d}d {row['score']:<25s} {str(row['K']):>5s} {row['direction']:<12s} "
            f"{row['ann_return']:>+8.2%} {row['sharpe']:>8.3f} {row['sortino']:>8.3f} "
            f"{row['max_drawdown']:>8.2%} {row['win_rate']:>8.1%} {row['total_return']:>+10.2%}")

    # Bottom 20 (worst)
    log(f"\n\nWORST 20 STRATEGIES:")
    log("-" * 120)
    for _, row in sorted_df.tail(20).iterrows():
        log(f"{row['horizon']:>6d}d {row['score']:<25s} {str(row['K']):>5s} {row['direction']:<12s} "
            f"{row['ann_return']:>+8.2%} {row['sharpe']:>8.3f} {row['sortino']:>8.3f} "
            f"{row['max_drawdown']:>8.2%} {row['win_rate']:>8.1%} {row['total_return']:>+10.2%}")

    # Per-horizon best
    log(f"\n\nBEST STRATEGY PER HORIZON:")
    log("-" * 120)
    for h in HORIZONS:
        h_df = sorted_df[sorted_df['horizon'] == h]
        if len(h_df) > 0:
            best = h_df.iloc[0]
            log(f"  {h:>3d}d: {best['score']:<25s} K={str(best['K']):>5s} {best['direction']:<12s} "
                f"Sharpe={best['sharpe']:.3f}  AnnRet={best['ann_return']:+.2%}  MaxDD={best['max_drawdown']:.2%}")

    # Market benchmark
    log(f"\n\nMARKET BENCHMARK (equal-weight all stocks):")
    mkt = sorted_df[sorted_df['score'] == 'MARKET_EW']
    for _, row in mkt.iterrows():
        log(f"  {row['horizon']:>3d}d: Sharpe={row['sharpe']:.3f}  AnnRet={row['ann_return']:+.2%}")

    elapsed = time.time() - t0
    log(f"\n\nStrategy search COMPLETE in {elapsed/60:.1f} minutes")
    log(f"Total strategies tested: {len(results_df)}")


if __name__ == "__main__":
    main()

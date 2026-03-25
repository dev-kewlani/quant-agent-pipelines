"""
Historical Backtest of XGBoost Model
======================================
Walk-forward out-of-sample predictions → trading strategies → PnL curves.

Strategies tested:
  1. Long/Short: always in market, direction = sign(prediction)
  2. Threshold: long if pred > +2%, short if pred < -2%, flat otherwise
  3. Sized: position size = clip(prediction / 0.10, -1, 1)
  4. Multi-horizon: 252d for direction, 22d for timing

For each strategy and horizon, compute:
  - Equity curve, cumulative return
  - Annualized return, Sharpe, Sortino
  - Max drawdown, win rate, profit factor
  - Comparison vs buy-and-hold
"""

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from pathlib import Path
import pickle
import time
import warnings
import gc

warnings.filterwarnings('ignore')

BASE = Path("Path(os.environ.get("DATA_DIR", "."))/Idea 4 - Spreads/orcl_analysis")
FEAT = BASE / "features"
DATA = BASE / "data"
RESULTS = BASE / "results"

FWD_HORIZONS = [22, 44, 66, 105, 150, 200, 252]
TOP_N = 300  # features per horizon

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_data():
    """Load features, compute targets, load screening results."""
    log("Loading data...")
    feat_df = pd.read_parquet(FEAT / "all_features.parquet")
    feat_df.index = pd.to_datetime(feat_df.index)

    orcl = pd.read_parquet(DATA / "orcl_base.parquet")
    orcl['date'] = pd.to_datetime(orcl['date'])
    close = orcl['prc_adj'].values.astype(np.float64)
    dates = orcl['date'].values

    with open(RESULTS / "feature_screening.pkl", 'rb') as f:
        screening = pickle.load(f)

    log(f"Features: {feat_df.shape}, Close prices: {len(close)}")
    return feat_df, close, dates, screening


def walk_forward_backtest(feat_df, close, dates, screening, horizon, n_folds=5):
    """
    Walk-forward backtest for a single horizon.
    Returns array of out-of-sample predictions aligned to dates.
    """
    h = horizon
    n = len(close)
    horizon_name = f"fwd_ret_{h}d"

    # Build target
    target = np.full(n, np.nan, dtype=np.float64)
    target[:n-h] = (close[h:] / close[:n-h]) - 1.0

    # Get top features
    top_features = screening[horizon_name]['top_features'][:TOP_N]
    X = feat_df[top_features].values.astype(np.float32)
    y = target

    # Walk-forward split
    tscv = TimeSeriesSplit(n_splits=n_folds)
    oos_predictions = np.full(n, np.nan, dtype=np.float64)

    xgb_params = {
        'objective': 'reg:squarederror',
        'max_depth': 5,
        'learning_rate': 0.03,
        'subsample': 0.8,
        'colsample_bytree': 0.3,
        'min_child_weight': 50,
        'reg_alpha': 1.0,
        'reg_lambda': 5.0,
        'tree_method': 'hist',
        'device': 'cpu',
    }

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_train, X_val = X[train_idx], X[val_idx]
        y_train, y_val = y[train_idx], y[val_idx]

        # Valid rows
        train_valid = ~np.isnan(y_train)
        val_valid = ~np.isnan(y_val)

        if train_valid.sum() < 200 or val_valid.sum() < 50:
            continue

        X_tr = np.nan_to_num(X_train[train_valid], nan=0.0)
        y_tr = y_train[train_valid]
        X_vl = np.nan_to_num(X_val, nan=0.0)

        # Also do a small internal val split for early stopping
        split = int(len(y_tr) * 0.85)
        dtrain = xgb.DMatrix(X_tr[:split], label=y_tr[:split])
        dval_es = xgb.DMatrix(X_tr[split:], label=y_tr[split:])
        dpred = xgb.DMatrix(X_vl)

        model = xgb.train(
            xgb_params, dtrain,
            num_boost_round=500,
            evals=[(dval_es, 'val')],
            early_stopping_rounds=30,
            verbose_eval=False
        )

        preds = model.predict(dpred)
        oos_predictions[val_idx] = preds

        # Compute OOS IC
        val_mask = val_valid
        if val_mask.sum() > 10:
            oos_rets = y_val[val_mask]
            oos_preds = preds[val_mask]
            ic = np.corrcoef(oos_preds, oos_rets)[0, 1]
            log(f"  Fold {fold+1}: OOS IC={ic:.4f}, n={val_mask.sum()}, "
                f"train={train_valid.sum()}, pred range=[{preds.min():.4f}, {preds.max():.4f}]")

    return oos_predictions


def compute_strategy_pnl(predictions, close, dates, horizon, strategy='long_short'):
    """
    Compute PnL for a trading strategy based on predictions.

    For horizon-based strategies:
    - At each rebalance point (every `horizon` days), use the prediction to set position
    - Hold for `horizon` days, then rebalance
    - PnL = position * realized return over holding period

    For daily strategies:
    - Use daily predictions to set next-day position
    """
    n = len(close)
    h = horizon
    valid = ~np.isnan(predictions)

    # Daily returns
    daily_ret = np.zeros(n, dtype=np.float64)
    daily_ret[1:] = (close[1:] / close[:-1]) - 1.0

    # Forward returns over horizon
    fwd_ret = np.full(n, np.nan, dtype=np.float64)
    fwd_ret[:n-h] = (close[h:] / close[:n-h]) - 1.0

    # Strategy: rebalance every `rebal_freq` days using prediction
    rebal_freq = max(h // 2, 5)  # Rebalance at half the horizon frequency

    positions = np.zeros(n, dtype=np.float64)
    pred_arr = predictions.copy()

    if strategy == 'long_short':
        # Always in market: long if pred > 0, short if pred < 0
        for i in range(n):
            if valid[i]:
                positions[i] = 1.0 if pred_arr[i] > 0 else -1.0
            elif i > 0:
                positions[i] = positions[i-1]

    elif strategy == 'threshold':
        # Long if pred > 2%, short if pred < -2%, flat otherwise
        thresh = 0.02
        for i in range(n):
            if valid[i]:
                if pred_arr[i] > thresh:
                    positions[i] = 1.0
                elif pred_arr[i] < -thresh:
                    positions[i] = -1.0
                else:
                    positions[i] = 0.0
            elif i > 0:
                positions[i] = positions[i-1]

    elif strategy == 'sized':
        # Position size proportional to prediction, clipped to [-1, 1]
        for i in range(n):
            if valid[i]:
                positions[i] = np.clip(pred_arr[i] / 0.10, -1.0, 1.0)
            elif i > 0:
                positions[i] = positions[i-1]

    elif strategy == 'rebalanced':
        # Only rebalance every rebal_freq days
        last_rebal = -rebal_freq
        for i in range(n):
            if valid[i] and (i - last_rebal) >= rebal_freq:
                positions[i] = np.clip(pred_arr[i] / 0.10, -1.0, 1.0)
                last_rebal = i
            elif i > 0:
                positions[i] = positions[i-1]

    # Compute PnL: position[t-1] * return[t] (positions are lagged by 1 day)
    strategy_ret = np.zeros(n, dtype=np.float64)
    strategy_ret[1:] = positions[:-1] * daily_ret[1:]

    # Buy and hold
    bnh_ret = daily_ret.copy()

    return positions, strategy_ret, bnh_ret


def compute_metrics(strategy_ret, dates, annual_factor=252):
    """Compute performance metrics."""
    valid = ~np.isnan(strategy_ret) & (strategy_ret != 0)
    rets = strategy_ret[valid]

    if len(rets) < 50:
        return {}

    # Basic stats
    total_ret = np.prod(1 + rets) - 1
    n_days = len(rets)
    n_years = n_days / annual_factor

    ann_ret = (1 + total_ret) ** (1 / max(n_years, 0.01)) - 1
    ann_vol = np.std(rets) * np.sqrt(annual_factor)
    sharpe = ann_ret / ann_vol if ann_vol > 0 else 0

    # Sortino (downside vol)
    downside = rets[rets < 0]
    downside_vol = np.std(downside) * np.sqrt(annual_factor) if len(downside) > 0 else 0
    sortino = ann_ret / downside_vol if downside_vol > 0 else 0

    # Max drawdown
    cum = np.cumprod(1 + rets)
    peak = np.maximum.accumulate(cum)
    dd = (cum - peak) / peak
    max_dd = np.min(dd)

    # Win rate
    win_rate = np.mean(rets > 0)
    avg_win = np.mean(rets[rets > 0]) if np.sum(rets > 0) > 0 else 0
    avg_loss = np.mean(rets[rets < 0]) if np.sum(rets < 0) > 0 else 0
    profit_factor = abs(avg_win * np.sum(rets > 0) / (avg_loss * np.sum(rets < 0))) if np.sum(rets < 0) > 0 and avg_loss != 0 else np.inf

    return {
        'total_return': total_ret,
        'ann_return': ann_ret,
        'ann_vol': ann_vol,
        'sharpe': sharpe,
        'sortino': sortino,
        'max_drawdown': max_dd,
        'win_rate': win_rate,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'profit_factor': profit_factor,
        'n_days': n_days,
        'n_years': n_years,
    }


def main():
    t0 = time.time()

    feat_df, close, dates, screening = load_data()

    all_results = {}

    for h in FWD_HORIZONS:
        horizon_name = f"fwd_ret_{h}d"
        log(f"\n{'='*80}")
        log(f"BACKTESTING {horizon_name}")
        log(f"{'='*80}")

        # Get walk-forward OOS predictions
        oos_preds = walk_forward_backtest(feat_df, close, dates, screening, h)

        n_valid = np.sum(~np.isnan(oos_preds))
        log(f"  OOS predictions: {n_valid} / {len(oos_preds)} days")

        if n_valid < 100:
            log(f"  Not enough OOS predictions, skipping")
            continue

        # Test multiple strategies
        strategies = ['long_short', 'threshold', 'sized', 'rebalanced']
        horizon_results = {}

        for strat in strategies:
            positions, strat_ret, bnh_ret = compute_strategy_pnl(
                oos_preds, close, dates, h, strategy=strat
            )

            # Only compute metrics where we have OOS predictions
            oos_mask = ~np.isnan(oos_preds)
            strat_ret_valid = strat_ret.copy()
            strat_ret_valid[~oos_mask] = 0  # Zero out periods without predictions

            metrics = compute_metrics(strat_ret_valid[oos_mask], dates[oos_mask])
            bnh_metrics = compute_metrics(bnh_ret[oos_mask], dates[oos_mask])

            horizon_results[strat] = {
                'metrics': metrics,
                'bnh_metrics': bnh_metrics,
                'positions': positions,
                'strategy_returns': strat_ret,
                'oos_predictions': oos_preds,
            }

            if metrics:
                log(f"\n  Strategy: {strat}")
                log(f"    Annualized Return:  {metrics['ann_return']:>+8.2%}  (B&H: {bnh_metrics.get('ann_return', 0):>+8.2%})")
                log(f"    Annualized Vol:     {metrics['ann_vol']:>8.2%}  (B&H: {bnh_metrics.get('ann_vol', 0):>8.2%})")
                log(f"    Sharpe Ratio:       {metrics['sharpe']:>8.3f}  (B&H: {bnh_metrics.get('sharpe', 0):>8.3f})")
                log(f"    Sortino Ratio:      {metrics['sortino']:>8.3f}")
                log(f"    Max Drawdown:       {metrics['max_drawdown']:>8.2%}  (B&H: {bnh_metrics.get('max_drawdown', 0):>8.2%})")
                log(f"    Win Rate:           {metrics['win_rate']:>8.1%}")
                log(f"    Profit Factor:      {metrics['profit_factor']:>8.2f}")
                log(f"    Total Return:       {metrics['total_return']:>+8.2%}  (B&H: {bnh_metrics.get('total_return', 0):>+8.2%})")
                log(f"    Period:             {metrics['n_years']:.1f} years ({metrics['n_days']} days)")

        all_results[horizon_name] = horizon_results

    # ── Summary Table ──────────────────────────────────────────────────────
    log(f"\n\n{'='*120}")
    log("BACKTEST SUMMARY — All Horizons x All Strategies")
    log(f"{'='*120}")

    log(f"\n{'Horizon':<15s} {'Strategy':<15s} {'Ann Ret':>10s} {'Sharpe':>8s} {'MaxDD':>8s} {'WinRate':>8s} {'PF':>8s} {'TotRet':>10s} {'B&H Ret':>10s} {'B&H Sharpe':>11s}")
    log("-" * 120)

    for h_name in sorted(all_results.keys()):
        for strat_name, strat_data in all_results[h_name].items():
            m = strat_data['metrics']
            bm = strat_data['bnh_metrics']
            if not m:
                continue
            log(f"{h_name:<15s} {strat_name:<15s} {m['ann_return']:>+10.2%} {m['sharpe']:>8.3f} "
                f"{m['max_drawdown']:>8.2%} {m['win_rate']:>8.1%} {m['profit_factor']:>8.2f} "
                f"{m['total_return']:>+10.2%} {bm.get('total_return',0):>+10.2%} {bm.get('sharpe',0):>11.3f}")

    # ── Save Results ───────────────────────────────────────────────────────
    # Save lightweight version (no large arrays)
    save_results = {}
    for h_name, h_data in all_results.items():
        save_results[h_name] = {}
        for strat_name, strat_data in h_data.items():
            save_results[h_name][strat_name] = {
                'metrics': strat_data['metrics'],
                'bnh_metrics': strat_data['bnh_metrics'],
            }

    with open(RESULTS / "backtest_results.pkl", 'wb') as f:
        pickle.dump(save_results, f, protocol=4)

    # Save full OOS predictions for plotting
    oos_all = {}
    for h_name, h_data in all_results.items():
        # Just take from any strategy (predictions are the same)
        for strat_name, strat_data in h_data.items():
            oos_all[h_name] = {
                'predictions': strat_data['oos_predictions'],
                'sized_returns': strat_data['strategy_returns'],
            }
            break

    with open(RESULTS / "backtest_oos_predictions.pkl", 'wb') as f:
        pickle.dump(oos_all, f, protocol=4)

    log(f"\nSaved backtest_results.pkl and backtest_oos_predictions.pkl")

    elapsed = time.time() - t0
    log(f"\nBacktest COMPLETE in {elapsed/60:.1f} minutes")


if __name__ == "__main__":
    main()

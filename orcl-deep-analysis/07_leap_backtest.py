"""
LEAP-Aligned First-Passage-Time Backtest
==========================================
Labels:
  CALL label = 1 if stock hits +45% within 200d WITHOUT first dropping >15%
  PUT label  = 1 if stock drops -40% within 200d WITHOUT first rallying >15%

Walk-forward XGBoost classifiers for each label.
Backtest: buy LEAP calls/puts based on model probabilities.
Option P&L approximated via Black-Scholes delta/gamma/theta.
"""

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score, precision_recall_curve, average_precision_score
from pathlib import Path
import pickle
import time
import warnings
from scipy.stats import norm
from numba import njit

warnings.filterwarnings('ignore')

BASE = Path("Path(os.environ.get("DATA_DIR", "."))/Idea 4 - Spreads/orcl_analysis")
FEAT = BASE / "features"
DATA = BASE / "data"
RESULTS = BASE / "results"

# ── Label parameters ───────────────────────────────────────────────────────
CALL_TARGET = 0.45       # Stock must rally +45%
CALL_STOP = -0.15        # Invalidated if stock drops >15% first
PUT_TARGET = -0.40       # Stock must drop 40%
PUT_STOP = 0.15          # Invalidated if stock rallies >15% first
MIN_HOLD = 22            # Minimum hold before target can be hit
MAX_HORIZON = 200        # Maximum days to hit target (leave time value in LEAP)

# ── Option parameters for P&L simulation ───────────────────────────────────
RISK_FREE = 0.045
OPTION_EXPIRY_DAYS = 365  # 1-year LEAP
CALL_DELTA_TARGET = 0.30  # Buy ~30-delta OTM calls
PUT_DELTA_TARGET = 0.30   # Buy ~30-delta OTM puts

TOP_N = 300
N_FOLDS = 5


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ══════════════════════════════════════════════════════════════════════════════
# LABEL CONSTRUCTION
# ══════════════════════════════════════════════════════════════════════════════

@njit(cache=True)
def compute_first_passage_labels(close, target_pct, stop_pct, min_hold, max_horizon):
    """
    First-passage-time label with protective barrier.
    For each day t:
      - Track price path from t+1 to t+max_horizon
      - If price hits stop_pct BEFORE target_pct → label = 0
      - If price hits target_pct (after min_hold) without hitting stop → label = 1
      - If neither hit → label = 0
    Also returns: time_to_target (days) for label=1 events.
    """
    n = len(close)
    labels = np.full(n, np.nan, dtype=np.float64)
    time_to_target = np.full(n, np.nan, dtype=np.float64)

    for t in range(n - min_hold):
        entry = close[t]
        if entry <= 0 or np.isnan(entry):
            continue

        end = min(t + max_horizon, n - 1)
        hit_stop = False
        hit_target = False

        for s in range(t + 1, end + 1):
            ret = close[s] / entry - 1.0

            # Check stop first (protective barrier)
            if target_pct > 0:  # Call: stop is negative
                if ret < stop_pct:
                    hit_stop = True
                    break
            else:  # Put: stop is positive
                if ret > stop_pct:
                    hit_stop = True
                    break

            # Check target (only after min_hold)
            if (s - t) >= min_hold:
                if target_pct > 0 and ret >= target_pct:
                    hit_target = True
                    time_to_target[t] = float(s - t)
                    break
                elif target_pct < 0 and ret <= target_pct:
                    hit_target = True
                    time_to_target[t] = float(s - t)
                    break

        if hit_stop:
            labels[t] = 0.0
        elif hit_target:
            labels[t] = 1.0
        else:
            labels[t] = 0.0  # Timed out

    return labels, time_to_target


# ══════════════════════════════════════════════════════════════════════════════
# BLACK-SCHOLES FOR OPTION P&L
# ══════════════════════════════════════════════════════════════════════════════

def bs_call_price(S, K, T, r, sigma):
    """Black-Scholes call price."""
    if T <= 0 or sigma <= 0:
        return max(S - K, 0)
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)


def bs_put_price(S, K, T, r, sigma):
    """Black-Scholes put price."""
    if T <= 0 or sigma <= 0:
        return max(K - S, 0)
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)


def find_strike_for_delta(S, T, r, sigma, target_delta, option_type='call'):
    """Find strike price that gives approximately target_delta."""
    # Binary search
    lo, hi = S * 0.5, S * 2.0
    for _ in range(50):
        K = (lo + hi) / 2
        d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
        if option_type == 'call':
            delta = norm.cdf(d1)
            if delta > target_delta:
                lo = K  # Need higher strike for lower delta
            else:
                hi = K
        else:
            delta = norm.cdf(d1) - 1  # Put delta is negative
            if abs(delta) > target_delta:
                hi = K  # Need lower strike for lower |delta|
            else:
                lo = K
    return (lo + hi) / 2


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    t0 = time.time()

    # ── Load data ──────────────────────────────────────────────────────────
    log("Loading data...")
    feat_df = pd.read_parquet(FEAT / "all_features.parquet")
    feat_df.index = pd.to_datetime(feat_df.index)

    orcl = pd.read_parquet(DATA / "orcl_base.parquet")
    orcl['date'] = pd.to_datetime(orcl['date'])
    close = orcl['prc_adj'].values.astype(np.float64)
    dates = pd.to_datetime(orcl['date'].values)
    n = len(close)

    with open(RESULTS / "feature_screening.pkl", 'rb') as f:
        screening = pickle.load(f)

    # Estimate historical vol for option pricing (252d rolling)
    log_ret = np.diff(np.log(np.maximum(close, 1e-8)))
    rolling_vol = np.full(n, np.nan, dtype=np.float64)
    for t in range(252, n):
        rolling_vol[t] = np.std(log_ret[t-252:t]) * np.sqrt(252)

    log(f"Data: {n} days, features: {feat_df.shape[1]}")

    # ── Compute labels ─────────────────────────────────────────────────────
    log("\nComputing first-passage-time labels...")

    log(f"  CALL: target=+{CALL_TARGET:.0%}, stop={CALL_STOP:.0%}, min_hold={MIN_HOLD}d, max={MAX_HORIZON}d")
    call_labels, call_ttt = compute_first_passage_labels(
        close, CALL_TARGET, CALL_STOP, MIN_HOLD, MAX_HORIZON
    )
    call_valid = ~np.isnan(call_labels)
    call_rate = np.mean(call_labels[call_valid])
    call_ttt_valid = call_ttt[~np.isnan(call_ttt)]
    log(f"    Events: {int(np.sum(call_labels[call_valid]==1))} / {int(call_valid.sum())} "
        f"({call_rate:.1%})")
    if len(call_ttt_valid) > 0:
        log(f"    Time to target: mean={np.mean(call_ttt_valid):.0f}d, "
            f"median={np.median(call_ttt_valid):.0f}d, "
            f"P25={np.percentile(call_ttt_valid,25):.0f}d, "
            f"P75={np.percentile(call_ttt_valid,75):.0f}d")

    log(f"  PUT: target={PUT_TARGET:.0%}, stop=+{PUT_STOP:.0%}, min_hold={MIN_HOLD}d, max={MAX_HORIZON}d")
    put_labels, put_ttt = compute_first_passage_labels(
        close, PUT_TARGET, PUT_STOP, MIN_HOLD, MAX_HORIZON
    )
    put_valid = ~np.isnan(put_labels)
    put_rate = np.mean(put_labels[put_valid])
    put_ttt_valid = put_ttt[~np.isnan(put_ttt)]
    log(f"    Events: {int(np.sum(put_labels[put_valid]==1))} / {int(put_valid.sum())} "
        f"({put_rate:.1%})")
    if len(put_ttt_valid) > 0:
        log(f"    Time to target: mean={np.mean(put_ttt_valid):.0f}d, "
            f"median={np.median(put_ttt_valid):.0f}d")

    # ── Walk-forward classification ────────────────────────────────────────
    for label_name, y_labels in [('CALL', call_labels), ('PUT', put_labels)]:
        log(f"\n{'='*80}")
        log(f"WALK-FORWARD CLASSIFICATION: {label_name}")
        log(f"{'='*80}")

        y = y_labels
        valid_rate = np.mean(y[~np.isnan(y)])

        if valid_rate < 0.005 or valid_rate > 0.995:
            log(f"  Skipping — degenerate label rate: {valid_rate:.3%}")
            continue

        # Feature selection: use screening from nearest horizon
        screen_key = 'fwd_ret_66d' if label_name == 'CALL' else 'fwd_ret_252d'
        if screen_key not in screening:
            screen_key = list(screening.keys())[0]
        top_features = screening[screen_key]['top_features'][:TOP_N]
        X = feat_df[top_features].values.astype(np.float32)

        tscv = TimeSeriesSplit(n_splits=N_FOLDS)
        probs = np.full(n, np.nan, dtype=np.float64)
        fold_metrics = []

        for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
            y_train = y[train_idx]
            y_val = y[val_idx]

            train_valid = ~np.isnan(y_train)
            val_valid_mask = ~np.isnan(y_val)

            if train_valid.sum() < 200:
                log(f"  Fold {fold+1}: skipped (insufficient training data)")
                continue

            X_tr = np.nan_to_num(X[train_idx][train_valid], nan=0.0)
            y_tr = y_train[train_valid]
            X_vl = np.nan_to_num(X[val_idx], nan=0.0)

            pos_rate = np.mean(y_tr)
            if pos_rate < 0.005 or pos_rate > 0.995:
                log(f"  Fold {fold+1}: skipped (degenerate, pos_rate={pos_rate:.3f})")
                continue

            scale_pos = (1 - pos_rate) / max(pos_rate, 1e-6)

            params = {
                'objective': 'binary:logistic',
                'eval_metric': 'auc',
                'max_depth': 5,
                'learning_rate': 0.02,
                'subsample': 0.8,
                'colsample_bytree': 0.3,
                'min_child_weight': 30,
                'reg_alpha': 1.0,
                'reg_lambda': 5.0,
                'scale_pos_weight': scale_pos,
                'tree_method': 'hist',
                'device': 'cpu',
            }

            split = int(len(y_tr) * 0.85)
            dtrain = xgb.DMatrix(X_tr[:split], label=y_tr[:split])
            dval_es = xgb.DMatrix(X_tr[split:], label=y_tr[split:])
            dpred = xgb.DMatrix(X_vl)

            model = xgb.train(
                params, dtrain,
                num_boost_round=500,
                evals=[(dval_es, 'val')],
                early_stopping_rounds=30,
                verbose_eval=False
            )

            fold_probs = model.predict(dpred)
            probs[val_idx] = fold_probs

            # Evaluate
            y_v = y_val[val_valid_mask]
            p_v = fold_probs[val_valid_mask]
            if len(y_v) > 20 and len(np.unique(y_v)) > 1:
                auc = roc_auc_score(y_v, p_v)
                ap = average_precision_score(y_v, p_v)
                # Precision at various thresholds
                prec_at = {}
                for thresh in [0.10, 0.15, 0.20, 0.30, 0.50]:
                    pred_pos = p_v > thresh
                    if pred_pos.sum() > 0:
                        prec = np.mean(y_v[pred_pos])
                        prec_at[thresh] = prec

                fold_metrics.append({'fold': fold+1, 'auc': auc, 'ap': ap, 'n': len(y_v),
                                     'pos_rate': np.mean(y_v), 'prec_at': prec_at})
                prec_str = '  '.join([f'P@{t:.0%}={p:.1%}' for t, p in sorted(prec_at.items())])
                log(f"  Fold {fold+1}: AUC={auc:.4f}  AP={ap:.4f}  "
                    f"pos_rate={np.mean(y_v):.1%}  n={len(y_v)}  {prec_str}")
            else:
                log(f"  Fold {fold+1}: n={val_valid_mask.sum()} (insufficient for eval)")

        # Save probabilities
        if label_name == 'CALL':
            call_probs = probs.copy()
        else:
            put_probs = probs.copy()

        # Probability distribution
        valid_p = probs[~np.isnan(probs)]
        if len(valid_p) > 0:
            log(f"\n  OOS probability distribution:")
            for pct in [1, 5, 10, 25, 50, 75, 90, 95, 99]:
                log(f"    P{pct}: {np.percentile(valid_p, pct):.4f}")
            log(f"    Mean: {np.mean(valid_p):.4f}")

    # ── BACKTEST: LEAP-style trading ───────────────────────────────────────
    log(f"\n{'='*80}")
    log("LEAP-STYLE BACKTEST")
    log(f"{'='*80}")

    daily_ret = np.zeros(n, dtype=np.float64)
    daily_ret[1:] = (close[1:] / close[:-1]) - 1.0

    # For each entry, simulate the LEAP P&L
    # Simplified: approximate option return as leveraged stock return using delta/gamma
    # More accurate: use BS to price option at entry and exit

    # Track trades
    trades = []
    equity_curve = [1.0]
    equity_dates = [dates[0]]
    capital = 1.0
    position_size = 0.10  # Risk 10% of capital per trade
    in_trade = False
    trade_entry_idx = 0
    trade_type = None  # 'call' or 'put'
    trade_strike = 0
    trade_entry_price = 0  # Option entry price
    trade_entry_stock = 0

    # OOS mask
    oos_start = np.argmax(~np.isnan(call_probs))

    log(f"  OOS start: {dates[oos_start].date()}")
    log(f"  Testing entry thresholds for CALL and PUT separately...")

    # ── Strategy: enter call when call_prob > threshold, enter put when put_prob > threshold
    # Exit: hit target (+45% stock = ~4x option), hit stop (-15% stock = ~-60% option),
    #        or max hold reached (200d)

    for call_thresh in [0.15, 0.20, 0.25, 0.30]:
        for put_thresh in [0.15, 0.20, 0.25, 0.30]:
            capital = 1.0
            equity = [1.0]
            n_trades = 0
            n_wins = 0
            n_losses = 0
            total_pnl = 0.0
            trade_log = []
            in_trade = False

            for t in range(oos_start, n - MIN_HOLD):
                if in_trade:
                    days_held = t - trade_entry_idx
                    ret_from_entry = close[t] / trade_entry_stock - 1.0

                    # Check exit conditions
                    exit_trade = False
                    exit_reason = ''

                    if trade_type == 'call':
                        if ret_from_entry >= CALL_TARGET:
                            exit_trade = True
                            exit_reason = 'TARGET'
                        elif ret_from_entry <= CALL_STOP:
                            exit_trade = True
                            exit_reason = 'STOP'
                        elif days_held >= MAX_HORIZON:
                            exit_trade = True
                            exit_reason = 'TIMEOUT'
                    else:  # put
                        if ret_from_entry <= PUT_TARGET:
                            exit_trade = True
                            exit_reason = 'TARGET'
                        elif ret_from_entry >= PUT_STOP:
                            exit_trade = True
                            exit_reason = 'STOP'
                        elif days_held >= MAX_HORIZON:
                            exit_trade = True
                            exit_reason = 'TIMEOUT'

                    if exit_trade:
                        # Compute option P&L using BS
                        S_exit = close[t]
                        T_remaining = max((OPTION_EXPIRY_DAYS - days_held) / 365.0, 0.001)
                        vol = rolling_vol[t] if not np.isnan(rolling_vol[t]) else 0.35

                        if trade_type == 'call':
                            exit_opt_price = bs_call_price(S_exit, trade_strike, T_remaining, RISK_FREE, vol)
                        else:
                            exit_opt_price = bs_put_price(S_exit, trade_strike, T_remaining, RISK_FREE, vol)

                        opt_return = (exit_opt_price / max(trade_entry_price, 0.01)) - 1.0
                        opt_return = np.clip(opt_return, -1.0, 20.0)  # Can't lose more than 100%

                        pnl = position_size * opt_return
                        capital *= (1 + pnl)
                        total_pnl += pnl

                        if opt_return > 0:
                            n_wins += 1
                        else:
                            n_losses += 1
                        n_trades += 1

                        trade_log.append({
                            'entry_date': str(dates[trade_entry_idx].date()),
                            'exit_date': str(dates[t].date()),
                            'type': trade_type,
                            'days': days_held,
                            'stock_ret': f"{ret_from_entry:+.1%}",
                            'opt_ret': f"{opt_return:+.1%}",
                            'reason': exit_reason,
                        })
                        in_trade = False

                else:
                    # Check for entry
                    cp = call_probs[t] if not np.isnan(call_probs[t]) else 0
                    pp = put_probs[t] if not np.isnan(put_probs[t]) else 0
                    vol = rolling_vol[t] if not np.isnan(rolling_vol[t]) else 0.35

                    if cp > call_thresh and pp <= put_thresh:
                        # Enter CALL
                        in_trade = True
                        trade_entry_idx = t
                        trade_type = 'call'
                        trade_entry_stock = close[t]
                        T_entry = OPTION_EXPIRY_DAYS / 365.0
                        trade_strike = find_strike_for_delta(
                            close[t], T_entry, RISK_FREE, vol, CALL_DELTA_TARGET, 'call')
                        trade_entry_price = bs_call_price(close[t], trade_strike, T_entry, RISK_FREE, vol)

                    elif pp > put_thresh and cp <= call_thresh:
                        # Enter PUT
                        in_trade = True
                        trade_entry_idx = t
                        trade_type = 'put'
                        trade_entry_stock = close[t]
                        T_entry = OPTION_EXPIRY_DAYS / 365.0
                        trade_strike = find_strike_for_delta(
                            close[t], T_entry, RISK_FREE, vol, PUT_DELTA_TARGET, 'put')
                        trade_entry_price = bs_put_price(close[t], trade_strike, T_entry, RISK_FREE, vol)

                equity.append(capital)

            # Results
            if n_trades > 0:
                equity_arr = np.array(equity)
                total_return = capital - 1
                n_years = (n - oos_start) / 252
                ann_ret = (capital) ** (1 / max(n_years, 0.01)) - 1
                win_rate = n_wins / n_trades if n_trades > 0 else 0
                peak = np.maximum.accumulate(equity_arr)
                max_dd = np.min((equity_arr - peak) / peak)

                avg_win = np.mean([float(t['opt_ret'].strip('%+')) / 100
                                   for t in trade_log if float(t['opt_ret'].strip('%+')) > 0]) if n_wins > 0 else 0
                avg_loss = np.mean([float(t['opt_ret'].strip('%+')) / 100
                                    for t in trade_log if float(t['opt_ret'].strip('%+')) < 0]) if n_losses > 0 else 0

                log(f"\n  Call>{call_thresh:.0%} / Put>{put_thresh:.0%}:  "
                    f"Trades={n_trades}  Wins={n_wins}  Losses={n_losses}  "
                    f"WinRate={win_rate:.1%}  "
                    f"TotRet={total_return:+.1%}  AnnRet={ann_ret:+.1%}  MaxDD={max_dd:.1%}  "
                    f"AvgWin={avg_win:+.1%}  AvgLoss={avg_loss:+.1%}")

                # Show recent trades
                if trade_log:
                    log(f"    Last 10 trades:")
                    for tr in trade_log[-10:]:
                        log(f"      {tr['entry_date']} -> {tr['exit_date']}  "
                            f"{tr['type']:4s}  {tr['days']:>3d}d  "
                            f"stock={tr['stock_ret']:>8s}  option={tr['opt_ret']:>8s}  {tr['reason']}")
            else:
                log(f"\n  Call>{call_thresh:.0%} / Put>{put_thresh:.0%}:  NO TRADES")

    # ── Current signal ─────────────────────────────────────────────────
    log(f"\n{'='*80}")
    log("CURRENT SIGNAL")
    log(f"{'='*80}")
    last_cp = call_probs[-1] if not np.isnan(call_probs[-1]) else 0
    last_pp = put_probs[-1] if not np.isnan(put_probs[-1]) else 0
    log(f"  Date: {dates[-1].date()}")
    log(f"  CALL probability: {last_cp:.4f}")
    log(f"  PUT probability:  {last_pp:.4f}")
    log(f"  Signal: {'CALL' if last_cp > 0.20 else 'PUT' if last_pp > 0.20 else 'FLAT'}")

    # ── Save ───────────────────────────────────────────────────────────
    save_data = {
        'call_labels': call_labels, 'put_labels': put_labels,
        'call_probs': call_probs, 'put_probs': put_probs,
        'call_ttt': call_ttt, 'put_ttt': put_ttt,
        'call_rate': call_rate, 'put_rate': put_rate,
        'params': {
            'call_target': CALL_TARGET, 'call_stop': CALL_STOP,
            'put_target': PUT_TARGET, 'put_stop': PUT_STOP,
            'min_hold': MIN_HOLD, 'max_horizon': MAX_HORIZON,
        },
    }
    with open(RESULTS / "leap_backtest_results.pkl", 'wb') as f:
        pickle.dump(save_data, f, protocol=4)

    elapsed = time.time() - t0
    log(f"\nLEAP backtest COMPLETE in {elapsed/60:.1f} minutes")


if __name__ == "__main__":
    main()

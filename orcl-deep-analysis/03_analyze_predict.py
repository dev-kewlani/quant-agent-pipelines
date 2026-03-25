"""
Phase 3-6: Feature Screening, Modeling, Prediction, Stress Testing
====================================================================
1. Construct forward return targets at 7 horizons
2. Screen features via IC/ICIR + XGBoost importance
3. Train walk-forward XGBoost models (point + quantile regression)
4. Historical analogue matching (KNN in feature space)
5. Generate full probability distributions
6. Stress test via bootstrap + leave-year-out
7. Compile final results

Outputs:
  results/feature_screening.pkl     - IC/ICIR rankings per horizon
  results/xgb_importance.pkl        - XGBoost feature importance
  results/predictions.pkl           - Point predictions + distributions
  results/stress_tests.pkl          - Bootstrap + LYO results
  results/historical_analogues.pkl  - Nearest historical periods
  results/final_analysis.pkl        - Compiled analysis for report
"""

import pandas as pd
import numpy as np
from pathlib import Path
import pickle
import time
import warnings
import gc
from scipy import stats as scipy_stats
from numba import njit, prange
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit

warnings.filterwarnings('ignore')

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE = Path("Path(os.environ.get("DATA_DIR", "."))")
FEAT = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "features"
DATA = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "data"
RESULTS = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "results"
RESULTS.mkdir(parents=True, exist_ok=True)

# ── Configuration ──────────────────────────────────────────────────────────────
FWD_HORIZONS = [22, 44, 66, 105, 150, 200, 252]
PROB_THRESHOLDS = [-0.50, -0.40, -0.30, -0.20, -0.10, -0.05,
                    0.05, 0.10, 0.20, 0.30, 0.50, 0.75, 1.00]
TOP_FEATURES_PER_HORIZON = 500  # Top features to keep after screening
XGB_PARAMS = {
    'objective': 'reg:squarederror',
    'max_depth': 6,
    'learning_rate': 0.03,
    'subsample': 0.8,
    'colsample_bytree': 0.3,
    'min_child_weight': 50,
    'reg_alpha': 1.0,
    'reg_lambda': 5.0,
    'tree_method': 'hist',
    'device': 'cpu',
    'n_estimators': 500,
    'early_stopping_rounds': 30,
}
N_BOOTSTRAP = 200
N_ANALOGUES = 50

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3: TARGET CONSTRUCTION
# ══════════════════════════════════════════════════════════════════════════════

def construct_targets(feat_df):
    """Compute forward returns at each horizon."""
    log("Constructing forward return targets...")
    close = feat_df['L0_prc_adj'].values.astype(np.float64)
    n = len(close)
    targets = {}

    for h in FWD_HORIZONS:
        fwd_ret = np.empty(n, dtype=np.float32)
        fwd_ret[:] = np.nan
        if h < n:
            fwd_ret[:n-h] = ((close[h:] / close[:n-h]) - 1.0).astype(np.float32)
        targets[f"fwd_ret_{h}d"] = fwd_ret
        # Count valid
        valid = np.sum(~np.isnan(fwd_ret))
        log(f"  fwd_ret_{h}d: {valid} valid observations")

    targets_df = pd.DataFrame(targets, index=feat_df.index)
    return targets_df


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 4: FEATURE SCREENING
# ══════════════════════════════════════════════════════════════════════════════

@njit(cache=True)
def rank_correlation(x, y):
    """Spearman rank correlation (IC)."""
    n = len(x)
    valid = np.empty(n, dtype=np.bool_)
    for i in range(n):
        valid[i] = not (np.isnan(x[i]) or np.isnan(y[i]))
    cnt = np.sum(valid)
    if cnt < 30:
        return np.nan

    # Extract valid pairs
    xv = np.empty(cnt, dtype=np.float64)
    yv = np.empty(cnt, dtype=np.float64)
    idx = 0
    for i in range(n):
        if valid[i]:
            xv[idx] = x[i]
            yv[idx] = y[i]
            idx += 1

    # Rank
    def rank_array(arr):
        n_ = len(arr)
        order = np.argsort(arr)
        ranks = np.empty(n_, dtype=np.float64)
        for i_ in range(n_):
            ranks[order[i_]] = float(i_)
        return ranks

    rx = rank_array(xv)
    ry = rank_array(yv)

    # Pearson on ranks
    mx = np.mean(rx)
    my = np.mean(ry)
    num = np.float64(0.0)
    dx2 = np.float64(0.0)
    dy2 = np.float64(0.0)
    for i in range(cnt):
        dx = rx[i] - mx
        dy = ry[i] - my
        num += dx * dy
        dx2 += dx * dx
        dy2 += dy * dy
    den = np.sqrt(dx2 * dy2)
    return num / den if den > 1e-12 else 0.0


def rolling_ic(feature, target, window=504):
    """Rolling IC (Spearman correlation) over time."""
    n = len(feature)
    ic_values = []
    dates_valid = []

    # Compute IC in expanding windows, stepping by quarter
    step = 63  # quarterly
    for end in range(window, n, step):
        start = max(0, end - window)
        x = feature[start:end]
        y = target[start:end]
        ic = rank_correlation(x.astype(np.float64), y.astype(np.float64))
        ic_values.append(ic)
        dates_valid.append(end)

    return np.array(ic_values), np.array(dates_valid)


def screen_features(feat_df, targets_df):
    """Screen features via IC/ICIR for each horizon."""
    log("Screening features via IC/ICIR...")

    screening_results = {}
    feature_cols = [c for c in feat_df.columns if c.startswith(
        ('L0_', 'L1_', 'L2_', 'L3_', 'L4_', 'XA_', 'MACRO_', 'FF_', 'RANK_')
    )]

    for horizon_name in targets_df.columns:
        log(f"\n  Screening for {horizon_name}...")
        target = targets_df[horizon_name].values.astype(np.float64)

        ic_results = []
        for i, col in enumerate(feature_cols):
            if i % 2000 == 0 and i > 0:
                log(f"    Processed {i}/{len(feature_cols)} features...")

            feat_vals = feat_df[col].values.astype(np.float64)

            # Full-sample IC
            ic = rank_correlation(feat_vals, target)

            # Rolling IC for ICIR
            ic_series, _ = rolling_ic(feat_vals, target, window=504)
            ic_series = ic_series[~np.isnan(ic_series)]

            if len(ic_series) > 3:
                mean_ic = np.mean(ic_series)
                std_ic = np.std(ic_series)
                icir = mean_ic / std_ic if std_ic > 1e-6 else 0.0
                ic_stability = np.mean(np.sign(ic_series) == np.sign(mean_ic))
            else:
                mean_ic = ic
                icir = 0.0
                ic_stability = 0.0

            ic_results.append({
                'feature': col,
                'ic_full': ic,
                'mean_ic': mean_ic,
                'icir': icir,
                'ic_stability': ic_stability,
                'abs_icir': abs(icir),
            })

        ic_df = pd.DataFrame(ic_results)
        ic_df = ic_df.sort_values('abs_icir', ascending=False)

        # Top features
        top_features = ic_df.head(TOP_FEATURES_PER_HORIZON)['feature'].tolist()

        screening_results[horizon_name] = {
            'ic_rankings': ic_df,
            'top_features': top_features,
            'n_positive_ic': (ic_df['mean_ic'] > 0).sum(),
            'n_negative_ic': (ic_df['mean_ic'] < 0).sum(),
            'max_icir': ic_df['abs_icir'].max(),
            'top10_features': ic_df.head(10)[['feature', 'mean_ic', 'icir', 'ic_stability']].to_dict('records'),
        }
        log(f"    Top ICIR: {ic_df['abs_icir'].max():.4f}")
        log(f"    Top 5 features:")
        for _, row in ic_df.head(5).iterrows():
            log(f"      {row['feature']}: IC={row['mean_ic']:.4f}, ICIR={row['icir']:.4f}, stability={row['ic_stability']:.2f}")

    return screening_results


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5: MODELING
# ══════════════════════════════════════════════════════════════════════════════

def train_xgb_walkforward(X, y, n_folds=5):
    """Walk-forward XGBoost training with time-series cross-validation."""
    tscv = TimeSeriesSplit(n_splits=n_folds)
    models = []
    scores = []
    importances = []

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_train, X_val = X[train_idx], X[val_idx]
        y_train, y_val = y[train_idx], y[val_idx]

        # Remove rows where target is NaN
        train_mask = ~np.isnan(y_train)
        val_mask = ~np.isnan(y_val)

        if train_mask.sum() < 100 or val_mask.sum() < 20:
            continue

        X_tr = X_train[train_mask]
        y_tr = y_train[train_mask]
        X_vl = X_val[val_mask]
        y_vl = y_val[val_mask]

        # Replace NaN features with 0 for XGBoost
        X_tr = np.nan_to_num(X_tr, nan=0.0)
        X_vl = np.nan_to_num(X_vl, nan=0.0)

        dtrain = xgb.DMatrix(X_tr, label=y_tr)
        dval = xgb.DMatrix(X_vl, label=y_vl)

        params = {k: v for k, v in XGB_PARAMS.items()
                  if k not in ['n_estimators', 'early_stopping_rounds']}

        model = xgb.train(
            params, dtrain,
            num_boost_round=XGB_PARAMS['n_estimators'],
            evals=[(dval, 'val')],
            early_stopping_rounds=XGB_PARAMS['early_stopping_rounds'],
            verbose_eval=False
        )

        # Score
        y_pred = model.predict(dval)
        ic = np.corrcoef(y_pred, y_vl)[0, 1]
        rmse = np.sqrt(np.mean((y_pred - y_vl) ** 2))
        scores.append({'fold': fold, 'ic': ic, 'rmse': rmse,
                       'best_iteration': model.best_iteration})
        models.append(model)

        # Feature importance
        imp = model.get_score(importance_type='gain')
        importances.append(imp)

    return models, scores, importances


def train_xgb_quantile(X_train, y_train, X_val, y_val, quantile):
    """Train XGBoost quantile regression for a specific quantile."""
    params = {
        'objective': 'reg:quantileerror',
        'quantile_alpha': quantile,
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

    dtrain = xgb.DMatrix(X_train, label=y_train)
    dval = xgb.DMatrix(X_val, label=y_val)

    model = xgb.train(
        params, dtrain,
        num_boost_round=500,
        evals=[(dval, 'val')],
        early_stopping_rounds=30,
        verbose_eval=False
    )
    return model


def find_historical_analogues(feat_df, current_features, top_feature_names, n=50):
    """Find the N most similar historical periods in feature space."""
    log("Finding historical analogues...")

    # Get current feature vector (last row)
    current = current_features[top_feature_names].values.flatten()

    # Historical feature matrix
    hist = feat_df[top_feature_names].values

    # Normalize
    means = np.nanmean(hist, axis=0)
    stds = np.nanstd(hist, axis=0)
    stds[stds < 1e-8] = 1.0

    current_norm = (current - means) / stds
    hist_norm = (hist - means) / stds

    # Replace NaN with 0 for distance calculation
    current_norm = np.nan_to_num(current_norm, nan=0.0)
    hist_norm = np.nan_to_num(hist_norm, nan=0.0)

    # Euclidean distance
    distances = np.sqrt(np.sum((hist_norm - current_norm) ** 2, axis=1))

    # Exclude last year (too recent) and NaN-heavy rows
    nan_frac = np.isnan(feat_df[top_feature_names].values).mean(axis=1)
    mask = (nan_frac < 0.3)
    # Exclude last 252 rows (lookahead)
    mask[-252:] = False

    distances[~mask] = np.inf

    # Top N nearest
    nearest_idx = np.argsort(distances)[:n]
    nearest_dates = feat_df.index[nearest_idx]
    nearest_distances = distances[nearest_idx]

    return nearest_idx, nearest_dates, nearest_distances


def compute_probability_distributions(predictions, targets_df, historical_fwd_returns):
    """Compute full probability distributions for each horizon."""
    log("Computing probability distributions...")

    distributions = {}

    for horizon_name in targets_df.columns:
        h = int(horizon_name.split('_')[-1].replace('d', ''))
        dist = {}

        # 1. Historical unconditional distribution
        hist_rets = targets_df[horizon_name].dropna().values
        dist['hist_mean'] = float(np.mean(hist_rets))
        dist['hist_median'] = float(np.median(hist_rets))
        dist['hist_std'] = float(np.std(hist_rets))
        dist['hist_skew'] = float(scipy_stats.skew(hist_rets))
        dist['hist_kurt'] = float(scipy_stats.kurtosis(hist_rets))

        # Percentiles
        percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
        for p in percentiles:
            dist[f'hist_pct_{p}'] = float(np.percentile(hist_rets, p))

        # 2. Probability of exceeding each threshold
        for thresh in PROB_THRESHOLDS:
            dist[f'prob_exceed_{thresh:.2f}'] = float(np.mean(hist_rets > thresh))

        # 3. Model-conditioned predictions (if available)
        if horizon_name in predictions and predictions[horizon_name] is not None:
            pred = predictions[horizon_name]
            dist['model_prediction'] = float(pred['point_estimate'])
            if 'quantile_estimates' in pred:
                for q, val in pred['quantile_estimates'].items():
                    dist[f'model_q{q:.2f}'] = float(val)

        # 4. Historical analogue distribution
        if horizon_name in historical_fwd_returns:
            analogue_rets = historical_fwd_returns[horizon_name]
            analogue_rets = analogue_rets[~np.isnan(analogue_rets)]
            if len(analogue_rets) > 5:
                dist['analogue_mean'] = float(np.mean(analogue_rets))
                dist['analogue_median'] = float(np.median(analogue_rets))
                dist['analogue_std'] = float(np.std(analogue_rets))
                for p in percentiles:
                    dist[f'analogue_pct_{p}'] = float(np.percentile(analogue_rets, p))
                for thresh in PROB_THRESHOLDS:
                    dist[f'analogue_prob_exceed_{thresh:.2f}'] = float(np.mean(analogue_rets > thresh))

        # 5. Combined probability estimate (weighted average of approaches)
        # Weight: 40% model, 35% analogue, 25% historical
        for thresh in PROB_THRESHOLDS:
            probs = []
            weights = []

            # Historical
            if f'prob_exceed_{thresh:.2f}' in dist:
                probs.append(dist[f'prob_exceed_{thresh:.2f}'])
                weights.append(0.25)

            # Analogue
            if f'analogue_prob_exceed_{thresh:.2f}' in dist:
                probs.append(dist[f'analogue_prob_exceed_{thresh:.2f}'])
                weights.append(0.35)

            # Model (estimate from quantile predictions if available)
            if 'model_prediction' in dist and 'model_q0.10' in dist:
                # Interpolate from quantile estimates
                qvals = []
                qlevels = []
                for qname, qval in dist.items():
                    if qname.startswith('model_q'):
                        try:
                            ql = float(qname.replace('model_q', ''))
                            qvals.append(qval)
                            qlevels.append(ql)
                        except ValueError:
                            pass
                if qvals:
                    # Estimate P(ret > thresh) from quantile function
                    sorted_idx = np.argsort(qlevels)
                    qlevels = np.array(qlevels)[sorted_idx]
                    qvals = np.array(qvals)[sorted_idx]
                    # Interpolate: find quantile level where value = thresh
                    if thresh <= qvals[0]:
                        model_prob = 1.0 - qlevels[0]
                    elif thresh >= qvals[-1]:
                        model_prob = max(0.0, 1.0 - qlevels[-1])
                    else:
                        model_prob = float(1.0 - np.interp(thresh, qvals, qlevels))
                    probs.append(model_prob)
                    weights.append(0.40)

            if probs:
                total_w = sum(weights)
                combined = sum(p * w for p, w in zip(probs, weights)) / total_w
                dist[f'combined_prob_exceed_{thresh:.2f}'] = combined

        distributions[horizon_name] = dist

    return distributions


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 6: STRESS TESTING
# ══════════════════════════════════════════════════════════════════════════════

def bootstrap_predictions(X, y, feature_names, n_bootstrap=500):
    """Bootstrap to estimate prediction uncertainty."""
    log(f"Running bootstrap ({n_bootstrap} iterations)...")
    n = len(y)
    predictions = []

    # Use last 252 days as hold-out
    X_train = X[:-252]
    y_train = y[:-252]
    X_current = X[-1:].copy()

    valid_train = ~np.isnan(y_train)
    X_train_valid = np.nan_to_num(X_train[valid_train], nan=0.0)
    y_train_valid = y_train[valid_train]

    if len(y_train_valid) < 100:
        return np.array([])

    X_current_clean = np.nan_to_num(X_current, nan=0.0)

    params = {
        'objective': 'reg:squarederror',
        'max_depth': 5,
        'learning_rate': 0.05,
        'subsample': 0.7,
        'colsample_bytree': 0.3,
        'min_child_weight': 50,
        'tree_method': 'hist',
        'device': 'cpu',
    }

    for i in range(n_bootstrap):
        # Resample with replacement
        idx = np.random.choice(len(y_train_valid), size=len(y_train_valid), replace=True)
        X_boot = X_train_valid[idx]
        y_boot = y_train_valid[idx]

        dtrain = xgb.DMatrix(X_boot, label=y_boot)
        dcurr = xgb.DMatrix(X_current_clean)

        model = xgb.train(params, dtrain, num_boost_round=200, verbose_eval=False)
        pred = model.predict(dcurr)[0]
        predictions.append(pred)

        if (i + 1) % 100 == 0:
            log(f"    Bootstrap {i+1}/{n_bootstrap}")

    return np.array(predictions)


def leave_year_out_test(X, y, feature_names):
    """Leave-one-year-out cross-validation for robustness."""
    log("Running leave-year-out validation...")

    # Get years
    # This is a simplification - use indices as proxy for years
    n = len(y)
    year_size = 252
    n_years = n // year_size

    results = []
    for yr in range(2, n_years):  # Start from year 2 to have training data
        val_start = yr * year_size
        val_end = min((yr + 1) * year_size, n)

        train_mask = np.ones(n, dtype=bool)
        train_mask[val_start:val_end] = False

        y_train = y[train_mask]
        y_val = y[val_start:val_end]

        valid_train = ~np.isnan(y_train)
        valid_val = ~np.isnan(y_val)

        if valid_train.sum() < 100 or valid_val.sum() < 10:
            continue

        X_train = np.nan_to_num(X[train_mask][valid_train], nan=0.0)
        y_train = y_train[valid_train]
        X_val = np.nan_to_num(X[val_start:val_end][valid_val], nan=0.0)
        y_val = y_val[valid_val]

        params = {
            'objective': 'reg:squarederror',
            'max_depth': 5,
            'learning_rate': 0.05,
            'subsample': 0.8,
            'colsample_bytree': 0.3,
            'min_child_weight': 50,
            'tree_method': 'hist',
            'device': 'cpu',
        }

        dtrain = xgb.DMatrix(X_train, label=y_train)
        dval = xgb.DMatrix(X_val, label=y_val)

        model = xgb.train(params, dtrain, num_boost_round=300, verbose_eval=False)
        y_pred = model.predict(dval)

        ic = np.corrcoef(y_pred, y_val)[0, 1] if len(y_val) > 2 else np.nan
        rmse = np.sqrt(np.mean((y_pred - y_val) ** 2))

        results.append({'year_idx': yr, 'ic': ic, 'rmse': rmse, 'n_samples': len(y_val)})

    return results


# ══════════════════════════════════════════════════════════════════════════════
# MAIN ORCHESTRATOR
# ══════════════════════════════════════════════════════════════════════════════

def main():
    t0 = time.time()

    # ── Load Features ──────────────────────────────────────────────────────
    log("Loading feature matrix...")
    feat_df = pd.read_parquet(FEAT / "all_features.parquet")
    feat_df.index = pd.to_datetime(feat_df.index)
    log(f"Feature matrix: {feat_df.shape}")

    with open(FEAT / "feature_metadata.pkl", 'rb') as f:
        metadata = pickle.load(f)

    # ── Phase 3: Targets ───────────────────────────────────────────────────
    targets_df = construct_targets(feat_df)
    targets_df.to_parquet(RESULTS / "targets.parquet")

    # ── Phase 4: Feature Screening ─────────────────────────────────────────
    screening = screen_features(feat_df, targets_df)
    with open(RESULTS / "feature_screening.pkl", 'wb') as f:
        pickle.dump(screening, f, protocol=4)
    log("Saved feature_screening.pkl")

    # ── Phase 5: Modeling ──────────────────────────────────────────────────
    log("\n" + "=" * 60)
    log("PHASE 5: MODELING")
    log("=" * 60)

    all_predictions = {}
    all_importances = {}
    all_models = {}

    for horizon_name in targets_df.columns:
        log(f"\n--- Modeling {horizon_name} ---")
        target = targets_df[horizon_name].values.astype(np.float64)

        # Get top features for this horizon
        top_features = screening[horizon_name]['top_features']
        if len(top_features) == 0:
            log(f"  No predictive features found, skipping")
            continue

        X = feat_df[top_features].values.astype(np.float32)
        y = target

        # Walk-forward XGBoost
        log("  Training walk-forward XGBoost...")
        models, scores, importances = train_xgb_walkforward(X, y, n_folds=5)

        if not models:
            log(f"  No valid models trained, skipping")
            continue

        # Point prediction using last model on current features
        X_current = X[-1:].copy()
        X_current = np.nan_to_num(X_current, nan=0.0)
        dcurr = xgb.DMatrix(X_current)

        point_estimates = [m.predict(dcurr)[0] for m in models]
        point_mean = float(np.mean(point_estimates))
        point_std = float(np.std(point_estimates))

        log(f"  Point estimate: {point_mean:.4f} (±{point_std:.4f})")
        ic_strs = [f"{s['ic']:.4f}" for s in scores]
        log(f"  Walk-forward ICs: {ic_strs}")

        # Quantile regression for distribution
        log("  Training quantile regression...")
        quantiles = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]
        quantile_estimates = {}

        # Use all data except last year for training, last year for validation
        valid = ~np.isnan(y)
        X_valid = X[valid]
        y_valid = y[valid]

        # Train/val split (temporal)
        split_idx = int(len(y_valid) * 0.85)
        X_tr = np.nan_to_num(X_valid[:split_idx], nan=0.0)
        y_tr = y_valid[:split_idx]
        X_vl = np.nan_to_num(X_valid[split_idx:], nan=0.0)
        y_vl = y_valid[split_idx:]

        for q in quantiles:
            try:
                q_model = train_xgb_quantile(X_tr, y_tr, X_vl, y_vl, q)
                q_pred = q_model.predict(dcurr)[0]
                quantile_estimates[q] = float(q_pred)
            except Exception as e:
                log(f"    WARNING: Quantile {q} failed: {e}")

        # Feature importance aggregation
        agg_importance = {}
        for imp_dict in importances:
            for feat_idx_str, gain in imp_dict.items():
                feat_idx = int(feat_idx_str.replace('f', ''))
                if feat_idx < len(top_features):
                    fname = top_features[feat_idx]
                    agg_importance[fname] = agg_importance.get(fname, 0.0) + gain

        # Sort by importance
        sorted_imp = sorted(agg_importance.items(), key=lambda x: x[1], reverse=True)

        all_predictions[horizon_name] = {
            'point_estimate': point_mean,
            'point_std': point_std,
            'point_estimates_per_fold': [float(p) for p in point_estimates],
            'quantile_estimates': quantile_estimates,
            'walk_forward_scores': scores,
        }
        all_importances[horizon_name] = sorted_imp[:100]  # Top 100

        log(f"  Quantile estimates: {quantile_estimates}")
        log(f"  Top 5 features by importance:")
        for fname, gain in sorted_imp[:5]:
            log(f"    {fname}: {gain:.1f}")

    # ── Historical Analogues ───────────────────────────────────────────────
    log("\n" + "=" * 60)
    log("HISTORICAL ANALOGUES")
    log("=" * 60)

    # Use top features from the 66d horizon (median horizon)
    analogue_features = screening.get('fwd_ret_66d', {}).get('top_features', [])[:100]
    if not analogue_features:
        analogue_features = list(feat_df.columns[:100])

    nearest_idx, nearest_dates, nearest_distances = find_historical_analogues(
        feat_df, feat_df.iloc[[-1]], analogue_features, n=N_ANALOGUES
    )

    # Get forward returns for analogue periods
    historical_fwd_returns = {}
    for horizon_name in targets_df.columns:
        rets = targets_df[horizon_name].values[nearest_idx]
        historical_fwd_returns[horizon_name] = rets
        valid_rets = rets[~np.isnan(rets)]
        if len(valid_rets) > 0:
            log(f"  {horizon_name} analogue returns: mean={np.mean(valid_rets):.4f}, "
                f"median={np.median(valid_rets):.4f}, std={np.std(valid_rets):.4f}")

    analogue_results = {
        'nearest_dates': nearest_dates,
        'nearest_distances': nearest_distances,
        'forward_returns': historical_fwd_returns,
    }
    with open(RESULTS / "historical_analogues.pkl", 'wb') as f:
        pickle.dump(analogue_results, f, protocol=4)

    # ── Probability Distributions ──────────────────────────────────────────
    log("\n" + "=" * 60)
    log("PROBABILITY DISTRIBUTIONS")
    log("=" * 60)

    distributions = compute_probability_distributions(
        all_predictions, targets_df, historical_fwd_returns
    )

    for horizon_name, dist in distributions.items():
        h = horizon_name.split('_')[-1]
        log(f"\n  {horizon_name}:")
        log(f"    Historical: mean={dist.get('hist_mean', 0):.4f}, median={dist.get('hist_median', 0):.4f}")
        if 'model_prediction' in dist:
            log(f"    Model prediction: {dist['model_prediction']:.4f}")
        if 'analogue_mean' in dist:
            log(f"    Analogue: mean={dist['analogue_mean']:.4f}, median={dist['analogue_median']:.4f}")

        # Key probabilities
        for thresh in [0.10, 0.20, 0.50, 1.00, -0.10, -0.20, -0.50]:
            key = f'combined_prob_exceed_{thresh:.2f}'
            if key in dist:
                direction = "gain" if thresh > 0 else "loss"
                log(f"    P(>{thresh:+.0%}) = {dist[key]:.4f}")

    # ── Phase 6: Stress Testing ────────────────────────────────────────────
    log("\n" + "=" * 60)
    log("PHASE 6: STRESS TESTING")
    log("=" * 60)

    stress_results = {}
    for horizon_name in targets_df.columns:
        log(f"\n  Stress testing {horizon_name}...")
        target = targets_df[horizon_name].values.astype(np.float64)
        top_features = screening[horizon_name]['top_features'][:200]

        if not top_features:
            continue

        X = feat_df[top_features].values.astype(np.float32)

        # Bootstrap
        boot_preds = bootstrap_predictions(X, target, top_features, n_bootstrap=N_BOOTSTRAP)

        # Leave-year-out
        lyo_results = leave_year_out_test(X, target, top_features)

        stress_results[horizon_name] = {
            'bootstrap': {
                'mean': float(np.mean(boot_preds)) if len(boot_preds) > 0 else None,
                'std': float(np.std(boot_preds)) if len(boot_preds) > 0 else None,
                'ci_5': float(np.percentile(boot_preds, 5)) if len(boot_preds) > 0 else None,
                'ci_95': float(np.percentile(boot_preds, 95)) if len(boot_preds) > 0 else None,
                'n_samples': len(boot_preds),
            },
            'leave_year_out': {
                'mean_ic': float(np.mean([r['ic'] for r in lyo_results])) if lyo_results else None,
                'std_ic': float(np.std([r['ic'] for r in lyo_results])) if lyo_results else None,
                'mean_rmse': float(np.mean([r['rmse'] for r in lyo_results])) if lyo_results else None,
                'n_years': len(lyo_results),
                'per_year': lyo_results,
            }
        }

        if len(boot_preds) > 0:
            log(f"    Bootstrap: mean={np.mean(boot_preds):.4f}, "
                f"CI=[{np.percentile(boot_preds, 5):.4f}, {np.percentile(boot_preds, 95):.4f}]")
        if lyo_results:
            log(f"    LYO mean IC: {np.mean([r['ic'] for r in lyo_results]):.4f}")

    with open(RESULTS / "stress_tests.pkl", 'wb') as f:
        pickle.dump(stress_results, f, protocol=4)

    # ── Save All Results ───────────────────────────────────────────────────
    final_results = {
        'predictions': all_predictions,
        'distributions': distributions,
        'importances': all_importances,
        'screening_summary': {
            h: {
                'max_icir': s['max_icir'],
                'top10': s['top10_features'],
            }
            for h, s in screening.items()
        },
        'stress_tests': stress_results,
        'analogue_results': {
            'nearest_dates': [str(d) for d in nearest_dates],
            'nearest_distances': nearest_distances.tolist(),
        },
        'metadata': {
            'n_total_features': feat_df.shape[1],
            'n_observations': feat_df.shape[0],
            'date_range': (str(feat_df.index.min()), str(feat_df.index.max())),
            'last_date': str(feat_df.index.max()),
            'horizons': FWD_HORIZONS,
        }
    }

    with open(RESULTS / "final_analysis.pkl", 'wb') as f:
        pickle.dump(final_results, f, protocol=4)
    log("\nSaved final_analysis.pkl")

    with open(RESULTS / "predictions.pkl", 'wb') as f:
        pickle.dump(all_predictions, f, protocol=4)
    log("Saved predictions.pkl")

    with open(RESULTS / "distributions.pkl", 'wb') as f:
        pickle.dump(distributions, f, protocol=4)
    log("Saved distributions.pkl")

    elapsed = time.time() - t0
    log(f"\nPhases 3-6 COMPLETE in {elapsed/60:.1f} minutes")
    log("=" * 60)


if __name__ == "__main__":
    main()

"""
Cross-Sectional Pipeline — Step 5: Neutralized Portfolio Backtest
==================================================================
Constructs portfolios that are:
  1. Dollar neutral (long = short exposure)
  2. Market neutral (beta-hedged via equal long/short)
  3. Sector neutral (equal long/short WITHIN each GICS sector)
  4. Size neutral (equal long/short WITHIN each size bucket)
  5. Sector + Size neutral (double-sort neutralization)

Uses walk-forward model probabilities from Step 4.
Tests K = [5, 10, 15, 20, 30, 40, 50, 75, 100] per side.

Outputs:
  xs_pipeline/results/neutralized_results.parquet
  xs_pipeline/results/feature_importance.pkl
"""

import pandas as pd
import numpy as np
from pathlib import Path
import pickle
import time
import gc
import warnings

warnings.filterwarnings('ignore')

BASE = Path("Path(os.environ.get("DATA_DIR", "."))")
CHUNKS_DIR = BASE / "Idea 2 - CRSP_COMPUSTAT" / "data" / "data_cleaned"
LABEL_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "labels"
RESULT_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "results"

HORIZONS = [22, 66, 150, 252]
K_VALUES = [5, 10, 15, 20, 30, 40, 50, 75, 100]
SIZE_BUCKETS = 5  # Quintiles


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_sector_size_map():
    """Load sector and market cap for all stocks at each date."""
    log("Loading sector/size classifications from chunks...")
    records = []
    for cf in sorted(CHUNKS_DIR.glob("chunk_*_filtered_gapDays.parquet")):
        df = pd.read_parquet(cf, columns=['date', 'ticker', 'mktcap', 'gsector', 'ffi12'])
        df['date'] = pd.to_datetime(df['date'])
        df = df[df['date'] >= pd.Timestamp('2000-01-01')]
        records.append(df)
    full = pd.concat(records, ignore_index=True)
    full['gsector'] = full['gsector'].fillna('Unknown')
    full['ffi12'] = full['ffi12'].fillna(-1).astype(int).astype(str)
    full['mktcap'] = full['mktcap'].astype(np.float64)
    log(f"  Sector/size map: {full['ticker'].nunique()} stocks, {len(full)} rows")
    return full


def assign_size_bucket(mktcap_series, n_buckets=SIZE_BUCKETS):
    """Assign size quintile within a cross-section."""
    valid = mktcap_series.dropna()
    if len(valid) < n_buckets * 2:
        return pd.Series(np.nan, index=mktcap_series.index)
    return pd.qcut(mktcap_series, n_buckets, labels=False, duplicates='drop')


def load_model_probs(horizon):
    """Load saved model probabilities for a horizon."""
    probs = {}
    for label in ['label_return', 'label_drawdown', 'label_combined']:
        path = RESULT_DIR / f"model_probs_{horizon}d_{label}.pkl"
        if path.exists():
            with open(path, 'rb') as f:
                data = pickle.load(f)
            probs[label] = data['probs']
    return probs


def build_scored_snapshots(horizon):
    """Load dataset, attach model scores, sector, size. Return list of per-date DataFrames."""
    dataset_path = LABEL_DIR / f"dataset_{horizon}d.parquet"
    if not dataset_path.exists():
        return []

    log(f"  Loading dataset_{horizon}d...")
    dataset = pd.read_parquet(dataset_path)
    dataset['date'] = pd.to_datetime(dataset['date'])

    # Load model probs
    probs = load_model_probs(horizon)
    if 'label_return' in probs:
        dataset['prob_return'] = probs['label_return']
    if 'label_drawdown' in probs:
        dataset['prob_drawdown'] = probs['label_drawdown']

    # Score variants
    pr = dataset['prob_return'].fillna(0).values
    pd_vals = dataset['prob_drawdown'].fillna(0).values
    dataset['score_return'] = pr
    dataset['score_min'] = np.minimum(pr, pd_vals)
    dataset['score_product'] = pr * pd_vals
    dataset['score_avg'] = (pr + pd_vals) / 2
    dataset['score_wt70'] = 0.7 * pr + 0.3 * pd_vals

    # Load sector/size
    sector_map = load_sector_size_map()

    # Merge sector/size (use most recent non-null per ticker-date)
    dataset = dataset.merge(
        sector_map[['date', 'ticker', 'gsector', 'ffi12', 'mktcap']].rename(
            columns={'mktcap': 'mktcap_raw'}),
        on=['date', 'ticker'], how='left'
    )
    dataset['gsector'] = dataset['gsector'].fillna('Unknown')

    # Assign size buckets per date
    size_buckets = []
    for d, grp in dataset.groupby('date'):
        mc = grp['mktcap_raw']
        bucket = assign_size_bucket(mc)
        size_buckets.append(pd.Series(bucket.values, index=grp.index))
    dataset['size_bucket'] = pd.concat(size_buckets).sort_index()

    log(f"  Scored dataset: {len(dataset)} rows, sectors: {dataset['gsector'].nunique()}, "
        f"size buckets: {dataset['size_bucket'].nunique()}")

    return dataset


def neutralized_portfolio(snapshot, score_col, K, method='dollar_neutral'):
    """
    Construct neutralized portfolio from a single-date snapshot.

    Methods:
      dollar_neutral: top K long, bottom K short, equal weight
      sector_neutral: within each sector, top/bottom proportional
      size_neutral: within each size bucket, top/bottom proportional
      sector_size_neutral: within each sector x size cell
    """
    snap = snapshot.dropna(subset=[score_col, 'fwd_terminal']).copy()
    if len(snap) < K * 4:
        return None

    snap['rank'] = snap[score_col].rank(pct=True)
    n = len(snap)

    if method == 'dollar_neutral':
        long_mask = snap['rank'] >= (1 - K / n)
        short_mask = snap['rank'] <= (K / n)
        longs = snap[long_mask]
        shorts = snap[short_mask]
        if len(longs) == 0 or len(shorts) == 0:
            return None
        long_ret = longs['fwd_terminal'].mean()
        short_ret = shorts['fwd_terminal'].mean()
        port_ret = (long_ret - short_ret) / 2.0
        return {'return': port_ret, 'long_ret': long_ret, 'short_ret': short_ret,
                'n_long': len(longs), 'n_short': len(shorts)}

    elif method == 'sector_neutral':
        all_long_rets = []
        all_short_rets = []
        all_long_w = []
        all_short_w = []

        for sector, grp in snap.groupby('gsector'):
            if len(grp) < 10:
                continue
            grp = grp.copy()
            grp['sect_rank'] = grp[score_col].rank(pct=True)
            k_sect = max(1, int(K * len(grp) / n))  # Proportional K
            longs = grp.nlargest(k_sect, score_col)
            shorts = grp.nsmallest(k_sect, score_col)
            if len(longs) > 0 and len(shorts) > 0:
                all_long_rets.append(longs['fwd_terminal'].mean())
                all_short_rets.append(shorts['fwd_terminal'].mean())
                all_long_w.append(len(longs))
                all_short_w.append(len(shorts))

        if not all_long_rets:
            return None
        total_lw = sum(all_long_w)
        total_sw = sum(all_short_w)
        long_ret = sum(r * w for r, w in zip(all_long_rets, all_long_w)) / total_lw
        short_ret = sum(r * w for r, w in zip(all_short_rets, all_short_w)) / total_sw
        port_ret = (long_ret - short_ret) / 2.0
        return {'return': port_ret, 'long_ret': long_ret, 'short_ret': short_ret,
                'n_long': total_lw, 'n_short': total_sw}

    elif method == 'size_neutral':
        all_long_rets = []
        all_short_rets = []
        all_long_w = []
        all_short_w = []

        for bucket, grp in snap.groupby('size_bucket'):
            if len(grp) < 10:
                continue
            k_bucket = max(1, int(K * len(grp) / n))
            longs = grp.nlargest(k_bucket, score_col)
            shorts = grp.nsmallest(k_bucket, score_col)
            if len(longs) > 0 and len(shorts) > 0:
                all_long_rets.append(longs['fwd_terminal'].mean())
                all_short_rets.append(shorts['fwd_terminal'].mean())
                all_long_w.append(len(longs))
                all_short_w.append(len(shorts))

        if not all_long_rets:
            return None
        total_lw = sum(all_long_w)
        total_sw = sum(all_short_w)
        long_ret = sum(r * w for r, w in zip(all_long_rets, all_long_w)) / total_lw
        short_ret = sum(r * w for r, w in zip(all_short_rets, all_short_w)) / total_sw
        port_ret = (long_ret - short_ret) / 2.0
        return {'return': port_ret, 'long_ret': long_ret, 'short_ret': short_ret,
                'n_long': total_lw, 'n_short': total_sw}

    elif method == 'sector_size_neutral':
        all_long_rets = []
        all_short_rets = []
        all_long_w = []
        all_short_w = []

        snap['cell'] = snap['gsector'].astype(str) + '_' + snap['size_bucket'].astype(str)
        for cell, grp in snap.groupby('cell'):
            if len(grp) < 6:
                continue
            k_cell = max(1, int(K * len(grp) / n))
            longs = grp.nlargest(k_cell, score_col)
            shorts = grp.nsmallest(k_cell, score_col)
            if len(longs) > 0 and len(shorts) > 0:
                all_long_rets.append(longs['fwd_terminal'].mean())
                all_short_rets.append(shorts['fwd_terminal'].mean())
                all_long_w.append(len(longs))
                all_short_w.append(len(shorts))

        if not all_long_rets:
            return None
        total_lw = sum(all_long_w)
        total_sw = sum(all_short_w)
        long_ret = sum(r * w for r, w in zip(all_long_rets, all_long_w)) / total_lw
        short_ret = sum(r * w for r, w in zip(all_short_rets, all_short_w)) / total_sw
        port_ret = (long_ret - short_ret) / 2.0
        return {'return': port_ret, 'long_ret': long_ret, 'short_ret': short_ret,
                'n_long': total_lw, 'n_short': total_sw}


def compute_metrics(returns):
    rets = np.array(returns)
    rets = rets[~np.isnan(rets)]
    if len(rets) < 10:
        return None
    cum = np.cumprod(1 + rets)
    ppyr = 252 / 22
    n_yrs = len(rets) / ppyr
    ann_ret = cum[-1] ** (1 / max(n_yrs, 0.01)) - 1
    ann_vol = np.std(rets) * np.sqrt(ppyr)
    sharpe = ann_ret / ann_vol if ann_vol > 0 else 0
    down = rets[rets < 0]
    down_vol = np.std(down) * np.sqrt(ppyr) if len(down) > 0 else 1
    sortino = ann_ret / down_vol
    peak = np.maximum.accumulate(cum)
    max_dd = np.min((cum - peak) / peak)
    win_rate = np.mean(rets > 0)
    return {
        'ann_return': ann_ret, 'sharpe': sharpe, 'sortino': sortino,
        'max_drawdown': max_dd, 'win_rate': win_rate, 'total_return': cum[-1] - 1,
        'n_periods': len(rets), 'n_years': n_yrs, 'ann_vol': ann_vol,
        'avg_long_ret': np.nan, 'avg_short_ret': np.nan,
    }


def main():
    t0 = time.time()
    log("NEUTRALIZED PORTFOLIO BACKTEST")

    score_variants = ['score_return', 'score_min', 'score_product', 'score_wt70']
    methods = ['dollar_neutral', 'sector_neutral', 'size_neutral', 'sector_size_neutral']
    all_results = []

    for horizon in HORIZONS:
        log(f"\n{'='*80}")
        log(f"HORIZON: {horizon}d")
        log(f"{'='*80}")

        dataset = build_scored_snapshots(horizon)
        if isinstance(dataset, list) and len(dataset) == 0:
            continue

        rebal_dates = sorted(dataset['date'].unique())
        valid_dates = [d for d in rebal_dates if dataset[dataset['date'] == d].dropna(
            subset=['score_return', 'fwd_terminal']).shape[0] >= 100]

        log(f"  Valid rebalance dates: {len(valid_dates)}")

        for score_col in score_variants:
            for method in methods:
                for K in K_VALUES:
                    port_rets = []
                    long_rets = []
                    short_rets = []

                    for rd in valid_dates:
                        snap = dataset[dataset['date'] == rd]
                        result = neutralized_portfolio(snap, score_col, K, method)
                        if result:
                            port_rets.append(result['return'])
                            long_rets.append(result['long_ret'])
                            short_rets.append(result['short_ret'])

                    if len(port_rets) < 10:
                        continue

                    metrics = compute_metrics(port_rets)
                    if metrics is None:
                        continue

                    metrics['avg_long_ret'] = float(np.mean(long_rets))
                    metrics['avg_short_ret'] = float(np.mean(short_rets))
                    metrics['horizon'] = horizon
                    metrics['score'] = score_col.replace('score_', '')
                    metrics['method'] = method
                    metrics['K'] = K
                    all_results.append(metrics)

            # Save incrementally
            pd.DataFrame(all_results).to_parquet(
                RESULT_DIR / "neutralized_results.parquet", index=False)

        del dataset
        gc.collect()

    results_df = pd.DataFrame(all_results)
    results_df.to_parquet(RESULT_DIR / "neutralized_results.parquet", index=False)

    # ── Print Results ──────────────────────────────────────────────────────
    log(f"\n\n{'='*130}")
    log("ALL NEUTRALIZED RESULTS — SORTED BY SHARPE")
    log(f"{'='*130}")

    clean = results_df[results_df['sharpe'].notna() & np.isfinite(results_df['sharpe'])]
    sorted_df = clean.sort_values('sharpe', ascending=False)

    log(f"\n{'Hz':>4s} {'Score':<12s} {'Method':<22s} {'K':>4s} {'AnnRet':>8s} {'Sharpe':>8s} "
        f"{'Sortino':>8s} {'MaxDD':>8s} {'WinR':>6s} {'AvgL':>8s} {'AvgS':>8s}")
    log("-" * 110)

    for _, row in sorted_df.head(60).iterrows():
        log(f"{row['horizon']:>3d}d {row['score']:<12s} {row['method']:<22s} {row['K']:>4d} "
            f"{row['ann_return']:>+8.2%} {row['sharpe']:>8.3f} {row['sortino']:>8.3f} "
            f"{row['max_drawdown']:>8.2%} {row['win_rate']:>5.1%} "
            f"{row['avg_long_ret']:>+8.2%} {row['avg_short_ret']:>+8.2%}")

    # ── Per-method comparison (best score/K for each method) ───────────────
    log(f"\n\n{'='*130}")
    log("BEST STRATEGY PER NEUTRALIZATION METHOD")
    log(f"{'='*130}")

    for method in methods:
        m_df = sorted_df[sorted_df['method'] == method]
        if len(m_df) > 0:
            best = m_df.iloc[0]
            log(f"\n  {method:25s}: {best['horizon']:>3d}d  score={best['score']:<12s}  K={best['K']:>4d}  "
                f"Sharpe={best['sharpe']:.3f}  AnnRet={best['ann_return']:+.2%}  "
                f"MaxDD={best['max_drawdown']:.2%}  WinRate={best['win_rate']:.1%}")

    # ── 66d focus (best horizon) ───────────────────────────────────────────
    log(f"\n\n{'='*130}")
    log("66d HORIZON — ALL METHODS COMPARED")
    log(f"{'='*130}")

    h66 = sorted_df[sorted_df['horizon'] == 66]
    for method in methods:
        log(f"\n  {method}:")
        sub = h66[h66['method'] == method].head(10)
        for _, row in sub.iterrows():
            log(f"    {row['score']:<12s} K={row['K']:>4d}  "
                f"AnnRet={row['ann_return']:>+8.2%}  Sharpe={row['sharpe']:>8.3f}  "
                f"MaxDD={row['max_drawdown']:>8.2%}  WinR={row['win_rate']:>5.1%}  "
                f"L={row['avg_long_ret']:>+6.2%} S={row['avg_short_ret']:>+6.2%}")

    # ── Save full feature list ─────────────────────────────────────────────
    with open(LABEL_DIR / "universe_stats.pkl", 'rb') as f:
        stats = pickle.load(f)

    feature_report = {
        'per_stock_features': stats['feature_cols'],
        'xs_rank_features': [f'xs_{c}' for c in stats['feature_cols']],
        'macro_ff_features': stats['macro_cols'],
        'total_features': len(stats['feature_cols']) + len(stats['feature_cols']) + len(stats['macro_cols']),
        'feature_categories': {
            'L0_base': [c for c in stats['feature_cols'] if not c.startswith(('L2_', 'L3_'))
                        and not c.startswith(('ret_', 'logvol_', 'rsi_', 'bb_', 'atr_', 'mom_',
                                              'price_vs_', 'vol_', 'drawdown', 'macd'))],
            'L1_technical': [c for c in stats['feature_cols'] if c.startswith(('ret_', 'logvol_',
                             'rsi_', 'bb_', 'atr_', 'mom_', 'price_vs_', 'vol_', 'drawdown', 'macd'))],
            'L2_changes': [c for c in stats['feature_cols'] if c.startswith('L2_')],
            'L3_acceleration': [c for c in stats['feature_cols'] if c.startswith('L3_')],
        }
    }
    with open(RESULT_DIR / "feature_list_full.pkl", 'wb') as f:
        pickle.dump(feature_report, f)
    log(f"\nSaved feature_list_full.pkl ({feature_report['total_features']} total features)")

    elapsed = time.time() - t0
    log(f"\nNeutralized backtest COMPLETE in {elapsed/60:.1f} minutes")
    log(f"Total configurations tested: {len(results_df)}")


if __name__ == "__main__":
    main()

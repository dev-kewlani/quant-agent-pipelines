"""
Cross-Sectional Pipeline — Step 2: Labels + Ranks + Dataset Assembly
=====================================================================
1. Load all chunk features
2. At each rebalance date (every 22d):
   a. Cross-sectional percentile ranks of all features
   b. Forward returns (path-dependent: running max for return, running min for drawdown)
   c. Cross-sectional rank of forward returns and drawdowns
   d. Labels: return_rank >= 70th pctile, drawdown_rank >= 70th pctile
3. Merge with macro/FF features
4. Save training dataset

Outputs:
  xs_pipeline/labels/dataset_{horizon}d.parquet   (per horizon)
  xs_pipeline/labels/universe_stats.pkl           (universe counts, dates)
"""

import pandas as pd
import numpy as np
from numba import njit, prange
from pathlib import Path
import pickle
import time
import gc
import warnings

warnings.filterwarnings('ignore')

BASE = Path("Path(os.environ.get("DATA_DIR", "."))")
FEAT_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "features"
LABEL_DIR = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "labels"
LABEL_DIR.mkdir(parents=True, exist_ok=True)

REBAL_FREQ = 22  # Rebalance every 22 trading days
HORIZONS = [22, 66, 150, 252]
RETURN_PCTILE = 70  # Top 30% = label 1
DRAWDOWN_PCTILE = 70  # Top 30% (least drawdown) = label 1
MIN_STOCKS_PER_DATE = 100  # Need at least 100 stocks for meaningful cross-section


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


@njit(cache=True)
def compute_path_fwd_return_and_drawdown(close_series, h):
    """
    For a single stock's close price series, compute:
    - fwd_max_return: max(close[t+1:t+h+1]) / close[t] - 1  (best return in window)
    - fwd_max_drawdown: min(close[t+1:t+h+1]) / close[t] - 1  (worst return in window)
    - fwd_terminal_return: close[t+h] / close[t] - 1  (point-to-point return)
    """
    n = len(close_series)
    fwd_max_ret = np.full(n, np.nan, dtype=np.float64)
    fwd_max_dd = np.full(n, np.nan, dtype=np.float64)
    fwd_terminal = np.full(n, np.nan, dtype=np.float64)

    for t in range(n - h):
        entry = close_series[t]
        if entry <= 0 or np.isnan(entry):
            continue

        mx = -np.inf
        mn = np.inf
        for s in range(t + 1, t + h + 1):
            v = close_series[s]
            if np.isnan(v):
                continue
            r = v / entry - 1.0
            if r > mx:
                mx = r
            if r < mn:
                mn = r

        if mx > -np.inf:
            fwd_max_ret[t] = mx
        if mn < np.inf:
            fwd_max_dd[t] = mn

        terminal = close_series[t + h]
        if not np.isnan(terminal) and entry > 0:
            fwd_terminal[t] = terminal / entry - 1.0

    return fwd_max_ret, fwd_max_dd, fwd_terminal


def main():
    t0 = time.time()
    log("Cross-Sectional Dataset Assembly")

    # ── Load all chunk features ────────────────────────────────────────────
    log("\nLoading chunk features...")
    chunk_files = sorted(FEAT_DIR.glob("chunk_*_features.parquet"))

    if not chunk_files:
        log("ERROR: No chunk feature files found. Run xs_01_features.py first.")
        return

    all_chunks = []
    for cf in chunk_files:
        log(f"  Loading {cf.name}...")
        df = pd.read_parquet(cf)
        df['date'] = pd.to_datetime(df['date'])
        all_chunks.append(df)
        log(f"    {df['ticker'].nunique()} stocks, {len(df)} rows")

    full_df = pd.concat(all_chunks, ignore_index=True)
    del all_chunks
    gc.collect()

    log(f"  Total: {full_df['ticker'].nunique()} stocks, {len(full_df)} rows")

    # Feature columns (exclude date, ticker)
    feature_cols = [c for c in full_df.columns if c not in ('date', 'ticker')]
    log(f"  Features per stock: {len(feature_cols)}")

    # ── Load macro/FF features ─────────────────────────────────────────────
    macro_path = FEAT_DIR / "macro_ff.parquet"
    if macro_path.exists():
        log("  Loading macro/FF features...")
        macro_ff = pd.read_parquet(macro_path)
        macro_ff.index = pd.to_datetime(macro_ff.index)
        macro_cols = list(macro_ff.columns)
        log(f"  Macro/FF features: {len(macro_cols)}")
    else:
        macro_ff = None
        macro_cols = []
        log("  WARNING: No macro/FF features found")

    # ── Identify rebalance dates ───────────────────────────────────────────
    all_dates = sorted(full_df['date'].unique())
    rebal_dates = all_dates[::REBAL_FREQ]
    log(f"\n  All dates: {len(all_dates)}, Rebalance dates: {len(rebal_dates)}")
    log(f"  Date range: {all_dates[0].date()} to {all_dates[-1].date()}")

    # ── Build close price panel for forward return computation ─────────────
    # We need close prices for ALL stocks at ALL dates for path-dependent forward returns
    log("\n  Building close price panel for forward returns...")

    # Get close prices (prc_adj is in L0 features as 'ret' changes, but we need the actual price)
    # We stored 'ret' in features. To get close, we need the original data.
    # Actually, we have 'log_mktcap' and 'mom_Xd' which are derived from close.
    # Let's reconstruct close from chunk parquets directly.

    # Reload close prices only from original chunks
    chunk_data_dir = BASE / "Idea 2 - CRSP_COMPUSTAT" / "data" / "data_cleaned"
    close_records = []
    for cf in sorted(chunk_data_dir.glob("chunk_*_filtered_gapDays.parquet")):
        log(f"    Loading close from {cf.name}...")
        cdf = pd.read_parquet(cf, columns=['date', 'ticker', 'prc_adj'])
        cdf['date'] = pd.to_datetime(cdf['date'])
        cdf = cdf[cdf['date'] >= pd.Timestamp('2000-01-01')]

        # Filter to tickers that are in our feature set
        valid_tickers = set(full_df['ticker'].unique())
        cdf = cdf[cdf['ticker'].isin(valid_tickers)]
        close_records.append(cdf)

    close_df = pd.concat(close_records, ignore_index=True)
    close_df['prc_adj'] = close_df['prc_adj'].astype(np.float64)
    del close_records
    gc.collect()

    log(f"  Close prices: {close_df['ticker'].nunique()} stocks, {len(close_df)} rows")

    # ── Compute forward returns for each horizon ───────────────────────────
    for horizon in HORIZONS:
        log(f"\n{'='*70}")
        log(f"HORIZON: {horizon}d")
        log(f"{'='*70}")

        # Compute path-dependent forward returns per stock
        log(f"  Computing path-dependent forward returns...")
        tickers = sorted(close_df['ticker'].unique())
        fwd_records = []

        for i, tkr in enumerate(tickers):
            if (i + 1) % 500 == 0:
                log(f"    Processed {i+1}/{len(tickers)} stocks...")

            sub = close_df[close_df['ticker'] == tkr].sort_values('date')
            close_arr = sub['prc_adj'].values.astype(np.float64)
            dates_arr = sub['date'].values

            if len(close_arr) < horizon + 22:
                continue

            fwd_max_ret, fwd_max_dd, fwd_terminal = compute_path_fwd_return_and_drawdown(
                close_arr, horizon
            )

            # Create records
            tkr_df = pd.DataFrame({
                'date': dates_arr,
                'ticker': tkr,
                'fwd_max_ret': fwd_max_ret.astype(np.float32),
                'fwd_max_dd': fwd_max_dd.astype(np.float32),
                'fwd_terminal': fwd_terminal.astype(np.float32),
            })
            fwd_records.append(tkr_df)

        fwd_df = pd.concat(fwd_records, ignore_index=True)
        del fwd_records
        gc.collect()

        log(f"  Forward returns: {len(fwd_df)} rows")

        # ── At each rebalance date: cross-sectional ranks ──────────────────
        log(f"  Computing cross-sectional ranks at {len(rebal_dates)} rebalance dates...")
        dataset_rows = []

        for rd_idx, rd in enumerate(rebal_dates):
            if (rd_idx + 1) % 50 == 0:
                log(f"    Rebalance date {rd_idx+1}/{len(rebal_dates)}: {rd.date()}")

            # Get features for this date
            feat_slice = full_df[full_df['date'] == rd]
            fwd_slice = fwd_df[fwd_df['date'] == rd]

            if len(feat_slice) < MIN_STOCKS_PER_DATE:
                continue

            # Merge features with forward returns
            merged = feat_slice.merge(fwd_slice[['ticker', 'fwd_max_ret', 'fwd_max_dd', 'fwd_terminal']],
                                       on='ticker', how='inner')

            if len(merged) < MIN_STOCKS_PER_DATE:
                continue

            # Drop rows where forward returns are NaN
            merged = merged.dropna(subset=['fwd_max_ret', 'fwd_max_dd'])
            if len(merged) < MIN_STOCKS_PER_DATE:
                continue

            n_stocks = len(merged)

            # Cross-sectional percentile ranks of features
            for col in feature_cols:
                vals = merged[col].values
                if np.isnan(vals).sum() < len(vals) * 0.8:
                    merged[f'xs_{col}'] = merged[col].rank(pct=True, na_option='keep').astype(np.float32)

            # Cross-sectional ranks of forward returns and drawdowns
            merged['ret_rank'] = merged['fwd_max_ret'].rank(pct=True).astype(np.float32)
            merged['dd_rank'] = merged['fwd_max_dd'].rank(pct=True).astype(np.float32)
            # Note: higher dd_rank = less negative drawdown = better

            # Labels
            ret_thresh = RETURN_PCTILE / 100.0
            dd_thresh = DRAWDOWN_PCTILE / 100.0
            merged['label_return'] = (merged['ret_rank'] >= ret_thresh).astype(np.float32)
            merged['label_drawdown'] = (merged['dd_rank'] >= dd_thresh).astype(np.float32)
            merged['label_combined'] = ((merged['ret_rank'] >= ret_thresh) &
                                        (merged['dd_rank'] >= dd_thresh)).astype(np.float32)

            # Add macro features for this date
            if macro_ff is not None and rd in macro_ff.index:
                macro_row = macro_ff.loc[rd]
                for mc in macro_cols:
                    merged[mc] = np.float32(macro_row[mc])

            merged['n_stocks'] = n_stocks
            dataset_rows.append(merged)

        if not dataset_rows:
            log(f"  WARNING: No valid rebalance dates for {horizon}d")
            continue

        dataset = pd.concat(dataset_rows, ignore_index=True)
        del dataset_rows
        gc.collect()

        # Stats
        n_dates = dataset['date'].nunique()
        n_tickers = dataset['ticker'].nunique()
        n_rows = len(dataset)
        label_ret_rate = dataset['label_return'].mean()
        label_dd_rate = dataset['label_drawdown'].mean()
        label_comb_rate = dataset['label_combined'].mean()

        log(f"\n  Dataset stats:")
        log(f"    Rows: {n_rows:,}  Dates: {n_dates}  Tickers: {n_tickers}")
        log(f"    Label rates — Return: {label_ret_rate:.1%}  Drawdown: {label_dd_rate:.1%}  Combined: {label_comb_rate:.1%}")
        log(f"    Feature cols: {len(feature_cols)}  XS rank cols: {sum(1 for c in dataset.columns if c.startswith('xs_'))}")

        # Save
        out_path = LABEL_DIR / f"dataset_{horizon}d.parquet"
        dataset.to_parquet(out_path, index=False)
        log(f"    Saved {out_path.name}: {dataset.shape}")
        del dataset
        gc.collect()

    # ── Save universe stats ────────────────────────────────────────────────
    stats = {
        'rebal_dates': [str(d) for d in rebal_dates],
        'horizons': HORIZONS,
        'n_total_stocks': full_df['ticker'].nunique(),
        'feature_cols': feature_cols,
        'macro_cols': macro_cols,
    }
    with open(LABEL_DIR / "universe_stats.pkl", 'wb') as f:
        pickle.dump(stats, f)

    elapsed = time.time() - t0
    log(f"\nDataset assembly COMPLETE in {elapsed/60:.1f} minutes")


if __name__ == "__main__":
    main()

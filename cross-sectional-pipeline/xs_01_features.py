"""
Cross-Sectional Pipeline — Step 1: Feature Engineering
========================================================
Processes all 7 CRSP/COMPUSTAT chunks. For each chunk:
  1. Pivot to (T, N) panels per base feature
  2. Compute L0 (base), L1 (technicals), L2 (changes), L3 (accelerations)
  3. Save per-chunk feature parquet in long format

Uses numba prange for parallel rolling computations across N stocks.

Outputs:
  xs_pipeline/features/chunk_{X}_features.parquet  (per chunk)
  xs_pipeline/features/macro_ff.parquet            (shared macro/FF features)
  xs_pipeline/features/chunk_meta.pkl              (tickers, dates per chunk)
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
CHUNKS_DIR = BASE / "Idea 2 - CRSP_COMPUSTAT" / "data" / "data_cleaned"
ORCL_DATA = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "data"
OUT = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "xs_pipeline" / "features"
OUT.mkdir(parents=True, exist_ok=True)

CHUNK_FILES = sorted(CHUNKS_DIR.glob("chunk_*_filtered_gapDays.parquet"))
MIN_DAYS = 504   # Stocks need at least 2 years of data
START_DATE = pd.Timestamp('2000-01-01')  # Focus on modern era for cross-sectional

# Feature definitions
L0_FUNDAMENTALS = [
    'ps', 'ptb', 'pe_op_basic', 'bm', 'divyield',
    'npm', 'gpm', 'opmad', 'ptpm', 'cfm',
    'roe', 'roa', 'aftret_eq',
    'de_ratio', 'debt_ebitda', 'debt_assets',
    'curr_ratio', 'quick_ratio', 'cash_ratio',
]
L2_KEY_FEATURES = [
    # Feature selection for L2/L3 derivatives — redacted.
    # In production: ~13 features selected from L0+L1 based on IC screening.
]
CHANGE_HORIZONS = [1, 5, 22, 66]
ROLL_WINDOWS_SHORT = [22, 66]
ROLL_WINDOWS_LONG = [22, 66, 252]
MOM_HORIZONS = [5, 22, 66, 126, 252]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ══════════════════════════════════════════════════════════════════════════════
# NUMBA PANEL KERNELS — parallel over N stocks
# ══════════════════════════════════════════════════════════════════════════════

@njit(parallel=True, cache=True)
def panel_rolling_mean(panel, w):
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        s = np.float64(0.0)
        c = 0
        for i in range(T):
            v = panel[i, j]
            if not np.isnan(v):
                s += v
                c += 1
            if i >= w:
                old = panel[i - w, j]
                if not np.isnan(old):
                    s -= old
                    c -= 1
            if i >= w - 1 and c > 0:
                out[i, j] = np.float32(s / c)
    return out


@njit(parallel=True, cache=True)
def panel_rolling_std(panel, w):
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(w - 1, T):
            s = np.float64(0.0)
            s2 = np.float64(0.0)
            c = 0
            for k in range(i - w + 1, i + 1):
                v = panel[k, j]
                if not np.isnan(v):
                    s += v
                    s2 += v * v
                    c += 1
            if c > 1:
                mn = s / c
                var = s2 / c - mn * mn
                out[i, j] = np.float32(np.sqrt(max(var, 0.0)))
    return out


@njit(parallel=True, cache=True)
def panel_rolling_skew(panel, w):
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(w - 1, T):
            s = np.float64(0.0)
            c = 0
            for k in range(i - w + 1, i + 1):
                if not np.isnan(panel[k, j]):
                    s += panel[k, j]
                    c += 1
            if c < 3:
                continue
            mn = s / c
            m2 = np.float64(0.0)
            m3 = np.float64(0.0)
            for k in range(i - w + 1, i + 1):
                if not np.isnan(panel[k, j]):
                    d = panel[k, j] - mn
                    m2 += d * d
                    m3 += d * d * d
            m2 /= c
            m3 /= c
            if m2 > 1e-12:
                out[i, j] = np.float32(m3 / (m2 ** 1.5))
    return out


@njit(parallel=True, cache=True)
def panel_rolling_kurt(panel, w):
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(w - 1, T):
            s = np.float64(0.0)
            c = 0
            for k in range(i - w + 1, i + 1):
                if not np.isnan(panel[k, j]):
                    s += panel[k, j]
                    c += 1
            if c < 4:
                continue
            mn = s / c
            m2 = np.float64(0.0)
            m4 = np.float64(0.0)
            for k in range(i - w + 1, i + 1):
                if not np.isnan(panel[k, j]):
                    d = panel[k, j] - mn
                    d2 = d * d
                    m2 += d2
                    m4 += d2 * d2
            m2 /= c
            m4 /= c
            if m2 > 1e-12:
                out[i, j] = np.float32(m4 / (m2 * m2) - 3.0)
    return out


@njit(parallel=True, cache=True)
def panel_rolling_max(panel, w):
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(w - 1, T):
            mx = -np.inf
            for k in range(i - w + 1, i + 1):
                v = panel[k, j]
                if not np.isnan(v) and v > mx:
                    mx = v
            if mx > -np.inf:
                out[i, j] = np.float32(mx)
    return out


@njit(parallel=True, cache=True)
def panel_rolling_min(panel, w):
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(w - 1, T):
            mn = np.inf
            for k in range(i - w + 1, i + 1):
                v = panel[k, j]
                if not np.isnan(v) and v < mn:
                    mn = v
            if mn < np.inf:
                out[i, j] = np.float32(mn)
    return out


@njit(parallel=True, cache=True)
def panel_rsi(ret_panel, w):
    T, N = ret_panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        avg_gain = np.float64(0.0)
        avg_loss = np.float64(0.0)
        for i in range(w):
            v = ret_panel[i, j]
            if not np.isnan(v):
                if v > 0:
                    avg_gain += v
                else:
                    avg_loss -= v
        avg_gain /= w
        avg_loss /= w
        if avg_loss > 1e-12:
            out[w, j] = np.float32(100.0 - 100.0 / (1.0 + avg_gain / avg_loss))
        else:
            out[w, j] = np.float32(100.0)
        for i in range(w + 1, T):
            v = ret_panel[i, j]
            if np.isnan(v):
                out[i, j] = out[i - 1, j]
                continue
            g = v if v > 0 else 0.0
            l = -v if v < 0 else 0.0
            avg_gain = (avg_gain * (w - 1) + g) / w
            avg_loss = (avg_loss * (w - 1) + l) / w
            if avg_loss > 1e-12:
                out[i, j] = np.float32(100.0 - 100.0 / (1.0 + avg_gain / avg_loss))
            else:
                out[i, j] = np.float32(100.0)
    return out


@njit(parallel=True, cache=True)
def panel_pct_change(panel, h):
    """Compute pct_change with horizon h on (T, N) panel."""
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(h, T):
            cur = panel[i, j]
            prev = panel[i - h, j]
            if not np.isnan(cur) and not np.isnan(prev) and abs(prev) > 1e-10:
                val = (cur - prev) / abs(prev)
                if val > 10.0:
                    val = 10.0
                elif val < -10.0:
                    val = -10.0
                out[i, j] = np.float32(val)
    return out


@njit(parallel=True, cache=True)
def panel_momentum(close_panel, h):
    """Compute momentum: close[t] / close[t-h] - 1."""
    T, N = close_panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(h, T):
            cur = close_panel[i, j]
            prev = close_panel[i - h, j]
            if not np.isnan(cur) and not np.isnan(prev) and prev > 1e-8:
                out[i, j] = np.float32(cur / prev - 1.0)
    return out


@njit(parallel=True, cache=True)
def panel_drawdown(close_panel, w):
    """Rolling max drawdown: current price / rolling max price - 1."""
    T, N = close_panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(w - 1, T):
            mx = -np.inf
            for k in range(i - w + 1, i + 1):
                v = close_panel[k, j]
                if not np.isnan(v) and v > mx:
                    mx = v
            cur = close_panel[i, j]
            if not np.isnan(cur) and mx > 1e-8:
                out[i, j] = np.float32(cur / mx - 1.0)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# CHUNK PROCESSING
# ══════════════════════════════════════════════════════════════════════════════

def build_panel(df, tickers, dates, col):
    """Build (T, N) panel from long-format DataFrame. Returns float32 numpy array.
    Uses vectorized pivot via pandas for speed."""
    T, N = len(dates), len(tickers)

    # Fast path: use pandas pivot
    sub = df[['date', 'ticker', col]].copy()
    sub[col] = sub[col].astype(np.float32)
    pivoted = sub.pivot_table(index='date', columns='ticker', values=col, aggfunc='first')

    # Reindex to ensure all dates and tickers are present
    pivoted = pivoted.reindex(index=dates, columns=tickers)
    return pivoted.values.astype(np.float32)


def process_chunk(chunk_path):
    """Process a single CRSP chunk into features."""
    chunk_name = chunk_path.stem.split('_filtered')[0]
    out_path = OUT / f"{chunk_name}_features.parquet"

    if out_path.exists():
        log(f"  {chunk_name}: already processed, skipping")
        return chunk_name

    log(f"  Loading {chunk_name}...")
    df = pd.read_parquet(chunk_path)
    df['date'] = pd.to_datetime(df['date'])
    df = df[df['date'] >= START_DATE].copy()

    # Filter stocks with enough data
    counts = df.groupby('ticker').size()
    valid_tickers = sorted(counts[counts >= MIN_DAYS].index.tolist())
    df = df[df['ticker'].isin(valid_tickers)].copy()

    tickers = sorted(df['ticker'].unique().tolist())
    dates = sorted(df['date'].unique().tolist())
    T, N = len(dates), len(tickers)

    log(f"    {N} stocks, {T} dates ({dates[0].date()} to {dates[-1].date()})")

    if N == 0 or T < 252:
        log(f"    SKIPPING — insufficient data")
        return chunk_name

    # ── Build base panels ──────────────────────────────────────────────────
    log(f"    Building base panels...")
    # Core panels needed
    base_cols = ['prc_adj', 'ret', 'vol', 'mktcap'] + [
        c for c in L0_FUNDAMENTALS if c in df.columns
    ]
    panels = {}
    for col in base_cols:
        if col in df.columns:
            panels[col] = build_panel(df, tickers, dates, col)

    del df
    gc.collect()

    close = panels['prc_adj']
    ret = panels['ret']
    vol = panels.get('vol')

    # ── L0: Base features ──────────────────────────────────────────────────
    log(f"    Computing L0 features...")
    features = {}

    # Returns and log-transformed features
    features['ret'] = ret
    if vol is not None:
        log_vol = np.log1p(np.maximum(np.nan_to_num(vol, nan=0.0), 0)).astype(np.float32)
        features['log_vol'] = log_vol
    features['log_mktcap'] = np.log1p(np.maximum(
        np.nan_to_num(panels.get('mktcap', np.full((T, N), np.nan, np.float32)), nan=0.0), 0
    )).astype(np.float32)

    # Fundamentals
    for f in L0_FUNDAMENTALS:
        if f in panels:
            features[f] = panels[f]

    # Bid-ask spread proxy (if we had bid/ask, use them; otherwise skip)
    n_l0 = len(features)

    # ── L1: Technical features ─────────────────────────────────────────────
    log(f"    Computing L1 technicals...")

    # RSI
    features['rsi_14'] = panel_rsi(ret, 14)
    features['rsi_22'] = panel_rsi(ret, 22)

    # Bollinger Bands
    ma20 = panel_rolling_mean(close, 20)
    sd20 = panel_rolling_std(close, 20)
    upper = ma20 + 2.0 * sd20
    lower = ma20 - 2.0 * sd20
    denom = upper - lower
    denom[denom < 1e-8] = np.nan
    features['bb_pctB_20'] = ((close - lower) / denom).astype(np.float32)
    safe_ma20 = ma20.copy()
    safe_ma20[safe_ma20 < 1e-8] = np.nan
    features['bb_bandwidth_20'] = ((upper - lower) / safe_ma20).astype(np.float32)
    del upper, lower, denom, sd20

    # ATR (using close as proxy for high/low — close-to-close range)
    abs_ret = np.abs(ret)
    for w in [14, 22, 66]:
        atr = panel_rolling_mean(abs_ret, w)
        safe_close = close.copy()
        safe_close[safe_close < 1e-8] = np.nan
        features[f'atr_pct_{w}'] = (atr / safe_close).astype(np.float32)

    # Rolling return stats
    for w in ROLL_WINDOWS_LONG:
        features[f'ret_mean_{w}'] = panel_rolling_mean(ret, w)
        features[f'ret_std_{w}'] = panel_rolling_std(ret, w)
        features[f'ret_max_{w}'] = panel_rolling_max(ret, w)
        features[f'ret_min_{w}'] = panel_rolling_min(ret, w)
    for w in [66, 252]:
        features[f'ret_skew_{w}'] = panel_rolling_skew(ret, w)
        features[f'ret_kurt_{w}'] = panel_rolling_kurt(ret, w)

    # Volume rolling stats
    if vol is not None:
        for w in ROLL_WINDOWS_SHORT:
            features[f'logvol_mean_{w}'] = panel_rolling_mean(log_vol, w)
            features[f'logvol_std_{w}'] = panel_rolling_std(log_vol, w)
        # Volume relative
        for w in [22, 66]:
            vol_ma = panel_rolling_mean(vol, w)
            safe_vol_ma = vol_ma.copy()
            safe_vol_ma[safe_vol_ma < 1e-8] = np.nan
            features[f'vol_rel_{w}'] = (vol / safe_vol_ma).astype(np.float32)

    # Momentum
    for h in MOM_HORIZONS:
        features[f'mom_{h}d'] = panel_momentum(close, h)

    # Price vs MA
    for w in [22, 50, 200]:
        ma = panel_rolling_mean(close, w)
        safe_ma = ma.copy()
        safe_ma[safe_ma < 1e-8] = np.nan
        features[f'price_vs_ma_{w}'] = ((close / safe_ma) - 1.0).astype(np.float32)

    # Vol z-score
    ret_std_22 = features['ret_std_22']
    mean_of_vol = panel_rolling_mean(ret_std_22, 252)
    std_of_vol = panel_rolling_std(ret_std_22, 252)
    safe_std = std_of_vol.copy()
    safe_std[safe_std < 1e-8] = np.nan
    features['vol_zscore'] = ((ret_std_22 - mean_of_vol) / safe_std).astype(np.float32)

    # Drawdown
    features['drawdown_252'] = panel_drawdown(close, 252)

    # MACD normalized
    # Approximate EMA with rolling mean (good enough for cross-sectional ranking)
    ma12 = panel_rolling_mean(close, 12)
    ma26 = panel_rolling_mean(close, 26)
    macd = ma12 - ma26
    safe_close2 = close.copy()
    safe_close2[safe_close2 < 1e-8] = np.nan
    features['macd_norm'] = (macd / safe_close2).astype(np.float32)

    n_l1 = len(features) - n_l0
    log(f"    L0: {n_l0}, L1: {n_l1}")

    # ── L2: Changes (1st derivative) ───────────────────────────────────────
    log(f"    Computing L2 changes...")
    l2_count = 0
    for feat_name in L2_KEY_FEATURES:
        if feat_name not in features:
            continue
        panel_f = features[feat_name]
        for h in CHANGE_HORIZONS:
            features[f'L2_chg{h}_{feat_name}'] = panel_pct_change(panel_f, h)
            l2_count += 1
    log(f"    L2: {l2_count}")

    # ── L3: Acceleration (2nd derivative) ──────────────────────────────────
    log(f"    Computing L3 accelerations...")
    l3_count = 0
    for feat_name in L2_KEY_FEATURES:
        for h_l2 in CHANGE_HORIZONS:
            l2_key = f'L2_chg{h_l2}_{feat_name}'
            if l2_key not in features:
                continue
            for h_l3 in [1, 5, 22]:
                features[f'L3_chg{h_l3}_{l2_key}'] = panel_pct_change(features[l2_key], h_l3)
                l3_count += 1
    log(f"    L3: {l3_count}")

    total_features = len(features)
    log(f"    Total features: {total_features}")

    # ── Convert to long format and save ────────────────────────────────────
    log(f"    Saving to parquet...")

    # Build multi-index DataFrame: (date, ticker) → features
    feature_names = sorted(features.keys())
    # Create a 3D array: (T, N, F) then reshape to long format
    # More memory-efficient: iterate by feature and build columns

    # Create date and ticker arrays for long format
    date_arr = np.array(dates)
    ticker_arr = np.array(tickers)

    # For each (date, ticker) pair, we need feature values
    # Use panel approach: for each feature, flatten (T, N) to (T*N,)
    # Then filter out rows where ALL features are NaN

    # Build feature matrix as (T*N, F)
    F = len(feature_names)
    feature_matrix = np.empty((T * N, F), dtype=np.float32)
    for f_idx, fname in enumerate(feature_names):
        feature_matrix[:, f_idx] = features[fname].reshape(-1, order='C')  # row-major: (T, N) → T*N

    # Build date and ticker indices
    date_idx = np.repeat(np.arange(T), N)
    ticker_idx = np.tile(np.arange(N), T)

    # Filter: keep rows where close price exists (stock was trading)
    close_flat = close.reshape(-1, order='C')
    valid_mask = ~np.isnan(close_flat)

    log(f"    Valid rows: {valid_mask.sum()} / {len(valid_mask)} ({valid_mask.mean():.1%})")

    # Build DataFrame
    result = pd.DataFrame(
        feature_matrix[valid_mask],
        columns=feature_names,
    )
    result.insert(0, 'date', date_arr[date_idx[valid_mask]])
    result.insert(1, 'ticker', ticker_arr[ticker_idx[valid_mask]])

    # Replace inf with NaN
    result = result.replace([np.inf, -np.inf], np.nan)

    result.to_parquet(out_path, index=False)
    log(f"    Saved {out_path.name}: {result.shape}")

    # Clean up
    del features, feature_matrix, panels, close, ret, vol, result
    gc.collect()

    return chunk_name


# ══════════════════════════════════════════════════════════════════════════════
# MACRO + FF FEATURES (shared across all stocks)
# ══════════════════════════════════════════════════════════════════════════════

def build_macro_ff():
    """Build macro + FF factor features that are shared across all stocks."""
    out_path = OUT / "macro_ff.parquet"
    if out_path.exists():
        log("  Macro/FF: already processed, skipping")
        return

    log("  Building macro + FF features...")

    # Load pre-computed macro and FF from ORCL pipeline
    macro = pd.read_parquet(ORCL_DATA / "macro_daily.parquet")
    macro.index = pd.to_datetime(macro.index)

    ff = pd.read_parquet(ORCL_DATA / "ff_factors.parquet")
    ff.index = pd.to_datetime(ff.index)

    # Select key macro features
    key_macro_cols = [c for c in macro.columns if any(k in c for k in [
        'vix', 'spread_10y2y', 'spread_10y3m', 'fed_funds_effective',
        'ice_bofa_hy_spread', 'ice_bofa_bbb_spread', 'breakeven_10yr',
        'sofr', 'trade_weighted_dollar', 'treasury_10yr', 'treasury_2yr',
    ])]

    if not key_macro_cols:
        # Fallback: take first 20 daily features
        key_macro_cols = [c for c in macro.columns if 'fred_d_' in c][:20]

    macro_sel = macro[key_macro_cols].copy()

    # Compute changes of macro features
    for col in list(macro_sel.columns):
        arr = macro_sel[col].values.astype(np.float64)
        for h in [1, 22]:
            chg = np.full(len(arr), np.nan, dtype=np.float32)
            chg[h:] = np.where(
                np.abs(arr[:-h]) > 1e-10,
                ((arr[h:] - arr[:-h]) / np.abs(arr[:-h])).astype(np.float32),
                np.float32(np.nan)
            )
            chg = np.clip(chg, -5.0, 5.0)
            macro_sel[f'{col}_chg{h}d'] = chg

    # FF factors + rolling stats
    for col in ff.columns:
        macro_sel[col] = ff[col].reindex(macro_sel.index).ffill()
        arr = ff[col].reindex(macro_sel.index).ffill().values.astype(np.float64)
        # 22d rolling mean
        rm = np.full(len(arr), np.nan, dtype=np.float32)
        for i in range(22, len(arr)):
            rm[i] = np.float32(np.nanmean(arr[i-22:i]))
        macro_sel[f'{col}_mean22'] = rm

    macro_sel = macro_sel.loc[START_DATE:].astype(np.float32)
    macro_sel.to_parquet(out_path)
    log(f"  Saved macro_ff.parquet: {macro_sel.shape}")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    t0 = time.time()
    log(f"Cross-Sectional Feature Engineering")
    log(f"Chunks: {len(CHUNK_FILES)}")
    log(f"Start date: {START_DATE.date()}")
    log(f"Min days per stock: {MIN_DAYS}")

    # Process each chunk
    chunk_meta = {}
    for chunk_path in CHUNK_FILES:
        log(f"\n{'='*60}")
        name = process_chunk(chunk_path)
        chunk_meta[name] = str(chunk_path)

    # Build macro/FF features
    log(f"\n{'='*60}")
    build_macro_ff()

    # Save metadata
    with open(OUT / "chunk_meta.pkl", 'wb') as f:
        pickle.dump(chunk_meta, f)

    elapsed = time.time() - t0
    log(f"\nFeature engineering COMPLETE in {elapsed/60:.1f} minutes")


if __name__ == "__main__":
    main()

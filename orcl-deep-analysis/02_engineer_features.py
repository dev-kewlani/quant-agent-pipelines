"""
Phase 2: Massive Feature Engineering
======================================
Builds 30K+ features across 4 derivative levels:
  L0: Base features (~80 CRSP + OHLCV-derived technicals)
  L1: Technical indicators (BB, ATR, RSI, MACD, rolling stats, skew, kurt)
  L2: 1st derivative (pct_change at 4 horizons) of all L0+L1
  L3: 2nd derivative (acceleration) of all L2
  L4: 3rd derivative of key L3 features
  Cross-asset: rolling correlations + std/skew of correlations + their derivatives
  Ranks: temporal (rolling percentile) + cross-sectional (vs peers)

Outputs:
  features/all_features.parquet  - Full feature matrix (DatetimeIndex, float32)
  features/feature_metadata.pkl  - Feature names, categories, levels
"""

import pandas as pd
import numpy as np
from numba import njit, prange
from pathlib import Path
import pickle
import time
import warnings
import gc

warnings.filterwarnings('ignore')

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE = Path("Path(os.environ.get("DATA_DIR", "."))")
DATA = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "data"
FEAT = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "features"
FEAT.mkdir(parents=True, exist_ok=True)

# ── Configuration ──────────────────────────────────────────────────────────────
ROLLING_WINDOWS = [5, 10, 22, 44, 66, 126, 252]
ROLLING_WINDOWS_SHORT = [5, 10, 22, 44, 66]
ROLLING_WINDOWS_LONG = [22, 44, 66, 126, 252]
BB_WINDOWS = [20, 50, 100, 200]
ATR_WINDOWS = [14, 22, 44, 66, 126]
RSI_WINDOWS = [7, 14, 22, 44]
MOM_HORIZONS = [1, 5, 10, 22, 44, 66, 126, 252]
CHANGE_HORIZONS = [1, 5, 22, 66]  # For derivative levels
CORR_WINDOWS = [22, 44, 66, 126, 252]

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ══════════════════════════════════════════════════════════════════════════════
# NUMBA KERNELS — vectorized rolling computations
# ══════════════════════════════════════════════════════════════════════════════

@njit(cache=True)
def rolling_mean(arr, w):
    """Rolling mean using cumsum trick."""
    n = len(arr)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    cs = np.float64(0.0)
    for i in range(w):
        cs += arr[i] if not np.isnan(arr[i]) else 0.0
    out[w-1] = np.float32(cs / w)
    for i in range(w, n):
        old = arr[i-w] if not np.isnan(arr[i-w]) else 0.0
        new = arr[i] if not np.isnan(arr[i]) else 0.0
        cs += new - old
        out[i] = np.float32(cs / w)
    return out


@njit(cache=True)
def rolling_std(arr, w):
    """Rolling std using Welford's online algorithm."""
    n = len(arr)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    for i in range(w-1, n):
        s = np.float64(0.0)
        s2 = np.float64(0.0)
        cnt = 0
        for j in range(i-w+1, i+1):
            v = arr[j]
            if not np.isnan(v):
                s += v
                s2 += v * v
                cnt += 1
        if cnt > 1:
            mean = s / cnt
            var = (s2 / cnt) - mean * mean
            out[i] = np.float32(np.sqrt(max(var, 0.0)))
        else:
            out[i] = np.nan
    return out


@njit(cache=True)
def rolling_skew(arr, w):
    """Rolling skewness."""
    n = len(arr)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    for i in range(w-1, n):
        s = np.float64(0.0)
        cnt = 0
        for j in range(i-w+1, i+1):
            if not np.isnan(arr[j]):
                s += arr[j]
                cnt += 1
        if cnt < 3:
            out[i] = np.nan
            continue
        mean = s / cnt
        m2 = np.float64(0.0)
        m3 = np.float64(0.0)
        for j in range(i-w+1, i+1):
            if not np.isnan(arr[j]):
                d = arr[j] - mean
                m2 += d * d
                m3 += d * d * d
        m2 /= cnt
        m3 /= cnt
        if m2 > 1e-12:
            out[i] = np.float32(m3 / (m2 ** 1.5))
        else:
            out[i] = np.nan
    return out


@njit(cache=True)
def rolling_kurt(arr, w):
    """Rolling excess kurtosis."""
    n = len(arr)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    for i in range(w-1, n):
        s = np.float64(0.0)
        cnt = 0
        for j in range(i-w+1, i+1):
            if not np.isnan(arr[j]):
                s += arr[j]
                cnt += 1
        if cnt < 4:
            out[i] = np.nan
            continue
        mean = s / cnt
        m2 = np.float64(0.0)
        m4 = np.float64(0.0)
        for j in range(i-w+1, i+1):
            if not np.isnan(arr[j]):
                d = arr[j] - mean
                d2 = d * d
                m2 += d2
                m4 += d2 * d2
        m2 /= cnt
        m4 /= cnt
        if m2 > 1e-12:
            out[i] = np.float32((m4 / (m2 * m2)) - 3.0)
        else:
            out[i] = np.nan
    return out


@njit(cache=True)
def rolling_max(arr, w):
    n = len(arr)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    for i in range(w-1, n):
        mx = -np.inf
        for j in range(i-w+1, i+1):
            if not np.isnan(arr[j]) and arr[j] > mx:
                mx = arr[j]
        out[i] = np.float32(mx) if mx > -np.inf else np.nan
    return out


@njit(cache=True)
def rolling_min(arr, w):
    n = len(arr)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    for i in range(w-1, n):
        mn = np.inf
        for j in range(i-w+1, i+1):
            if not np.isnan(arr[j]) and arr[j] < mn:
                mn = arr[j]
        out[i] = np.float32(mn) if mn < np.inf else np.nan
    return out


@njit(cache=True)
def rolling_percentile_rank(arr, w):
    """Rolling percentile rank: what % of values in window are <= current value."""
    n = len(arr)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    for i in range(w-1, n):
        val = arr[i]
        if np.isnan(val):
            out[i] = np.nan
            continue
        cnt = 0
        below = 0
        for j in range(i-w+1, i+1):
            if not np.isnan(arr[j]):
                cnt += 1
                if arr[j] <= val:
                    below += 1
        out[i] = np.float32(below / cnt) if cnt > 0 else np.nan
    return out


@njit(cache=True)
def rolling_correlation(arr1, arr2, w):
    """Rolling Pearson correlation between two arrays."""
    n = len(arr1)
    out = np.empty(n, dtype=np.float32)
    out[:w-1] = np.nan
    for i in range(w-1, n):
        sx = np.float64(0.0)
        sy = np.float64(0.0)
        sxy = np.float64(0.0)
        sx2 = np.float64(0.0)
        sy2 = np.float64(0.0)
        cnt = 0
        for j in range(i-w+1, i+1):
            x = arr1[j]
            y = arr2[j]
            if not np.isnan(x) and not np.isnan(y):
                sx += x
                sy += y
                sxy += x * y
                sx2 += x * x
                sy2 += y * y
                cnt += 1
        if cnt < 5:
            out[i] = np.nan
        else:
            num = cnt * sxy - sx * sy
            den = np.sqrt((cnt * sx2 - sx * sx) * (cnt * sy2 - sy * sy))
            out[i] = np.float32(num / den) if den > 1e-12 else np.nan
    return out


@njit(cache=True)
def rsi_calc(returns, window):
    """RSI calculation."""
    n = len(returns)
    out = np.empty(n, dtype=np.float32)
    out[:window] = np.nan
    gains = np.where(returns > 0, returns, 0.0)
    losses = np.where(returns < 0, -returns, 0.0)
    avg_gain = np.float64(0.0)
    avg_loss = np.float64(0.0)
    for i in range(window):
        avg_gain += gains[i]
        avg_loss += losses[i]
    avg_gain /= window
    avg_loss /= window
    if avg_loss > 1e-12:
        out[window] = np.float32(100.0 - (100.0 / (1.0 + avg_gain / avg_loss)))
    else:
        out[window] = np.float32(100.0)
    for i in range(window + 1, n):
        avg_gain = (avg_gain * (window - 1) + gains[i]) / window
        avg_loss = (avg_loss * (window - 1) + losses[i]) / window
        if avg_loss > 1e-12:
            out[i] = np.float32(100.0 - (100.0 / (1.0 + avg_gain / avg_loss)))
        else:
            out[i] = np.float32(100.0)
    return out


@njit(cache=True)
def consecutive_count(arr):
    """Count consecutive positive/negative streaks."""
    n = len(arr)
    up = np.empty(n, dtype=np.float32)
    dn = np.empty(n, dtype=np.float32)
    up[0] = np.float32(1.0) if arr[0] > 0 else np.float32(0.0)
    dn[0] = np.float32(1.0) if arr[0] < 0 else np.float32(0.0)
    for i in range(1, n):
        if np.isnan(arr[i]):
            up[i] = np.float32(0.0)
            dn[i] = np.float32(0.0)
        elif arr[i] > 0:
            up[i] = up[i-1] + np.float32(1.0)
            dn[i] = np.float32(0.0)
        elif arr[i] < 0:
            up[i] = np.float32(0.0)
            dn[i] = dn[i-1] + np.float32(1.0)
        else:
            up[i] = np.float32(0.0)
            dn[i] = np.float32(0.0)
    return up, dn


@njit(cache=True)
def atr_calc(high, low, close, window):
    """Average True Range."""
    n = len(close)
    out = np.empty(n, dtype=np.float32)
    out[:window] = np.nan
    tr = np.empty(n, dtype=np.float64)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        hl = high[i] - low[i]
        hc = abs(high[i] - close[i-1])
        lc = abs(low[i] - close[i-1])
        tr[i] = max(hl, max(hc, lc))
    # EMA of TR
    atr_val = np.float64(0.0)
    for i in range(window):
        atr_val += tr[i]
    atr_val /= window
    out[window-1] = np.float32(atr_val)
    for i in range(window, n):
        atr_val = (atr_val * (window - 1) + tr[i]) / window
        out[i] = np.float32(atr_val)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE ENGINEERING FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def engineer_L0_base(orcl_base):
    """Extract base numeric features from CRSP data."""
    log("Engineering L0 base features...")
    features = {}
    exclude = {'date', 'permno', 'comnam', 'cusip', 'ticker', 'siccd', 'gsector',
               'gicdesc', 'adate', 'qdate', 'public_date', 'public_date_used'}

    for c in orcl_base.columns:
        if c in exclude:
            continue
        if '_flag' in c or '_desc' in c or c.startswith('ffi'):
            continue
        if orcl_base[c].dtype in ['float32', 'float64', 'int64', 'int32']:
            arr = orcl_base[c].values.astype(np.float32)
            features[f"L0_{c}"] = arr

    log(f"  L0 base features: {len(features)}")
    return features


def engineer_L1_technicals(orcl_base, orcl_ohlcv, dates):
    """Engineer Level 1 technical indicators."""
    log("Engineering L1 technical indicators...")
    features = {}

    close = orcl_base['prc_adj'].values.astype(np.float64)
    ret = orcl_base['ret'].values.astype(np.float64)
    vol = orcl_base['vol'].values.astype(np.float64)

    # ── Use yfinance OHLCV if available, aligned to CRSP dates ─────────────
    if orcl_ohlcv is not None:
        ohlcv_dates = pd.to_datetime(orcl_ohlcv['date'])
        crsp_dates = pd.to_datetime(dates)
        # Align ohlcv to crsp dates
        ohlcv_indexed = orcl_ohlcv.set_index('date')
        aligned = ohlcv_indexed.reindex(crsp_dates).ffill()
        high = aligned['high'].values.astype(np.float64)
        low = aligned['low'].values.astype(np.float64)
        ohlcv_open = aligned['open'].values.astype(np.float64)
        has_ohlcv = True
        log("  Using yfinance OHLCV for high/low/open")
    else:
        # Use bid/ask as proxy for high/low
        if 'bid' in orcl_base.columns and 'ask' in orcl_base.columns:
            high = orcl_base['ask'].values.astype(np.float64)
            low = orcl_base['bid'].values.astype(np.float64)
            has_ohlcv = True
        else:
            has_ohlcv = False
        ohlcv_open = orcl_base['openprc'].values.astype(np.float64) if 'openprc' in orcl_base.columns else close
        log("  Using bid/ask proxy for high/low")

    n = len(close)

    # ── 1. Bollinger Bands ─────────────────────────────────────────────────
    for w in BB_WINDOWS:
        ma = rolling_mean(close, w)
        sd = rolling_std(close, w)
        upper = ma + 2.0 * sd
        lower = ma - 2.0 * sd
        features[f"L1_bb_pctB_{w}"] = np.where(
            (upper - lower) > 1e-8,
            ((close - lower) / (upper - lower)).astype(np.float32),
            np.float32(np.nan)
        )
        features[f"L1_bb_bandwidth_{w}"] = np.where(
            ma > 1e-8,
            ((upper - lower) / ma).astype(np.float32),
            np.float32(np.nan)
        )
        features[f"L1_bb_upper_dist_{w}"] = np.where(
            close > 1e-8,
            ((upper - close) / close).astype(np.float32),
            np.float32(np.nan)
        )
        features[f"L1_bb_lower_dist_{w}"] = np.where(
            close > 1e-8,
            ((close - lower) / close).astype(np.float32),
            np.float32(np.nan)
        )

    # ── 2. ATR ─────────────────────────────────────────────────────────────
    if has_ohlcv:
        for w in ATR_WINDOWS:
            atr = atr_calc(high, low, close, w)
            features[f"L1_atr_{w}"] = atr
            # ATR as % of close
            features[f"L1_atr_pct_{w}"] = np.where(
                close > 1e-8,
                (atr / close).astype(np.float32),
                np.float32(np.nan)
            )

    # ── 3. RSI ─────────────────────────────────────────────────────────────
    for w in RSI_WINDOWS:
        features[f"L1_rsi_{w}"] = rsi_calc(ret, w)

    # ── 4. MACD ────────────────────────────────────────────────────────────
    # Standard (12, 26, 9)
    ema12 = pd.Series(close).ewm(span=12, adjust=False).mean().values
    ema26 = pd.Series(close).ewm(span=26, adjust=False).mean().values
    macd_line = (ema12 - ema26).astype(np.float32)
    signal_line = pd.Series(macd_line).ewm(span=9, adjust=False).mean().values.astype(np.float32)
    features["L1_macd"] = macd_line
    features["L1_macd_signal"] = signal_line
    features["L1_macd_hist"] = (macd_line - signal_line).astype(np.float32)
    # Normalized MACD (as % of price)
    features["L1_macd_norm"] = np.where(close > 1e-8, macd_line / close, np.float32(np.nan)).astype(np.float32)

    # Slow MACD (26, 52, 9)
    ema52 = pd.Series(close).ewm(span=52, adjust=False).mean().values
    macd_slow = (ema26 - ema52).astype(np.float32)
    signal_slow = pd.Series(macd_slow).ewm(span=9, adjust=False).mean().values.astype(np.float32)
    features["L1_macd_slow"] = macd_slow
    features["L1_macd_slow_signal"] = signal_slow
    features["L1_macd_slow_hist"] = (macd_slow - signal_slow).astype(np.float32)

    # ── 5. Stochastic Oscillator ───────────────────────────────────────────
    if has_ohlcv:
        for w in [14, 22]:
            high_roll = rolling_max(high, w)
            low_roll = rolling_min(low, w)
            denom = high_roll - low_roll
            k = np.where(denom > 1e-8, ((close - low_roll) / denom * 100).astype(np.float32), np.float32(50.0))
            d = rolling_mean(k.astype(np.float64), 3)
            features[f"L1_stoch_k_{w}"] = k.astype(np.float32)
            features[f"L1_stoch_d_{w}"] = d

    # ── 6. Williams %R ─────────────────────────────────────────────────────
    if has_ohlcv:
        for w in [14, 22]:
            high_roll = rolling_max(high, w)
            low_roll = rolling_min(low, w)
            denom = high_roll - low_roll
            wr = np.where(denom > 1e-8, ((high_roll - close) / denom * -100).astype(np.float32), np.float32(-50.0))
            features[f"L1_williams_r_{w}"] = wr.astype(np.float32)

    # ── 7. CCI ─────────────────────────────────────────────────────────────
    if has_ohlcv:
        tp = ((high + low + close) / 3.0).astype(np.float64)
        for w in [14, 22, 44]:
            tp_ma = rolling_mean(tp, w)
            # Mean absolute deviation
            mad = np.empty(n, dtype=np.float32)
            mad[:w-1] = np.nan
            for i in range(w-1, n):
                s = 0.0
                for j in range(i-w+1, i+1):
                    s += abs(tp[j] - tp_ma[i])
                mad[i] = np.float32(s / w)
            features[f"L1_cci_{w}"] = np.where(
                mad > 1e-8,
                ((tp - tp_ma) / (0.015 * mad)).astype(np.float32),
                np.float32(0.0)
            )

    # ── 8. Rolling Stats of Returns ────────────────────────────────────────
    for w in ROLLING_WINDOWS:
        features[f"L1_ret_mean_{w}"] = rolling_mean(ret, w)
        features[f"L1_ret_std_{w}"] = rolling_std(ret, w)
        features[f"L1_ret_max_{w}"] = rolling_max(ret, w)
        features[f"L1_ret_min_{w}"] = rolling_min(ret, w)
        features[f"L1_ret_range_{w}"] = (
            features[f"L1_ret_max_{w}"].astype(np.float64) -
            features[f"L1_ret_min_{w}"].astype(np.float64)
        ).astype(np.float32)

    for w in ROLLING_WINDOWS_LONG:
        features[f"L1_ret_skew_{w}"] = rolling_skew(ret, w)
        features[f"L1_ret_kurt_{w}"] = rolling_kurt(ret, w)

    # ── 9. Rolling Stats of Volume ─────────────────────────────────────────
    log_vol = np.log1p(np.maximum(vol, 0)).astype(np.float64)
    for w in ROLLING_WINDOWS_LONG:
        features[f"L1_logvol_mean_{w}"] = rolling_mean(log_vol, w)
        features[f"L1_logvol_std_{w}"] = rolling_std(log_vol, w)
        features[f"L1_logvol_skew_{w}"] = rolling_skew(log_vol, w)
        features[f"L1_logvol_kurt_{w}"] = rolling_kurt(log_vol, w)

    # Volume relative to average
    for w in [22, 44, 66, 126, 252]:
        vol_ma = rolling_mean(vol, w)
        features[f"L1_vol_rel_{w}"] = np.where(
            vol_ma > 1e-8,
            (vol / vol_ma).astype(np.float32),
            np.float32(np.nan)
        )

    # ── 10. Momentum features ──────────────────────────────────────────────
    for h in MOM_HORIZONS:
        if h < n:
            mom = np.empty(n, dtype=np.float32)
            mom[:h] = np.nan
            mom[h:] = ((close[h:] / close[:-h]) - 1.0).astype(np.float32)
            features[f"L1_mom_{h}d"] = mom

            # Volume momentum
            vmom = np.empty(n, dtype=np.float32)
            vmom[:h] = np.nan
            safe_vol = np.where(vol > 0, vol, 1.0)
            vmom[h:] = ((vol[h:] / safe_vol[:-h]) - 1.0).astype(np.float32)
            features[f"L1_volmom_{h}d"] = vmom

    # ── 11. Price relative to moving average ───────────────────────────────
    for w in [5, 10, 22, 50, 100, 200]:
        ma = rolling_mean(close, w)
        features[f"L1_price_vs_ma_{w}"] = np.where(
            ma > 1e-8,
            ((close / ma) - 1.0).astype(np.float32),
            np.float32(np.nan)
        )

    # ── 12. Consecutive up/down ────────────────────────────────────────────
    up, dn = consecutive_count(ret)
    features["L1_consec_up"] = up
    features["L1_consec_down"] = dn

    # ── 13. Rolling max drawdown ───────────────────────────────────────────
    for w in [44, 66, 126, 252]:
        cummax = rolling_max(close, w)
        dd = np.where(cummax > 1e-8, ((close - cummax) / cummax).astype(np.float32), np.float32(0.0))
        features[f"L1_drawdown_{w}"] = dd.astype(np.float32)

    # ── 14. Volatility z-score ─────────────────────────────────────────────
    ret_std_22 = features["L1_ret_std_22"]
    ret_std_252 = features["L1_ret_std_252"]
    mean_std_252 = rolling_mean(ret_std_22.astype(np.float64), 252)
    std_std_252 = rolling_std(ret_std_22.astype(np.float64), 252)
    features["L1_vol_zscore"] = np.where(
        std_std_252 > 1e-8,
        ((ret_std_22.astype(np.float64) - mean_std_252) / std_std_252).astype(np.float32),
        np.float32(0.0)
    )

    # ── 15. Log market cap ─────────────────────────────────────────────────
    if 'mktcap' in orcl_base.columns:
        mktcap = orcl_base['mktcap'].values.astype(np.float64)
        features["L1_log_mktcap"] = np.log1p(np.maximum(mktcap, 0)).astype(np.float32)

    # ── 16. Bid-ask spread ─────────────────────────────────────────────────
    if 'bid' in orcl_base.columns and 'ask' in orcl_base.columns:
        bid = orcl_base['bid'].values.astype(np.float64)
        ask = orcl_base['ask'].values.astype(np.float64)
        mid = (bid + ask) / 2.0
        spread = np.where(mid > 1e-8, ((ask - bid) / mid).astype(np.float32), np.float32(np.nan))
        features["L1_bidask_spread"] = spread
        for w in [22, 66, 252]:
            features[f"L1_bidask_spread_ma_{w}"] = rolling_mean(spread.astype(np.float64), w)

    # ── 17. Return-volume interaction ──────────────────────────────────────
    features["L1_ret_x_vol"] = (ret * log_vol).astype(np.float32)
    features["L1_abs_ret_x_vol"] = (np.abs(ret) * log_vol).astype(np.float32)

    # ── 18. Intraday range (if OHLCV available) ───────────────────────────
    if has_ohlcv:
        intra_range = np.where(
            close > 1e-8,
            ((high - low) / close).astype(np.float32),
            np.float32(np.nan)
        )
        features["L1_intraday_range"] = intra_range.astype(np.float32)
        for w in [22, 66, 252]:
            features[f"L1_intraday_range_ma_{w}"] = rolling_mean(intra_range.astype(np.float64), w)

        # Gap (open vs prev close)
        gap = np.empty(n, dtype=np.float32)
        gap[0] = np.nan
        gap[1:] = np.where(
            close[:-1] > 1e-8,
            ((ohlcv_open[1:] - close[:-1]) / close[:-1]),
            0.0
        ).astype(np.float32)
        features["L1_gap"] = gap

    # ── 19. Rolling Stats of Close Price (log price levels) ────────────────
    log_close = np.log(np.maximum(close, 1e-8)).astype(np.float64)
    for w in ROLLING_WINDOWS_LONG:
        features[f"L1_logprice_std_{w}"] = rolling_std(log_close, w)
        features[f"L1_logprice_skew_{w}"] = rolling_skew(log_close, w)

    # ── 20. Fundamental rolling stats (for key fundamentals) ───────────────
    key_fundamentals = ['ps', 'ptpm', 'ptb', 'npm', 'roe', 'roa', 'de_ratio',
                        'curr_ratio', 'quick_ratio', 'cash_ratio', 'debt_ebitda',
                        'debt_assets', 'pcf', 'bm', 'pe_op_basic', 'divyield',
                        'gpm', 'opmad', 'cfm', 'aftret_eq']
    for fname in key_fundamentals:
        col_name = f"L0_{fname}"
        if col_name in features:  # Was already created in L0
            continue
        if fname in orcl_base.columns:
            farr = orcl_base[fname].values.astype(np.float64)
            for w in [66, 126, 252]:
                features[f"L1_fund_{fname}_mean_{w}"] = rolling_mean(farr, w)
                features[f"L1_fund_{fname}_std_{w}"] = rolling_std(farr, w)
                # Z-score
                rmean = features[f"L1_fund_{fname}_mean_{w}"].astype(np.float64)
                rstd = features[f"L1_fund_{fname}_std_{w}"].astype(np.float64)
                features[f"L1_fund_{fname}_zscore_{w}"] = np.where(
                    rstd > 1e-8,
                    ((farr - rmean) / rstd).astype(np.float32),
                    np.float32(0.0)
                )

    log(f"  L1 technical features: {len([k for k in features if k.startswith('L1_')])}")
    return features


def engineer_cross_asset(orcl_ret, dates):
    """Engineer cross-asset features: correlations, betas, relative strength."""
    log("Engineering cross-asset features...")
    features = {}

    # Load cross-asset returns
    cross_ret_path = DATA / "cross_asset_returns.parquet"
    if not cross_ret_path.exists():
        log("  WARNING: No cross-asset returns found, skipping")
        return features

    cross_ret = pd.read_parquet(cross_ret_path)
    cross_ret.index = pd.to_datetime(cross_ret.index)

    # Align to ORCL dates
    orcl_dates_dt = pd.to_datetime(dates)
    orcl_ret_series = pd.Series(orcl_ret, index=orcl_dates_dt)

    n_orcl = len(orcl_ret)
    count = 0

    for col in cross_ret.columns:
        if col == 'orcl_yf':
            continue  # Skip ORCL itself

        # Align cross-asset returns to ORCL dates
        aligned = cross_ret[col].reindex(orcl_dates_dt)
        cross_arr = aligned.values.astype(np.float64)

        # Fill small gaps
        cross_arr_filled = pd.Series(cross_arr).ffill().bfill().values

        if np.isnan(cross_arr_filled).sum() > len(cross_arr_filled) * 0.5:
            continue  # Skip if too many NaNs

        # Rolling correlations
        for w in CORR_WINDOWS:
            corr = rolling_correlation(orcl_ret.astype(np.float64), cross_arr_filled, w)
            features[f"XA_corr_{col}_{w}d"] = corr
            count += 1

        # 66d correlation + its rolling std and skew
        corr_66 = features.get(f"XA_corr_{col}_66d")
        if corr_66 is not None:
            for stat_w in [22, 44, 66]:
                features[f"XA_corr_std_{col}_{stat_w}d"] = rolling_std(corr_66.astype(np.float64), stat_w)
                features[f"XA_corr_skew_{col}_{stat_w}d"] = rolling_skew(corr_66.astype(np.float64), stat_w)
                count += 2

        # Rolling beta (ORCL ret regressed on cross ret)
        for w in [66, 126, 252]:
            # Beta = cov(orcl, cross) / var(cross)
            corr_arr = rolling_correlation(orcl_ret.astype(np.float64), cross_arr_filled, w)
            orcl_std = rolling_std(orcl_ret.astype(np.float64), w)
            cross_std = rolling_std(cross_arr_filled, w)
            beta = np.where(
                cross_std > 1e-8,
                (corr_arr.astype(np.float64) * orcl_std.astype(np.float64) / cross_std.astype(np.float64)).astype(np.float32),
                np.float32(np.nan)
            )
            features[f"XA_beta_{col}_{w}d"] = beta.astype(np.float32)
            count += 1

    # Cross-asset return features (raw)
    for col in cross_ret.columns:
        if col == 'orcl_yf':
            continue
        aligned = cross_ret[col].reindex(orcl_dates_dt).ffill().bfill()
        if aligned.isna().sum() < len(aligned) * 0.5:
            features[f"XA_ret_{col}"] = aligned.values.astype(np.float32)
            # Rolling stats of cross-asset returns
            arr = aligned.values.astype(np.float64)
            for w in [22, 66]:
                features[f"XA_ret_std_{col}_{w}d"] = rolling_std(arr, w)

    log(f"  Cross-asset features: {len(features)}")
    return features


def engineer_macro_features(dates):
    """Engineer macro features aligned to ORCL dates."""
    log("Engineering macro features...")
    features = {}

    macro_path = DATA / "macro_daily.parquet"
    if not macro_path.exists():
        log("  WARNING: No macro data found, skipping")
        return features

    macro = pd.read_parquet(macro_path)
    macro.index = pd.to_datetime(macro.index)

    orcl_dates_dt = pd.to_datetime(dates)

    for col in macro.columns:
        aligned = macro[col].reindex(orcl_dates_dt).ffill()
        if aligned.isna().sum() < len(aligned) * 0.8:
            features[f"MACRO_{col}"] = aligned.values.astype(np.float32)

    log(f"  Macro features: {len(features)}")
    return features


def engineer_ff_features(dates):
    """Engineer Fama-French factor features aligned to ORCL dates."""
    log("Engineering Fama-French features...")
    features = {}

    ff_path = DATA / "ff_factors.parquet"
    if not ff_path.exists():
        log("  WARNING: No FF factors found, skipping")
        return features

    ff = pd.read_parquet(ff_path)
    ff.index = pd.to_datetime(ff.index)

    orcl_dates_dt = pd.to_datetime(dates)

    for col in ff.columns:
        aligned = ff[col].reindex(orcl_dates_dt).ffill()
        arr = aligned.values.astype(np.float64)
        features[f"FF_{col}"] = arr.astype(np.float32)
        # Rolling stats of FF factors
        for w in [22, 66, 252]:
            features[f"FF_{col}_mean_{w}"] = rolling_mean(arr, w)
            features[f"FF_{col}_std_{w}"] = rolling_std(arr, w)

    log(f"  FF features: {len(features)}")
    return features


def engineer_derivatives(features, level, horizons, target_prefix=None, use_all_keys=False):
    """Compute pct_change / diff at multiple horizons for all features at given level."""
    if target_prefix is None:
        target_prefix = f"L{level+1}"
    log(f"Engineering {target_prefix} derivative features (horizons={horizons})...")
    new_features = {}

    # Get features to differentiate
    if use_all_keys:
        level_keys = list(features.keys())
    else:
        prefix = f"L{level}"
        level_keys = [k for k in features.keys()
                      if k.startswith(prefix) or (level == 1 and k.startswith('L0_'))]
        if level == 2:
            level_keys = [k for k in features.keys() if k.startswith('L2_')]
        elif level == 3:
            level_keys = [k for k in features.keys() if k.startswith('L3_')]

    count = 0
    for key in level_keys:
        arr = features[key].astype(np.float64)
        n = len(arr)
        for h in horizons:
            if h >= n:
                continue
            # Percentage change
            shifted = np.empty(n, dtype=np.float64)
            shifted[:h] = np.nan
            shifted[h:] = arr[:-h]
            pct = np.where(
                np.abs(shifted) > 1e-10,
                ((arr - shifted) / np.abs(shifted)).astype(np.float32),
                np.float32(np.nan)
            )
            # Clip extreme values
            pct = np.clip(pct, -10.0, 10.0).astype(np.float32)
            new_features[f"{target_prefix}_chg{h}_{key}"] = pct
            count += 1

    log(f"  L{level+1} derivative features: {count}")
    return new_features


def engineer_temporal_ranks(features, dates, windows=[252, 504]):
    """Rolling percentile rank within ORCL's own history."""
    log("Engineering temporal ranks...")
    rank_features = {}

    # Select key features to rank (returns, vol, momentum, fundamentals, correlations)
    key_patterns = ['L0_ret', 'L0_vol', 'L0_mktcap', 'L0_ps', 'L0_ptpm', 'L0_ptb',
                    'L0_npm', 'L0_roe', 'L0_roa', 'L0_de_ratio', 'L0_bm', 'L0_pe_op_basic',
                    'L1_ret_mean', 'L1_ret_std', 'L1_ret_skew', 'L1_ret_kurt',
                    'L1_rsi_', 'L1_mom_', 'L1_macd', 'L1_bb_pctB',
                    'L1_vol_zscore', 'L1_logvol_mean', 'L1_drawdown',
                    'L1_vol_rel_', 'L1_price_vs_ma']

    for key in features:
        if any(key.startswith(pat) or pat in key for pat in key_patterns):
            arr = features[key].astype(np.float64)
            for w in windows:
                rank_features[f"RANK_t{w}_{key}"] = rolling_percentile_rank(arr, w)

    log(f"  Temporal rank features: {len(rank_features)}")
    return rank_features


def engineer_cross_sectional_ranks(features, dates):
    """Rank ORCL's features among peer stocks."""
    log("Engineering cross-sectional ranks...")
    rank_features = {}

    peer_path = DATA / "peer_features.pkl"
    if not peer_path.exists():
        log("  WARNING: No peer data found, skipping cross-sectional ranks")
        return rank_features

    with open(peer_path, 'rb') as f:
        peer_data = pickle.load(f)

    orcl_dates_dt = pd.to_datetime(dates)

    # Key features to rank cross-sectionally
    rank_cols = ['prc_adj', 'ret', 'vol', 'mktcap', 'ps', 'ptpm', 'ptb', 'npm',
                 'roe', 'roa', 'de_ratio', 'bm', 'pe_op_basic', 'pcf', 'divyield', 'gpm']

    for col in rank_cols:
        orcl_key = f"L0_{col}"
        if orcl_key not in features:
            continue

        orcl_arr = features[orcl_key].astype(np.float64)

        # Collect peer values
        peer_vals = []
        for tkr, pdf in peer_data.items():
            if col in pdf.columns:
                aligned = pdf[col].reindex(orcl_dates_dt).ffill()
                peer_vals.append(aligned.values.astype(np.float64))

        if not peer_vals:
            continue

        # Stack: (n_peers, T)
        peer_matrix = np.column_stack(peer_vals)  # (T, n_peers)
        n_total = peer_matrix.shape[1] + 1  # peers + ORCL

        # Compute rank for each day
        ranks = np.empty(len(orcl_arr), dtype=np.float32)
        for i in range(len(orcl_arr)):
            orcl_val = orcl_arr[i]
            if np.isnan(orcl_val):
                ranks[i] = np.nan
                continue
            below = 0
            valid = 1  # ORCL itself
            for j in range(peer_matrix.shape[1]):
                pv = peer_matrix[i, j]
                if not np.isnan(pv):
                    valid += 1
                    if pv <= orcl_val:
                        below += 1
            ranks[i] = np.float32((below + 1) / valid)  # +1 for ORCL itself

        rank_features[f"RANK_xs_{col}"] = ranks

    log(f"  Cross-sectional rank features: {len(rank_features)}")
    return rank_features


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    t0 = time.time()

    # ── Load Data ──────────────────────────────────────────────────────────
    log("Loading data...")
    orcl_base = pd.read_parquet(DATA / "orcl_base.parquet")
    orcl_base['date'] = pd.to_datetime(orcl_base['date'])
    dates = orcl_base['date'].values

    orcl_ohlcv = None
    ohlcv_path = DATA / "orcl_ohlcv.parquet"
    if ohlcv_path.exists():
        orcl_ohlcv = pd.read_parquet(ohlcv_path)
        orcl_ohlcv['date'] = pd.to_datetime(orcl_ohlcv['date'])

    log(f"ORCL: {len(orcl_base)} rows, {orcl_base['date'].min().date()} to {orcl_base['date'].max().date()}")

    # ── Phase 2a: L0 Base Features ─────────────────────────────────────────
    all_features = {}
    all_features.update(engineer_L0_base(orcl_base))

    # ── Phase 2b: L1 Technical Indicators ──────────────────────────────────
    all_features.update(engineer_L1_technicals(orcl_base, orcl_ohlcv, dates))

    # ── Phase 2c: Cross-Asset Features ─────────────────────────────────────
    orcl_ret = orcl_base['ret'].values.astype(np.float64)
    all_features.update(engineer_cross_asset(orcl_ret, dates))

    # ── Phase 2d: Macro Features ───────────────────────────────────────────
    all_features.update(engineer_macro_features(dates))

    # ── Phase 2e: Fama-French Features ─────────────────────────────────────
    all_features.update(engineer_ff_features(dates))

    log(f"\nBase features (L0 + L1 + XA + MACRO + FF): {len(all_features)}")

    # ── Phase 2f: L2 — 1st Derivative (Changes) ───────────────────────────
    l1_features = {k: v for k, v in all_features.items() if k.startswith(('L0_', 'L1_'))}
    l2_features = engineer_derivatives(l1_features, level=1, horizons=CHANGE_HORIZONS)
    all_features.update(l2_features)

    log(f"After L2: {len(all_features)} total features")
    gc.collect()

    # ── Phase 2g: L3 — 2nd Derivative (Acceleration) ──────────────────────
    l3_features = engineer_derivatives(l2_features, level=2, horizons=CHANGE_HORIZONS)
    all_features.update(l3_features)

    log(f"After L3: {len(all_features)} total features")
    gc.collect()

    # ── Phase 2h: L4 — 3rd Derivative (Jerk) ──────────────────────────────
    # For L4, only compute for key L3 features (returns, vol, momentum, RSI)
    key_l3 = {}
    key_patterns_l3 = ['L3_chg', 'L0_ret', 'L0_vol', 'L1_ret_', 'L1_rsi_',
                       'L1_mom_', 'L1_macd', 'L1_bb_', 'L1_vol_']
    for k, v in l3_features.items():
        for pat in key_patterns_l3:
            if pat in k:
                key_l3[k] = v
                break
    # Limit L4 to prevent memory explosion — take first 2000 L3 features
    if len(key_l3) > 2000:
        key_l3 = dict(list(key_l3.items())[:2000])

    l4_features = engineer_derivatives(key_l3, level=3, horizons=[1, 5, 22])
    all_features.update(l4_features)

    log(f"After L4: {len(all_features)} total features")
    gc.collect()

    # ── Phase 2i: Cross-Asset Derivative Features ──────────────────────────
    log("Engineering cross-asset derivative features...")
    xa_features = {k: v for k, v in all_features.items() if k.startswith('XA_')}
    xa_l2 = engineer_derivatives(xa_features, level=1, horizons=[1, 5, 22, 66],
                                  target_prefix="XA_L2", use_all_keys=True)
    all_features.update(xa_l2)
    xa_l3 = engineer_derivatives(xa_l2, level=2, horizons=[1, 5, 22],
                                  target_prefix="XA_L3", use_all_keys=True)
    all_features.update(xa_l3)

    log(f"After XA derivatives: {len(all_features)} total features")
    gc.collect()

    # ── Phase 2j: Macro Derivative Features ────────────────────────────────
    log("Engineering macro derivative features...")
    macro_features = {k: v for k, v in all_features.items() if k.startswith('MACRO_')}
    macro_l2 = engineer_derivatives(macro_features, level=1, horizons=[1, 5, 22, 66],
                                     target_prefix="MACRO_L2", use_all_keys=True)
    all_features.update(macro_l2)

    log(f"After MACRO derivatives: {len(all_features)} total features")
    gc.collect()

    # ── Phase 2k: Temporal Ranks ───────────────────────────────────────────
    all_features.update(engineer_temporal_ranks(all_features, dates))

    # ── Phase 2l: Cross-Sectional Ranks ────────────────────────────────────
    all_features.update(engineer_cross_sectional_ranks(all_features, dates))

    log(f"\n{'='*60}")
    log(f"TOTAL FEATURES: {len(all_features)}")
    log(f"{'='*60}")

    # ── Save ───────────────────────────────────────────────────────────────
    log("Building DataFrame and saving...")

    # Build DataFrame
    feat_df = pd.DataFrame(all_features, index=pd.to_datetime(dates))
    feat_df.index.name = 'date'

    # Force float32 throughout
    for c in feat_df.columns:
        feat_df[c] = feat_df[c].astype(np.float32)

    # Replace inf with NaN
    feat_df = feat_df.replace([np.inf, -np.inf], np.nan)

    log(f"Feature matrix shape: {feat_df.shape}")
    log(f"Memory usage: {feat_df.memory_usage(deep=True).sum() / 1e9:.2f} GB")
    log(f"NaN percentage: {feat_df.isna().mean().mean() * 100:.1f}%")

    # Save
    feat_df.to_parquet(FEAT / "all_features.parquet")
    log(f"Saved all_features.parquet")

    # Save metadata
    metadata = {
        'feature_names': list(feat_df.columns),
        'n_features': len(feat_df.columns),
        'n_rows': len(feat_df),
        'date_range': (feat_df.index.min(), feat_df.index.max()),
        'categories': {
            'L0': [c for c in feat_df.columns if c.startswith('L0_')],
            'L1': [c for c in feat_df.columns if c.startswith('L1_')],
            'L2': [c for c in feat_df.columns if c.startswith('L2_')],
            'L3': [c for c in feat_df.columns if c.startswith('L3_')],
            'L4': [c for c in feat_df.columns if c.startswith('L4_')],
            'XA': [c for c in feat_df.columns if c.startswith('XA_') and not c.startswith(('XA_L2', 'XA_L3'))],
            'XA_L2': [c for c in feat_df.columns if c.startswith('XA_L2')],
            'XA_L3': [c for c in feat_df.columns if c.startswith('XA_L3')],
            'MACRO': [c for c in feat_df.columns if c.startswith('MACRO_') and not c.startswith('MACRO_L2')],
            'MACRO_L2': [c for c in feat_df.columns if c.startswith('MACRO_L2')],
            'FF': [c for c in feat_df.columns if c.startswith('FF_')],
            'RANK_temporal': [c for c in feat_df.columns if c.startswith('RANK_t')],
            'RANK_cross_sect': [c for c in feat_df.columns if c.startswith('RANK_xs')],
        }
    }
    with open(FEAT / "feature_metadata.pkl", 'wb') as f:
        pickle.dump(metadata, f, protocol=4)
    log("Saved feature_metadata.pkl")

    elapsed = time.time() - t0
    log(f"\nPhase 2 COMPLETE in {elapsed/60:.1f} minutes")
    log(f"Feature categories:")
    for cat, cols in metadata['categories'].items():
        log(f"  {cat}: {len(cols)} features")


if __name__ == "__main__":
    main()

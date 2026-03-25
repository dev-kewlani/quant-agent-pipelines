"""
Phase 1: Data Collection
=========================
Loads ORCL from CRSP chunk_0, fetches latest OHLCV via yfinance,
loads all external instruments (indices, commodities, rates, FX, FF factors, FRED macro),
merges into aligned daily panel.

Outputs:
  data/orcl_base.parquet       - ORCL time series (CRSP + yfinance extended)
  data/orcl_ohlcv.parquet      - ORCL OHLCV from yfinance (full history for ATR/BB)
  data/cross_asset_prices.parquet  - All cross-asset close prices
  data/cross_asset_returns.parquet - All cross-asset daily returns
  data/macro_daily.parquet     - FRED macro features (forward-filled daily)
  data/ff_factors.parquet      - Fama-French factors
  data/peer_features.parquet   - Peer stock features for cross-sectional ranks
"""

import pandas as pd
import numpy as np
import yfinance as yf
from pathlib import Path
import warnings
import time
import sys

warnings.filterwarnings('ignore')

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE = Path("Path(os.environ.get("DATA_DIR", "."))")
OUT  = BASE / "Idea 4 - Spreads" / "orcl_analysis" / "data"
CHUNK0 = BASE / "Idea 2 - CRSP_COMPUSTAT" / "data" / "data_cleaned" / "chunk_0_filtered_gapDays.parquet"
EXT  = BASE / "EXTERNAL"
OUT.mkdir(parents=True, exist_ok=True)

# ── Configuration ──────────────────────────────────────────────────────────────
ORCL_TICKER = "ORCL"
# Peer stocks in chunk_0 for cross-sectional ranks (large-cap tech + diversified)
PEER_TICKERS = ["AAPL", "HON", "T", "XOM", "LIN", "CVX", "GS"]

# yfinance cross-asset tickers (ETFs/indices for 2025-2026 extension)
YF_CROSS_ASSET = {
    # US Equity Indices
    "SPY": "sp500_etf", "QQQ": "nasdaq100_etf", "IWM": "russell2000_etf",
    "DIA": "dow_etf",
    # Sectors
    "XLK": "tech_sector", "XLF": "financials_sector", "XLV": "healthcare_sector",
    "XLE": "energy_sector", "XLI": "industrials_sector", "XLB": "materials_sector",
    "XLRE": "realestate_sector", "XLU": "utilities_sector", "XLC": "comms_sector",
    "XLP": "staples_sector", "XLY": "discretionary_sector",
    # Commodities
    "GLD": "gold_etf", "SLV": "silver_etf", "USO": "oil_etf",
    "DBA": "agriculture_etf", "DBB": "basemetals_etf",
    # Bonds
    "TLT": "treasury20y_etf", "IEF": "treasury10y_etf", "SHY": "treasury3y_etf",
    "LQD": "ig_corp_etf", "HYG": "hy_corp_etf", "AGG": "agg_bond_etf",
    # Volatility
    "^VIX": "vix",
    # Currency
    "UUP": "dollar_etf",
    # ORCL peers (enterprise tech)
    "CRM": "salesforce", "MSFT": "microsoft", "AMZN": "amazon",
    "GOOGL": "google", "SAP": "sap", "IBM": "ibm", "ADBE": "adobe",
    "NOW": "servicenow", "INTU": "intuit",
}

# ── Helper Functions ───────────────────────────────────────────────────────────
def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_crsp_orcl():
    """Load ORCL + peers from CRSP chunk_0."""
    log("Loading CRSP chunk_0...")
    df = pd.read_parquet(CHUNK0)

    # Identify numeric columns (exclude flags, categoricals, identifiers)
    exclude_patterns = ['_flag', '_desc', 'ffi', 'permno', 'comnam', 'cusip',
                        'ticker', 'siccd', 'gsector', 'gicdesc', 'adate', 'qdate',
                        'public_date', 'public_date_used']
    numeric_cols = []
    for c in df.columns:
        if c == 'date':
            continue
        if any(pat in c for pat in exclude_patterns):
            continue
        if pd.api.types.is_numeric_dtype(df[c]):
            numeric_cols.append(c)

    tickers_needed = [ORCL_TICKER] + PEER_TICKERS

    result = {}
    for tkr in tickers_needed:
        sub = df[df['ticker'] == tkr][['date'] + numeric_cols].copy()
        sub = sub.sort_values('date').reset_index(drop=True)
        sub['date'] = pd.to_datetime(sub['date'])
        # Downcast to float32
        for c in numeric_cols:
            sub[c] = sub[c].astype(np.float32)
        result[tkr] = sub
        log(f"  {tkr}: {len(sub)} rows, {sub['date'].min().date()} to {sub['date'].max().date()}")

    log(f"  Numeric features: {len(numeric_cols)}")
    return result, numeric_cols


def fetch_yfinance_orcl():
    """Fetch ORCL full history OHLCV from yfinance (needed for ATR, Bollinger, etc.)."""
    log("Fetching ORCL OHLCV from yfinance...")
    try:
        tkr = yf.Ticker("ORCL")
        df = tkr.history(period="max", auto_adjust=True)
        df = df.reset_index()
        df.columns = [c.lower().replace(' ', '_') for c in df.columns]
        df['date'] = pd.to_datetime(df['date']).dt.tz_localize(None)
        df = df[['date', 'open', 'high', 'low', 'close', 'volume']].copy()
        for c in ['open', 'high', 'low', 'close']:
            df[c] = df[c].astype(np.float32)
        df['volume'] = df['volume'].astype(np.float64)
        log(f"  ORCL yfinance: {len(df)} rows, {df['date'].min().date()} to {df['date'].max().date()}")
        return df
    except Exception as e:
        log(f"  WARNING: yfinance ORCL fetch failed: {e}")
        return None


def fetch_yfinance_cross_asset():
    """Fetch cross-asset ETFs/indices from yfinance."""
    log("Fetching cross-asset data from yfinance...")
    all_tickers = list(YF_CROSS_ASSET.keys()) + ["ORCL"]

    results = {}
    # Batch download in groups of 10 to avoid rate limits
    batch_size = 10
    ticker_list = list(all_tickers)

    for i in range(0, len(ticker_list), batch_size):
        batch = ticker_list[i:i+batch_size]
        batch_str = " ".join(batch)
        log(f"  Fetching batch {i//batch_size + 1}: {batch}")
        try:
            data = yf.download(batch_str, period="max", auto_adjust=True,
                             progress=False, threads=True)
            if isinstance(data.columns, pd.MultiIndex):
                for tkr in batch:
                    try:
                        sub = data['Close'][tkr].dropna()
                        if len(sub) > 100:
                            results[tkr] = sub
                    except (KeyError, TypeError):
                        log(f"    WARNING: No data for {tkr}")
            else:
                # Single ticker
                if len(batch) == 1:
                    results[batch[0]] = data['Close'].dropna()
        except Exception as e:
            log(f"    WARNING: Batch download failed: {e}")
            # Try individually
            for tkr in batch:
                try:
                    t = yf.Ticker(tkr)
                    hist = t.history(period="max", auto_adjust=True)
                    if len(hist) > 100:
                        results[tkr] = hist['Close']
                        log(f"    {tkr}: {len(hist)} rows (individual fetch)")
                except Exception as e2:
                    log(f"    WARNING: {tkr} failed: {e2}")
        time.sleep(1)  # Rate limit courtesy

    # Build price DataFrame
    if results:
        prices = pd.DataFrame(results)
        prices.index = pd.to_datetime(prices.index).tz_localize(None)
        prices.index.name = 'date'
        prices = prices.sort_index()
        # Rename columns to descriptive names
        rename_map = {}
        for tkr, name in YF_CROSS_ASSET.items():
            if tkr in prices.columns:
                rename_map[tkr] = name
        if "ORCL" in prices.columns:
            rename_map["ORCL"] = "orcl_yf"
        prices = prices.rename(columns=rename_map)
        prices = prices.astype(np.float32)
        log(f"  Cross-asset prices: {prices.shape}, {prices.index.min().date()} to {prices.index.max().date()}")
        return prices
    return None


def load_external_instruments():
    """Load all instruments from EXTERNAL directory (parquet files)."""
    log("Loading external instruments...")

    categories = {
        'commodities': EXT / 'commodities',
        'indices': EXT / 'indices',
        'crypto': EXT / 'crypto',
    }

    all_prices = {}
    for cat_name, cat_dir in categories.items():
        if not cat_dir.exists():
            continue
        for f in sorted(cat_dir.glob("*.parquet")):
            try:
                df = pd.read_parquet(f)
                if 'date' in df.columns and 'close' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                    series = df.set_index('date')['close'].sort_index()
                    name = f"ext_{cat_name}_{f.stem}"
                    all_prices[name] = series.astype(np.float32)
            except Exception as e:
                pass  # Skip corrupt files silently

    if all_prices:
        prices = pd.DataFrame(all_prices)
        prices.index = pd.to_datetime(prices.index)
        prices = prices.sort_index()
        log(f"  External instruments: {prices.shape[1]} series, {prices.index.min().date()} to {prices.index.max().date()}")
        return prices
    return None


def load_fred_macro():
    """Load FRED daily/weekly/monthly and forward-fill to daily."""
    log("Loading FRED macro data...")

    all_series = {}

    # Daily FRED
    daily_dir = EXT / 'fred' / 'daily'
    if daily_dir.exists():
        for f in sorted(daily_dir.glob("*.parquet")):
            if f.stem.startswith('_'):
                continue  # Skip aggregate files
            try:
                df = pd.read_parquet(f)
                if 'date' in df.columns and 'value' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                    series = df.set_index('date')['value'].sort_index()
                    all_series[f"fred_d_{f.stem}"] = series
                elif 'date' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                    df = df.set_index('date')
                    for c in df.columns:
                        if df[c].dtype in ['float64', 'float32', 'int64']:
                            all_series[f"fred_d_{f.stem}_{c}"] = df[c]
            except Exception:
                pass

    # Weekly FRED
    weekly_dir = EXT / 'fred' / 'weekly'
    if weekly_dir.exists():
        for f in sorted(weekly_dir.glob("*.parquet")):
            if f.stem.startswith('_'):
                continue
            try:
                df = pd.read_parquet(f)
                if 'date' in df.columns and 'value' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                    series = df.set_index('date')['value'].sort_index()
                    all_series[f"fred_w_{f.stem}"] = series
                elif 'date' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                    df = df.set_index('date')
                    for c in df.columns:
                        if df[c].dtype in ['float64', 'float32', 'int64']:
                            all_series[f"fred_w_{f.stem}_{c}"] = df[c]
            except Exception:
                pass

    # Monthly FRED
    monthly_dir = EXT / 'fred' / 'monthly'
    if monthly_dir.exists():
        for f in sorted(monthly_dir.glob("*.parquet")):
            if f.stem.startswith('_'):
                continue
            try:
                df = pd.read_parquet(f)
                if 'date' in df.columns and 'value' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                    series = df.set_index('date')['value'].sort_index()
                    all_series[f"fred_m_{f.stem}"] = series
                elif 'date' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])
                    df = df.set_index('date')
                    for c in df.columns:
                        if df[c].dtype in ['float64', 'float32', 'int64']:
                            all_series[f"fred_m_{f.stem}_{c}"] = df[c]
            except Exception:
                pass

    if all_series:
        macro = pd.DataFrame(all_series)
        macro.index = pd.to_datetime(macro.index)
        macro = macro.sort_index()
        # Forward-fill (macro data publishes with lag)
        macro = macro.ffill()
        macro = macro.astype(np.float32)
        log(f"  FRED macro: {macro.shape[1]} series, {macro.index.min().date()} to {macro.index.max().date()}")
        return macro
    return None


def load_fama_french():
    """Load Fama-French daily factors."""
    log("Loading Fama-French factors...")
    ff_dir = EXT / 'fama_french'

    all_series = {}

    # FF5 daily
    ff5_path = ff_dir / 'ff5_daily.parquet'
    if ff5_path.exists():
        df = pd.read_parquet(ff5_path)
        df['date'] = pd.to_datetime(df['date'])
        df = df.set_index('date').sort_index()
        ff5_names = ['Mkt_RF', 'SMB', 'HML', 'RMW', 'CMA', 'RF']
        for i, c in enumerate(df.columns):
            name = ff5_names[i] if i < len(ff5_names) else f'ff5_{c}'
            all_series[f"ff_{name}"] = df[c]

    # Momentum daily
    mom_path = ff_dir / 'momentum_daily.parquet'
    if mom_path.exists():
        df = pd.read_parquet(mom_path)
        df['date'] = pd.to_datetime(df['date'])
        df = df.set_index('date').sort_index()
        for c in df.columns:
            if c != 'date':
                all_series[f"ff_Mom_{c}"] = df[c]

    # Short-term reversal
    st_path = ff_dir / 'st_reversal_daily.parquet'
    if st_path.exists():
        df = pd.read_parquet(st_path)
        df['date'] = pd.to_datetime(df['date'])
        df = df.set_index('date').sort_index()
        for c in df.columns:
            if c != 'date':
                all_series[f"ff_STRev_{c}"] = df[c]

    # Long-term reversal
    lt_path = ff_dir / 'lt_reversal_daily.parquet'
    if lt_path.exists():
        df = pd.read_parquet(lt_path)
        df['date'] = pd.to_datetime(df['date'])
        df = df.set_index('date').sort_index()
        for c in df.columns:
            if c != 'date':
                all_series[f"ff_LTRev_{c}"] = df[c]

    if all_series:
        ff = pd.DataFrame(all_series)
        ff.index = pd.to_datetime(ff.index)
        ff = ff.sort_index().astype(np.float32)
        log(f"  Fama-French: {ff.shape[1]} factors, {ff.index.min().date()} to {ff.index.max().date()}")
        return ff
    return None


def merge_and_save():
    """Master merge: align everything to ORCL's date index."""

    # 1. Load CRSP
    crsp_dict, numeric_cols = load_crsp_orcl()
    orcl_crsp = crsp_dict[ORCL_TICKER]

    # 2. Fetch yfinance ORCL OHLCV
    orcl_ohlcv = fetch_yfinance_orcl()

    # 3. Fetch yfinance cross-asset
    yf_prices = fetch_yfinance_cross_asset()

    # 4. Load external instruments
    ext_prices = load_external_instruments()

    # 5. Load FRED macro
    macro = load_fred_macro()

    # 6. Load Fama-French
    ff = load_fama_french()

    # ── Build master date index ────────────────────────────────────────────────
    # Use ORCL CRSP dates as primary, extend with yfinance
    orcl_dates = set(orcl_crsp['date'].values)

    if orcl_ohlcv is not None:
        # Extend with yfinance dates beyond CRSP
        crsp_max = orcl_crsp['date'].max()
        yf_extension = orcl_ohlcv[orcl_ohlcv['date'] > crsp_max]
        if len(yf_extension) > 0:
            log(f"Extending ORCL with {len(yf_extension)} yfinance days beyond {crsp_max.date()}")
            # Compute returns from combined close series
            combined_close = pd.concat([
                orcl_crsp[['date', 'prc_adj']],
                pd.DataFrame({'date': yf_extension['date'].values,
                               'prc_adj': yf_extension['close'].values})
            ]).sort_values('date').reset_index(drop=True)
            combined_close['ret'] = combined_close['prc_adj'].pct_change().astype(np.float32)

            # Build extension rows — start with all CRSP columns as NaN
            ext_rows = pd.DataFrame(index=range(len(yf_extension)))
            ext_rows['date'] = yf_extension['date'].values
            for c in orcl_crsp.columns:
                if c == 'date':
                    continue
                ext_rows[c] = np.float32(np.nan)

            # Fill in what we have from yfinance
            ext_rows['prc_adj'] = yf_extension['close'].values.astype(np.float32)
            ext_rows['openprc'] = yf_extension['open'].values.astype(np.float32)
            ext_rows['vol'] = yf_extension['volume'].values.astype(np.float32)

            # Fill returns from combined series
            ext_dates = set(ext_rows['date'].values)
            ret_map = combined_close.set_index('date')['ret'].to_dict()
            ext_rows['ret'] = ext_rows['date'].map(ret_map).astype(np.float32)

            orcl_base = pd.concat([orcl_crsp, ext_rows[orcl_crsp.columns]], ignore_index=True)
            orcl_base = orcl_base.sort_values('date').reset_index(drop=True)
        else:
            orcl_base = orcl_crsp.copy()
    else:
        orcl_base = orcl_crsp.copy()

    log(f"ORCL base: {len(orcl_base)} rows, {orcl_base['date'].min().date()} to {orcl_base['date'].max().date()}")

    # ── Save ORCL base ─────────────────────────────────────────────────────────
    orcl_base.to_parquet(OUT / "orcl_base.parquet", index=False)
    log(f"Saved orcl_base.parquet ({len(orcl_base)} rows, {len(orcl_base.columns)} cols)")

    # ── Save ORCL OHLCV ───────────────────────────────────────────────────────
    if orcl_ohlcv is not None:
        orcl_ohlcv.to_parquet(OUT / "orcl_ohlcv.parquet", index=False)
        log(f"Saved orcl_ohlcv.parquet ({len(orcl_ohlcv)} rows)")

    # ── Merge cross-asset prices ───────────────────────────────────────────────
    # Combine yfinance ETF prices with external parquet prices
    all_cross = []
    if yf_prices is not None:
        all_cross.append(yf_prices)
    if ext_prices is not None:
        all_cross.append(ext_prices)

    if all_cross:
        cross_prices = pd.concat(all_cross, axis=1)
        # Remove duplicate columns (prefer yfinance as more recent)
        cross_prices = cross_prices.loc[:, ~cross_prices.columns.duplicated(keep='first')]
        cross_prices = cross_prices.sort_index().ffill()

        # Compute returns
        cross_returns = cross_prices.pct_change().astype(np.float32)

        cross_prices.to_parquet(OUT / "cross_asset_prices.parquet")
        cross_returns.to_parquet(OUT / "cross_asset_returns.parquet")
        log(f"Saved cross_asset prices/returns: {cross_prices.shape}")

    # ── Save macro ─────────────────────────────────────────────────────────────
    if macro is not None:
        macro.to_parquet(OUT / "macro_daily.parquet")
        log(f"Saved macro_daily.parquet ({macro.shape[1]} series)")

    # ── Save FF factors ────────────────────────────────────────────────────────
    if ff is not None:
        ff.to_parquet(OUT / "ff_factors.parquet")
        log(f"Saved ff_factors.parquet ({ff.shape[1]} factors)")

    # ── Save peer features for cross-sectional ranks ───────────────────────────
    peer_data = {}
    for tkr in PEER_TICKERS:
        if tkr in crsp_dict:
            pdf = crsp_dict[tkr].set_index('date')
            # Keep only key features for ranking
            key_cols = [c for c in ['prc_adj', 'ret', 'vol', 'mktcap', 'ps', 'ptpm',
                                     'ptb', 'npm', 'roe', 'roa', 'de_ratio', 'bm',
                                     'pe_op_basic', 'pcf', 'divyield', 'gpm'] if c in pdf.columns]
            peer_data[tkr] = pdf[key_cols]

    if peer_data:
        # Save as dict of DataFrames
        import pickle
        with open(OUT / "peer_features.pkl", 'wb') as f:
            pickle.dump(peer_data, f, protocol=4)
        log(f"Saved peer_features.pkl ({len(peer_data)} peers)")

    log("=" * 60)
    log("Phase 1 COMPLETE — all data saved to orcl_analysis/data/")
    log("=" * 60)


if __name__ == "__main__":
    merge_and_save()

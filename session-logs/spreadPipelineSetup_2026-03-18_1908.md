## User (exchange 1)
Create a new directory "Idea 4 - Spreads" in DATA. Build a Jupyter notebook (not .py) that:
- Loads 3 stocks (ORCL, JPM, WMT) from fundamental chunks starting from 2010 (parameterizable)
- Loads Gold and Russell 2000 from external data
- 5 instruments total, computes all 5C2=10 spread pairs (price ratios)
- Builds feature matrix: top 5 fundamental + top 5 technical features (check feature importance files)
- Spread features: ratio of features between instruments in each pair
- Change features: day-on-day, month-on-month, year-on-year shifts
- Forward returns: 22d, 66d, 120d, 252d
- Distribution analysis: spread distributions, regime dependency, max spread/return, feature-target correlations
- Monetizability assessment
- Make it parameterizable, plug-and-play, easy to debug, daily frequency only
- Update memory with this info

## Claude (exchange 1)
Created `DATA/Idea 4 - Spreads/spread_analysis.ipynb` — a 33-cell Jupyter notebook with the full pipeline:

**Data**: ORCL (chunk_0), JPM + WMT (chunk_6000), Gold (EXTERNAL/commodities), Russell 2000 (EXTERNAL/indices). 4,041 trading days from 2010-01-04 to 2026-01-23.

**Pipeline structure**:
1. Configuration cell (all parameters)
2. Data Loading (stocks from chunks + external instruments)
3. Spread Construction (10 pairs, price ratio A/B)
4. Feature Engineering:
   - 15 fundamental features (5 × 3 stocks: ps, ptpm, ptb, npm, aftret_eq)
   - 25 technical features (5 × 5 instruments: RSI-14, vol-66d, vol-126d, mom-5d, mom-22d)
   - 65 spread features (tech ratios for all 10 pairs + fund ratios for 3 stock pairs)
   - 90 change features (1d/22d/252d pct_change for spreads + key spread features)
5. Forward Returns (40 columns: 10 spreads × 4 horizons)
6. Master DataFrame (4,041 × 255, 3.4% NaN)
7. Distribution & Analysis (histograms, time series, regime heatmap, extremes, correlations)
8. Monetizability Assessment (mean reversion half-life, simple strategy Sharpe, feature predictability)

Also created CLAUDE.md for the directory and updated memory index.

## User (exchange 2)
Run the notebook, tell me results.

## Claude (exchange 2)
Executed full notebook. ORCL/WMT best simple MR Sharpe 0.61. Portfolio top-3 = Sharpe 0.61, maxDD -15.6%. XGBoost OOS IC +0.098.

## User (exchange 3)
Implement more — don't tell me, just do it.

## Claude (exchange 3)
Added 19 cells: cointegration, z-score strategy, risk metrics, portfolio, lookback optimization, XGBoost, rolling Sharpe, final assessment.

## User (exchange 4)
Expand fundamentals to top 20+ with mandatory categories. Top 30 technicals from importance file. Add FROM/TO window dicts.

## Claude (exchange 4)
Expanded: 35 fundamentals (108 cols), 870 technicals via FROM/TO windows, 205 spread features, 303 change features. Master: 1,546 columns. XGBoost OOS IC jumped to +0.200, Sharpe to +0.73.

## User (exchange 7-10)
Rebuilt notebook to individual instruments (no spreads). Added autocorr filter (<0.7, 995→92 tech features), fundamental decay (half-life 45d). Trained 6 model types: continuous regression, ordinal (base/weighted/Huber), binary bin-5 classifier, max DD ordinal. Pooled all instruments per time bin. Best: ordinal IC=+0.131, max DD IC=+0.178, binary bin-5 precision=55.6% with +41.8% mean buy return at 253-504d.

## User (exchange 11-20, 2026-03-18 to 2026-03-19)
- Discussed overlap problem with 5 instruments (252d forward windows = ~6-7 independent observations)
- Discussed individual stocks + LEAPs vs spreads strategy
- Added weighted ordinal (5x bin-5 weight), Huber ordinal, binary bin-5 classifier, max DD ordinal
- Scaled from 5 → 125 instruments (75 stocks + 50 external)
- Fixed FRED schema issue (value column, not close)
- Fixed dropna issue (thresh=50% instead of how='any')
- Built parallel feature screening: IC>0.03 + autocorr<0.7 with ThreadPoolExecutor
- Discovered spurious ALUMINUM volume features (high IC on sparse/zero data)
- Need to filter low-entropy features (>50% same value)
- Computed IC ranking with numba (2.17M IC computations)
- Provided checkpoint save/load code
- Session ended with 125 instruments loaded, ~2800 tech features surviving IC+autocorr, pending low-entropy filter and model retraining

## User (exchange 5)
Spreads vs individual stocks discussion - LEAPs strategy idea.

## Claude (exchange 5)
Discussed: individual stocks with LEAP options have multiple-X potential; spreads are capped. LEAPs give convex payoffs + defined risk.

## User (exchange 6)
Rebuild notebook: delete spreads, keep individual stock returns, feature_df + fwd_ret_df only. Decile binning with cross-instrument visualization. Forward binning with max drawdown categories (event velocity approach).

## Claude (exchange 6)
Complete notebook rebuild (27 cells):
- feature_df: 4,041 rows x 1,108 columns (108 fundamental + 995 technical/volume + 5 returns)
- fwd_ret_df: 4,041 rows x 30 columns (5 instruments x 6 horizons)
- Decile analysis: 11,010 rank IC scores computed, cross-instrument heatmaps
- Forward binning: 96,065 bin assignments across 5 instruments x 5 time bins
- Top features: JPM_ret_min_f0_t252 (avg|IC|=0.243), RUT_ret_range_f0_t126 (0.228), JPM_capei (0.209)
- Cross-instrument insight: RUT return range features predict ALL instruments positively (regime signal). GOLD_ret_max predicts RUT strongly (+0.35 IC).

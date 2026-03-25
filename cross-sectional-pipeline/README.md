# Cross-Sectional Equity Factor Model

5-step pipeline for cross-sectional equity prediction over ~6,000 US stocks.

## Pipeline Steps

1. **`xs_01_features.py`** — Per-stock feature engineering with Numba parallel kernels across 7 CRSP/Compustat chunks. L0 base + L1 technicals + L2 changes + L3 accelerations.

2. **Label & Rank Construction** (not included) — Path-dependent forward return and drawdown labels, cross-sectionally ranked at each rebalance date. Combined with macro/FF factor features.

3. **`xs_03_train_backtest.py`** — Walk-forward XGBoost classification with 5-fold temporal CV. OOS AUC 0.70+ across all horizons.

4. **`xs_04_strategy_search.py`** — Exhaustive strategy search: 756 combinations of scoring methods, portfolio sizes, and directions.

5. **Neutralized Backtest** (not included) — Dollar/sector/size/sector+size neutral portfolio construction with multiple scoring combinations.

## Key Results

- Sector-neutral, 66d horizon: Sharpe 2.18, 87% win rate
- FF5+Mom alpha: 25% annualized (t=9.75)
- 92% of returns are genuine alpha

## Not Included

Label construction and portfolio scoring methodology are proprietary.

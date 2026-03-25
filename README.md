# Quant Agent Pipelines

End-to-end quantitative research pipelines built via long-running AI agent sessions. Cross-sectional equity factor models, reinforcement learning portfolio optimization, real-time market dashboards, and a custom Claude Code skill library for quant research automation.

## What's Here

### `/cross-sectional-pipeline/` — Walk-Forward Factor Model (5,965 stocks)
Cross-sectional equity prediction pipeline processing 7 CRSP/Compustat chunks (~9,200 stocks, 1972-2024).
- **254 features per stock**: L0 base (22) + L1 technicals (40) + L2 changes (48) + L3 accelerations (144)
- **Cross-sectional percentile ranks** of all features (the dominant signal source)
- **Path-dependent labels**: forward max return + forward max drawdown, ranked cross-sectionally
- **Walk-forward XGBoost**: 5-fold temporal CV, OOS AUC 0.70+ across all horizons
- **Neutralized backtests**: Dollar/sector/size/sector+size neutral portfolios
- **Result**: Sector+size neutral, 66d horizon, **Sharpe 2.19**, max drawdown -14%
- 756 strategy combinations tested exhaustively

### `/alpha-portfolio-rl/` — Transformer Policy Network + DSR Reward
229K-parameter transformer for deep RL portfolio optimization:
- Per-asset temporal encoder -> Cross-asset attention (503 tokens) -> Portfolio head (25L/25S)
- Differential Sharpe Ratio reward, truncated BPTT, 6-phase cost curriculum
- 159 features (30 tech + 97 fundamental + 32 macro), cross-sectional rank normalization
- 5-fold expanding window walk-forward with warm-start

### `/signal-gate/` — XGBoost Ensemble (IC=0.080, Sharpe=1.29)
Four-model XGBoost ensemble: monthly 252d/66d regression + clean-move classifiers. Walk-forward baseline Sharpe=1.29.

### `/orcl-deep-analysis/` — Single-Stock Deep Dive (56,747 features)
10+ hour agent session: 56,747 features across 4 derivative levels + 121 cross-asset instruments + 127 FRED macro. Regime analysis, walk-forward XGBoost, quantile regression, LEAP option simulation.

### `/dashboard-monitoring/` — Real-Time Market Dashboard
Full-stack TypeScript: React 19 + Express + WebSocket. Pluggable data providers (Interactive Brokers TWS primary, Yahoo Finance fallback). Real-time quotes, sparklines, macro regime panel, IV tracking.

### `/claude-skills/` — 22 Custom AI Agent Skills for Quant Research
- **`leakage-audit`**: 6-category data leakage checklist
- **`signal-eval`**: IC/ICIR scorecard with industry benchmarks
- **`beta-trap`**: Sharpe decomposition into beta vs alpha
- **`analytics-audit`**: 5-phase, 16-section enterprise audit
- **`mental-model`**: Multi-pass cognitive pipeline with checkpoints
- **`CLAUDE_GLOBAL.md`**: Performance-first rules (numpy -> CuPy -> Numba prange)

## Tech Stack

| Layer | Tools |
|-------|-------|
| ML | XGBoost (GPU), PyTorch, scikit-learn |
| Compute | CuPy, Numba (@njit parallel prange), numpy panels |
| Data | CRSP/Compustat, 121 cross-asset instruments, 127 FRED series |
| Frontend | React 19, TypeScript, Vite, Lightweight Charts, Zustand |
| Backend | Node.js, Express, WebSocket, @stoqey/ib, yahoo-finance2 |
| Agent | Claude Code, 22 custom skills, persistent memory |

## Key Results

| Pipeline | Metric | Value |
|----------|--------|-------|
| Cross-sectional (sector-neutral, 66d) | Sharpe | **2.18** |
| Cross-sectional (sector-neutral, 66d) | Ann. Return | **27.19%** |
| Cross-sectional (sector-neutral, 66d) | FF5+Mom Alpha | **25.00% (t=9.75)** |
| Cross-sectional (sector-neutral, 66d) | Win Rate | **87%** |
| Signal Gate XGBoost (252d, 25L/25S) | Sharpe | **1.29** |
| XGBoost OOS AUC (return prediction) | AUC | **0.70+** |
| Feature Engineering | Total features | **56,747** |
| Universe | Stocks | **5,965** |

## Factor Attribution (Best Strategy: Sector-Neutral, 66d Hold)

**92% of the strategy's return is genuine alpha.** Only 8% comes from known factor exposures.

| Metric | Value |
|--------|-------|
| Ann. Return | 27.19% |
| Ann. Vol | 12.48% |
| Sharpe | 2.18 |
| Win Rate | 87% |
| FF5+Mom Alpha | 25.00% (t=9.75) |
| R-squared | 0.27 |

**Is it Size?** No. Despite 15.6x market cap asymmetry (long $162M vs short $2.5B), SMB beta is 0.07 (t=0.31) -- insignificant. Both sides load positively on SMB, so net exposure washes out.

**Is it Momentum?** Opposite -- it's REVERSAL. The only significant factor loading is Mom = -0.23 (t=-3.47). The strategy is contrarian:
- Long side: Buys recent losers (Mom beta -0.29)
- Short side: Shorts recent winners (Mom beta +0.18)

**The Alpha Source:** XGBoost learns which mean-reversion setups will work using non-linear interactions between fundamentals (valuation, profitability) and technicals (RSI, vol, momentum). A simple linear reversal captures the -0.23 Mom loading, but the remaining 25% alpha comes from distinguishing genuine turnarounds from value traps.

**Top Feature Drivers:** L3 acceleration of fundamental valuation changes (dominant IC contributor), cross-sectional valuation ranks, and fundamental x size interactions. The signal is dominated by 2nd/3rd derivative features, not raw values.

**Stability:** All 5 sub-periods (2004-2024) positive Sharpe (1.54-2.71). 100% of rolling 3-year windows have alpha > 0 with t > 2.

**Signal Decay:** Monthly rebalancing yields Sharpe 3.49 vs quarterly 2.20. Signal half-life >220 days but faster rebalancing captures more alpha.

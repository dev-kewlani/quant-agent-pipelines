# What I've Built: Agent-Driven Quant Research Pipelines

I build quantitative research systems using long-running AI agent sessions. The agent handles code generation and execution; I direct the research design — what to predict, how to label, what biases to check, when to stop. Below is what I've shipped in the last 6 weeks.

---

## 1. Cross-Sectional Equity Factor Model

**Universe**: 5,965 US equities (CRSP/Compustat, 2000-2024)
**Features**: 254 per stock (fundamentals + technicals + L3 acceleration derivatives), cross-sectionally ranked
**Labels**: Path-dependent — forward max return AND forward max drawdown, ranked cross-sectionally at each rebalance
**Model**: Walk-forward XGBoost, 5-fold temporal CV
**Result after sector-neutralization**:

| Metric | Value |
|--------|-------|
| Ann. Return | 27.19% |
| Ann. Vol | 12.48% |
| Sharpe | 1.84 |
| Win Rate | 87% |
| FF5+Mom Alpha | 25.00% (t=9.75) |
| R-squared vs factors | 0.27 |
| Max Drawdown | -14.3% |

92% of returns are alpha. Only 8% explained by known factors. (Capacity yet to be determined)

**What the model actually does**: It's a contrarian/mean-reversion signal. The only significant factor loading is momentum at -0.23 (t=-3.47). XGBoost learns which mean-reversion setups will work by combining L3 acceleration of fundamental valuation changes with technical context. A simple linear reversal captures the Mom loading; the remaining 25% alpha is the ML model distinguishing turnarounds from value traps.

**Stability**: All 5 sub-periods (2004-2024) have positive Sharpe (1.54-2.71). 100% of rolling 3-year windows have alpha > 0 with t > 2.

**How it was built**: Single agent session. Feature engineering across 7 data chunks with Numba parallel kernels:

```python
@njit(parallel=True, cache=True)
def panel_rolling_std(panel, w):
    """Rolling std on (T, N) panel — parallel over N stocks."""
    T, N = panel.shape
    out = np.full((T, N), np.nan, dtype=np.float32)
    for j in prange(N):
        for i in range(w - 1, T):
            s, s2, c = 0.0, 0.0, 0
            for k in range(i - w + 1, i + 1):
                v = panel[k, j]
                if not np.isnan(v):
                    s += v; s2 += v * v; c += 1
            if c > 1:
                mn = s / c
                out[i, j] = np.float32(np.sqrt(max(s2/c - mn*mn, 0.0)))
    return out
```

Then 756 strategy combinations tested exhaustively (9 scoring methods x 7 portfolio sizes x 3 directions x 4 horizons), with dollar/sector/size/sector+size neutralization variants. The sector+size neutral variant at 66-day hold was the winner.

---

## 2. Real-Time Market Dashboard

Full-stack TypeScript application for live market monitoring.

**Stack**: React 19 + Express + WebSocket + Lightweight Charts
**Data**: Pluggable provider — Interactive Brokers TWS (primary) with automatic Yahoo Finance fallback

Features:
- Real-time stock table with sortable columns, 30-day candlestick sparklines
- Performance periods: 1D through 5Y, with excess return vs SPY toggle
- Macro regime panel with economic event countdowns
- Theme/watchlist management with persistent storage
- IV percentile + IV rank tracking from options chains
- WebSocket message batching (100ms flush) for efficient real-time updates

The provider abstraction was the key design — same frontend works whether connected to a live IBKR TWS session or falling back to Yahoo Finance polling. Connection status badge shows which source is active.

---

## 3. Transformer + Deep RL Portfolio Optimizer

229K-parameter transformer policy network trained with Differential Sharpe Ratio reward:

```
Input: 500 stocks x 60-day sequences x 159 features
  ↓
Per-Asset Temporal Encoder (tech/fund separate, 128→64 merge)
  ↓
Cross-Asset Attention (CLS + MKT + REGIME + 500 stock tokens)
  ↓
Portfolio Head (softmax → 25 long / 25 short, beta-neutral rescaling)
  ↓
Value Head (PPO baseline)
```

Training uses 6-phase cost curriculum: phases 0-2 have zero transaction costs (learn what goes up), phases 3-5 ramp to full realistic costs. 5-fold expanding window walk-forward with warm-start between folds.

**Baseline XGBoost signal gate** (simpler model, same data): IC=0.080, IR=2.73, Sharpe=1.29.

---

## 4. Agent Workflow System

22 custom Claude Code skills built for quant research automation:

**Quant-specific skills**:
- `leakage-audit` — 6-category checklist: target alignment, point-in-time violations, survivorship bias, walk-forward embargo gaps, cross-sectional operations, Compustat datadate vs rdq
- `signal-eval` — IC/ICIR scorecard with benchmarks (">0.02 interesting, >0.05 strong"), regime breakdown, decay analysis, turnover
- `beta-trap` — Sharpe decomposition into beta vs alpha, with the specific context that our first pipeline had beta=1.31 and alpha was not significant
- `backtest-report` — Performance table, IC analysis, risk decomposition, transaction cost sensitivity, capacity estimate

**Global performance rules** enforced across all sessions:
```
1. Vectorize first: numpy/pandas panel ops on full arrays
2. GPU (CuPy) for rolling/sliding window ops on (T, N) panels
3. Numba prange for irregular ops (barrier scans, consecutive counts)
4. Memory-aware: sparse format for >90% NaN matrices
5. Batch over configs, not instruments
```

With a running mistakes log — real errors caught and documented so they don't repeat:
- Wrote per-ticker Python loops for 20K stocks instead of panel-wide ops (fixed: vectorized)
- Created 291K DataFrame columns instead of (T, N) panel dict (would have been 31 TB)
- Serial Numba kernel: 14 min. Parallel prange: 34 sec (25x speedup)

---

## 5. Single-Stock Deep Dive (ORCL, 10+ Hour Session)

Built in a single continuous agent session to stress-test the full pipeline on one name:

- 56,747 features: 4 derivative levels (base → changes → acceleration → jerk) + 121 cross-asset correlation features + 127 FRED macro indicators + Fama-French factors + temporal ranks + cross-sectional ranks
- Regime-conditional forward return distributions across 7 horizons (22d to 252d)
- Walk-forward XGBoost + quantile regression + historical analogue matching (50 nearest neighbors in feature space)
- First-passage-time labels for LEAP option P&L simulation with Black-Scholes pricing
- Bootstrap (200 iterations) + leave-year-out cross-validation for stress testing

The key finding: 3rd-order derivatives of cross-asset correlations (acceleration of changes in betas to sector ETFs) were the single most predictive feature category, with ICIR up to 3.47 — higher than any raw feature or 1st/2nd derivative.

---

## What I'm Looking For

I've been building these systems on nights and weekends while working my primary role. The agent-driven workflow lets me move fast — the cross-sectional pipeline (feature engineering across 7 data chunks, label construction, walk-forward training, 756-strategy exhaustive search, 4 neutralization methods) was built and backtested in a single session, however, the ideas they've been brainstorming themselves since probably the past year and I'm still understanding the nuances of this strategy but I want to trade my book live soon and well - this is something that feels like the start to Something.

I'm interested in doing this full-time: running long-running agent systems for quant research, with the domain knowledge to direct the research design and the engineering chops to make it run at scale (start with cross  stock prediction problems to Relative Vol/Index vs Single Stock Vol prediction problems).

Happy to do a screen-share walkthrough of any of the above.

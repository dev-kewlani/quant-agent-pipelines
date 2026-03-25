---
name: backtest-report
description: Generate a structured backtest results report from pipeline output — equity curves, drawdowns, IC over time, regime analysis
disable-model-invocation: true
argument-hint: "<results-file-or-directory>"
---

## Backtest Results Report

Source: $ARGUMENTS

### Report Structure

Generate a comprehensive but scannable report covering:

#### 1. Executive Summary
- Strategy description (1-2 lines)
- Date range, universe size, rebalance frequency
- Headline metrics: annualized return, Sharpe, max drawdown, turnover

#### 2. Performance Table
```
Strategy Variant    | Ann.Ret | Sharpe | MaxDD | Calmar | Turnover | Avg.Pos
--------------------|---------|--------|-------|--------|----------|--------
L/S Top50           |         |        |       |        |          |
L/S Top100          |         |        |       |        |          |
Long-Only Top50     |         |        |       |        |          |
Long-Only Top100    |         |        |       |        |          |
Benchmark (EW)      |         |        |       |        |          |
```

#### 3. IC Analysis Over Time
- Rolling IC (21d window) — trend, stability, any structural breaks
- ICIR by year — is the signal decaying over time?
- IC by quintile — is it monotonic?

#### 4. Risk Analysis
- Drawdown periods: start, trough, recovery, depth
- Worst months / worst quarters
- Tail risk: skewness, kurtosis of returns
- Beta to SPY / market factor

#### 5. Transaction Cost Sensitivity
- Performance at 0bp, 5bp, 10bp, 20bp, 50bp one-way costs
- Break-even cost level

#### 6. Regime Analysis (if regime data available)
```
Regime       | Ann.Ret | Sharpe | IC   | % Time
-------------|---------|--------|------|-------
Goldilocks   |         |        |      |
Overheating  |         |        |      |
Stagflation  |         |        |      |
Recession    |         |        |      |
```

#### 7. Verdict
- Strengths (what works)
- Weaknesses (what doesn't)
- Recommended next steps
- Capacity estimate (how much AUM could this support?)

### Format
Output as clean markdown. Use ASCII tables for data. Keep it dense and scannable — no filler text.

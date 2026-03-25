---
name: signal-eval
description: Evaluate an alpha signal — compute IC, ICIR, decay, turnover, Sharpe, and pass/fail against industry benchmarks
disable-model-invocation: true
argument-hint: "<signal-file-or-description>"
---

## Alpha Signal Evaluation Scorecard

Signal: $ARGUMENTS

### Metrics to Compute

For each horizon (5d, 10d, 21d, 42d, 63d) where applicable:

| Metric | Formula/Method | Industry Benchmark |
|--------|---------------|-------------------|
| **Rank IC** | Spearman correlation between signal rank and forward return rank | >0.02 interesting, >0.05 strong |
| **ICIR** | Mean(IC) / Std(IC) across time periods | >0.5 tradeable, >1.0 excellent |
| **IC t-stat** | ICIR × sqrt(N_periods) | >2.0 statistically significant |
| **IC Hit Rate** | % of periods with positive IC | >55% interesting, >60% strong |
| **IC Decay** | IC at lag 1, 2, 3... periods (autocorrelation of signal) | Slow decay = more capacity |
| **Turnover** | Mean abs change in signal ranks per rebalance | Lower = cheaper to trade |
| **Long-short Sharpe** | Annualized Sharpe of top-minus-bottom quintile returns | >0.5 interesting, >1.0 strong |
| **Long-only alpha** | Excess return over equal-weight benchmark | Positive and stable |
| **Max drawdown** | Worst peak-to-trough of cumulative L/S returns | Context-dependent |

### Analysis Steps

1. **Read the signal data** — understand format, date range, universe coverage
2. **Compute all metrics** above, grouped by horizon
3. **IS vs OOS comparison** — flag any metric that degrades >50% out-of-sample
4. **Regime breakdown** — if macro regime data available, break metrics by regime
5. **Correlation with existing signals** — check redundancy with the other 5 validated Puzzles signals

### Output

```
═══════════════════════════════════════════
SIGNAL SCORECARD: [signal name]
Date range: [start] — [end]
Universe: [N stocks]
═══════════════════════════════════════════

Horizon | IC    | ICIR  | t-stat | Hit%  | Turnover | Sharpe
--------|-------|-------|--------|-------|----------|-------
5d      |       |       |        |       |          |
10d     |       |       |        |       |          |
21d     |       |       |        |       |          |
42d     |       |       |        |       |          |
63d     |       |       |        |       |          |

IS vs OOS Degradation: [table]
Signal Correlation Matrix: [with existing signals]

VERDICT: [PASS / MARGINAL / FAIL] — [1-line reasoning]
```

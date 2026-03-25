---
name: beta-trap
description: Check if a portfolio or signal is capturing beta instead of alpha — regress against SPY, decompose Sharpe, flag market exposure
disable-model-invocation: true
argument-hint: "<returns-file-or-signal>"
---

## Beta Trap Detector

Target: $ARGUMENTS

### Context
AlphaPortfolio had β=1.31, R²=0.76, α=0.39% (not significant) — it learned leveraged market exposure, not alpha. This check prevents repeating that mistake.

### Analysis Steps

1. **Load portfolio/signal returns** and SPY (or equal-weight universe) returns over the same period

2. **Run OLS regression**: R_portfolio = α + β × R_market + ε
   - Report: α (annualized), β, R², t-stat on α, p-value on α

3. **Sharpe decomposition**:
   - Total Sharpe = reported Sharpe
   - Beta Sharpe = β × (market Sharpe)
   - Alpha Sharpe = Total Sharpe - Beta Sharpe
   - % of Sharpe from beta = Beta Sharpe / Total Sharpe

4. **Flag thresholds**:
   ```
   R² > 0.30  → ⚠️ "Significant market exposure — may be capturing beta"
   R² > 0.50  → 🔴 "Likely a beta strategy, not alpha"
   β > 0.50   → ⚠️ "Meaningful market beta"
   β > 1.00   → 🔴 "Leveraged market exposure"
   α p-value > 0.05 → ⚠️ "Alpha not statistically significant"
   ```

5. **Multi-factor extension** (if data available):
   - Regress against Fama-French 3 or 5 factors
   - Report exposure to: MKT, SMB, HML, RMW, CMA
   - Flag if any factor explains >20% of returns

### Output

```
═══════════════════════════════════════
BETA TRAP ANALYSIS
═══════════════════════════════════════
Portfolio Sharpe:     [X.XX]
  ├─ From beta:      [X.XX] ([XX%])
  └─ From alpha:     [X.XX] ([XX%])

Regression:
  α (ann.):  [X.XX%]  (t=[X.XX], p=[X.XX])
  β:         [X.XX]
  R²:        [X.XX]

VERDICT: ✅ ALPHA / ⚠️ MIXED / 🔴 BETA TRAP
[1-line explanation]
═══════════════════════════════════════
```

---
name: leakage-audit
description: Audit an alpha research pipeline for data leakage, look-ahead bias, survivorship bias, and point-in-time violations
disable-model-invocation: true
argument-hint: "[file or directory to audit]"
---

## Data Leakage & Look-Ahead Bias Audit

Target: $ARGUMENTS (defaults to current project if empty)

You are auditing a quantitative research pipeline. This is CRITICAL — a single leakage bug invalidates all results. Be paranoid.

### Checklist — check ALL of these systematically

#### 1. Target Variable Alignment
- [ ] Forward returns are computed using FUTURE prices only (no same-day close in numerator and denominator)
- [ ] Target labels don't use any information from the prediction date or later
- [ ] NYSE trading calendar is used for date alignment (not raw calendar days)
- [ ] No off-by-one errors in shift/lag operations — verify exact row alignment

#### 2. Feature Construction
- [ ] All features use ONLY data available BEFORE the prediction date
- [ ] Compustat fundamentals use `datadate` or `rdq` (report date), not filing date assumptions
- [ ] Rolling windows don't include the current observation in their calculation
- [ ] Technical indicators (Bollinger, RSI, etc.) don't peek forward
- [ ] No future fill / interpolation that bleeds forward data backward

#### 3. Point-in-Time Integrity
- [ ] CRSP/Compustat merge uses point-in-time alignment (not latest available)
- [ ] Accounting data respects reporting lag (use `rdq` + buffer, not `datadate`)
- [ ] Delisted/dead stocks are included up to their delisting date (survivorship)
- [ ] Index membership is as-of, not current

#### 4. Train/Test Split
- [ ] Walk-forward validation with embargo gap between train and test
- [ ] Embargo gap >= max forward return horizon
- [ ] No information leaks across splits (normalization, imputation fitted on full data?)
- [ ] Cross-sectional operations (rank, zscore) done within each time period, not across time

#### 5. Preprocessing Leakage
- [ ] StandardScaler / normalization fitted ONLY on training data
- [ ] Missing value imputation doesn't use test-period statistics
- [ ] Feature selection / clustering done ONLY on training data
- [ ] PCA / dimensionality reduction fitted ONLY on training data

#### 6. Subtle Leaks
- [ ] No `dropna()` that could create survivorship bias
- [ ] Rebalance dates don't assume instant execution at close
- [ ] Transaction cost model doesn't use future liquidity data
- [ ] Random seeds are fixed but data ordering doesn't leak temporal info

### Output Format

For each finding:
```
[LEAK|SUSPECT|CLEAN] file:line
  What: <description>
  Risk: <what this could inflate/distort>
  Fix: <specific code change>
```

End with a summary: total items checked, leaks found, suspect items, confidence level.

---
name: regime-check
description: Classify current macro regime (Goldilocks/Overheating/Stagflation/Recession) and output portfolio positioning playbook
disable-model-invocation: true
argument-hint: "[optional: specific macro data or question]"
---

## Macro Regime Analysis & Portfolio Playbook

Context: $ARGUMENTS

### Step 1: Regime Classification

Classify the current environment using this framework:

```
                    Growth ↑           Growth ↓
                ┌──────────────────┬──────────────────┐
Inflation ↓     │   GOLDILOCKS     │   RECESSION      │
                │   (best for risk)│   (risk-off)      │
                ├──────────────────┼──────────────────┤
Inflation ↑     │   OVERHEATING    │   STAGFLATION    │
                │   (selective)    │   (worst for risk)│
                └──────────────────┴──────────────────┘
```

**Key indicators to assess:**
- Growth: PMI (>50 = expansion), GDP growth, employment, earnings growth
- Inflation: CPI/PCE trend, breakevens, commodity prices, wage growth
- Policy: Fed funds rate direction, yield curve slope (2s10s), real rates
- Stress: VIX level, credit spreads (HY OAS), financial conditions index

### Step 2: Regime Playbook

For the identified regime, output the positioning framework:

| Regime | Equities | Duration | Credit | Commodities | Factors |
|--------|----------|----------|--------|-------------|---------|
| Goldilocks | OW | Neutral | OW (tight spreads) | Neutral | Growth, Momentum |
| Overheating | Neutral | UW | Neutral | OW | Value, Quality |
| Stagflation | UW | UW | UW | OW | Defensives, Min Vol |
| Recession | UW → OW late | OW | UW early, OW late | UW | Quality, Low Vol |

### Step 3: Signal Implications

How does the current regime affect Puzzles signals?
- Which of the 6 validated signals historically perform best in this regime?
- Should portfolio construction tilt long-only vs long-short?
- Any horizon that works better in this regime?

### Step 4: Actionable Tilts

Given Dev's constraints (PAD 22-day holding period, OPT status):
- Specific sector/factor tilts
- Position sizing guidance
- Risk limits appropriate for the regime
- What to watch for regime transition signals

### Output
Keep it to 1 page equivalent. Table-heavy, minimal prose. End with "watch for" triggers that would change the regime call.

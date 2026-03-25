---
name: lab-notebook
description: Log a Puzzles experiment — hypothesis, config, results, interpretation, and decision. Appends to running lab notebook file.
disable-model-invocation: true
argument-hint: "<experiment-name>"
---

## Puzzles Lab Notebook Entry

Experiment: $ARGUMENTS

### Instructions

1. **Ask for or extract** the following from the conversation:

```
═══════════════════════════════════════════════════
EXPERIMENT: [name]
Date: [today]
═══════════════════════════════════════════════════

## Hypothesis
What are we testing and why?

## Config
- Signal: [which of the 6, or new]
- Horizon: [5d/10d/22d/44d/63d]
- Target: [raw return / rank / q_score_v2 / etc.]
- Strategy: [long-only / long-short]
- Portfolio size: [top 5/10/20/decile/quintile]
- Rebalance: [22/66/126/252 days]
- Execution: [t+1 open / t close]
- Transaction costs: [tiered / flat / none]
- Walk-forward: [train window, embargo gap, test window]
- Special: [any non-standard settings]

## Results
| Metric | IS | OOS |
|--------|-----|-----|
| IC | | |
| ICIR | | |
| Sharpe | | |
| Calmar | | |
| Max DD | | |
| Turnover | | |
| OOS/IS ratio | | |

## Interpretation
What did we learn? Was the hypothesis supported?

## Leakage Check
- OOS IC plausible for this horizon? [yes/no]
- OOS/IS ratio < 1.0? [yes/no]
- Any anomalies? [describe]

## Decision
- [ ] Proceed with this config
- [ ] Modify and rerun (what to change: ___)
- [ ] Discard (reason: ___)
- [ ] Investigate further (what: ___)

## Next Step
Concrete next action.
═══════════════════════════════════════════════════
```

2. **Append** this entry to the lab notebook file. Look for an existing file at:
   - The current project's root: `lab_notebook.md`
   - Or create one if it doesn't exist

3. **Cross-reference** with previous entries — flag if this experiment duplicates a prior one or contradicts prior findings.

---
name: research-memo
description: Generate a structured thematic investment research memo — thesis, catalysts, risks, tickers, sizing
disable-model-invocation: true
argument-hint: "<theme> [horizon]"
---

## Thematic Research Memo

Theme: $0
Horizon: $1 (default: 6-12 months)

### Template

```
════════════════════════════════════════════
RESEARCH MEMO: [Theme]
Date: [today]
Horizon: [timeframe]
Conviction: [High / Medium / Low]
════════════════════════════════════════════
```

#### 1. Thesis (3-5 sentences)
What is the opportunity and WHY does it exist now? What is the market mispricing or not yet pricing in?

#### 2. Catalysts
| Catalyst | Expected Timing | Impact if Realized |
|----------|----------------|-------------------|
| ... | ... | ... |

#### 3. Bull / Base / Bear Scenarios
| Scenario | Probability | Return Est. | Key Assumption |
|----------|------------|-------------|----------------|
| Bull | % | +X% | ... |
| Base | % | +X% | ... |
| Bear | % | -X% | ... |

#### 4. Vehicles
| Ticker/ETF | Why This One | Liquidity | Expense |
|-----------|-------------|-----------|---------|
| ... | ... | ... | ... |

Include both direct plays and derivative/leveraged options if applicable.

#### 5. Risks
- **Risk 1**: description → mitigation
- **Risk 2**: description → mitigation
- **Risk 3**: description → mitigation

#### 6. Position Sizing Framework
- Max allocation as % of portfolio
- Entry strategy (scale in vs. full position)
- Stop-loss / review trigger levels
- Rebalance rules

Note: Account for PAD 22-day holding requirement.

#### 7. Review Triggers
What would make you:
- **Add**: [conditions]
- **Hold**: [conditions]
- **Cut**: [conditions]

#### 8. Related Signals
Do any of the 6 validated Puzzles signals have exposure to this theme? If so, how does this thematic view complement or conflict with the systematic signals?

### Output
Dense, no filler. This should read like a professional research memo you'd present at a fund's idea generation meeting.

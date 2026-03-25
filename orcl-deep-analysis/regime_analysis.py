"""
Regime-Conditional Analysis
============================
What happens AFTER ORCL enters the current extreme regime?
Analyze forward returns conditional on:
1. Extreme drawdown (>40% from high)
2. Extreme negative 126d momentum (<-30%)
3. Price far below 200MA (>20% below)
4. Combination of all three (like now)
5. Post-bubble-deflation (rallied >80% then lost >40%)
"""
import pandas as pd
import numpy as np
from pathlib import Path
from scipy import stats

BASE = Path("Path(os.environ.get("DATA_DIR", "."))/Idea 4 - Spreads/orcl_analysis")
feat = pd.read_parquet(BASE / "features/all_features.parquet")
orcl = pd.read_parquet(BASE / "data/orcl_base.parquet")
orcl['date'] = pd.to_datetime(orcl['date'])

close = orcl['prc_adj'].values.astype(np.float64)
n = len(close)
FWD = [22, 44, 66, 105, 150, 200, 252]

# Build forward return arrays
fwd_rets = {}
for h in FWD:
    fwd = np.full(n, np.nan, dtype=np.float64)
    fwd[:n-h] = (close[h:] / close[:n-h]) - 1.0
    fwd_rets[h] = fwd

# Current indicators
drawdown_252 = feat['L1_drawdown_252'].values.astype(np.float64)
mom_126 = feat['L1_mom_126d'].values.astype(np.float64)
price_vs_ma200 = feat['L1_price_vs_ma_200'].values.astype(np.float64)
mom_252 = feat['L1_mom_252d'].values.astype(np.float64)

# Current values
last = feat.iloc[-1]
print("=" * 100)
print("ORCL REGIME-CONDITIONAL FORWARD RETURN ANALYSIS")
print("=" * 100)
print(f"Current date: {feat.index[-1]}")
print(f"Current price: ${last['L0_prc_adj']:.2f}")
print(f"Current drawdown from 252d high: {last['L1_drawdown_252']:.1%}")
print(f"Current 126d momentum: {last['L1_mom_126d']:.1%}")
print(f"Current price vs 200MA: {last['L1_price_vs_ma_200']:.1%}")
print(f"Current 252d momentum: {last['L1_mom_252d']:.1%}")


def analyze_regime(name, mask, fwd_rets, exclude_last_n=252):
    """Analyze forward returns for days matching the regime mask."""
    print(f"\n{'='*80}")
    print(f"REGIME: {name}")
    print(f"{'='*80}")

    # Exclude recent data (no look-ahead)
    safe_mask = mask.copy()
    safe_mask[-exclude_last_n:] = False
    n_events = np.sum(safe_mask)
    print(f"  Events: {n_events} days ({n_events/len(mask)*100:.1f}% of history)")

    if n_events < 10:
        print("  Too few events for analysis")
        return {}

    # Get dates of events
    event_dates = feat.index[safe_mask]
    print(f"  Date range: {event_dates.min().date()} to {event_dates.max().date()}")

    results = {}
    print(f"\n  {'Horizon':>8s}  {'Mean':>8s}  {'Median':>8s}  {'Std':>8s}  {'P5':>8s}  {'P25':>8s}  {'P75':>8s}  {'P95':>8s}  {'P(>0)':>7s}  {'P(>20%)':>8s}  {'P(>50%)':>8s}  {'P(>100%)':>9s}  {'P(<-20%)':>9s}  {'P(<-50%)':>9s}")
    print("  " + "-" * 130)

    for h in FWD:
        rets = fwd_rets[h][safe_mask]
        valid = rets[~np.isnan(rets)]
        if len(valid) < 5:
            continue

        pcts = np.percentile(valid, [5, 25, 50, 75, 95])
        r = {
            'n': len(valid), 'mean': np.mean(valid), 'median': np.median(valid),
            'std': np.std(valid), 'p5': pcts[0], 'p25': pcts[1], 'p75': pcts[3], 'p95': pcts[4],
            'p_positive': np.mean(valid > 0),
            'p_gt20': np.mean(valid > 0.20), 'p_gt50': np.mean(valid > 0.50),
            'p_gt100': np.mean(valid > 1.0),
            'p_lt_neg20': np.mean(valid < -0.20), 'p_lt_neg50': np.mean(valid < -0.50),
        }
        results[h] = r

        print(f"  {h:>6d}d  {r['mean']:>+8.2%}  {r['median']:>+8.2%}  {r['std']:>8.2%}  "
              f"{r['p5']:>+8.2%}  {r['p25']:>+8.2%}  {r['p75']:>+8.2%}  {r['p95']:>+8.2%}  "
              f"{r['p_positive']:>7.1%}  {r['p_gt20']:>8.1%}  {r['p_gt50']:>8.1%}  "
              f"{r['p_gt100']:>9.1%}  {r['p_lt_neg20']:>9.1%}  {r['p_lt_neg50']:>9.1%}")

    return results


# ── Unconditional baseline ─────────────────────────────────────────────
unconditional = analyze_regime(
    "UNCONDITIONAL (all history)",
    np.ones(n, dtype=bool),
    fwd_rets
)

# ── Regime 1: Extreme drawdown (>40% from 252d high) ──────────────────
mask_dd = drawdown_252 < -0.40
regime1 = analyze_regime("EXTREME DRAWDOWN (>40% from 252d high, like NOW)", mask_dd, fwd_rets)

# ── Regime 2: Extreme negative 126d momentum (<-30%) ──────────────────
mask_mom = mom_126 < -0.30
regime2 = analyze_regime("EXTREME NEGATIVE 126d MOMENTUM (<-30%, like NOW)", mask_mom, fwd_rets)

# ── Regime 3: Price far below 200MA (>20% below) ──────────────────────
mask_ma = price_vs_ma200 < -0.20
regime3 = analyze_regime("PRICE >20% BELOW 200MA (like NOW)", mask_ma, fwd_rets)

# ── Regime 4: All three combined (current regime) ─────────────────────
mask_all = mask_dd & mask_mom & mask_ma
regime4 = analyze_regime("TRIPLE EXTREME: DD>40% + Mom<-30% + MA200>-20% (CURRENT STATE)", mask_all, fwd_rets)

# ── Regime 5: Post-bubble (252d mom was >50% but now drawdown >30%) ───
mask_bubble = (mom_252 > -0.10) & (drawdown_252 < -0.30)
regime5 = analyze_regime("BUBBLE DEFLATION: 252d flat/up BUT drawdown>30%", mask_bubble, fwd_rets)

# ── Regime 6: Looser current-like conditions ──────────────────────────
mask_loose = (drawdown_252 < -0.30) & (mom_126 < -0.20) & (price_vs_ma200 < -0.15)
regime6 = analyze_regime("DISTRESSED: DD>30% + Mom126<-20% + Price<15%belowMA200", mask_loose, fwd_rets)

# ── Compare to opposite regime: Strong momentum up ────────────────────
mask_strong = (mom_126 > 0.30) & (price_vs_ma200 > 0.20)
regime_strong = analyze_regime("STRONG BULL: Mom126>+30% + Price>20%aboveMA200", mask_strong, fwd_rets)

# ── Summary comparison ────────────────────────────────────────────────
print("\n\n" + "=" * 100)
print("REGIME COMPARISON SUMMARY — How does the CURRENT state compare to history?")
print("=" * 100)

regimes = {
    'Unconditional': unconditional,
    'Current (Triple Extreme)': regime4,
    'Extreme Drawdown': regime1,
    'Extreme Neg Mom': regime2,
    'Below 200MA': regime3,
    'Bubble Deflation': regime5,
    'Distressed': regime6,
    'Strong Bull (opposite)': regime_strong,
}

for h in [22, 66, 126, 252]:
    print(f"\n  --- {h}d FORWARD RETURNS ---")
    print(f"  {'Regime':35s}  {'Mean':>8s}  {'Median':>8s}  {'P(>0)':>7s}  {'P(>50%)':>9s}  {'P(>100%)':>10s}  {'P(<-20%)':>10s}  {'P(<-50%)':>10s}")
    for rname, rdata in regimes.items():
        if h in rdata:
            r = rdata[h]
            print(f"  {rname:35s}  {r['mean']:>+8.2%}  {r['median']:>+8.2%}  {r['p_positive']:>7.1%}  "
                  f"{r['p_gt50']:>9.1%}  {r['p_gt100']:>10.1%}  {r['p_lt_neg20']:>10.1%}  {r['p_lt_neg50']:>10.1%}")

# ── Historical episodes of current regime ─────────────────────────────
print("\n\n" + "=" * 100)
print("HISTORICAL EPISODES matching current regime (DD>30%, Mom126<-20%, below200MA)")
print("=" * 100)
mask_episodes = mask_loose.copy()
mask_episodes[-252:] = False  # Exclude recent

# Find episode clusters (group consecutive days)
episode_starts = []
in_episode = False
for i in range(n):
    if mask_episodes[i]:
        if not in_episode:
            episode_starts.append(i)
            in_episode = True
    else:
        in_episode = False

print(f"\nFound {len(episode_starts)} distinct episode entries")
for start_idx in episode_starts[:30]:  # Show first 30
    d = feat.index[start_idx]
    dd_val = drawdown_252[start_idx]
    mom_val = mom_126[start_idx]
    price = close[start_idx]

    # What happened after?
    outcomes = []
    for h in [22, 66, 252]:
        if start_idx + h < n:
            fwd_r = (close[start_idx + h] / close[start_idx]) - 1.0
            outcomes.append(f"{h}d:{fwd_r:+.1%}")

    print(f"  {d.date()}  price=${price:>8.2f}  DD={dd_val:>+.1%}  Mom126={mom_val:>+.1%}  →  {' | '.join(outcomes)}")

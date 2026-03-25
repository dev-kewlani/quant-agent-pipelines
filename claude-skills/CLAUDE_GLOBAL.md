# Global Claude Code Instructions

## Performance-First Code — ALWAYS DO THIS

When writing code that processes data or runs computation, **default to optimal from the start**. Do NOT write naive Python loops first and wait for the user to ask for optimization. This is a BLOCKING rule.

### Mandatory checklist before writing any data processing code:
1. **Vectorize first**: Use numpy/pandas panel operations on full arrays. NEVER loop over individual items (tickers, instruments, rows) in Python when a vectorized operation exists.
2. **GPU (CuPy) for rolling/sliding window ops**: Rolling std, mean, max, min, correlation, RSI — use CuPy on the full (T, N) panel. The user has an RTX 5090 (25.7 GB VRAM).
3. **Numba `prange` for irregular ops**: Consecutive counts, barrier scans, anything with conditional logic that can't vectorize — use `@njit(parallel=True)` with `prange` over the N dimension.
4. **Memory-aware storage**: Don't store dense (T, N) matrices when 99% is NaN — use sparse/long format. Don't create one column per (ticker, feature) — use (T, N) panels indexed by feature name.
5. **Batch over configs, not instruments**: When sweeping parameters, one kernel call per config across all instruments (prange), not one call per instrument.

### Mistakes log — DO NOT REPEAT:
- Wrote per-ticker Python loops for 20K stocks instead of panel-wide numpy/CuPy ops. Should have vectorized from the start.
- Created 291K DataFrame columns (one per ticker×feature) instead of (T, N) panel dict. Would have been 31 TB.
- Stored 16 full dense (13K, 5.8K) DataFrames (38 GB) where 99% was NaN. Should have stored sparse event list (~150 MB).
- Used serial Numba kernel scanning instruments one at a time for 14 min. Parallel `prange` version took 34 sec (25x faster).
- Mktcap filter compared against 300 instead of 300_000_000 (wrong units). Always verify data units before applying thresholds.

## Session Persistence

Agent sessions are logged for reproducibility and iterative development tracking.

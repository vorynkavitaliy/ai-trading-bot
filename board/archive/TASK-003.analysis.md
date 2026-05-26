---
task: TASK-003
author: architect
created: 2026-05-24T09:01:07Z
iteration: 0
---

## Summary

**Verdict: Scenario C — partial fix, architectural compromise.** The `ON CONFLICT DO NOTHING` pattern is **still live in `backfill.ts:64` and `cli/backfill-daily-weekly.ts:29`** — CLAUDE.md's wording "Fix D' applied" is **misleading** if read literally. The actual fix landed in commit `cd2fce3` (2026-05-23 v4 migration) but was applied **in the backtest engine, not in the backfill writer**: `src/backtest/engine.ts` now ignores the frozen DB D/W bars for the *current* period and reconstructs the incomplete day/week bar on-the-fly by aggregating 1h candles up to `cutoff1h` (function `aggregateHourlyTo`, engine.ts:94-127, used at engine.ts:435-454 and 473-479). The look-ahead leak through the **backtest** path is closed; the **DB itself still contains frozen-at-open D/W bars** and any *other* code path that reads `candles WHERE tf IN ('1D','1W')` will still see stale H/L. Whether that residual risk is real depends on whether any non-engine consumer of `loadBars(symbol, '1D'|'1W', ...)` uses the D/W H/L for decisions.

## Current behavior

### Backfill writer — unchanged, still freezes D/W bars

The active universal writer is `src/data/backfill.ts:43-69 insertCandles()`. The SQL:

```text
src/data/backfill.ts:62-64
INSERT INTO candles (symbol, tf, ts, open, high, low, close, volume, turnover)
VALUES ${values.join(', ')}
ON CONFLICT (symbol, tf, ts) DO NOTHING
```

Funding has the same pattern at `src/data/backfill.ts:80-82`.

This function is called from:
- `refreshForScan()` (`src/data/backfill.ts:18-41`) — runs every cron cycle; loops over `TFS_FOR_SCAN = ['1m', '5m', '15m', '60m', '240m', '1D', '1W']` (line 16). Every cycle fetches **from `last+tfMs` to `now`** (line 28), so an incomplete D/W bar is first inserted ~30 seconds after period open and **never updated** because `DO NOTHING` swallows the conflict. Confirmed live behavior.
- `runIncremental()` (`src/data/backfill.ts:191-217`) — uses `TFS = ['1m', '5m', '15m', '60m', '240m']` (line 7) — **does NOT include 1D/1W**, so this path doesn't even refresh weekly/daily.
- `runBackfill()` (`src/data/backfill.ts:151-189`) — also `TFS` only (no 1D/1W). One-shot historical loads.

The dedicated D/W CLI `src/data/cli/backfill-daily-weekly.ts:27-29` repeats the same pattern:

```text
src/data/cli/backfill-daily-weekly.ts:27-29
INSERT INTO candles (symbol, tf, ts, open, high, low, close, volume, turnover)
VALUES ${values.join(', ')}
ON CONFLICT (symbol, tf, ts) DO NOTHING
```

Schema: `migrations/001_init.sql:11-23` declares `PRIMARY KEY (symbol, tf, ts)`. No `updated_at` / `fetched_at` column — there is **no way** for a consumer to tell whether a stored D/W bar is "complete" or "frozen at open".

### Backtest engine — fixed in commit cd2fce3 ("Fix D'")

`src/backtest/engine.ts:94-127 aggregateHourlyTo(hourly, periodStart, cutoff)` builds a synthetic bar from 1h candles.

The engine's main decision loop at `src/backtest/engine.ts:415-454` then segregates **closed** D/W bars from the current incomplete period:

```text
src/backtest/engine.ts:435-444
if (data.bars1d) {
  const closedD = data.bars1d.filter((b) => b.ts + ONE_DAY_MS <= cutoff1h);
  const curDayStart = dayStartUtc(cutoff1h);
  const synthD = aggregateHourlyTo(data.bars1h, curDayStart, cutoff1h);
  const allD = synthD ? [...closedD, synthD] : closedD;
  ...
}
```

Same pattern for weekly at `engine.ts:445-454`. The strategy-facing recent slices `bars1dRecent` / `bars1wRecent` at `engine.ts:474-479` do the same. The comment at `engine.ts:416-424` documents the intent:

```text
src/backtest/engine.ts:416-424
// D/W bars in DB store full-bar H/L (Bybit snapshot of closed candle, or for
// recently-inserted bars: frozen at open due to ON CONFLICT DO NOTHING). Both
// cases are wrong for backtest:
//   - Historical bars (full H/L): including the current incomplete bar leaks
//     future H/L to strategy → structural stops artificially wide → inflated WR
//   - Recent bars (frozen at open): useless data
// Fix: keep DB bars only for fully-CLOSED periods; reconstruct the current
// incomplete period's bar from hourly data, capped at cutoff. This gives
// strategy a faithful week-to-date / day-to-date snapshot.
```

Git provenance: `git show cd2fce3 -- src/backtest/engine.ts` confirms the `aggregateHourlyTo` function and the `synthD/synthW` reconstruction were introduced in `cd2fce3 feat(strategy): v4 migration — VP-SMC → CG-fade Tier-1 portfolio` (Sat May 23 15:11:03 2026). The commit message itself lists this as "Fix D-prime: day/week bars reconstructed on-the-fly from hourly". `backfill.ts` was **not touched** in that commit — `git log -- src/data/backfill.ts` shows the most recent change is `36f7c7a` (2026-05-24, swap to `tier1Pairs()`) which only changed the SYMBOLS list, not the INSERT.

### Candle loader — passthrough, returns whatever the DB has

`src/data/candles.ts:33-63 loadBars()` is a pure `SELECT ts, open, high, low, close, volume FROM candles WHERE symbol=$1 AND tf=$2 ORDER BY ts ASC` (no freshness filter, no aggregation). So any consumer that asks `loadBars(symbol, '1D', ...)` or `'1W'` gets the same DB rows — which include the frozen-at-open current bar. The deduplication is **the engine's responsibility**, and the engine does it (above). No other consumer is.

## Findings

This is **Scenario C — partial fix / architectural compromise**.

**What's fixed:**
- The backtest engine's CG-fade portfolio walk-forward results that justify v4 migration (`+88.88%/yr`, `WR 54.8%`, `PF 1.53`, `MaxDD 6.73%`) ran *after* `cd2fce3`, so they used the synth-D/W aggregation path. The look-ahead bias is **not present in those numbers**.
- The diagnostic from commit `cd2fce3` was that VP-SMC's `+120%/yr` was structurally dependent on the leaked future H/L — confirmed by re-running the same VP-SMC strategy against synth-D/W and seeing `−10.74%/yr`.

**What's NOT fixed (residual risk):**
1. **The DB still contains frozen-at-open D/W bars.** Run `SELECT tf, ts, high, low FROM candles WHERE tf IN ('1D','1W') ORDER BY ts DESC LIMIT 20` and you will see the current week's row with H/L = (close,close) from ~30s after week open. This is the literal source of the bug CLAUDE.md describes.
2. **Any future consumer that does `loadBars(symbol, '1D'|'1W', ...)` will silently inherit the bug.** There is no DB-level guard (no `expires_at`, no `is_complete` flag, no engine helper that the backfill writer co-owns). The fix is in the engine's *decision loop*, not in a shared accessor.
3. **Live runtime check:** I scanned `src/runtime/` and `src/strategies/cg-fade.ts` for `loadBars(... '1D'` / `'1W'`. The CG-fade strategies live (`src/strategies/cg-fade.ts`, all 4 factories) use **CG signals + 4H/BTC trend filters** — they don't read D/W bars at all. `src/runtime/scan-decide.ts`, `auto-execute.ts`, `position-watcher.ts`, `reconcile.ts`, `risk-guard.ts` don't reference 1D/1W candles in any path I can find with grep. So **at runtime today, no live consumer of D/W exists**. The bug is dormant: backtest is correct, live doesn't care.
4. **Strategic discipline:** CLAUDE.md says "backfill.ts uses ON CONFLICT DO NOTHING → ... Fixed as Fix D'", which conflates two distinct things. A re-reader will assume `backfill.ts` was changed; it was not. Anyone who reintroduces a D/W-reading strategy without reading the engine code carefully will re-step on the rake.

**Verdict justification:** The task acceptance criterion #2 reads "If `ON CONFLICT DO NOTHING` is still applied for D/W — fix to DO UPDATE WHERE bar incomplete, OR rebuild D/W from 1h after fix". The codebase took the OR branch (engine rebuilds D/W from 1h), but only in `engine.ts`, not "after fix" in a general sense. Criterion #3 ("if fix already applied — analysis with git log -p confirming") is met for the engine, not for backfill.

## Recommendation

**Status: `in_progress` → handoff to `tech-lead`.** Recommended next step is a *small* hardening pass plus a documentation correction. Three options ordered by blast radius:

### Option 1 (recommended): Documentation + backfill-side DO UPDATE for incomplete periods

Change `src/data/backfill.ts:62-64` (and the redundant duplicate in `src/data/cli/backfill-daily-weekly.ts:27-29`) to:

```sql
ON CONFLICT (symbol, tf, ts) DO UPDATE SET
  open = EXCLUDED.open,
  high = EXCLUDED.high,
  low  = EXCLUDED.low,
  close = EXCLUDED.close,
  volume = EXCLUDED.volume,
  turnover = EXCLUDED.turnover
WHERE candles.ts + (CASE candles.tf
                      WHEN '1m'   THEN 60000
                      WHEN '5m'   THEN 300000
                      WHEN '15m'  THEN 900000
                      WHEN '60m'  THEN 3600000
                      WHEN '240m' THEN 14400000
                      WHEN '1D'   THEN 86400000
                      WHEN '1W'   THEN 604800000
                    END) > EXTRACT(EPOCH FROM NOW()) * 1000;
```

Effect: bars whose period end is in the future (i.e. the current incomplete bar) get overwritten on every refresh; fully-closed bars never. Removes the dormant footgun, leaves the engine's synth-D/W as belt-and-suspenders (still correct for fine-grained intraday cutoffs that the writer can't anticipate).

Blast radius: 2 file edits, ~20 lines, no engine changes, no schema change, no re-backtest required (engine is robust either way — change is "fix the DB", not "change strategy behavior"). The current backtest numbers already excluded the leaked H/L via the synth-D/W path, so post-fix backtest numbers will not move materially.

Plus: edit `CLAUDE.md`'s "What changed 2026-05-23" paragraph to read `Fix D-prime: backtest engine reconstructs current D/W bar from 1h (backfill.ts continues to DO NOTHING; engine treats DB bars as authoritative only for fully-closed periods)`. This kills the misleading wording.

### Option 2: Pure-engine fix, no backfill change

Leave `backfill.ts` as-is, just edit CLAUDE.md to correctly describe where the fix lives. Cheaper, but the dormant footgun remains: any future D/W-reading code path will silently re-introduce look-ahead.

### Option 3: Schema-level invariant

Add an `is_complete BOOLEAN` column or a check via a `candles_current_period` view. Higher blast radius (migration + index + every consumer). Rejected — too much scaffolding for a problem that is currently dormant.

**Pick Option 1.** It's the smallest change that aligns the code with CLAUDE.md's literal claim, kills the dormant footgun, and requires no re-backtest. Tech-lead should validate the SQL portability and decide whether to also strip the comment block in `engine.ts:416-424` to point at the new behavior, or keep it as belt-and-suspenders documentation.

## Open questions

- [NEEDS CLARIFICATION: Should the diagnostic backfill tools `src/tools/diagnostics/backfill-1m-resume.ts:35`, `cg-deep-backfill.ts:23`, `cg-orderbook-backfill.ts:27`, `cg-5m-backfill.ts:14`, `coinglass-backfill.ts:63` also be touched? They all use `ON CONFLICT DO NOTHING` for non-OHLCV tables (CG snapshots, OB snapshots, 1m candles for resume). For OHLCV 1m the same "frozen at open" reasoning applies in theory, but the bug only matters if the current incomplete 1m bar leaks future H/L to the engine — engine.ts:50 loads 1m for SL/TP simulation, not for decisions, so probably fine. Tech-lead decision.]
- [NEEDS CLARIFICATION: Is a one-shot DB scrub needed for the historical 1D/1W rows already in DB that were inserted ~30s after open and never refreshed? Acceptance criterion #4 ("sanity check: D/W bars on rebuild match aggregation from 1h for 3 pairs × 3 months") would catch this. If frozen, a `TRUNCATE candles WHERE tf IN ('1D','1W') ; then re-fetch with the DO UPDATE branch` is a 5-minute operation. Recommend doing it as part of the same task.]
- [NEEDS CLARIFICATION: Acceptance criterion #5 says "backtest after fix does not show metrics drop". Because Option 1 only fixes the *DB write side* and the engine already synthesises the current bar, **no backtest movement is expected**. Confirm operator wants a re-run as a sanity check or accept that the existing v4 numbers are unaffected.]

## Dev brief

For the next dev: this is a small targeted hardening change, not a big refactor.

1. Edit `src/data/backfill.ts:43-69 insertCandles()` — change `ON CONFLICT (symbol, tf, ts) DO NOTHING` to the conditional `DO UPDATE` shown in Option 1. The CASE on `tf` covers `1m, 5m, 15m, 60m, 240m, 1D, 1W`. Don't touch `insertFunding()` at line 71-85 — funding has no "incomplete bar" concept.
2. Apply the **same** change to `src/data/cli/backfill-daily-weekly.ts:16-32 insertCandles()` (literal copy of the same SQL). Or, better, delete `cli/backfill-daily-weekly.ts` entirely and have it import from `../backfill.ts` — it's a 60-line v3-universe-hardcoded duplicate that's already obsolete (uses the 10-pair v3 list, not Tier-1).
3. Update `CLAUDE.md`'s "What changed 2026-05-23 (v4 migration)" section, the "Discovery" bullet, to correctly say: "Fix D-prime: backtest engine reconstructs the current D/W bar from 1h on the fly (`engine.ts aggregateHourlyTo`). Backfill writer also tightened to `DO UPDATE` for not-yet-closed bars (`backfill.ts insertCandles`) as belt-and-suspenders." Don't claim the writer fix is the whole story — both layers cooperate now.
4. Optional but recommended: run `DELETE FROM candles WHERE tf IN ('1D','1W')` and re-run `src/data/cli/incremental-run.ts` so the DB no longer holds historical frozen-at-open rows. Verify a few rows match `aggregateHourlyTo` from 1h.
5. **Do NOT** re-run the full walk-forward backtest as part of this task — the engine already uses synth-D/W, so backfill writer changes can't shift numbers. Acceptance criterion #5 is satisfied by reasoning, not by re-running.

Tester acceptance: pick 3 random pairs × 3 historical months, query `MAX(high), MIN(low)` from 1h aggregated into a week vs the stored 1W bar — they should match within rounding for any closed week. For the current (partial) week, the stored 1W bar after the fix should equal aggregation from 1h up to "now". This is exactly TASK-003 acceptance criterion #4.

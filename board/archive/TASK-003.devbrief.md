---
task: TASK-003
author: tech-lead
created: 2026-05-24T09:09:10Z
iteration: 0
---

# TASK-003 Dev Brief — backfill DO UPDATE + DB scrub + sanity backtest

## TL;DR

Three concrete moves, in order:

1. **Code fix (one file edit + one file delete):**
   - `src/data/backfill.ts:62-64 insertCandles()` — replace `ON CONFLICT (symbol, tf, ts) DO NOTHING` with the conditional `DO UPDATE WHERE bar not yet closed` block in §3 below. **Do not touch** `insertFunding()` (line 80-82) — funding is event-stamped at execution, never "incomplete".
   - `git rm src/data/cli/backfill-daily-weekly.ts` + remove the `data:dw` script from `package.json:25`. The file is a 60-line dead copy bound to the obsolete 10-pair v3 universe (`'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','OPUSDT','NEARUSDT','AVAXUSDT','SUIUSDT','XLMUSDT','TAOUSDT'`). Universe coverage now flows through `tier1Pairs()` → `refreshForScan()` / `backfill-symbol.ts`. No live caller exists (grep confirmed: only `package.json:25` references it).
   - **All five `src/tools/diagnostics/cg-*-backfill.ts` and `backfill-1m-resume.ts` files: SKIP.** They write to CG snapshot tables (no incomplete-bar concept) or are one-shot resume tools for 1m gap-fills (the 1m "frozen at open" theoretical bug is harmless — engine.ts uses 1m only for intra-bar SL/TP fill simulation, never for decisions; see Audit Map §1).
   - No new shared helper. KISS — exactly one writer path (`insertCandles` in backfill.ts) needs the conditional UPSERT. The diagnostic CG bulk-insert helpers are structurally different (no `tf` column, no period concept) so factoring would couple unrelated concerns. Per TEAM.md §4: "refactor on the *third* occurrence, not the second."

2. **DB scrub:** `DELETE FROM candles WHERE tf IN ('1D','1W')` then re-fetch. **Re-fetch path: `npx tsx src/data/cli/backfill-symbol.ts <SYM1> <SYM2> ...` for each Tier-1 pair** (it covers `TFS_HTF = ['1D','1W']` with 730 days back via `backfillCandles` → now-fixed `insertCandles`). `incremental-run.ts` will **not** re-fetch D/W because `runIncremental()` uses `TFS = ['1m','5m','15m','60m','240m']` (`src/data/backfill.ts:7`). Alternative: trigger via natural cron — the next top-of-hour `scan-decide` calls `refreshForScan()` which uses `TFS_FOR_SCAN` including D/W and will pull `from = now - 30d`. **Pick `backfill-symbol.ts` for explicit deterministic 730-day refill.**

3. **Sanity backtest:** `npx tsx src/backtest/cli/cg-fade-portfolio.ts 365 > /tmp/cg-fade-portfolio-postfix.out 2>&1`. Expect **no material movement** (engine already uses `aggregateHourlyTo` synth-D/W path; the writer fix only changes what's *in the DB*, not what the engine *sees*). Acceptance: `Total Return` 88% ± 5%, `PF ≥ 1.4`, `MaxDD ≤ 7.5%`. If outside band — document, halt, surface to tech-lead.

## Audit map (all ON CONFLICT in src/data + src/tools/diagnostics)

| File:line | Таблица | INSERT pattern | Решение | Причина |
|---|---|---|---|---|
| `src/data/backfill.ts:62-64` | `candles` | OHLCV bars (all TFs incl. 1D/1W) | **FIX** | OHLCV freezes incomplete D/W bar at open → look-ahead bias on any non-engine reader. Live `scan-decide.ts:71-72` loads 1D/1W for PWL/PWH (informational notes only — not gate-blocking, but stored value is wrong). |
| `src/data/backfill.ts:80-82` | `funding_history` | funding rate events | **SKIP** | Funding is event-stamped at Bybit's 8h tick — no "incomplete" period. Once written, value is final. |
| `src/data/cli/backfill-daily-weekly.ts:27-29` | `candles` (1D/1W only) | duplicate of backfill.ts pattern on v3 universe | **DELETE FILE** | Dead code: 10-pair v3 universe (incl. OPUSDT/NEARUSDT/AVAXUSDT/SUIUSDT/XLMUSDT — none in Tier-1). Only referenced by `package.json:25 data:dw`; no cron/script/runtime call. Universe coverage now flows via `tier1Pairs()`. |
| `src/data/coinglass-backfill.ts:63` | `cg_*` tables (oi/funding/ls/taker/liq/orderbook) | CG history rows | **SKIP** | Coinglass returns its own H/L/O/C per bar (their server-side aggregation). We're not the producer of the "incomplete period" data — Coinglass is. Re-fetching most-recent bars overwrites stale values only if Coinglass itself overwrites; with `DO NOTHING` we accept whatever CG snapshot we caught first. Bug equivalent to backfill.ts in theory; in practice these tables are not used for H/L "ahead/behind" decisions — strategies read `funding_oi_weighted` (`fr_close`) and `ls_top_position` (`ratio`) point-in-time. Track but don't fix here; create separate task if a CG-fade strategy is ever shown to depend on intra-period CG H/L. |
| `src/tools/diagnostics/backfill-1m-resume.ts:35` | `candles` (1m only) | resume historical 1m gap-fills | **SKIP** | One-shot historical fills (`TARGETS` 2021-2022 startMs). 1m incomplete-bar bug is dormant: engine.ts uses 1m only for intra-bar SL/TP fill simulation (`engine.ts:51`), never for strategy decisions. Live `scan-decide.ts:73 loadBars('5m', 300)` and `loadBars('60m', 300)` — no 1m. Bug surface: zero. |
| `src/tools/diagnostics/cg-deep-backfill.ts:23` | `cg_*` tables (360d deep refresh) | one-shot deep CG re-pull | **SKIP** | Same reasoning as `coinglass-backfill.ts:63`. Diagnostic-only, manual invocation. |
| `src/tools/diagnostics/cg-5m-backfill.ts:14` | `cg_*_5m` tables | 5m CG backfill | **SKIP** | Snapshot tables, CG-controlled aggregation. Same reasoning. |
| `src/tools/diagnostics/cg-orderbook-backfill.ts:27` | `cg_orderbook_pair` | orderbook depth history | **SKIP** | Snapshot table. |
| `src/data/coinglass-backfill.ts:274` (comment only) | n/a | comment referencing the pattern | n/a (comment) | No code change — just an explanatory comment. Optional: tech-lead may also update the comment to reflect post-fix world, but not required. |

**Decision summary:** 1 file FIX, 1 file DELETE, 7 SKIPs (5 diagnostics + 1 funding INSERT + 1 comment). No new shared helper (DRY tripwire = 3 occurrences; we have 2 with different signatures).

## File-by-file changes

### Change 1 — `src/data/backfill.ts:62-64`

**Before:**

```ts
    const sql = `INSERT INTO candles (symbol, tf, ts, open, high, low, close, volume, turnover)
                 VALUES ${values.join(', ')}
                 ON CONFLICT (symbol, tf, ts) DO NOTHING`;
```

**After (see §3 for final SQL):**

Replace the SQL string with the `DO UPDATE WHERE not-yet-closed` form. Keep the surrounding `query(sql, params)` call unchanged. No code changes anywhere else in `insertCandles()`.

### Change 2 — delete `src/data/cli/backfill-daily-weekly.ts`

```
git rm src/data/cli/backfill-daily-weekly.ts
```

### Change 3 — `package.json:25`

Remove the line:

```json
    "data:dw": "tsx src/data/cli/backfill-daily-weekly.ts 730",
```

(Adjust trailing commas of neighbouring lines.)

### Change 4 — `CLAUDE.md` (see §5)

Two edits — Discovery bullet + Known outstanding issues. Already-fixed reconcile.ts:188 bullet must be removed (TASK-002 verified clean per task acceptance criterion).

## Final SQL (copy-paste ready)

Replace `src/data/backfill.ts:62-64` SQL string with the block below. The `CASE` covers exactly the TFs used in the codebase (`'1m','5m','15m','60m','240m','1D','1W'` per `TFS_FOR_SCAN` at backfill.ts:16; `'1m','5m','15m','60m','240m'` per `TFS` at backfill.ts:7). `volume` and `turnover` columns: `volume NUMERIC(28,8) NOT NULL`, `turnover NUMERIC(28,8)` nullable per `migrations/001_init.sql:19-20` — both safe to use in `EXCLUDED`.

Timestamp: use `EXTRACT(EPOCH FROM NOW()) * 1000` (server time, ms) — matches the engine's "now" semantics. This makes the condition portable and immune to clock skew between Node and Postgres (single source of truth = DB clock).

```ts
    const sql = `INSERT INTO candles (symbol, tf, ts, open, high, low, close, volume, turnover)
                 VALUES ${values.join(', ')}
                 ON CONFLICT (symbol, tf, ts) DO UPDATE SET
                   open     = EXCLUDED.open,
                   high     = EXCLUDED.high,
                   low      = EXCLUDED.low,
                   close    = EXCLUDED.close,
                   volume   = EXCLUDED.volume,
                   turnover = EXCLUDED.turnover
                 WHERE candles.ts + (CASE candles.tf
                                       WHEN '1m'   THEN 60000
                                       WHEN '5m'   THEN 300000
                                       WHEN '15m'  THEN 900000
                                       WHEN '60m'  THEN 3600000
                                       WHEN '240m' THEN 14400000
                                       WHEN '1D'   THEN 86400000
                                       WHEN '1W'   THEN 604800000
                                       ELSE 0
                                     END) > EXTRACT(EPOCH FROM NOW()) * 1000`;
```

**Semantics:** the row is updated only when `candles.ts + tf_duration > now_ms`, i.e. the bar's period **end** is in the future ⇒ the bar is *currently open and incomplete*. Closed bars (`candles.ts + tf_duration <= now_ms`) hit the `WHERE` filter, the update is skipped, and Postgres effectively behaves like `DO NOTHING` — historical immutability preserved. The `ELSE 0` is defensive: an unknown `tf` falls through to "treat as already closed" rather than blindly overwrite.

**WHY (single-line comment NOT to be added — explained in commit message instead per TEAM.md §4 Comments rules):** this is a non-obvious WHY but expressible through method renames + commit message. Do not add an inline comment. The PR description should reference TASK-003 + this brief.

## Operational sequence

1. **Land code fix as a PR.** `git checkout -b fix/backfill-do-update-incomplete`. Edit `src/data/backfill.ts:62-64` per §3. `git rm src/data/cli/backfill-daily-weekly.ts`. Edit `package.json:25` to drop `data:dw`. Edit `CLAUDE.md` per §5. Run `npm run typecheck`. Commit. PR title: `fix(backfill): DO UPDATE WHERE bar incomplete + remove dead D/W CLI`.
2. **After PR is merged, perform DB scrub** on the live host (the same machine that runs cron). Order:
   - Pause cron: `crontab -e` → comment out the `*/5 * * * * /root/Projects/ai-trading-bot/scripts/cycle.sh` line. **Why pause:** between DELETE and the re-fetch, a top-of-hour `refreshForScan()` would race the manual `backfill-symbol.ts` invocation. Cron pause window = ~5 minutes (fetch time for 7 pairs × 2 TFs × ≤1000 bars ≈ 14 API calls × 150ms = ~2s + DB writes; total ≤ 60s).
   - Safety net: scan-decide does NOT crash if D/W bars are missing — it gates on `closedW.length < 1` (scan-decide.ts:85) and would return `null` with reason `'no-closed-1w-bar'`. So in the worst case (scrub finishes but re-fetch hasn't reached a pair), that pair simply gets no decision next hour. Reconcile and position-watcher don't touch D/W at all (grepped: no 1D/1W references in `src/runtime/reconcile.ts` / `position-watcher.ts` / `risk-guard.ts` / `auto-execute.ts` / `execute.ts`). **DELETE is safe mid-day.**
   - Execute scrub:
     ```
     psql "$DATABASE_URL" -c "DELETE FROM candles WHERE tf IN ('1D','1W');"
     npx tsx src/data/cli/backfill-symbol.ts BTCUSDT INJUSDT TAOUSDT ATOMUSDT LTCUSDT ARBUSDT XRPUSDT > /tmp/dw-refetch.out 2>&1
     ```
     (Tier-1 list = `tier1Pairs()` per `src/runtime/pair-strategies.ts`. `backfill-symbol.ts` covers 1m/5m/15m/60m/240m back 365d + 1D/1W back 730d. Funding also re-fetches but that's redundant — harmless thanks to PRIMARY KEY conflict skip on the unchanged funding INSERT.)
   - **Verify scrub** (acceptance criterion #4): for 3 random pairs × 3 historical months, the stored 1W row's H/L should equal `MAX(high)/MIN(low)` over the 1h bars of that ISO week. Quick query template — `dev` to write `src/tools/diagnostics/verify-dw-aggregation.ts` (or run inline psql):
     ```sql
     -- example: BTCUSDT, week of 2026-02-09 UTC
     WITH wk AS (
       SELECT ts AS week_ts, high AS w_high, low AS w_low
       FROM candles WHERE symbol='BTCUSDT' AND tf='1W' AND ts = EXTRACT(EPOCH FROM TIMESTAMP '2026-02-09 00:00:00')*1000
     )
     SELECT
       wk.week_ts,
       wk.w_high, wk.w_low,
       (SELECT MAX(high) FROM candles WHERE symbol='BTCUSDT' AND tf='60m' AND ts >= wk.week_ts AND ts < wk.week_ts + 604800000) AS agg_high,
       (SELECT MIN(low)  FROM candles WHERE symbol='BTCUSDT' AND tf='60m' AND ts >= wk.week_ts AND ts < wk.week_ts + 604800000) AS agg_low
     FROM wk;
     ```
     Expected: `w_high ≈ agg_high` and `w_low ≈ agg_low` (within float rounding, e.g. < 0.1%). Repeat for BTCUSDT 2025-12, INJUSDT 2026-03, XRPUSDT 2026-01.
   - Re-enable cron: uncomment the `*/5 * * * * ...` line.
3. **Sanity backtest** (see §4): run `cg-fade-portfolio.ts 365`. Capture output. Compare vs published v4 numbers (PF 1.53 / MaxDD 6.73% / +88.88% on $200k).
4. **Code review → testing → done.** Reviewer enforces TEAM.md §4 (no comments, naming, error handling). Tester runs the verification queries from step 2 + the backtest from step 3.

## Sanity backtest acceptance

**Command:**

```
npx tsx src/backtest/cli/cg-fade-portfolio.ts 365 > /tmp/cg-fade-portfolio-postfix.out 2>&1
```

**Output location:** `/tmp/cg-fade-portfolio-postfix.out`. The CLI prints:

- `=== AGGREGATE ===` block with `Total trades`, `Win Rate`, `Profit Factor`, `Total R`, `Return`, `Max Drawdown`, `Max consec L/W`.
- `=== PER-PAIR ===` table.
- `=== MONTHLY P&L ===` table.

**Acceptance bands** (from CLAUDE.md "Engine validation: 511 trades / year, WR 54.8%, PF 1.53, MaxDD 6.73%, +88.88% on $200k"):

| Metric | Expected | Pass band |
|---|---|---|
| Total trades | ~511 | 480–540 |
| Win Rate | 54.8% | 50%–60% |
| Profit Factor | 1.53 | ≥ 1.4 |
| Total Return | +88.88% | +80% to +95% |
| Max Drawdown | 6.73% | ≤ 7.5% |

If any metric falls outside its band: **halt**. Document delta and root cause (re-fetched D/W data drift, time-since-baseline drift, network refetch incompleteness). Surface to tech-lead before re-running with adjusted bands.

**Rationale that movement should be small:** engine reads D/W via `engine.ts:435-454 aggregateHourlyTo` which **already** reconstructs the current period from 1h. Closed historical D/W bars in the DB are *snapshots taken by Bybit's API at fetch time* — Bybit's API returns the **final** H/L/O/C for closed bars, identical to what aggregation from 1h would produce (within rounding). Therefore the DB content for closed periods is essentially unchanged after the scrub + re-fetch. Where the writer fix matters going forward: keeps the current incomplete bar fresh in DB for non-engine consumers (scan-decide PWL/PWH notes; future strategies).

## CLAUDE.md edits

### Edit 1 — Discovery bullet (lines 146-150)

**Old (exact):**

```
**Discovery:** 7 days of honest debugging revealed VP-SMC's claimed +120%/year was a data-bug artifact:
- `backfill.ts` uses `ON CONFLICT DO NOTHING` → weekly/daily bars frozen at first insert (~30s after open)
- Backtest engine `b.ts < cutoff` filter included those frozen bars → strategy used **future full-week H/L** in historical periods (look-ahead bias)
- Without look-ahead, VP-SMC on honest data: −10.74%/year (Fix D')
- Investigation: see backtest engine fixes A, B, C, D, D' (intra-bar resolution, TP slip semantics, limit entry, D/W bar reconstruction from hourly)
```

**New (exact):**

```
**Discovery:** 7 days of honest debugging revealed VP-SMC's claimed +120%/year was a data-bug artifact:
- `backfill.ts` previously used `ON CONFLICT DO NOTHING` → weekly/daily bars frozen at first insert (~30s after open)
- Backtest engine `b.ts < cutoff` filter included those frozen bars → strategy used **future full-week H/L** in historical periods (look-ahead bias)
- Without look-ahead, VP-SMC on honest data: −10.74%/year (Fix D')
- Two-layer fix (2026-05-23 commit cd2fce3 + TASK-003 2026-05-24):
  - `engine.ts aggregateHourlyTo` reconstructs the current D/W bar from 1h on the fly — backtest is authoritative
  - `backfill.ts insertCandles` now uses `ON CONFLICT DO UPDATE WHERE ts + tf_duration > now` — DB row for the open period is refreshed every cycle, closed bars are immutable (belt-and-suspenders)
- Investigation: see backtest engine fixes A, B, C, D, D' (intra-bar resolution, TP slip semantics, limit entry, D/W bar reconstruction from hourly)
```

### Edit 2 — Known outstanding issues (lines 162-164)

**Old (exact):**

```
**Known outstanding issues (to fix):**
- `cg-fade.ts` returns `tp1 = tp2` (single target) but `execute.ts` places 2 separate limit orders. Need true partial split (TP1 = 1× ATR partial, TP2 = 2.5× ATR runner) + re-backtest.
- `src/runtime/reconcile.ts:188` uses `t.qty` (remaining qty after TP1 partial) for `riskedUsd` calc → inflates live `realized_r` by ~2× on TP1-partial trades. Fix: use `initial_qty` field. (Independent fix.)
```

**New (exact):**

```
**Known outstanding issues (to fix):**
- `cg-fade.ts` returns `tp1 = tp2` (single target) but `execute.ts` places 2 separate limit orders. Need true partial split (TP1 = 1× ATR partial, TP2 = 2.5× ATR runner) + re-backtest.
```

(I.e. remove the reconcile.ts:188 bullet — TASK-002 verified clean.)

## Rollback plan

**If sanity backtest fails acceptance bands:**

1. **Do not revert the code fix.** The writer change cannot mathematically degrade the engine output (engine bypasses DB D/W rows for the open period; closed D/W rows fetched from Bybit are unchanged).
2. **Most likely cause:** time drift — running the backtest weeks later than the baseline (2026-05-23) means newer market data is included in the rolling 365d window. Compare apples to apples: re-run with explicit window matching the baseline period: `BT_HOURS=$((365*24)) npx tsx src/backtest/cli/cg-fade-portfolio.ts 365 > /tmp/cg-baseline-window.out 2>&1` and additionally inspect monthly breakdown — if recent months (post-baseline) account for the delta, document as natural OOS drift rather than a code regression.
3. **Less likely cause:** DB scrub re-fetched stale/incomplete data. Verify Bybit returned full 730-day coverage for 1D/1W: `SELECT symbol, tf, COUNT(*), MIN(ts), MAX(ts) FROM candles WHERE tf IN ('1D','1W') GROUP BY symbol, tf ORDER BY symbol, tf;` — expect ~730 rows per (symbol,'1D') and ~104 per (symbol,'1W'). If short, re-run `backfill-symbol.ts` for affected symbols.
4. **Worst case:** if backtest is so far outside bands that engine code is suspect — **do not roll back this task's edits**, file a new TASK-004 to investigate engine drift. The TASK-003 DB scrub is forward-correct regardless.

**If DB scrub raises errors mid-flight:** the `candles` table has no FK from anywhere (grep verified: no `REFERENCES candles` in migrations). DELETE cannot cascade-corrupt anything. Worst case: partial DELETE leaves a mixed state; re-run the DELETE statement (idempotent). Re-fetch via `backfill-symbol.ts` is also idempotent thanks to the conditional UPSERT.

**If `package.json` removal breaks something downstream:** zero callers found in cron/scripts. If a teammate's local script depended on `npm run data:dw`, they can substitute `npx tsx src/data/cli/backfill-symbol.ts <SYM>...` which covers 1D/1W (730 days, see `TFS_HTF` in backfill-symbol.ts:10).

## Risks

1. **Postgres CASE expression on non-listed TF.** If a future TF is added (e.g. `'30m'`), the CASE returns `ELSE 0`, which means `candles.ts + 0 > now_ms` is always false ⇒ rows for that TF are silently never updated. Mitigation: defensive — keep `ELSE 0` but if you add a new TF, also update the CASE. Document this in the commit message. (Considered adding TF→ms lookup as a Postgres function; rejected — schema sprawl for a problem that's also documented in the source TF constants `TF_MS` map at `src/data/bybit-public.ts`.)
2. **Clock skew between Node and Postgres.** Using `EXTRACT(EPOCH FROM NOW()) * 1000` instead of a Node-provided `$N` parameter avoids this. Verified: `query()` is `pg`-driver based with no custom now-injection.
3. **Race between cron and scrub.** Mitigated by the cron-pause step in §Operational sequence. If operator forgets, worst case = duplicate fetch (idempotent under new UPSERT).
4. **Sanity backtest natural drift.** Bands are intentionally wide (~5pp on return, 1pp on MaxDD). If trial accidentally tightens them, false positive halt. See §Rollback plan step 2.
5. **`coinglass-backfill.ts` SKIP decision.** If a future CG-fade strategy variant uses intra-period CG H/L (e.g. `funding_oi_weighted.fr_high`), the same look-ahead pattern will silently resurface in CG tables. Mitigation: tracked in this audit map; create new task if/when such a strategy lands.
6. **Diagnostic 1m backfill SKIP decision.** Assumes engine.ts never makes a strategy decision based on 1m H/L. Verified by grep + reading `src/backtest/engine.ts:51-52` (1m loaded but used only inside the intra-bar fill simulation loop, not passed to `strategy.decide()`). If a future strategy declares `decisionTf: '1m'`, revisit.
7. **PR review surface area.** Three concerns (backfill SQL change + dead file removal + CLAUDE.md edit). Keep them in **one commit** — they tell one story (the writer fix). The reviewer will want to see all three together.

## Reviewer checklist (TEAM.md §4 anchor)

- [ ] No new comments added inside the SQL string or around it (per "Comments" rule). The WHY lives in the commit message + this brief.
- [ ] No `as` casts, no `any` introduced.
- [ ] Imports unchanged (no new dependencies).
- [ ] `npm run typecheck` clean.
- [ ] `package.json` JSON valid after script removal.
- [ ] CLAUDE.md diff is exactly the two edits above — no other lines touched.
- [ ] Single commit, message format: `fix(backfill): DO UPDATE WHERE bar incomplete + remove dead D/W CLI`.

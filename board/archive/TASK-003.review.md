---
task: TASK-003
reviewer: code-reviewer
iteration: 1
reviewed_at: 2026-05-24T09:30:00Z
tally:
  important: 0
  nit: 1
  pre_existing: 1
verdict: APPROVE_FOR_TEST
---

# TASK-003 Review — backfill DO UPDATE WHERE incomplete

## Important

_None._

## Nit

### N1. README.md:12 — references removed `npm run data:dw` script

The deleted CLI's npm script is still documented in the project README as part of the "cold start" sequence:

```
npm run data:dw # 1D/1W за 730 дней
```

After this PR, the command will error with `npm ERR! Missing script: "data:dw"`. README was not in the dev brief's "files to edit" list and the dev followed the brief precisely, so this is a brief-coverage gap, not a dev error. Tester should either:

- Replace the line with `npx tsx src/data/cli/backfill-symbol.ts BTCUSDT INJUSDT TAOUSDT ATOMUSDT LTCUSDT ARBUSDT XRPUSDT`, **or**
- Drop the line entirely (cold-start coverage of 1D/1W now flows naturally via top-of-hour `refreshForScan()`).

Classified as Nit (docs-only, no runtime impact). Iteration is 1, so flagging is allowed; dev or tester may fix during the testing phase.

## Pre-existing

### P1. `.claude/settings.json` modifications — out of TASK-003 scope

Working tree contains uncommitted `.claude/settings.json` edits (board path allowlist + Pre/PostToolUse hooks). These are unrelated to TASK-003 (backfill DO UPDATE). Not introduced by this task — they appear to be ambient dev-environment infra. Flag once: if these stay in the same commit as the backfill fix, the PR title `fix(backfill): ...` will be misleading. Recommend committing the backfill fix in isolation. Not blocking.

## Reviewer checklist (TEAM.md §4 anchor)

- [x] SQL correctness verified — all 7 TFs from `TFS_FOR_SCAN` (1m/5m/15m/60m/240m/1D/1W) covered in CASE; `EXCLUDED.*` refs match the schema (`migrations/001_init.sql:11-22`); `EXTRACT(EPOCH FROM NOW()) * 1000` returns ms-resolution timestamp matching `candles.ts` storage; WHERE filter `candles.ts + tf_duration > now_ms` correctly identifies bars whose period_end is still in the future (= currently open); `ELSE 0` defensive branch is correct (unknown TF → `ts + 0 > now_ms` is always false ⇒ skip update ⇒ historical immutability preserved).
- [x] `insertFunding()` untouched (`src/data/backfill.ts:87-101` retains `ON CONFLICT (symbol, ts) DO NOTHING`) — matches devbrief Audit Map §funding (events are atomic, never "incomplete").
- [x] Dead file deletion verified — `grep -rn "backfill-daily-weekly\|data:dw"` in source returns only board/ docs + README.md (Nit N1). No imports, no cron, no scripts/cycle.sh references.
- [x] `package.json` valid JSON (jq parse clean). Only the `data:dw` line removed; trailing comma on neighbouring `data:features` correctly preserved.
- [x] `CLAUDE.md` edits precise — diff is exactly the Discovery bullet rewrite (lines 146-153) + Known outstanding issues bullet removal (line 167). No other lines touched.
- [x] No new comments — SQL block contains zero `//` or `--` comments; whitelist (TS pragmas, ESLint, shebang) trivially satisfied; the non-obvious WHY about period-end semantics lives in the devbrief / commit message per TEAM.md §4 Comments rules.
- [x] Typecheck clean — `npx tsc --noEmit` returned 0 lines (0 errors).

## Acceptance criteria coverage

| # | Criterion | State |
|---|---|---|
| 1 | Code around line 64 read and Scenario C documented | ✓ devbrief §Audit map |
| 2 | DO UPDATE WHERE incomplete in insertCandles for all TFs | ✓ src/data/backfill.ts:62-80 |
| 3 | backfill-daily-weekly.ts deleted/unified | ✓ git rm staged |
| 4 | Audit ALL ON CONFLICT DO NOTHING in src/data + diagnostics, decision list | ✓ devbrief §Audit map (1 FIX, 1 DELETE, 7 SKIPs) |
| 5 | DB scrub + 3×3 verify | ⏭ defers to tester |
| 6 | Sanity walk-forward CG-fade portfolio 365 | ⏭ defers to tester |
| 7 | CLAUDE.md updated (Fix D' wording + reconcile.ts:188 removed) | ✓ diff matches devbrief §5 exactly |

Code-side criteria (1, 2, 3, 4, 7) all satisfied. Runtime/data criteria (5, 6) hand off to tester per task brief boundaries.

## Notes

- Single-commit-vs-split observation: the working tree mixes the backfill fix (intended) with `.claude/settings.json` changes (unrelated). Recommend `git restore --staged .claude/settings.json` and a separate commit for the dev-env infra. Not blocking; orchestrator can decide.
- Postgres `query.rowCount` semantics under `DO UPDATE ... WHERE`: rows filtered by the WHERE clause are not counted (they're treated like the conflict was resolved by DO NOTHING). The `total += r.rowCount` accumulator in `insertCandles` therefore now reports "inserted OR refreshed", undercounting silently-skipped closed-bar attempts. This is acceptable — the log line `'backfill candles done', inserted: totalInserted` is operator-informational, not a correctness invariant.
- The fix is correctness-forward and mathematically cannot degrade the engine (engine uses `aggregateHourlyTo` synth path for D/W; DB rows for closed periods are unchanged). Sanity backtest in §6 should land within bands; if not, the rollback playbook in devbrief §Rollback is authoritative.

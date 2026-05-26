---
name: smoke-test
description: Use when the tester verifies acceptance by running real commands — npm scripts, curl probes, Playwright (if frontend exists), backtest CLIs. Captures output to /tmp, classifies pass/fail, never creates new test infrastructure. Owned by tester agent.
---

# smoke-test — Acceptance verification by execution

Used by the `tester` agent. See also `.claude/agents/tester.md` for context and limits.

## When to invoke

Task `status: testing`. The reviewer cleared correctness; you verify behavior.

## Procedure

### 1. Plan one check per acceptance criterion

Each `acceptance:` item maps to one or more commands. Examples:

| Acceptance | Verification |
|---|---|
| "Typecheck passes" | `npm run typecheck` |
| "All trades compute R within 0.01" | committed `npx tsx src/tools/diagnostics/r-precision-check.ts` |
| "Backtest walk-forward gate holds" | `npm run backtest:portfolio` and check PF ≥ 1.4, MaxDD ≤ 4% |
| "Reconcile reports aligned: true" | `npm run reconcile`, read output |
| "Scan emits valid JSON" | `npm run scan:decide`, Read tool on `/tmp/scan-decide-latest.json` |
| "Telegram message sent" | `npm run tg:test` |

If no command exists, the criterion isn't testable as worded — flag as Important back-feedback to architect/planner.

### 2. Run, capture to `/tmp`

Every command goes:

```bash
npm run <script> > /tmp/test-TASK-NNN-<step>.log 2>&1
```

Then Read tool on the log to inspect. Don't `cat` or `tail`.

For backtest CLIs that take minutes, use `run_in_background: true` and continue with other checks in parallel.

### 3. Run mandatory steps

For every task:

- `npm run typecheck` — must pass.

For `live_sensitive: true` tasks:

- The walk-forward gate (PF ≥ 1.4, MaxDD ≤ 4%, expectancy ≥ 0.3R, ≥ 100 trades) must hold on the relevant backtest CLI.
- `npm run reconcile` reports `aligned: true`.

### 4. Run existing tests in the changed area

For each file in the diff, check if it has a sibling `.test.ts` or lives under a directory with `__tests__/`. If yes, run that test surface.

**If no test files exist for the changed area:** do NOT create test infrastructure. Note the coverage gap in the report and suggest a follow-up task. Per project policy (operator decision), we only extend tests where they already live.

### 5. Smoke-test runtime entrypoints (safe ones)

If the diff touches:

- `src/core/telegram.ts` or `src/core/tg-templates.ts` → `npm run tg:test`.
- `src/core/bybit.ts` or Bybit-related code → `npm run bybit:test` (read-only).
- `src/runtime/scan-decide.ts` → `npm run scan:decide` (read-only).
- `src/data/cli/` → the appropriate `npm run data:*` (some are read-only, some write to DB — check the script).

**Never run** `npm run execute` against real or demo accounts in tester role. Order placement is dev's responsibility during their own verification, not yours.

### 6. Forbidden shell patterns

Same as everywhere — `CLAUDE.md § Forbidden shell patterns`:

- No heredocs.
- No `node -e`, `python3 -c`.
- No `$(...)` in command args.
- No `<(...)` process substitution.
- No raw curl to Telegram.

Use Read/Write/Edit tools and committed `npx tsx` scripts.

### 7. Classify each acceptance item

- ✅ pass — observed output matches expectation.
- ❌ fail — observed mismatch. Include actual vs expected.
- ⚠️ skipped — couldn't run (with reason).

### 8. Write `TASK-NNN.test.md`

Use the template in `.claude/agents/tester.md`. Frontmatter includes a list with `{item, status, evidence}` per acceptance item, plus the verdict.

### 9. Transition

- All ✅ → `status: done`. Update `tested_at` in task frontmatter. Reply to orchestrator with a one-line pass summary; orchestrator archives.
- Any ❌ → `status: rework`. Reply with the failure(s); do **not** increment iteration (dev does it on resubmit).

Update `index.json` per `board-update` skill.

## Anti-patterns

- ❌ Marking ✅ without running the command.
- ❌ Creating new test files for previously-untested code.
- ❌ Running `execute.ts` against real or demo accounts.
- ❌ Skipping `npm run typecheck`.
- ❌ Letting backtest gate slide ("close enough") on `live_sensitive`.
- ❌ Modifying source code. Bugs found → `status: rework` with the finding in the test report.
- ❌ Forgetting to update `index.json`.

## Backtest gate reference

For `live_sensitive` tasks, the gate from `CLAUDE.md § Targets and Constraints`:

```
PF       ≥ 1.4
MaxDD    ≤ 4%   (some live-trial flexibility, but flag if > 5%)
expR     ≥ 0.3
trades   ≥ 100 (combined across universe)
```

If a portfolio-level PF holds but a per-pair pair dips slightly (e.g. XRP expR 0.25R), that's acceptable per the operator's policy — flag but don't fail.

## Coverage gap reporting

When changed files have no test infrastructure:

```markdown
### Coverage gap

`src/runtime/reconcile.ts` and `src/runtime/auto-execute.ts` have no sibling .test.ts files
and no `__tests__/` directory. Per project policy, the tester does not create new test
infrastructure. Recommend a follow-up task:

- TASK-XXX (proposed): Add reconcile/auto-execute integration test harness covering
  the partial-fill TP1 and reconstruct paths.
```

The orchestrator decides whether to create the follow-up task.

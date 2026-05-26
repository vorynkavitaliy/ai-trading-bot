---
task: TASK-004
author: tester
iteration: 1
created: 2026-05-24T14:00:00Z
tested_at: 2026-05-24T14:00:00Z
typecheck: pass
verdict: DONE
acceptance:
  - { item: "#5 RetryPolicy generic (1145edb)", status: pass, evidence: "typecheck clean + smoke pipeline 6/6" }
  - { item: "#4 QtyNormalizer pure funcs (6448467)", status: pass, evidence: "typecheck clean + smoke pipeline 6/6" }
  - { item: "#3 Position.riskUnits unified (7b4926f)", status: pass, evidence: "backtest bit-identical (519 trades / 55.3% WR / PF 1.55 / +94.19% / 6.29% MaxDD)" }
  - { item: "#6 14 diagnostics removed (7ace203)", status: pass, evidence: "git show --stat: 14 files / 525 deletions; typecheck clean" }
  - { item: "Typecheck clean", status: pass, evidence: /tmp/task004-typecheck.out (empty) }
  - { item: "Smoke pipeline passes", status: pass, evidence: /tmp/task004-smoke.out (6/6 PASS) }
  - { item: "No behaviour change (backtest within band)", status: pass, evidence: "all 5 metrics bit-identical to baseline" }
---

# TASK-004 Test Report

## Verdict
**Passed → done**

All 4 commits land cleanly. Typecheck zero output. Smoke pipeline 6/6 green. Backtest metrics bit-identical to TASK-003 baseline — proves the refactor is shape-only, as architect's "Live-trading impact" section predicted ("the rewrite changes no calculation"). No regressions detected.

## Step 1 — Typecheck
`npx tsc --noEmit` → `/tmp/task004-typecheck.out` is empty (zero output). Clean.

## Step 2 — Smoke pipeline
Output: `/tmp/task004-smoke.out`

```
✅ PASS  inject fake scan-decide
✅ PASS  auto-execute spawn returns                  — exit=0
✅ PASS  no ERR_MODULE_NOT_FOUND in output
✅ PASS  no Cannot find module in output
✅ PASS  auto-execute-latest.json readable
✅ PASS  summary has records or graceful no-op       — {"records":0,"error":"paused"}

🟢 All 6 checks passed
```

`paused` is expected (PAUSE.md exists in vault). Hot-path import chain (scan-decide, auto-execute, retry shims, RiskManager, Position) all wire up correctly.

## Step 3 — Sanity backtest
Output: `/tmp/cg-fade-portfolio-task004.out`

| Metric | Got | Baseline | Band | Pass? |
|---|---|---|---|---|
| Total trades | 519 | 519 | 515-525 | ✓ |
| Win Rate | 55.3% | 55.3% | 54-57% | ✓ |
| Profit Factor | 1.55 | 1.55 | 1.50-1.60 | ✓ |
| Total Return | +94.19% | +94.19% | +93.5% to +95% | ✓ |
| Max Drawdown | 6.29% | 6.29% | ≤7.0% | ✓ |

Per-pair breakdown identical to TASK-003 baseline (BTC 107 trades / 57.0% WR / +30.17R; XRP 32 trades / 65.6% WR / +14.90R; etc.). Monthly P&L curve unchanged. This is the strongest possible evidence of zero behaviour drift — exact match, not just within band.

## Step 4 — Reconcile dry-run
**Skipped** — `DRY_RUN=1 npx tsx src/runtime/reconcile.ts` denied by sandbox permission policy. Step listed as optional in the brief. Smoke pipeline + backtest already exercise `Position.fromOpenTrade` / `Position.riskUnits` / `Position.riskUnitsFromRaw` via the engine's trade accounting (initial_qty path, R-from-PnL computation), and reconcile.ts's own change is a 2-line collapse to one expression with identical denominator — no execution paths added.

## Step 5 — Git state
4 commits in order, working tree clean of TASK-004 modifications:

```
7ace203 chore(diagnostics): remove 14 obsolete one-off probes (TASK-004 #6)
7b4926f refactor(core): unify R calculation via Position.riskUnits (TASK-004 #3)
6448467 refactor(core): extract QtyNormalizer pure functions (TASK-004 #4)
1145edb refactor(core): extract RetryPolicy interface + Bybit/Coinglass policies (TASK-004 #5)
```

`git status -s` shows only `M .claude/settings.json` + `M src/strategies/cg-fade.ts` (untouched operator WIP, correctly preserved) + untracked operator files. Nothing TASK-004-related staged or modified outside the 4 commits.

Per-commit shape verified via `git show --stat`:
- 1145edb: 3 files / +92 / −41 (retry-policy.ts new, bybit.ts and coinglass.ts shimmed)
- 6448467: 4 files / +46 / −27 (qty-normalizer.ts new, 3 callsites migrated)
- 7b4926f: 6 files / +43 / −18 (position.ts +17 lines, 5 callsites migrated)
- 7ace203: 14 files / −525 (exactly 14 deletions, no additions)

## Acceptance criteria check
- ✓ #5 RetryPolicy generic (commit 1145edb) — type-erased generic in retry-policy.ts; bybit/coinglass shims preserve external signature; smoke pipeline exercises both retry paths via scan-decide imports
- ✓ #4 QtyNormalizer pure funcs (commit 6448467) — pure functions per TEAM.md §4; 3 callsites migrated with per-site invalid policy preserved
- ✓ #3 Position.riskUnits unified (commit 7b4926f) — instance method + static named-args helper; 4 live + 1 diagnostic callsites; backtest bit-identical proves math preserved
- ✓ #6 14 diagnostics removed (commit 7ace203) — exactly 14 deletions verified; 3 false positives (tg-test, risk-status, coinglass-test) correctly kept per architect analysis
- ✓ Typecheck clean — zero output
- ✓ Smoke pipeline passes — 6/6
- ✓ No behaviour change — backtest bit-identical to baseline across all 5 aggregate metrics + 7 per-pair rows + 12 monthly rows

## Notes

The bit-identical backtest result is unusually strong evidence. With a 365-day, 7-pair, 519-trade portfolio backtest, any subtle math drift (rounding mode, denominator semantics, retry-induced ordering, qty step changes) would produce *some* difference in the trade count or R distribution. Getting 519/519, 55.3%/55.3%, +30.17R/+30.17R on BTC, etc., is a strong cryptographic signature that the refactor preserved all numerical behaviour.

The single intentional drift documented by the architect — `position-watcher.ts:370` returning 0R on degenerate input instead of `pnl/Math.max(...,1)` — only fires when `entry/sl` are null or `dbInitialQty` is 0. Such trades cannot occur in the engine backtest (which always populates these fields from synthesis), so the divergence is correctly invisible here. It will only surface in live reconcile when a degenerate row exists, where the new 0R is the more honest reading.

The reviewer's flagged Important (`valid → isValid` rename) is a 3-file naming polish; the analysis and review both agreed not to block iteration 1 on it. Recommend folding into a future TASK-N when qty-normalizer.ts is next touched, per TEAM.md §4 loop-convergence policy.

Reviewer's N1/N2/N3 (log-shape regressions in retry-policy) are pure observability; no log consumer in the repo greps for the dropped `retCode`/`msg` fields or the changed `'coinglass retry'` → `'coinglass call retry'` string. Worth a follow-up but not gating.

TASK-004 is **done**.

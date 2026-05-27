---
task: TASK-005
author: tester
iteration: 1
created: 2026-05-26T09:45:00Z
tested_at: 2026-05-26T09:45:00Z
typecheck: pass
acceptance:
  - { item: 1, status: pass, evidence: "closeAndVerify + closeAcrossAccounts in src/core/close-verifier.ts; all 6 callsites migrated" }
  - { item: 2, status: pass, evidence: "MultiCloseResult struct + cross-check pass; close-symbol ARBUSDT exit=0, 3/3 verified-closed" }
  - { item: 3, status: pass, evidence: "divergence-detector.ts dust branch no longer gates on tp1_filled (grep shows only tp1_partial branch retains flag)" }
  - { item: 4, status: pass, evidence: "position-watcher.ts safety-net has 4-outcome force-close fallback (af050c1)" }
  - { item: 5, status: pass, evidence: "0 hits of Market+reduceOnly:true submitOrder outside close-verifier.ts" }
  - { item: 6, status: pass, evidence: "npx tsc --noEmit clean (zero output)" }
  - { item: 7, status: pass, evidence: "smoke-pipeline 7/7 PASS; reconcile aligned:true" }
  - { item: 8, status: pass, evidence: "close-symbol ARBUSDT on flat state → no_position for all 3 accounts, exit=0, no submits" }
verdict: DONE
---

# TASK-005 Test Report

## Verdict
**Passed → done**

## Step 1 — Static checks
- **typecheck:** clean (`npx tsc --noEmit` zero output).
- **grep Market+reduceOnly outside close-verifier.ts:** 4 hits, all in `src/runtime/execute.ts` and `src/core/pending-orders.ts`:
  - `execute.ts:190` — entry order, `reduceOnly: false` (verified line 193)
  - `execute.ts:407` — DCA entry, `reduceOnly: false` (verified line 410)
  - `execute.ts:542` — DB log string, not an order submit
  - `pending-orders.ts:19` — TypeScript type definition `orderType: 'Market' | 'Limit'`
  - All entry-side; **0 close-paths outside close-verifier.ts**.
- **grep reduceOnly:true + Market/submitOrder outside close-verifier.ts:** 0 hits.
- **grep tp1_filled in divergence-detector.ts:** 1 hit at line 47, in the `tp1_partial` branch (`!match.tp1_filled && ratioVsInitial > TP1_PARTIAL_LO && ratioVsInitial < TP1_PARTIAL_HI`). Dust branch is clean of the gate. Matches architect § Design.

## Step 2 — Smoke pipeline
`/tmp/task005-smoke.out`:
- 7/7 checks PASS (inject fake scan-decide, auto-execute spawn returns exit=0, no ERR_MODULE_NOT_FOUND, no Cannot find module, auto-execute-latest.json readable, summary has 1 actionable record, no spawn-path bug).
- Hot-path imports resolve including new `close-verifier.ts` (indirect via `position-watcher.ts` + `reconcile.ts` graph).

## Step 3 — Reconcile dry-run
`/tmp/task005-reconcile.out`:
```json
{
  "aligned": true,
  "ts": "2026-05-26T09:43:06.908Z",
  "bybitPositionsCount": 3,
  "dbOpenTradesCount": 3,
  "divergences": [],
  "staleOrphans": []
}
```
exit=0. Reconcile exercises `tradeRepo.openTrades`, `divergenceDetector.classify` (with new dust logic), and the gap-fill paths. No regression: aligned=true and zero divergences. The 3 positions are ETHUSDT (Tier-2), opened today 04:00 UTC across all 3 accounts (DB rows 231/232/233).

## Step 4 — Position snapshot all Tier-1
Per-pair (`/tmp/task005-pos-<SYM>.out`):
- **BTCUSDT, INJUSDT, TAOUSDT, ATOMUSDT, LTCUSDT, XRPUSDT, ARBUSDT:** all flat across Ivan/Vitalii/Vеra (no positions, no orders).
- Out-of-band note: 3 open ETHUSDT positions (Tier-2, not in tester scope but verified) — all 3 have SL=2123.98 attached server-side. No naked positions on any account.

## Step 5 — close-symbol on flat state (ARBUSDT)
`/tmp/task005-close-symbol-arb.out`:
```
  50000/Ivan: ∅ ARBUSDT initial=0 final=0 attempts=0 status=no_position
  200000/Vitalii: ∅ ARBUSDT initial=0 final=0 attempts=0 status=no_position
  200000/Vеra: ∅ ARBUSDT initial=0 final=0 attempts=0 status=no_position

=== ARBUSDT verified-closed: 3/3, stuck: 0 ===
```
exit=0. Format matches architect spec § "close-symbol.ts main — diff outline" exactly. Full path exercised: `close-symbol.ts main()` → `closeAcrossAccounts(accounts, 'ARBUSDT', { reason: 'admin close-symbol', cancelOrders: true })` → per-account `closeAndVerify` → initial position fetch returns empty → returns `no_position` short-circuit (step 3 of helper semantics). No `submitOrder` calls issued.

## Step 6 — Sanity backtest
**Skipped.** Backtest CLI `src/backtest/cli/cg-fade-portfolio.ts` deleted in operator WIP (working tree `D` status). Per architect § Live-trading impact: "Walk-forward backtest re-run NOT required. The change is purely execution-layer (close path) and risk-safety". Strategy logic untouched.

## Step 7 — Git state
8 TASK-005 commits on top of `52b8903`:
```
7fded20 refactor(diag/full-exit-symbol): route through closeAcrossAccounts (TASK-005)
d80f178 refactor(admin/close-all): route through closeAcrossAccounts per symbol (TASK-005)
40c1c9f refactor(admin/close-symbol): route through closeAcrossAccounts (TASK-005)
5daad76 fix(reconcile): route dust handler through closeAndVerify (TASK-005)
af050c1 fix(position-watcher): force-close fallback when emergency SL set fails (TASK-005)
ad16b01 fix(reconcile): drop tp1_filled gate on dust classification (TASK-005)
7014f59 feat(core): add closeAndVerify + closeAcrossAccounts safety helpers (TASK-005)
0ab03d4 feat(bybit): expose minNotionalValue on InstrumentInfo (TASK-005 prep)
```
Per-commit file scope verified — each commit touches exactly the file per architect dev brief; `src/strategies/cg-fade.ts` NOT in any TASK-005 commit. Working tree contains operator WIP only (`M board/index.json`, deletes of `src/backtest/cli/btc-*`, `src/backtest/cli/cg-*`, `src/backtest/cli/grid-*`, `src/tools/diagnostics/cg-*`, untracked `board/tasks/`, untracked `src/backtest/cli/wf-*.ts`). None of it is TASK-005 output.

## Acceptance criteria check
- ✓ `closeAndVerify` в shared helper (`src/core/close-verifier.ts:152` + `closeAcrossAccounts:158`)
- ✓ Multi-account verifier + cross-check pass (final cross-check downgrades stale `ok`→`stuck`)
- ✓ divergence-detector dust verdict без `tp1_filled` gate (acceptance #3 — implemented per architect's qty-ratio-only refinement)
- ✓ position-watcher safety-net force-close fallback (af050c1 — 4 outcome branches: ok / dust_below_min / stuck / error)
- ✓ Все close-paths через `closeAndVerify` — 6 migrated callsites + 0 hits of inline Market+reduceOnly:true outside the helper
- ✓ Typecheck clean (`npx tsc --noEmit` zero output)
- ✓ Smoke pass (7/7)
- ✓ Manual integration: close-symbol на flat ARBUSDT → `no_position` для всех 3 accounts, exit=0, no live submits

## Notes

**Step 6 deviation from prompt:** prompt asserted "НЕТ открытых позиций" but reconcile + db-open-trades show 3 open ETHUSDT positions opened today 04:00 UTC. ETHUSDT is Tier-2 (paused), not in TASK-005 scope. All 3 have server-side SL=2123.98 attached — no naked positions, no regression. Reported here for operator awareness (not a TASK-005 failure).

**Operator WIP not committed (per reviewer):** working tree has many uncommitted operator changes (deletes/adds in `src/backtest/`, `board/index.json` modification, new `src/backtest/cli/wf-*.ts`). None of these belong to TASK-005. The 8 TASK-005 commits are surgical and isolated.

**Live-trading inviolables strengthened (CLAUDE.md):**
1. Server-side SL within 5 min — safety-net now force-closes when SL set fails (no more naked overnight).
2. Edit-never-cancel SL — untouched; `setTradingStop` remains primary path; force-close only on amend failure.
3. Reconcile divergence — dust verdicts now auto-close via hardened helper.

**No backtest gate check required** — execution-layer task only, strategy logic untouched (architect § Live-trading impact).

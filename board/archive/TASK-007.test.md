---
task: TASK-007
author: tester
iteration: 2
created: 2026-05-27T09:53:26Z
---

# TASK-007 Test Report

## Verdict
Passed → done

## Step 1 — Static
- `npx tsc --noEmit`: clean (no output, exit 0).
- 7 commits present `c820062..HEAD`: bd29e7c, d8d5ab3, 340c3da, 904e3da, a46f245, a7edf11, eeb6eed — matches spec.
- TODO/FIXME/HACK scan over the 8 touched files: 1 hit (`risk-guard.ts:171 totalKillTriggered … TODO`) but `git blame` shows it predates TASK-007 (commit d9f74c90, 2026-04-29). NOT TASK-007 code. The pending-aware duplicate-check block added by a46f245 is clean. Pass.

## Step 2 — Smoke
`smoke-pipeline.ts`: 🟢 all 7 checks passed (inject scan-decide, auto-execute spawn exit=0, no module-resolution errors, auto-execute-latest.json readable, summary `{"actionable":1,"records":1}`, SMOKEUSDT no spawn-path bug). Output `/tmp/task007-smoke.out`.

## Step 3 — Reconcile dry-run (guard test)
Ran clean to completion, emitted valid JSON, **exit code 4** (= deliberate `aligned:false` divergence exit, `reconcile.ts:305 process.exit(r.aligned ? 0 : 4)`). NOT exit 1 (unhandled-throw path `:311`). No stack trace. 3 `bybit_without_db` divergences on XRPUSDT (all 3 accounts). The new try/catch promotion guard (`reconcile.ts:131-147`) was exercised: the divergences passed through the no-pending fall-through cleanly; cycle did not abort. Output `/tmp/task007-reconcile.out`.

## Step 4 — XRP state
Snapshot (`position-snapshot.ts XRPUSDT`): slot-1 Sell Limit @1.3346 has **now FILLED** on all 3 accounts (POS size>0: Ivan 24982.6 / Vitalii 101273.5 / Vеra 104396.8), server-side SL @1.3444 present (Untriggered Buy Market StopLoss), plus reduce-only TP Buy-limits @1.3216 and the remaining Sell-limit DCA ladder @1.3411/1.3379. So the operator's limits filled since the incident.

DB trades (`/tmp/t007-xrp.ts`):
- **#240/241/242 = `cancelled`** (orchestrator cleanup), entry 1.3346 — confirmed.
- **No new phantom `open` rows** for XRPUSDT since cleanup. The honest execute path did not recreate phantoms.

DB pending_orders: rows #118/119/120 (the incident slot-1 intents) are `status='placed'` with `trade_id` = 240/241/242 (linked to the now-cancelled trades). Because `findUnpromotedPending` filters `status='placed' AND trade_id IS NULL`, these are correctly **not** promotable → that is why the now-filled positions reported as `bybit_without_db` rather than auto-promoting. This is **leftover manual-cleanup state, not a TASK-007 defect**: the manual cleanup cancelled the trades but left the pending rows trade_id-linked. TASK-007 promotion logic is correct for fresh entries (verified in code below). Operator may null those pending trade_ids or let position-watcher/reconcile surface the divergence; outside TASK-007 scope.

## Step 5 — Daemon version awareness
`position-monitor` systemd unit **active**, PID 1183842, started **May26** — i.e. before the TASK-007 commits (dated 2026-05-27). The running daemon loaded account-monitor.ts source at start, so the new `tryPromotePending` wiring (commit 904e3da) is **NOT active** in the live daemon. Promotion via daemon path requires **`npm run monitor:restart`** — OPERATOR STEP. Until restart, only the reconcile catch-net path carries promotion (and that requires an unpromoted pending, see Step 4).

## Step 6 — Git scope
Operator WIP intact and uncommitted: `board/index.json`, `scripts/cycle.sh`, and a large set of `src/backtest/cli/*` deletions (btc-*, grid-*, portfolio-*, cg-fade-*, wf-*). No TASK-007 artifact file (execute.ts, reconcile.ts, pending-promoter.ts, trade-journal.ts, account-monitor.ts, pending-orders.ts, risk-guard.ts, tg-templates.ts, auto-execute.ts) appears as an uncommitted change — all 7 commits are clean and self-contained.

## Acceptance check
- ✓ execute honest fill (no phantom row on unfilled limit) — fake fallback `actualFilledQty = slots[0].qtyNum` removed; `pendingOnly`, `slot1Filled`, `filled: s.level===1 && slot1Filled`, persistTrade filters `r.ok && !r.pendingOnly && (r.qty??0)>0`, `initial_qty` set explicitly in INSERT (execute.ts:463,501-518,540).
- ✓ pending-promoter idempotent — `SELECT … FOR UPDATE`, `{tradeId, created}` return, loser no-ops `created:false`, null when no eligible intent (pending-promoter.ts:8,17-33,86).
- ✓ promotion wiring (daemon + reconcile) — reconcile catch-net at reconcile.ts:131-142 (daemon path committed in account-monitor.ts via 904e3da; live activation pending restart per Step 5).
- ✓ Telegram pending/confirmed templates — `ОРДЕР РАЗМЕЩЁН` pending header + `notifyEntryConfirmed`/`ВХОД ПОДТВЕРЖДЁН` (tg-templates.ts:89,159,168).
- ✓ risk-guard pending-aware duplicate — `pending_orders WHERE trade_id IS NULL AND status IN ('pending','placed')` (risk-guard.ts:238-239).
- ✓ orphan-on-cancel — `markPendingOrphanedByLink` invoked from `cancelScaledInOrphans` (reconcile.ts:67).
- ✓ reconcile guard (iter2 fix) — try/catch around promotion, `log.warn` + fall-through to `bybit_without_db`, no propagation (reconcile.ts:131-147); exercised live in Step 3 with no crash.
- ✓ typecheck + smoke — both clean.

## Operator deployment steps
1. `npm run monitor:restart` (load TASK-007 daemon promotion code; daemon currently on May26 source).
2. Observe next limit-entry: should show 🟡 ОРДЕР РАЗМЕЩЁН (Slot 1 ⏳ pending), no phantom DB `open` row, then ✅ ВХОД ПОДТВЕРЖДЁН + exactly one trades row on fill.
3. (Optional, current XRP) The live XRP positions (filled limits) will keep reporting `bybit_without_db` because pending rows #118/119/120 are trade_id-linked to the cancelled #240/241/242. To clear: either null those pending `trade_id`s so the catch-net can promote, or manually journal the open positions. Leftover incident state, not a code regression.

## Notes
- Static-only / read-only verification per charter (no daemon restart, no execute/auto-execute, no forced XRP fill, no backtest). All four "не делаем" constraints honored.
- The reconcile guard's correctness was confirmed both by code review of reconcile.ts:131-147 and by the live dry-run in Step 3, which passed 3 XRP divergences through the fall-through without aborting.

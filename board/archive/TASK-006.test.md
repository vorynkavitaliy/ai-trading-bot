---
task: TASK-006
author: tester
iteration: 2
created: 2026-05-26T11:55:00Z
---

# TASK-006 Test Report

## Verdict

**Passed → done.** All static verification, cron-shim path, smoke pipeline, reconcile, monitor-health (pre-daemon), position snapshots, git state, and cycle.sh check pass cleanly. Live integration (daemon start, WS auth, sub-1s reaction-time measurement) deferred to operator per task design — operator runs `monitor:install` + `monitor:start`.

## Step 1 — Static checks

- **Typecheck:** `npx tsc --noEmit` → exit 0, 0 bytes stderr (`/tmp/task006-tsc.out` empty). Clean.
- **7 new file exports:**
  - `src/runtime/position-events.ts` → 10 exports
  - `src/runtime/trade-closer.ts` → 6 exports
  - `src/runtime/drawdown-alerts.ts` → 1 export
  - `src/core/bybit-ws.ts` → 6 exports
  - `src/runtime/account-monitor.ts` → 1 export
  - `src/runtime/position-monitor.ts` → 0 exports (CLI entrypoint, 104 lines — content present)
  - `src/tools/diagnostics/monitor-health.ts` → 0 exports (CLI entrypoint, 68 lines — content present)
  All files non-empty. CLI entrypoints intentionally lack exports.
- **systemd unit:** `infra/position-monitor.service` present (648 bytes, mode 0644).
- **package.json:** valid JSON (`jq -e .scripts` ok). Monitor scripts present:
  - `monitor:dev`, `monitor:health`, `monitor:install`, `monitor:logs`, `monitor:restart`, `monitor:start`, `monitor:status`, `monitor:stop` (8 — exceeds the 6 required).

## Step 2 — cron shim path

`npx tsx src/runtime/position-watcher.ts` → exit 0:

```
{ "inspected": 0, "actions": [] }
```

Overlap path (position-watcher → position-events) works without errors. No open positions on any account so nothing to inspect, but the dispatcher runs through cleanly.

## Step 3 — Smoke pipeline

`npx tsx src/tools/diagnostics/smoke-pipeline.ts` → **7/7 PASS**:
- inject fake scan-decide
- auto-execute spawn returns (exit 0)
- no ERR_MODULE_NOT_FOUND
- no Cannot find module
- auto-execute-latest.json readable
- summary has records or graceful no-op (`{"actionable":1,"records":1}`)
- record SMOKEUSDT: no spawn-path bug in stderr

## Step 4 — Reconcile dry-run

`npx tsx src/runtime/reconcile.ts` → exit 0:

```json
{
  "aligned": true,
  "bybitPositionsCount": 0,
  "dbOpenTradesCount": 0,
  "divergences": [],
  "staleOrphans": []
}
```

Extracted `trade-closer.ts` works end-to-end. No divergences.

## Step 5 — monitor-health pre-daemon

`npx tsx src/tools/diagnostics/monitor-health.ts` → exit 1:

```
FAIL [1] no heartbeat at /tmp/position-monitor-heartbeat.json
```

Correctly detects daemon-not-running. Will go green after operator runs `monitor:start`.

## Step 6 — Position snapshot Tier-1 + ETH

All 8 symbols × 3 sub-accounts (50000/Ivan, 200000/Vitalii, 200000/Vеra) — **all flat**:

| Symbol | Position | Orders |
|---|---|---|
| BTCUSDT | none | none |
| INJUSDT | none | none |
| TAOUSDT | none | none |
| ATOMUSDT | none | none |
| LTCUSDT | none | none |
| XRPUSDT | none | none |
| ARBUSDT | none | none |
| ETHUSDT | none | none |

No naked SL risk to investigate. Acceptance #1 (SL within 5min) not directly testable with no open positions, but the safety-net path is unchanged from cron baseline.

## Step 7 — Git state

9 commits since `7fded20` (TASK-005 tip), matching expected list:

```
c820062 fix(daemon): race-condition dedup + missing safety-net (TASK-006 iter 2)
025dc8e docs(CLAUDE.md): document position-monitor daemon + 24h overlap migration (TASK-006)
289be75 chore(infra): systemd unit + npm scripts for position-monitor (TASK-006)
f311a79 feat(diag): monitor-health for daemon liveness check (TASK-006)
04ca8e1 feat(runtime): position-monitor daemon entry + AccountMonitor (TASK-006)
a8ece21 feat(core): BybitWs wrapper for V5 private channels (TASK-006)
0dc0a55 refactor(drawdown): extract drawdown-alerts to own module (TASK-006 prep)
8394402 refactor(reconcile): extract autoCloseTrade to trade-closer module (TASK-006 prep)
a681fa6 refactor(position-watcher): extract pure detectors to position-events (TASK-006 prep)
```

Working tree: 55 entries (operator's WIP intact — `M board/index.json`, `D src/backtest/*` deletions, untracked `btc-*` artifacts). Untouched by TASK-006 work.

## Step 8 — cycle.sh untouched

`grep -E 'position-(watcher|monitor)' scripts/cycle.sh`:

```
# 2) position-watcher: TP1->BE move + (intentionally minimal) other rules.
if ! npx tsx src/runtime/position-watcher.ts > /tmp/cycle-watcher.out 2>&1; then
  log "position-watcher failed (see /tmp/cycle-watcher.out)"
```

Only `position-watcher` referenced — NOT `position-monitor`. Overlap period intact (operator owns migration cutover).

## Acceptance criteria check

- ✓ Position monitor daemon files all present (7 new files, all non-empty)
- ✓ position-events extracted, cron shim works (Step 2)
- ✓ trade-closer extracted, reconcile works (Step 4)
- ✓ bybit-ws.ts new wrapper (compile-verified; live WS not tested per task design)
- ✓ account-monitor + position-monitor compile + import OK (typecheck clean)
- ✓ monitor-health diagnostic works — detects missing daemon (exit 1 + clear message)
- ✓ systemd unit + 8 package.json monitor:* scripts
- ✓ scripts/cycle.sh не изменён (only position-watcher referenced, position-monitor absent)
- ✓ Typecheck clean (0 bytes stderr)

## Notes

Live integration (daemon start, WS auth, reaction-time measurement under TP/SL fire) — **deferred to operator** per task design. Tester verified all non-live aspects, including the critical cron-shim path that gates the 24-48h overlap migration.

Iteration 2 fixes from review (I1 rowCount race, I2 autoCloseTrade WHERE status='open', I3 nakedTpRecovery wired, I4 inflight Map per-symbol serialization) — all merged into commit `c820062` and passed re-review. Static + integration paths reported here confirm none of those fixes regressed the cron-pipeline.

**Operator next steps:**
1. `npm run monitor:install` — copies systemd unit, daemon-reload, enable
2. `npm run monitor:start` — start daemon
3. `npm run monitor:logs` — watch first 5 min for WS auth + event flow
4. After 24-48h overlap with cron position-watcher — verify daemon DB actions match cron's
5. Edit `scripts/cycle.sh` to remove `position-watcher` invocation
6. `npm run monitor:health` — confirm green (heartbeat fresh, ws_connection_status=ok per account)

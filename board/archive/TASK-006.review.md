---
task: TASK-006
reviewer: code-reviewer
iteration: 2
reviewed_at: 2026-05-26T13:45:00Z
tally:
  important: 0
  nit: SUPPRESSED (iter ≥ 2)
  pre_existing: SUPPRESSED
verdict: APPROVED
---

# TASK-006 Re-Review iter 2

## Verdict

**Approved → testing.** All 4 iter-1 Important findings fixed correctly in commit `c820062`. Diff is tightly scoped (3 files, +60/−6) and matches the architect's reuse-the-cron-detectors invariant. Typecheck clean. Operator WIP (deleted `src/backtest/*` files + dirty `board/index.json`) untouched.

Per TEAM.md §2 Loop Convergence, Nit / Pre-existing categories suppressed for iter ≥ 2 and are not enumerated below.

## Important verification per iter-1 finding

### I1. `handleTp1Fill` rowCount → resolved

`src/runtime/position-events.ts:164-179`

```ts
const res = await query(
  `UPDATE trades SET qty = $1, tp1_filled_at = NOW(), tp1_filled_qty = $2, tp1_realized_pnl_usd = $3
   WHERE id = $4 AND tp1_filled_at IS NULL`,
  [pos.size, fill.filledQty, fill.realizedPnl, pos.dbTradeId],
);
if (res.rowCount === 0) {
  log.debug('TP1 fill lost race — DB already updated by another writer', {
    symbol: pos.symbol, account: pos.account.keyName, dbTradeId: pos.dbTradeId,
  });
  return {
    symbol: pos.symbol,
    account: accountLabel,
    action: 'TP1-FILL-NOOP',
    reason: 'already processed',
  };
}
```

- `WHERE id = $4 AND tp1_filled_at IS NULL` retained (line 166).
- `res.rowCount === 0` → early return with `'TP1-FILL-NOOP'` action.
- `tp1Groups.push` (line 200), `log.info('TP1 fill processed', ...)` (line 202), and the success return at line 210 are all unreachable on lost-race path.
- Only the `debug` log fires on noop — no Telegram, no group push. Acceptance #10 holds.
- `action: string` on `RecoveryAction` (line 48) accepts the new `'TP1-FILL-NOOP'` literal without type changes. ✓

### I2. `autoCloseTrade` UPDATE `AND status='open'` → resolved

`src/runtime/trade-closer.ts:110-120` and return type `Promise<CloseEvent | null>` at line 82:

```ts
const res = await query(
  `UPDATE trades SET status = 'closed',
     exit_price = $1, closed_at = to_timestamp($2 / 1000.0),
     realized_r = $3, pnl_usd = $4, exit_reason = $5
   WHERE id = $6 AND status = 'open'`,
  [wAvgExit, lastTs, pnlR, totalPnl, exitReason, t.id],
);
if (res.rowCount === 0) {
  log.info('autoCloseTrade lost race — already closed', { id: t.id, symbol: t.symbol });
  return null;
}
```

- `AND status = 'open'` added (line 114).
- `rowCount === 0` → `return null` before the `'auto-closed trade'` log and `CloseEvent` construction. No duplicate consolidated-close Telegram on a lost race.
- Caller audit:
  - `src/runtime/account-monitor.ts:339` — `const evt = await autoCloseTrade(t, fills); if (evt) await notifyConsolidatedCloses([evt]);` — null-safe.
  - `src/runtime/reconcile.ts:209` — `const evt = await autoCloseTrade(t, fills); if (evt) { closeEvents.push(evt); ... continue; }` — null-safe; orphan cancel + `continue` only fire on winning race.
- Function signature was already `CloseEvent | null` (line 82 comment shows pre-existing nullable return for partial-close path), so caller checks already handled null. No call-site changes needed. ✓

### I3. `nakedTpRecovery` wire-up in daemon → resolved

`src/runtime/account-monitor.ts:41` import + `:275-299` invocation:

```ts
import { nakedTpRecovery } from './naked-tp-recovery';
// ...
if (size > 0 && stopLoss > 0 && !pos.tp1AlreadyFilled) {
  const state = this.state.get(symbol);
  const tpRecoveryLast = state?.lastTpRecoveryTs ?? 0;
  if (Date.now() - tpRecoveryLast > 5 * 60_000) {
    try {
      const recovered = await nakedTpRecovery.check(pos, getRest(this.account));
      if (recovered) {
        log.info('daemon naked-TP recovery', { ... });
        if (state) {
          state.lastTpRecoveryTs = Date.now();
          this.state.set(symbol, state);
        }
      }
    } catch (err: any) {
      log.warn('daemon naked-TP check failed', { ... });
    }
  }
}
```

- Import line 41: `import { nakedTpRecovery } from './naked-tp-recovery';` ✓
- Gating predicate `size > 0 && stopLoss > 0 && !pos.tp1AlreadyFilled` matches the iter-1 fix recipe verbatim. ✓
- Throttle via `state?.lastTpRecoveryTs ?? 0` + `Date.now() - last > 5 * 60_000` (1×/5min/symbol). ✓
- Sits in `onPosition` **after** dust (line 256), DCA (line 265), and TP1-partial (line 270) branches per the recipe — early `return` from any of those preserves their semantics and skips recovery in the same push, which is correct (TP1-partial implies a TP exists). ✓
- `SymbolState` extended with `lastTpRecoveryTs?: number` (line 58). ✓
- `try/catch` wraps the `check()` call; failures log `warn` rather than crashing the dispatcher chain.
- Note: `nakedTpRecovery.check` itself already swallows internal errors and short-circuits when the position has ≥1 reduce-only Limit, so the throttle is the only behaviour change vs cron path. ✓

### I4. `inflight` Map per-symbol serialization → resolved (root cause)

`src/runtime/account-monitor.ts:95, 105, 111-119, 396, 407`:

```ts
private readonly inflight = new Map<string, Promise<void>>();
// ...
this.ws.on('position', (e) => this.dispatchPosition(e));
// ...
private dispatchPosition(e: PositionUpdate): Promise<void> {
  const sym = e.data.symbol;
  const prev = this.inflight.get(sym) ?? Promise.resolve();
  const next = prev.then(() => this.onPosition(e)).catch((err: any) => {
    log.warn('onPosition crashed', { sym, err: err?.message });
  });
  this.inflight.set(sym, next);
  return next;
}
```

- Map declared on the class (line 95). ✓
- WS subscription replaced from `(e) => { void this.onPosition(e); }` (the iter-1 fire-and-forget) → `(e) => this.dispatchPosition(e)`. ✓
- `restResync` (line 396 — new arrivals) and the synthetic close-event branch (line 407 — symbols dropped from `seenSymbols`) **both** now route through `dispatchPosition` instead of `await this.onPosition(...)`. This was the critical hand-off; without it the WS↔REST race remained. ✓
- `catch` logs via `log.warn` and does not rethrow, so a failed handler does not poison subsequent symbol events. ✓
- Per-symbol serialization makes the line-196 seq guard (`prev.lastSeq >= p.seq`) and the line-217 5s `lastFullCloseTs` throttle meaningful — `prev = this.state.get(symbol)` is read fresh at the start of each `onPosition`, with no concurrent writer.
- Memory: `inflight` is keyed by symbol; bounded by universe (≤ 11 pairs/account). Replacing entries via `set` lets older resolved promises GC. No leak. ✓
- The listener signature is `(e: PositionUpdate) => void`; `dispatchPosition` returns `Promise<void>` but TS contravariant return-types permit it and `tsc --noEmit` is clean. EventEmitter ignores the returned value — the daemon owns the promise via `inflight` for chaining. ✓

## New Important findings (if any)

None. Cross-checks performed:

- `dispatchPosition` does not deadlock: each `next = prev.then(() => onPosition(e))` is chained but each `onPosition` runs to completion (no waiting on the next event); the chain is linear, not self-referential.
- `inflight` Map cannot grow unbounded: keyed by symbol, capped by Bybit-side universe.
- `nakedTpRecovery.check` invocation cannot race with the cron `position-watcher` shim because both share the same DB write idempotency now via I1+I2; and the in-strategy guard inside `naked-tp-recovery.ts` (counts existing reduce-only Limits before placing) makes double-placement a no-op.
- New `'TP1-FILL-NOOP'` action string does not collide with consumers — `position-watcher.ts:130` consumes the returned action only for `log.info('TP1 action', ...)` and does not branch on the value.
- 3 files touched per `git show c820062 --stat`: `account-monitor.ts`, `position-events.ts`, `trade-closer.ts`. No other files in the commit. ✓
- `scripts/cycle.sh` untouched, operator owns overlap migration. ✓
- Operator WIP (deleted `src/backtest/*` files, `M board/index.json`) intact in `git status -s`. ✓

## Approval criteria summary

- [x] All 4 iter-1 Important resolved (I1, I2, I3, I4 verified with code citations above)
- [x] No new Important introduced
- [x] Typecheck clean (`npx tsc --noEmit` → 0 bytes stderr)
- [x] 3 files touched, operator WIP intact

Hand off to tester (testing acceptance #2 latency, #5 reconnect REST resync, #9/#10 dedup under WS+REST race per the manual testnet steps the analysis.md lays out).

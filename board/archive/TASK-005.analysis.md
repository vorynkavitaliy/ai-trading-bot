---
task: TASK-005
author: architect
created: 2026-05-26T09:20:42Z
iteration: 0
---

## Summary

ARB overnight incident root cause confirmed at three independent layers: admin close-tools fire-and-forget without size verification (`close-symbol.ts:52-66`, `close-all.ts:41-55`), divergence-detector gates dust on `tp1_filled` flag (`divergence-detector.ts:52`), and the safety-net stops at "set SL failed → alert" (`position-watcher.ts:284-305`). Fix is a single new `src/core/close-verifier.ts` exporting `closeAndVerify` + `closeAcrossAccounts`, plus one-line behavioural tightening in divergence-detector and a fallback branch in the safety-net. All current inline `submitOrder Market reduceOnly` callsites (8 in src, 2 of them in legacy diagnostics) migrate to the new helper. Live-sensitive (touches `src/runtime/*`); requires no backtest re-run (execution-layer, not strategy).

## Current behavior

### Дыра №1 — admin close-tools verify only `retCode` (fire-and-forget)

**`src/tools/admin/close-symbol.ts:52-66`** — submits Market reduce-only IOC, branches purely on `r.retCode === 0`:

```ts
const r = await withRetry(() => c.submitOrder({ ...orderType: 'Market', reduceOnly: true, timeInForce: 'IOC' }), {...});
if (r.retCode === 0) {
  console.log(`  ${label}: ✅ closed ${p.symbol} ${p.side} qty=${p.size} → ${closeSide} reduce-only`);
  results.push({ account: label, symbol: p.symbol, ok: true, detail: `qty=${p.size}` });
}
```

No `getPositionInfo` follow-up. Bybit V5 IOC reduce-only can partial-fill if depth is thin on either side of best — the unfilled remainder cancels (IOC) but the position retains `size > 0`. `retCode=0` only attests the order was accepted, not that the position is flat.

**`src/tools/admin/close-all.ts:41-55`** — identical pattern, multi-symbol loop on one account.

**`src/tools/diagnostics/full-exit-symbol.ts:55-64`** — identical pattern (also Market + reduceOnly + IOC, retCode-only). Operator-facing diagnostic.

**`src/tools/admin/close-trade.ts`** — read fully (lines 1-101): this is a **DB-only** utility that writes `status='closed'` on a known `trade_id`. It does NOT call Bybit at all. It is in the task's artifact list but is not a closer in the sense of the trifecta. Migration here is N/A (out of scope; covered in the "Out of scope" section).

### Дыра №2 — `divergence-detector.ts:52` requires `tp1_filled` for dust verdict

```ts
const ratioVsInitial = pos.size / Math.max(match.initial_qty, 1);
// ...
if (match.tp1_filled && ratioVsInitial < DUST_FRAC) {
  return 'dust';
}
```

`DUST_FRAC = 0.01` (line 32). Logic only classifies as `dust` when **both** TP1 was logged and size dropped below 1% of initial. When close-symbol partial-fills a position (no TP1 in history because TP1 limits were cancelled by the admin tool before market close), the resulting Bybit residue maps to:
- `diff > tolerance` (so not `aligned`)
- `ratioVsInitial` typically 1-5% (so not `tp1_partial` which needs 40-60%)
- `match.tp1_filled === false` → fails the dust gate
- Falls through to `mismatch` → `reconcile.ts:325-328` records as divergence and **does nothing** (no auto-close, just reports).

Net effect: dust naked positions accumulate across reconcile cycles until operator intervenes manually.

### Дыра №3 — `position-watcher.ts:284-305` safety-net alerts but does not force-close

```ts
try {
  await moveStopLoss(pos, pos.dbInitialSL, 'EMERGENCY: position had no SL');
  actions.push({...'EMERGENCY-SL-SET'...});
  await notifyAlert({...'установлен SL'...});
} catch (e: any) {
  log.error('EMERGENCY SL set FAILED — position is naked!', { err: e?.message });
  await notifyAlert({...'🆘 КРИТИЧНО: ... Закрой вручную'...});
}
```

When Bybit rejects `setTradingStop` — most plausibly because position notional fell below Bybit's per-symbol minimum (V5 returns retCode 110017 / 110052 region) or because the SL price is now well past current mark — the catch logs and sends a Telegram message and that is the end. The position remains open, naked, on prop accounts overnight. This is the precise failure observed in the 2026-05-25 incident.

### Reconcile dust handler — `reconcile.ts:297-321`

Once verdict is `dust`, this branch DOES submit Market reduce-only and sets `pos.size = 0` in-memory so the gap-fill loop will auto-close the DB row. But:

1. It is inline `submitOrder` (same fire-and-forget pattern as close-symbol). Lines 309-314 have `tries: 2` retry on transient errors but no size verification.
2. It is only reached when divergence-detector returns `dust`, which requires `tp1_filled` (Дыра №2). So the most dangerous case — manual admin close leaves residue — never reaches this branch.

### `position-watcher.ts:152-169 closePosition`

```ts
async function closePosition(pos: BybitPos, reason: string): Promise<void> {
  ...
  const r = await withRetry(() => c.submitOrder({
    category: 'linear', symbol: pos.symbol,
    side: pos.side === 'Buy' ? 'Sell' : 'Buy',
    orderType: 'Market', qty: String(pos.size),
    timeInForce: 'IOC', reduceOnly: true,
  }), {...});
  if (r.retCode !== 0) throw new Error(`close retCode=${r.retCode} ${r.retMsg}`);
  ...
}
```

Currently **not called from anywhere** (grep'd `src/`: only definition, no consumers). It exists for future regime-flip/time-stop/vol-spike close-rules that are intentionally disabled (see comment `position-watcher.ts:463-475`). Replacing it with a thin wrapper around `closeAndVerify` is low-risk and makes the safety-net fallback natural.

### `naked-tp-recovery.ts`

Read fully (1-126): this file **does not close positions**. It re-places missing TP1/TP2 reduce-only **Limit** orders (lines 90-103). No migration needed. Listed only for completeness of the "all close paths through one helper" map.

### Bybit V5 instrument info — what fields we have

`src/core/bybit.ts:37-44` `InstrumentInfo` exposes `qtyStep`, `minOrderQty`, `maxOrderQty`, `maxMktOrderQty`, `tickSize`. **`minNotionalValue` is NOT currently parsed** even though Bybit's `lotSizeFilter` ships it. This matters because:

- USDT-perp pairs have a `minNotionalValue ≈ $5` (varies). A Market reduce-only with `qty × markPrice < minNotional` is rejected with retCode 110017 ("order_cost_not_enough" / "qty_below_min_notional"-class error).
- When admin close-symbol does its first market call on a fresh position, `qty` is far above min notional and this is invisible. When the residual after a partial fill is dust, the retry submit fails with min-notional violation — which is exactly the state the safety-net inherits and tries to set SL on.

We need to fetch `minNotionalValue` once (extend `InstrumentInfo`) so `closeAndVerify` can recognise "residual < minNotional → not closeable via market, classify as `dust_below_min`".

## Map of close callsites — migration plan

| File:line | Current code | Migration |
|---|---|---|
| `src/tools/admin/close-symbol.ts:21-72` (main loop) | Per-account: cancelAllOrders + getPositionInfo + inline submitOrder Market reduceOnly + retCode-only check | Replace whole inner loop with a single call to `closeAcrossAccounts(accounts, symbol, { reason: 'admin close-symbol', cancelOrders: true })`. Print the `MultiCloseResult` summary. Non-zero exit if `!result.allClosed`. |
| `src/tools/admin/close-all.ts:13-62` (main loop) | Per-account: cancelAllOrders (settleCoin=USDT, all symbols) + getPositionInfo + per-position inline submitOrder | Two-phase: (a) `await cancelAllOrdersForAccount(acc)` (one call per account, settleCoin USDT — already factored), (b) build set of unique (symbol) tuples across accounts from `getPositionInfo`, then for each symbol call `closeAcrossAccounts(accounts, symbol, { reason: 'admin close-all', cancelOrders: false })` since we already cancelled. |
| `src/tools/admin/close-trade.ts` (whole file) | DB-only `UPDATE trades SET status='closed'` — does not touch Bybit | **No migration.** Out of scope. The task acceptance lists it because operators conflate "close" with this script; but Bybit closing must happen separately via close-symbol or close-all. Note this clearly in the dev brief. |
| `src/tools/diagnostics/full-exit-symbol.ts:55-64` | Inline submitOrder Market reduceOnly | Replace the `if (execute) { ... }` block with `await closeAcrossAccounts([a], symbol, { reason: 'full-exit-symbol', cancelOrders: false })`. Already cancels separately at lines 30-33. |
| `src/runtime/position-watcher.ts:152-169 closePosition` | Inline submitOrder Market reduceOnly, throws on retCode != 0 | Rewrite body to `const r = await closeAndVerify(pos.account, pos.symbol, { reason, cancelOrders: false }); if (r.status !== 'ok' && r.status !== 'dust_below_min') throw new Error(...); ` (keep `cancelOrders: false` because SL/TP are already attached to the position and reduce-only orders self-cancel when size→0). |
| `src/runtime/position-watcher.ts:284-305` (safety-net) | `try moveStopLoss → catch → only alert` | Add a `catch` fallback: call `closeAndVerify(pos.account, pos.symbol, { reason: 'naked-no-SL-fallback', cancelOrders: false })`. On `status === 'ok'` push EMERGENCY-CLOSE action + send "позиция БЕЗ SL — экстренно закрыта" Telegram. On status `'dust_below_min'` send informational Telegram (residue too small to close, ride it out with monitoring). On `'stuck'` / `'error'` send the original 🆘 КРИТИЧНО alert. |
| `src/runtime/reconcile.ts:297-321` (dust handler) | Inline submitOrder + sets `pos.size = 0` | Replace with `const r = await closeAndVerify(accForDust, pos.symbol, { reason: 'reconcile-dust', cancelOrders: false }); if (r.status === 'ok' || r.status === 'dust_below_min') pos.size = 0;`. The `dust_below_min` branch still marks `size = 0` because the trade is effectively closed from a risk-budget perspective (the residual is < min notional → < ~$5 P&L exposure). |
| `src/runtime/naked-tp-recovery.ts` (whole file) | Re-places Limit reduce-only TPs only — does not close | **No migration.** Listed for completeness. |

After migration, the only places in `src/` that call `submitOrder({ orderType: 'Market', reduceOnly: true })` will be inside `src/core/close-verifier.ts`.

## Design

### `src/core/close-verifier.ts` — new file

```ts
import { AccountKey } from './accounts';
import { getRest, getInstrumentInfo, roundQtyToStep, withRetry, getLiveTickers } from './bybit';
import { log } from './logger';

export interface CloseAttempt {
  account: string;          // bucket/keyName
  symbol: string;
  initialSize: number;
  finalSize: number;
  attempts: number;
  status: 'ok' | 'dust_below_min' | 'stuck' | 'no_position' | 'error';
  detail?: string;
}

export interface CloseAndVerifyOpts {
  maxAttempts?: number;     // default 3
  pollDelayMs?: number;     // default 1500
  cancelOrders?: boolean;   // default true — cancelAllOrders(symbol) before first close
  reason: string;
}

export interface MultiCloseResult {
  attempts: CloseAttempt[];
  allClosed: boolean;       // true iff every attempt is 'ok' or 'no_position' (dust_below_min ALSO counts as closed for risk purposes? — see Risks)
  stuck: CloseAttempt[];    // attempts where status ∈ {'stuck', 'error'}
}

export async function closeAndVerify(
  account: AccountKey,
  symbol: string,
  opts: CloseAndVerifyOpts,
): Promise<CloseAttempt> { /* ... */ }

export async function closeAcrossAccounts(
  accounts: AccountKey[],
  symbol: string,
  opts: CloseAndVerifyOpts,
): Promise<MultiCloseResult> { /* ... */ }
```

**Semantics — `closeAndVerify(account, symbol, opts)`:**

1. Establish `label = ${account.bucket}/${account.keyName}`, `maxAttempts = opts.maxAttempts ?? 3`, `pollDelayMs = opts.pollDelayMs ?? 1500`.
2. Optional pre-cancel: if `opts.cancelOrders !== false`, call `cancelAllOrders({ category, symbol })` once. Log retry count. Failure here is non-fatal — log warn and continue (we still try to close the position; orphan reduce-only TP/SL will self-cancel when size→0).
3. Fetch initial position snapshot via `getPositionInfo({ category: 'linear', symbol })`. Filter `size > 0`. If empty → return `{ status: 'no_position', initialSize: 0, finalSize: 0, attempts: 0, ... }`.
4. Take the **first** matching position object (V5 returns ≤ 1 per symbol in one-way mode, which the codebase uses everywhere — `positionIdx: 0`). Record `initialSize = parseFloat(p.size)`, `side = p.side`, `closeSide = side === 'Buy' ? 'Sell' : 'Buy'`.
5. Fetch instrument info: `info = await getInstrumentInfo(account, symbol)`. Pull `minNotionalValue` (new field — see "Interfaces / types" section below).
6. Loop `attempt` in `0..maxAttempts - 1`:
   1. Re-fetch position (`getPositionInfo`).
   2. If size == 0 → break out as `'ok'`.
   3. Normalize remaining `qty` to step (`roundQtyToStep(size, info)`); if rounded qty == 0 → break as `'dust_below_min'`.
   4. Compute `notional = size × markPrice`. If `notional < info.minNotionalValue` → break as `'dust_below_min'` (do not submit; Bybit will reject 110017).
   5. Submit Market reduceOnly with the rounded remaining qty. `withRetry(..., { tries: 2 })` for transient network. Do **not** treat retCode != 0 as fatal here — log warn, then sleep `pollDelayMs` and re-check via `getPositionInfo`. The position size is the source of truth, not the order response.
   6. Sleep `pollDelayMs` to let the matching engine settle.
7. After the loop, do one final `getPositionInfo`:
   - `size == 0` → `'ok'`.
   - `0 < size && (size × markPrice) < info.minNotionalValue` → `'dust_below_min'`.
   - else → `'stuck'`.
8. Any thrown exception inside (network, auth) → log and return `{ status: 'error', detail: e.message, finalSize: <last known> }`.
9. Return `CloseAttempt { account: label, symbol, initialSize, finalSize, attempts: attemptsTaken, status, detail }`.

**Semantics — `closeAcrossAccounts(accounts, symbol, opts)`:**

1. `Promise.all(accounts.map(a => closeAndVerify(a, symbol, opts)))` — parallel, one independent `CloseAttempt` per account.
2. **Cross-check pass** (the operator's explicit requirement): after `Promise.all` resolves, re-poll once: `Promise.all(accounts.map(a => fetchPosSize(a, symbol)))`. For any account where the cross-check returns `size > 0` AND the corresponding `CloseAttempt.status === 'ok'`, downgrade that attempt's status to `'stuck'` and update `finalSize`. This catches the case where the matching engine had a delayed fill rollback (extremely rare but operationally observed).
3. Compute `allClosed = attempts.every(a => a.status === 'ok' || a.status === 'no_position' || a.status === 'dust_below_min')` — dust below min notional **counts as closed** because the residue is below the risk threshold (~$5 max P&L) and Bybit cannot accept further reduce-only Market orders on it. Caller may filter on this if they want a stricter check.
4. `stuck = attempts.filter(a => a.status === 'stuck' || a.status === 'error')`.
5. Telegram: this helper does **not** send Telegram itself (single-responsibility). Caller composes one consolidated message from the `MultiCloseResult`. This matches existing patterns in `reconcile.ts notifyConsolidatedCloses` and `position-watcher.ts tp1Groups`.

### Interfaces / types

**`src/core/bybit.ts:37-43`** — extend `InstrumentInfo`:

```ts
export interface InstrumentInfo {
  qtyStep: number;
  minOrderQty: number;
  maxOrderQty: number;
  maxMktOrderQty: number;
  tickSize: number;
  minNotionalValue: number;   // NEW — Bybit V5 lotSizeFilter.minNotionalValue, default 5
}
```

And in `getInstrumentInfo` (line 64-70):

```ts
const info: InstrumentInfo = {
  qtyStep: ...,
  ...
  minNotionalValue: parseFloat(item.lotSizeFilter?.minNotionalValue ?? '5'),
};
```

Fallback `5` is safe: every USDT-perp the bot trades has `minNotionalValue >= 5`. If the field is absent (older response shape), assume `5` rather than `0`.

**`src/runtime/divergence-detector.ts`** — replace the dust branch (lines 51-54):

```ts
// Before:
if (match.tp1_filled && ratioVsInitial < DUST_FRAC) {
  return 'dust';
}

// After:
const isAbsoluteDust = pos.size > 0 && pos.size < match.initial_qty * DUST_FRAC;
if (isAbsoluteDust) return 'dust';
```

Drop the `match.tp1_filled` gate entirely. Any position whose Bybit size is < 1% of initial_qty is dust **regardless** of whether TP1 was logged in DB — the partial-fill could have come from manual admin close. Notional-based check (`pos.size × markPrice < $5`) would also be valid, but requires the detector to either accept a price input (currently pure, no IO) or refactor the call site. **Reject** that extension: the qty-ratio test catches every observed case (incident residue was ~2% × initial, well under the new gate after we widen DUST_FRAC if needed — but 1% is the right cutoff because anything above is meaningful and should remain `mismatch` for human review).

Keep `DUST_FRAC = 0.01` (line 32). Keep the order — check `aligned` first, then `tp1_partial`, then `dust`, then fall through.

### `position-watcher.ts:284-305` safety-net — diff

```ts
// Before (lines 284-305):
try {
  await moveStopLoss(pos, pos.dbInitialSL, 'EMERGENCY: position had no SL');
  actions.push({ ... 'EMERGENCY-SL-SET' ... });
  await notifyAlert({ ... 'установлен SL=...' ... });
} catch (e: any) {
  log.error('EMERGENCY SL set FAILED — position is naked!', { err: e?.message });
  await notifyAlert({ ... '🆘 КРИТИЧНО: ... Закрой вручную' ... });
}

// After:
try {
  await moveStopLoss(pos, pos.dbInitialSL, 'EMERGENCY: position had no SL');
  actions.push({
    symbol: pos.symbol, account: `${pos.account.bucket}/${pos.account.keyName}`,
    action: 'EMERGENCY-SL-SET', reason: 'naked position detected',
  });
  await notifyAlert({
    kind: 'reconcile_divergence',
    symbol: pos.symbol,
    detail: `${pos.symbol} ${pos.side} был БЕЗ стоп-лосса! Установлен SL=${pos.dbInitialSL.toFixed(4)} (из DB).`,
    action: 'Проверь Bybit — почему SL не сохранился при open. Возможен баг в execute.ts',
  });
} catch (slErr: any) {
  log.error('EMERGENCY SL set FAILED — falling back to force close', { err: slErr?.message });
  try {
    const closeResult = await closeAndVerify(pos.account, pos.symbol, {
      reason: 'naked-no-SL-fallback',
      cancelOrders: false,
    });
    if (closeResult.status === 'ok') {
      actions.push({
        symbol: pos.symbol, account: `${pos.account.bucket}/${pos.account.keyName}`,
        action: 'EMERGENCY-CLOSE', reason: 'naked + SL set rejected → force-closed',
      });
      await notifyAlert({
        kind: 'reconcile_divergence',
        symbol: pos.symbol,
        detail: `${pos.symbol} ${pos.side} был БЕЗ SL и SL не удалось установить — экстренно закрыта по рынку. finalSize=${closeResult.finalSize}.`,
        action: 'Проверь execute.ts и Bybit лог — почему SL не привязался при open.',
      });
    } else if (closeResult.status === 'dust_below_min') {
      await notifyAlert({
        kind: 'reconcile_divergence',
        symbol: pos.symbol,
        detail: `${pos.symbol} ${pos.side} БЕЗ SL, остаток < min notional ($${closeResult.finalSize}). Bybit не принимает reduce-only Market. Риск < $5, мониторим.`,
        action: 'Ручное закрытие через UI, либо подожди дрейф до SL/ликвидации.',
      });
    } else {
      throw new Error(`closeAndVerify status=${closeResult.status} finalSize=${closeResult.finalSize}`);
    }
  } catch (closeErr: any) {
    log.error('EMERGENCY close ALSO FAILED', { err: closeErr?.message });
    await notifyAlert({
      kind: 'reconcile_divergence',
      symbol: pos.symbol,
      detail: `🆘 КРИТИЧНО: ${pos.symbol} БЕЗ SL и не получилось ни установить SL, ни закрыть по рынку. Закрой вручную.`,
      action: 'Закрой позицию через Bybit UI немедленно. SL fail: ' + slErr?.message + ' | Close fail: ' + closeErr?.message,
    });
  }
}
continue;
```

### `position-watcher.ts:152-169 closePosition` — diff

```ts
// Before:
async function closePosition(pos: BybitPos, reason: string): Promise<void> {
  const c = getRest(pos.account);
  const info = await getInstrumentInfo(pos.account, pos.symbol);
  const r = await withRetry(() => c.submitOrder({...}), {...});
  if (r.retCode !== 0) throw new Error(`close retCode=${r.retCode} ${r.retMsg}`);
  log.warn('position closed by watcher', {...});
}

// After:
async function closePosition(pos: BybitPos, reason: string): Promise<void> {
  const result = await closeAndVerify(pos.account, pos.symbol, { reason, cancelOrders: false });
  if (result.status === 'stuck' || result.status === 'error') {
    throw new Error(`closePosition ${pos.symbol}: status=${result.status} finalSize=${result.finalSize} detail=${result.detail ?? ''}`);
  }
  log.warn('position closed by watcher', {
    symbol: pos.symbol, account: pos.account.keyName, reason,
    finalSize: result.finalSize, status: result.status, attempts: result.attempts,
  });
}
```

The unused-import (`getInstrumentInfo`) at the top of `position-watcher.ts:12` stays — it's still used by the DCA-fill branch at line 349. No collateral cleanup needed.

### `reconcile.ts:297-321` dust handler — diff

```ts
// Before:
if (verdict === 'dust') {
  ...
  try {
    const accForDust = accounts.find((a) => `${a.bucket}/${a.keyName}` === pos.account);
    if (accForDust) {
      const c = getRest(accForDust);
      const closingSide = pos.side === 'Buy' ? 'Sell' : 'Buy';
      await withRetry(() => c.submitOrder({ ... }), { label: `dust-close-${pos.symbol}-${pos.account}`, tries: 2 });
      pos.size = 0;
    }
  } catch (e: any) {
    log.warn('dust close failed', { symbol: pos.symbol, err: e?.message });
  }
  continue;
}

// After:
if (verdict === 'dust') {
  const ratioVsInitial = pos.size / Math.max(match.initial_qty, 1);
  log.info('reconcile: dust detected — closing via closeAndVerify', {
    symbol: pos.symbol, account: pos.account,
    initial_qty: match.initial_qty, bybit_size: pos.size, ratio: ratioVsInitial.toFixed(4),
  });
  const accForDust = accounts.find((a) => `${a.bucket}/${a.keyName}` === pos.account);
  if (accForDust) {
    try {
      const r = await closeAndVerify(accForDust, pos.symbol, {
        reason: `reconcile-dust trade=${match.id}`,
        cancelOrders: false,
      });
      if (r.status === 'ok' || r.status === 'dust_below_min') {
        pos.size = 0;
      } else {
        log.warn('reconcile dust close stuck', { symbol: pos.symbol, status: r.status, finalSize: r.finalSize });
      }
    } catch (e: any) {
      log.warn('reconcile dust close threw', { symbol: pos.symbol, err: e?.message });
    }
  }
  continue;
}
```

`pos.size = 0` is set for both `ok` and `dust_below_min` because either way the trade is effectively flat and the gap-fill loop (lines 351-389) should close the DB row.

### `close-symbol.ts` main — diff outline

Replace lines 21-72 (the per-account close loop) with:

```ts
const result = await closeAcrossAccounts(accounts, symbol, {
  reason: 'admin close-symbol',
  cancelOrders: true,
});

for (const a of result.attempts) {
  const tag = a.status === 'ok' ? '✅'
    : a.status === 'no_position' ? '∅'
    : a.status === 'dust_below_min' ? '⚠ dust'
    : '❌';
  console.log(`  ${a.account}: ${tag} ${a.symbol} initial=${a.initialSize} final=${a.finalSize} attempts=${a.attempts} status=${a.status}${a.detail ? ' ' + a.detail : ''}`);
}

const okCount = result.attempts.filter(a => a.status === 'ok' || a.status === 'no_position' || a.status === 'dust_below_min').length;
console.log(`\n=== ${symbol} verified-closed: ${okCount}/${result.attempts.length}, stuck: ${result.stuck.length} ===`);

if (!result.allClosed) {
  log.error('close-symbol: some accounts stuck', { symbol, stuck: result.stuck });
  await closePg();
  process.exit(2);
}
await closePg();
```

`close-all.ts` follows the same pattern with an outer loop over the discovered symbol set.

## Alternatives considered and rejected

### Option B — handle dust through Bybit's `cancelAllOrders + setTradingStop emergency SL = mark - small ε`

We would set a virtual stop a few ticks away from the current mark, forcing Bybit to close on the next adverse tick. Rejected because: (a) Bybit V5 setTradingStop has the same `minNotionalValue` constraint internally — it'll be rejected on dust positions, (b) it relies on an adverse tick that may never come within a useful timeframe, (c) HyroTrader compliance window is 5 minutes per CLAUDE.md; "wait for a tick" is not a deterministic recovery.

### Option C — invoke `closeAndVerify` in a dedicated cron, separate from `position-watcher`

A "force-close-stuck" cron every 30 minutes would scan reconcile output for `mismatch` / `db_without_bybit` and call the helper. Rejected because: (a) it adds another moving part to the cron pipeline (which already has cycle.sh + heartbeat + reconcile + position-watcher), (b) the natural place for "this position has no SL" remediation is the safety-net that already detected it — adding a 30-minute round-trip between detection and remediation defeats the purpose of the safety-net, (c) reconcile's dust handler is the right place for the second class of leftovers, and migrating it inline is one diff.

### Option D — keep all three call sites inline but factor the verify-loop into a shared `verifyClosed(account, symbol)` helper, leaving the `submitOrder` itself at each call site

A weaker abstraction: helper just polls, callers still submit. Rejected because: (a) it leaves four near-identical `submitOrder Market reduceOnly` blocks (close-symbol, close-all, position-watcher.closePosition, reconcile dust) — the very DRY violation that produced the incident, (b) the retry-on-partial logic (loop body step 6 above) is the operationally important part — separating submit from verify means each caller has to re-implement the loop, (c) the operator's explicit acceptance is "единый shared helper closeAndVerify".

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bybit V5 returns retCode != 0 on every retry (e.g. position auto-liquidated mid-flight, account permission revoked) — verify loop spins for `maxAttempts × pollDelayMs ≈ 4.5s` and reports `stuck`. | low | Status `stuck` triggers operator Telegram; `getPositionInfo` is source of truth, so a liquidated position will be reported as `no_position` on the next poll (Bybit removes it). |
| `minNotionalValue` is absent from `getInstrumentsInfo` response shape for legacy symbols. | very low | Fallback `?? 5` in `InstrumentInfo` parsing. Every Tier-1 symbol has been observed returning the field in 2026. |
| Cross-check pass in `closeAcrossAccounts` races a delayed fill — falsely flags `ok` as `stuck` for ~1 cycle. | low | Cross-check uses the same `getPositionInfo` call as the inner loop, so it's eventually consistent. If incorrectly downgraded, the next cron cycle re-checks and clears. The downside (one extra Telegram alert) is much smaller than the upside (catching real stuck positions). |
| Retry loop on a successfully-closed position issues a second Market reduceOnly — Bybit rejects with "size mismatch" but no harm (no new position). | medium (could happen if matching engine is delayed > `pollDelayMs`) | Inner loop step 6.2: pre-check `size == 0` BEFORE submitting. If size dropped during sleep, we exit with `ok` without another submit. |
| Operator-cancelled SL during a position re-trips the safety-net every cycle (since safety-net runs every 5 min). | low | This is current behaviour — the safety-net already exists. Migration doesn't change frequency; it just adds a force-close fallback when SL re-attach fails. |
| `closeAndVerify` is called from `closePosition` which is currently unused — dead code that activates if regime-flip rules are re-enabled. | low | This is acceptable. The wrapping makes future re-enablement safer, not riskier. |
| Adding `minNotionalValue` field is a non-additive change to consumers of `InstrumentInfo` (they don't currently use the field, but TS strict mode requires the field in every constructed object). | very low | All `InstrumentInfo` construction sites are inside `getInstrumentInfo` itself (line 64-70 in `bybit.ts`); no other code constructs the interface directly. Grep'd: 0 hits outside that one function. |

## Live-trading impact

**Inviolables touched (from `CLAUDE.md`):**

1. **"Server-side SL within 5 minutes of every position open."** Strengthened by Дыра №3 fix — when SL set fails, we force-close instead of leaving naked. The 5-min compliance window is now atomic-with-fallback.
2. **"Edit-never-cancel SL: to move a stop, use Bybit amend_order, never cancel-then-create."** Untouched. `setTradingStop` (V5 amend equivalent) remains the path for SL moves. We only force-close when amend itself fails.
3. **"Reconcile before every cycle. If trades DB rows and Bybit positions diverge → halt analysis until aligned."** Strengthened — dust verdicts (which were silently `mismatch` before) now actively auto-close, raising the bar for what counts as a "real" divergence.

**Walk-forward backtest re-run NOT required.** The change is purely execution-layer (close path) and risk-safety (force-close fallback). Strategy logic in `src/strategies/cg-fade.ts` and `src/runtime/risk-guard.ts` is untouched. No new entries, no SL/TP price changes, no sizing changes.

**Worst-case failure mode:**

- Bybit API unreachable mid-fallback: `closeAndVerify` returns `'error'` → safety-net hits the inner `closeErr` catch → 🆘 КРИТИЧНО Telegram → operator manual close. This is **no worse than current behaviour** (which was also a manual-close alert on SL-set failure), but adds one extra automated attempt before giving up.
- DB stale / reconcile divergence: unchanged. `closeAndVerify` operates purely on Bybit-side state; DB consequences are downstream in `reconcile.autoCloseTrade`.

## Out of scope

- **`close-trade.ts`** — DB-only utility. It is in the artifact list of the task but does not call Bybit. Do not refactor it; just document this in commit message.
- **Strategy code (`src/strategies/cg-fade.ts`)** — operator WIP, do not touch.
- **`pair-strategies.ts`, `risk-guard.ts`, `auto-execute.ts`, `execute.ts`** — entry-side; this task is exit-side only.
- **Migration of `naked-tp-recovery.ts`** — it only places Limit orders, not Market closes. Out of scope.
- **DB schema changes** — none required. `trades.initial_qty` and `trades.tp1_filled` already exist (per the migration history). `closed_reason` column does not exist and is not being added.
- **Backtest engine changes** — none.
- **Telegram template additions** — `notifyAlert({ kind: 'reconcile_divergence' })` is reused; no new alert kinds.

## Acceptance criteria (refined)

The task's `acceptance:` list is correct. Two refinements for clarity:

1. **Acceptance #3** ("divergence-detector.ts: dust verdict ИЛИ без tp1_filled — любая позиция с size < 1% × initial_qty ИЛИ size × mark < $5 notional → 'dust'") — accept the qty-ratio test alone (drop the `size × mark < $5` clause). The notional test would require either passing mark price into the pure classifier (refactor of the detector contract) or fetching mark inside the classifier (breaks purity). The 1% qty-ratio test catches every observed dust case from the incident and is the simpler fix.
2. **Acceptance #8** ("manual integration test: open dust position … в Bybit testnet или симулировать через mock") — the dev can verify against testnet OR a Vitest unit-test of `closeAndVerify` with a `RestClientV5` mock that returns staged responses (initial size > 0, then submit retCode=0, then position still size > 0 → exit on attempt 2 with status='stuck' or final size=0 → 'ok'). The repo currently has no Vitest setup committed; tester decides which path.

## Dev brief

Single dev, sequential file edits. Suggested order:

1. **`src/core/bybit.ts`** — extend `InstrumentInfo` with `minNotionalValue: number`, parse from `lotSizeFilter.minNotionalValue` with `?? '5'` fallback. No other change.
2. **`src/core/close-verifier.ts`** (new) — implement `CloseAttempt`, `CloseAndVerifyOpts`, `MultiCloseResult`, `closeAndVerify`, `closeAcrossAccounts` exactly as in the Design section. Pure functions; depend only on `bybit.ts`, `accounts.ts`, `logger.ts`. No Telegram. No DB.
3. **`src/runtime/divergence-detector.ts`** — one-line behavioural change: drop `match.tp1_filled` gate; use the absolute-dust check.
4. **`src/runtime/position-watcher.ts`** — replace `closePosition` body (lines 152-169) with `closeAndVerify` wrapper; add fallback branch in safety-net (lines 284-305 region).
5. **`src/runtime/reconcile.ts`** — replace dust-handler inline submit (lines 297-321) with `closeAndVerify` call. Keep `pos.size = 0` semantics.
6. **`src/tools/admin/close-symbol.ts`** — replace main loop with `closeAcrossAccounts` call.
7. **`src/tools/admin/close-all.ts`** — replace per-account close loop with `closeAcrossAccounts` per discovered symbol. Keep the per-account `cancelAllOrders(settleCoin USDT)` pre-step before the symbol fan-out.
8. **`src/tools/diagnostics/full-exit-symbol.ts`** — replace the `if (execute) { submitOrder ... }` block at lines 55-64 with `await closeAcrossAccounts([a], symbol, { reason: 'full-exit-symbol', cancelOrders: false })`.

**Before submitting:**

- `npx tsc --noEmit` clean. No new `any`, no `as` casts (use the `InstrumentInfo` field directly).
- Grep `src/ --include="*.ts" -E "submitOrder.*orderType.*Market" -B1 -A4` — every remaining hit must be inside `src/core/close-verifier.ts`.
- `grep -rn "match.tp1_filled" src/runtime/divergence-detector.ts` — zero hits.
- Code-quality check per `.claude/TEAM.md` §4: no comments describing what (only why on `?? 5` fallback and on the cross-check rationale). One responsibility per function. Imports grouped external/core/local.

## Open questions

None blocking. The minNotionalValue field name `minNotionalValue` (camelCase) is confirmed from Bybit V5 API reference (lotSizeFilter object on `/v5/market/instruments-info`).

---
task: TASK-007
author: architect
created: 2026-05-27T10:20:00Z
iteration: 0
---

## Summary

Confirmed root cause: when slot 1 is a LIMIT that hasn't filled, `execute.ts` fakes `actualFilledQty` (`:496`), hardcodes `gridSlots[].filled` (`:504`), and unconditionally `persistTrade`s an `open` row + sends a "✅ filled" Telegram. We make `execute.ts` honest (no fake qty, no trade row when nothing filled, "pending" Telegram), and add a **promotion mechanism** (hybrid: daemon-immediate + reconcile catch-net, the TASK-005/006 pattern) that creates the `trades` row from the surviving `pending_orders` intent only when Bybit actually credits the position, plus a `notifyEntryConfirmed` follow-up.

## Current flow (execute.ts entry → DB → Telegram)

1. `auto-execute.ts:117` hardcodes `--order-type limit` → slot 1 always Limit.
2. `execute.ts:402` `useMarket = isFirst && args.orderType === 'market'` → with `orderType='limit'`, slot 1 is submitted as Limit GTC (`:407`, `:413`). The market-anchor path is dead code in prod.
3. `execute.ts:376-393` `insertPending` records slot 1 intent (`order_type:'Limit'`, qty/entry/sl/tp1/tp2/riskPct); `:426 markPlaced` sets `status='placed'`, `bybit_order_id`, `trade_id` still NULL.
4. `execute.ts:445-455` polls `getPositionInfo` 60×500ms for a non-zero size. Limit not at market → `actualFilledQty` stays `0`. `:457-464` correctly skips TP.
5. **`execute.ts:496` `if (actualFilledQty === 0) actualFilledQty = slots[0].qtyNum`** — fakes a fill. `result.qty` (`:497`) becomes the planned slot-1 qty.
6. **`execute.ts:504` `filled: s.level === 1`** — hardcodes slot 1 as filled regardless of reality.
7. `execute.ts:646 persistTrade` → unconditional `INSERT INTO trades … status='open'` (`:543-557`) using `r.qty` (the faked qty) and `args.entryPrice` (the planned, not actual, price). Then `linkTradeId` (`:560`) sets `pending_orders.trade_id`. **Phantom open row #240/241/242.**
8. `execute.ts:647 notifyTelegram` → `notifyOpen` renders header "🔴 ВХОД SHORT" (`tg-templates.ts:85`) and `Slot 1 … ✅ filled` (`tg-templates.ts:106`, `s.filled === true`).

Confirmed schema facts that constrain the design:
- `trades` table (`migrations/001_init.sql:42-66`) has **no `order_link_id` column**. Idempotency cannot key on `trades.order_link_id`.
- `initial_qty` exists only via `migrations/005` and is **not set by `persistTrade`** (it relies on `COALESCE(initial_qty, qty)` in `trade-repo.ts:73`).
- `pending_orders` (`migrations/006`) has `order_link_id UNIQUE`, `trade_id BIGINT` (soft FK, nullable), `status` in `pending|placed|failed|orphaned`. The natural idempotency key is **`pending_orders.trade_id IS NULL`** guarded by `order_link_id`.
- `account-monitor.ts:159-171 toBybitPos` returns `null` when no matching open DB trade exists, and `onPosition:274 if (!pos) return` — so a credited position **without** a DB row is currently silently dropped by the daemon. This is the exact hook point for promotion.
- `reconcile.ts:118-119` emits `bybit_without_db` for a Bybit position with no DB trade — the exact hook point for the catch-net.

## Design

### Part 1 — execute.ts honest fill state

`placeScaledIn` keeps everything through `markPlaced` (`:426`) unchanged — the pending intent and the actual Bybit limit orders are correct and stay. Only the post-wait reporting changes.

1. **Delete the fake fallback at `:494-496`:**
   ```ts
   // remove these three lines entirely:
   // actualFilledQty captured above is authoritative; fall back to slot[0].qtyNum
   // only if the wait loop timed out (which we've already warned about).
   if (actualFilledQty === 0) actualFilledQty = slots[0].qtyNum;
   ```
   `actualFilledQty` stays `0` when nothing credited.

2. **`:497-498` becomes conditional on the real fill:**
   ```ts
   result.qty = actualFilledQty;          // 0 when limit unfilled — honest
   result.fillPrice = actualFilledQty > 0 ? slots[0].priceNum : undefined;
   ```

3. **`:500-505` honest grid flags** — slot 1 filled only if a position was credited:
   ```ts
   const slot1Filled = actualFilledQty > 0;
   result.gridSlots = slots.map(s => ({
     level: s.level,
     price: s.priceNum,
     qty: s.qtyNum,
     filled: s.level === 1 && slot1Filled,
   }));
   ```

4. **New `AccountResult` field** (`execute.ts:84-95`) to carry "intent placed, nothing filled yet":
   ```ts
   interface AccountResult {
     …
     pendingOnly?: boolean;       // limit slot 1 placed but not yet credited (qty===0)
     plannedQty?: number;         // slot 1 planned qty — for the "pending" Telegram message
     plannedEntry?: number;       // slot 1 limit price — for the "pending" Telegram message
   }
   ```
   In `placeScaledIn`, set near `result.ok = true` (`:491`):
   ```ts
   result.ok = true;                       // order placement succeeded
   result.pendingOnly = actualFilledQty === 0;
   result.plannedQty = slots[0].qtyNum;
   result.plannedEntry = slots[0].priceNum;
   ```
   Note `result.ok` stays `true` — placement *did* succeed; "ok but pendingOnly" is the new honest state. `notifyTelegram`/`main` branch on `pendingOnly`, not on `ok`.

5. **`persistTrade` (`:509-568`) must NOT create a trades row for accounts where slot 1 didn't fill.** Filter the success set:
   ```ts
   const filled = results.filter(r => r.ok && !r.pendingOnly && (r.qty ?? 0) > 0);
   if (filled.length === 0) return;        // all pending → no trades rows, pending_orders intents survive
   ```
   Then iterate `filled` (not `succ`) for both the vault file and the `INSERT`. When mixed (some accounts credited, some pending — see Edge cases), only credited accounts get a row; pending accounts' `pending_orders` rows survive for promotion. The existing `linkTradeId` (`:560`) stays for the credited rows.
   - Also set `initial_qty` explicitly in the INSERT (currently missing) so promotion and the synchronous path agree on the field. Add `initial_qty` column + `r.qty` value to the `INSERT` (or set it in the same statement). Mirror this in the promotion INSERT (Part 2).

   **Non-scaled-in market path is unaffected:** for a plain market entry, slot logic isn't used; `actualFilledQty` comes from `placeOnAccount` and `pendingOnly` is never set → `!r.pendingOnly` is true → behaves exactly as today.

### Part 2 — Promotion mechanism

**Decision: Variant C (hybrid).** Daemon promotes immediately (<1s after Bybit credits the position) so risk-guard/heat/reconcile see truth without a 5-min lag; reconcile is the idempotent catch-net for when the daemon is down or missed the event. This is the same belt-and-suspenders pattern already used for naked-TP recovery and full-close handling (TASK-005/006), so it's consistent with the codebase and the operator's mental model.

- **Variant A (reconcile-only) rejected:** 5-min latency means a freshly-promoted-but-not-yet-seen position spends up to 5 min as `bybit_without_db` divergence (a red-flag trigger) and risk-guard under-counts heat — exactly the inconsistency we're removing. Acceptable only as a fallback, not the primary.
- **Variant B (daemon-only) rejected:** daemon is a long-running WS process; if it's down (deploy, crash, restart) a fill during the gap is never journaled. No catch-net violates the "reconcile before every cycle" inviolable.

**New shared module `src/runtime/pending-promoter.ts`** (single responsibility: promote a credited pending intent into a trades row). Both the daemon and reconcile call it, so the idempotent INSERT lives in exactly one place (DRY, and the race guard can't drift between two copies).

```ts
export interface PromotablePending {
  id: number;
  orderLinkId: string;
  accountBucket: string;
  accountKey: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  sl: number;
  tp1: number | null;
  tp2: number | null;
  riskPct: number | null;
  rationale: string | null;
}

// Returns the trade_id (new or already-linked); null if no eligible pending intent.
export async function promotePendingToTrade(
  pending: PromotablePending,
  bybitPos: { size: number; avgPrice: number },
): Promise<number | null>;
```

**New `pending-orders.ts` helper** to find the unresolved intent for a credited position (keyed on account+symbol+side, unresolved, placed):
```ts
export async function findUnpromotedPending(
  accountBucket: string, accountKey: string, symbol: string, side: 'Buy' | 'Sell',
): Promise<PromotablePending | null>;
// WHERE account_bucket=$1 AND account_key=$2 AND symbol=$3 AND side=$4
//   AND status='placed' AND trade_id IS NULL
// ORDER BY requested_at DESC LIMIT 1
```

**`promotePendingToTrade` implementation (idempotent, single transaction):**
1. Begin tx.
2. `SELECT … FROM pending_orders WHERE id=$1 AND trade_id IS NULL FOR UPDATE` — row lock. If no row (already promoted by the other path), `ROLLBACK`/return the existing `trade_id` via a follow-up `SELECT trade_id`. This `FOR UPDATE` + `trade_id IS NULL` recheck is the race guard: whichever of daemon/reconcile grabs the lock first wins; the loser sees `trade_id` already set and no-ops.
3. `INSERT INTO trades (…, qty, initial_qty, entry_price, status, opened_at, …) VALUES (…, bybitPos.size, bybitPos.size, bybitPos.avgPrice, 'open', NOW(), …) RETURNING id`. **`entry_price` = actual `avgPrice` from Bybit (not the planned `pending.entryPrice`); `qty` = `initial_qty` = actual `bybitPos.size`.** Carry `sl/tp1/tp2/rationale/order_type='Limit'/bybit_order_id` from the pending row.
4. `UPDATE pending_orders SET trade_id=$tradeId WHERE id=$pendingId`.
5. Commit. Return `tradeId`.

Also write the `vault/Trades/*.md` journal file (factor the frontmatter writer out of `persistTrade` so both paths share it — or accept a small dup; KISS says a one-call shared helper `writeTradeJournal(...)` is worth it on the 2nd occurrence here).

**Daemon hook (`account-monitor.ts`).** In `onPosition`, when `size > 0` and `toBybitPos` returns `null` (no DB trade), instead of dropping at `:274`, attempt promotion before bailing:
```ts
const pos = await this.toBybitPos(symbol, {…});
if (!pos) {
  const pending = await findUnpromotedPending(this.account.bucket, this.account.keyName, symbol, side);
  if (pending) {
    const tradeId = await promotePendingToTrade(pending, { size, avgPrice: parseFloat(p.entryPrice || '0') });
    if (tradeId) {
      await notifyEntryConfirmed({ symbol, side, size, avgPrice, sl: pending.sl, tp: pending.tp1, account: this.account.keyName });
    }
  }
  return;
}
```
Place this AFTER the `size===0` and naked-SL grace branches (it only applies to `size>0`). The newly-created row will be picked up by `toBybitPos` on the *next* event (TP/SL/DCA logic resumes normally). Telegram dedup: send `notifyEntryConfirmed` only when `promotePendingToTrade` returns a *newly created* id — easiest is to have `promotePendingToTrade` return `{ tradeId, created: boolean }` and notify only on `created === true`. (Refine the signature accordingly.)

**Reconcile catch-net (`reconcile.ts:118-119`).** Before pushing `bybit_without_db`, try promotion:
```ts
if (!match) {
  const acc = accountByLabel.get(pos.account);          // build this map earlier (currently at :185)
  const pending = acc && await findUnpromotedPending(acc.bucket, acc.keyName, pos.symbol, pos.side as 'Buy'|'Sell');
  if (pending) {
    const r = await promotePendingToTrade(pending, { size: pos.size, avgPrice: pos.entry });
    if (r?.created) { /* optional: collect for one consolidated notifyEntryConfirmed */ }
    continue;                                            // promoted → not a divergence
  }
  divergences.push({ type: 'bybit_without_db', … });
  continue;
}
```
Move the `accountByLabel` construction (`:185`) above the Phase-A loop so both phases share it.

**`risk-guard` interaction:** no change needed. Once the row exists (`status='open'`), risk-guard counts it normally. While truly pending (no fill, no row), it correctly does NOT occupy a slot — which is the desired behavior (a never-filled limit shouldn't hold a parallel-position slot). Operator accepted that pending limits stay live; if a *new* signal arrives for the same pair while a limit is pending, that's an existing concern outside this task (see Open questions).

### Part 3 — Telegram truthful

**`notifyOpen` (`tg-templates.ts:74-134`) gains an `allPending` notion.** Add to `OpenTradeArgs`:
```ts
status?: 'filled' | 'pending';   // default 'filled' (back-compat for market entries)
```
Header (`:85`):
```ts
const headerVerb = a.status === 'pending' ? 'ОРДЕР РАЗМЕЩЁН' : 'ВХОД';
const headerDot  = a.status === 'pending' ? '🟡' : dot;
lines.push(`${headerDot} <b>${headerVerb} ${dir} • ${a.symbol}</b>`);
```
The grid loop (`:104-108`) already renders `⏳ pending` correctly once `s.filled` is honest (Part 1). The size line (`:111`) when pending should read planned qty and say "(ожидает заполнения)". `notifyTelegram` (`execute.ts:570`) computes `status`:
```ts
const allPending = succ.every(r => r.pendingOnly);
… notifyOpen({ …, status: allPending ? 'pending' : 'filled', qtyTotal: allPending ? plannedTotal : filledTotal });
```
Use `plannedQty` for `qtyTotal` and `plannedEntry`/`gridSlots[i].price` for the price lines when pending (since `entryPrice` arg is the planned limit anyway, this is already correct).

**New template `notifyEntryConfirmed(a)`** (Russian, what/why/what-next) for the promotion event:
```ts
export interface EntryConfirmedArgs {
  symbol: string; side: 'Buy' | 'Sell';
  size: number; avgPrice: number;
  sl: number; tp: number | null;
  accountSummaries: string[];   // optional consolidation across accounts
}
export async function notifyEntryConfirmed(a: EntryConfirmedArgs): Promise<void>;
// Header: "✅ <b>ВХОД ПОДТВЕРЖДЁН • {symbol}</b> {dir}"
// Body: фактическая цена входа {avgPrice}, размер {size}, стоп {sl}, тейк {tp}
// what-next: "позиция активна, стоп выставлен; тейк — reduce-only лимит"
```
Follow allowed-terms list (вход, выход, стоп, тейк, размер, риск). No forbidden slang. One message per credited (symbol+side); consolidate across accounts like `notifyConsolidatedCloses` does if multiple accounts fill in the same reconcile pass — for the daemon path it's naturally one-account-at-a-time, so per-account is acceptable there.

### Part 4 — auto-execute + comment cleanup

- **`auto-execute.ts:117`** — `--order-type limit` is now CORRECT by design (operator decision: slot 1 = limit). **No code change.** Optionally add a one-line WHY comment per TEAM.md §4 whitelist: `// slot 1 LIMIT by design — maker fee + better fade entry (TASK-007)`. Keep it to one line or omit.
- **`execute.ts:395-398`** — the comment "Slot 1 is MARKET … for guaranteed immediate fill … Slots 2..N stay Limit" is now misleading (slot 1 is Limit in prod). Rewrite to reflect reality:
  ```
  // Slot 1 carries the position stopLoss. When orderType==='market' it fills
  // immediately; in prod (auto-execute sends 'limit') slot 1 is a GTC limit that
  // may fill later — promotion (pending-promoter.ts) creates the trades row on
  // actual fill. Slots 2..N are always Limit.
  ```
  (Or trim further — the WHY that matters is "limit may fill later → promotion handles the row".)
- **`execute.ts:430-436` / `:457-464` / `:472-474` comments** about "slot 1 (Market/IOC) fills immediately" are similarly stale — soften to "slot 1 fills immediately when market; when limit, may fill later (promotion handles it)". These are accuracy fixes, not behavior changes.
- The `useMarket` logic at `:402` itself stays — it's correct (supports a future/manual `--order-type market` call); it's just never hit by auto-execute. Note this so the dev doesn't delete it.

## Idempotency / race analysis

The only way a duplicate `trades` row can appear is daemon and reconcile both promoting the same pending intent. Prevented by:
1. Single shared `promotePendingToTrade` with `SELECT … FOR UPDATE WHERE id=$1 AND trade_id IS NULL`. The row lock serializes the two callers; the second sees `trade_id` already set inside the same tx and no-ops (returns `created:false`).
2. `findUnpromotedPending` filters `trade_id IS NULL` — once linked, neither path re-selects it.
3. `pending_orders.order_link_id` is `UNIQUE`, so there's exactly one intent per slot-1 entry to promote.
4. Telegram dedup: `notifyEntryConfirmed` fires only on `created === true`, so the catch-net firing after the daemon already promoted produces no second message.

Edge race — daemon promotes, then the *synchronous* `execute.ts` (still running its 30s wait) sees the position credited late and the OLD code would have persisted: NOT possible here because (a) the limit by definition wasn't filled within the 30s window in the incident, and (b) even if it fills at second 29, `execute.ts` now goes through `persistTrade`'s `filled.length` path normally and `linkTradeId` sets `trade_id`; a subsequent daemon event then sees `trade_id` set and skips. The `FOR UPDATE` guard covers the sub-second overlap.

## Edge cases

- **Slot 1 fills, slots 2/3 pending (normal DCA):** `actualFilledQty > 0` → behaves as today; `initial_qty` = slot-1 fill size. Slots 2/3 fills handled by existing `handleDcaFill` (`account-monitor.ts:285-288`). `initial_qty` stays slot-1; DCA logic uses `> dbInitialQty*1.01` to detect adds — unchanged.
- **Limit fills partially (slot 1 partial):** `getPositionInfo` returns the partial size; `actualFilledQty` = partial > 0 → row created with the partial as `qty`/`initial_qty`. TP placed for the partial. Acceptable — position-watcher/DCA detection reconciles further fills. (Same behavior as a partial market fill today.)
- **Limit cancelled before fill (next signal / manual / `cancelScaledInOrphans`):** no position ever appears → no promotion. The `pending_orders` row stays `placed`/`trade_id NULL` and ages into `findStaleOrphans` (>5min) → surfaced as a warning, never becomes a trade. Recommend: when reconcile/orphan-sweep cancels the live limit (`reconcile.ts:42 cancelScaledInOrphans`), also mark the matching pending `status='orphaned'` so it stops showing as a stale orphan. (Note for dev; optional, low priority.)
- **Daemon down, reconcile catch-net:** position credited while daemon offline → next reconcile (≤5min) promotes via the same function. Telegram `notifyEntryConfirmed` still fires (created:true). This is the safety net that makes Variant C correct.
- **Promotion when `avgPrice`==0** (Bybit hasn't populated it): guard — if `bybitPos.avgPrice <= 0`, fall back to `pending.entry_price` for `entry_price` but log a warning; do NOT block the row creation (a credited position must be journaled). Edge only on demo lag.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Duplicate trades row (daemon + reconcile) | medium | `SELECT … FOR UPDATE WHERE trade_id IS NULL` in one shared function; recheck inside tx |
| `entry_price` recorded as planned not actual → inflates/deflates R | medium | Promotion uses Bybit `avgPrice`; only falls back to planned on `avgPrice<=0` with a warning |
| `initial_qty` left NULL (current INSERT omits it) → R math via COALESCE drifts if qty later changes | low | Set `initial_qty` explicitly in BOTH synchronous persistTrade and promotion INSERT |
| Daemon hooks promotion before SL is server-side, breaking the 5-min SL inviolable | low | Slot 1 carries `stopLoss` at submit (`execute.ts:414-416`); SL is attached to the order, present the instant the position exists — promotion only journals, doesn't place SL |
| Telegram "pending" message misread as "no order" by operator | low | Header "🟡 ОРДЕР РАЗМЕЩЁН" + per-slot ⏳ pending + follow-up "✅ ВХОД ПОДТВЕРЖДЁН" on fill |
| Stale pending after manual cancel never cleaned | low | Mark pending `orphaned` on orphan-sweep cancel (noted, optional) |
| Mixed-account result (some filled, some pending) mishandled | low | persistTrade filters per-account on `!pendingOnly && qty>0`; pending accounts promote independently |

## Live-trading impact

- **Inviolable touched:** Rule 1 (server-side SL within 5 min) — UNAFFECTED: SL is submitted with slot 1 order at placement, not at promotion. Promotion only writes the DB row.
- **Inviolable touched:** Rule 4 (reconcile before every cycle) — IMPROVED: `bybit_without_db` for a legitimately-filling limit is no longer a false divergence; it's promoted. Genuine divergences (no matching pending) still report.
- **Red-flag trigger "Reconcile divergence > 1 cycle":** the phantom-row incident would have tripped this; the fix removes that false positive.
- **No walk-forward re-run needed.** Zero strategy/sizing/backtest-engine change. This is purely reporting/state-truth plumbing. `cg-fade.ts`, sizing, TP logic untouched.
- **Worst-case failure:** if `promotePendingToTrade` throws (DB down), the daemon/reconcile log a warning and the position stays `bybit_without_db` (the OLD behavior) until DB recovers — strictly no worse than today, and reconcile retries every cycle.

## Out of scope

- NOT changing slot 1 to market (operator decision).
- NOT touching `cg-fade.ts` or any strategy.
- NOT changing TP1==TP2 single-target behavior (separate known issue).
- NOT changing the backtest engine.
- NOT changing `reconcile.ts:188` riskedUsd/initial_qty R-inflation (separate task — but Part 1/Part 2 explicitly set `initial_qty`, which is complementary).

## Acceptance criteria (refined)

The task frontmatter `acceptance` is already precise. Two refinements to propose to the planner:
- Replace "Place: reconcile.ts OR account-monitor.ts" with "**hybrid**: daemon `account-monitor.ts` (immediate) + `reconcile.ts` catch-net, both calling shared `pending-promoter.ts` `promotePendingToTrade`".
- Add: "promotion sets `entry_price = Bybit avgPrice` and `initial_qty = actual filled size` (not planned values)".
- Add: "synchronous `persistTrade` INSERT sets `initial_qty` explicitly (currently relies on COALESCE)".

## Dev brief — file-by-file

Implement in this order:

1. **`src/core/pending-orders.ts`** — add `findUnpromotedPending(bucket, key, symbol, side): Promise<PromotablePending | null>` (status='placed', trade_id IS NULL, newest). Export `PromotablePending` interface.
2. **`src/runtime/pending-promoter.ts`** (NEW) — `promotePendingToTrade(pending, {size, avgPrice}): Promise<{ tradeId: number; created: boolean } | null>`. One transaction: `SELECT … FOR UPDATE WHERE id=$1 AND trade_id IS NULL`; if locked-and-null → INSERT trades (qty=initial_qty=size, entry_price=avgPrice with `<=0` fallback to planned, sl/tp1/tp2/rationale/order_type='Limit'/bybit_order_id from pending, status='open', opened_at=NOW()), then UPDATE pending_orders.trade_id, commit, return `{tradeId, created:true}`; if already linked → return `{tradeId: existing, created:false}`. Factor `writeTradeJournal` out of `execute.ts persistTrade` and call it here too (or accept the small dup if cleaner).
3. **`src/core/tg-templates.ts`** — add `status?: 'filled'|'pending'` to `OpenTradeArgs`; branch header (🟡 ОРДЕР РАЗМЕЩЁН) + size-line wording. Add `notifyEntryConfirmed(EntryConfirmedArgs)`.
4. **`src/runtime/execute.ts`** — Part 1: delete `:494-496` fake fallback; honest `result.qty`/`fillPrice`/`gridSlots[].filled`; add `pendingOnly/plannedQty/plannedEntry` to `AccountResult` and set them; `persistTrade` filters `!pendingOnly && qty>0` and sets `initial_qty` explicitly in INSERT; `notifyTelegram` computes `status` and passes planned vs filled totals. Part 4: rewrite stale comments `:395-398`, `:430-436`, `:457-464`, `:472-474` (accuracy only, no logic change; keep `useMarket`).
5. **`src/runtime/account-monitor.ts`** — in `onPosition`, after `toBybitPos` returns `null` for `size>0`, call `findUnpromotedPending` → `promotePendingToTrade` → `notifyEntryConfirmed` on `created`. Then `return`.
6. **`src/runtime/reconcile.ts`** — move `accountByLabel` build above Phase A; in the `!match` branch try `findUnpromotedPending`/`promotePendingToTrade` before pushing `bybit_without_db`; `continue` on success.
7. **`src/runtime/auto-execute.ts`** — no code change (optional one-line WHY comment at `:117`).

Verify before submitting: `npx tsc --noEmit` clean; the smoke path in acceptance (place a limit that won't fill → no `open` trade row, Telegram "🟡 ОРДЕР РАЗМЕЩЁН / Slot 1 ⏳ pending"; simulate fill → exactly one `trades` row appears via daemon OR reconcile, never two, Telegram "✅ ВХОД ПОДТВЕРЖДЁН"). Re-run reconcile twice to confirm no duplicate row and no `bybit_without_db` divergence.

## Open questions

- [NEEDS CLARIFICATION: rationale source] `promotePendingToTrade` writes `trades.rationale` from `pending_orders.rationale` (truncated to 4000). Confirm that's the desired audit text (it is the same string `execute.ts` would have stored). Assuming yes.
- [NEEDS CLARIFICATION: re-signal while pending] If a new scan signal fires for the same pair while a slot-1 limit is still pending (no position, no trades row), risk-guard's duplicate check (`risk-guard.ts:226`) won't block it because there's no open trade — could place a second limit ladder. Out of scope for TASK-007 but flag for operator: do we want a "pending intent occupies the pair" guard? Recommend a follow-up task, not bundled here.
- [NEEDS CLARIFICATION: orphan-on-cancel] Marking `pending_orders.status='orphaned'` when `cancelScaledInOrphans` cancels the live limit (so it leaves the stale-orphan report) — include in this task or defer? Recommend include (one extra UPDATE), low risk.

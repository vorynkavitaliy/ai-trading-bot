// Crash-safe order intent. Every entry submitOrder records its intent in PG
// BEFORE the network call. If the process crashes between submitOrder.ok and
// INSERT INTO trades, the pending_orders row survives so reconcile (or operator)
// can resolve the orphan via orderLinkId. See migrations/006_pending_orders.sql.
//
// Scope: this module tracks ONLY the entry order. TP1/TP2 reduce-only limits are
// recovered by position-watcher's Bybit-side check (it scans /open-orders for
// missing reduce-only limits and re-places from DB). Tracking three rows per
// entry would add complexity without buying additional safety.

import { query } from './db';

export interface PendingOrderIntent {
  orderLinkId: string;
  accountBucket: string;
  accountKey: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  qty: number;
  entryPrice: number | null;
  sl: number;
  tp1: number | null;
  tp2: number | null;
  riskPct: number | null;
  rationale: string;
  // Phase 2 (2026-06-11): strategy.name for trades.strategy attribution on promoted
  // rows, and the resting-entry TTL the canceller (entry-ttl.ts) enforces.
  strategy?: string | null;
  ttlMinutes?: number | null;
}

export async function insertPending(intent: PendingOrderIntent): Promise<number> {
  // pg returns BIGSERIAL `id` as a string; coerce so callers can treat it as a number.
  const r = await query<{ id: string }>(
    `INSERT INTO pending_orders (
       order_link_id, account_bucket, account_key, symbol, side, order_type,
       qty, entry_price, sl, tp1, tp2, risk_pct, rationale, strategy, ttl_minutes,
       status, requested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',NOW())
     RETURNING id`,
    [
      intent.orderLinkId, intent.accountBucket, intent.accountKey,
      intent.symbol, intent.side, intent.orderType,
      intent.qty, intent.entryPrice, intent.sl,
      intent.tp1, intent.tp2, intent.riskPct,
      intent.rationale.slice(0, 4000),
      intent.strategy ?? null, intent.ttlMinutes ?? null,
    ]
  );
  return parseInt(r.rows[0].id, 10);
}

export async function markPlaced(id: number, bybitOrderId: string | undefined): Promise<void> {
  await query(
    `UPDATE pending_orders
       SET status='placed', bybit_order_id=$1, resolved_at=NOW()
     WHERE id=$2`,
    [bybitOrderId ?? null, id]
  );
}

export async function markFailed(id: number, error: string): Promise<void> {
  await query(
    `UPDATE pending_orders
       SET status='failed', last_error=$1, attempts=attempts+1, resolved_at=NOW()
     WHERE id=$2`,
    [error.slice(0, 2000), id]
  );
}

// Called after persistTrade's INSERT INTO trades succeeds. Links the pending row
// to the trade row by orderLinkId (which we passed to Bybit as clientOrderId).
//
// Idempotency: only set trade_id when still NULL. Otherwise we'd silently
// overwrite a trade_id already set by promotePendingToTrade — that race was the
// 2026-05-28 stack-and-sum bug, where execute.ts and the WS daemon both fired
// for scaled-in fills and each created its own trades row.
export async function linkTradeId(orderLinkId: string, tradeId: number): Promise<void> {
  await query(
    `UPDATE pending_orders SET trade_id=$1
      WHERE order_link_id=$2 AND trade_id IS NULL`,
    [tradeId, orderLinkId]
  );
}

// Returns the trade_id currently linked to a pending intent (set by either
// promotePendingToTrade or linkTradeId), or null if unlinked. Used by persistTrade
// to skip duplicate INSERTs when the WS daemon already promoted the intent.
export async function getLinkedTradeId(orderLinkId: string): Promise<number | null> {
  const r = await query<{ trade_id: string | null }>(
    `SELECT trade_id FROM pending_orders WHERE order_link_id=$1`,
    [orderLinkId]
  );
  const v = r.rows[0]?.trade_id;
  return v != null ? parseInt(v, 10) : null;
}

export interface PromotablePending {
  id: number;
  orderLinkId: string;
  accountBucket: string;
  accountKey: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  entryPrice: number | null;
  sl: number;
  tp1: number | null;
  tp2: number | null;
  riskPct: number | null;
  rationale: string | null;
  bybitOrderId: string | null;
  strategy: string | null;
}

// Find the unresolved intent for a credited position: a 'placed' row with no
// trade_id yet, keyed on account+symbol+side, newest first. This is what the
// promoter consumes to materialize a trades row once Bybit credits the position.
export async function findUnpromotedPending(
  accountBucket: string,
  accountKey: string,
  symbol: string,
  side: 'Buy' | 'Sell'
): Promise<PromotablePending | null> {
  const r = await query<any>(
    `SELECT id, order_link_id, account_bucket, account_key, symbol, side, order_type,
            entry_price, sl, tp1, tp2, risk_pct, rationale, bybit_order_id, strategy
       FROM pending_orders
      WHERE account_bucket = $1 AND account_key = $2 AND symbol = $3 AND side = $4
        AND status = 'placed' AND trade_id IS NULL
      ORDER BY requested_at DESC
      LIMIT 1`,
    [accountBucket, accountKey, symbol, side]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: typeof row.id === 'string' ? parseInt(row.id, 10) : row.id,
    orderLinkId: row.order_link_id,
    accountBucket: row.account_bucket,
    accountKey: row.account_key,
    symbol: row.symbol,
    side: row.side,
    orderType: row.order_type,
    entryPrice: row.entry_price != null ? parseFloat(row.entry_price) : null,
    sl: parseFloat(row.sl),
    tp1: row.tp1 != null ? parseFloat(row.tp1) : null,
    tp2: row.tp2 != null ? parseFloat(row.tp2) : null,
    riskPct: row.risk_pct != null ? parseFloat(row.risk_pct) : null,
    rationale: row.rationale,
    bybitOrderId: row.bybit_order_id,
    strategy: row.strategy ?? null,
  };
}

// ── Phase 2 (resting limit entries, 2026-06-11) ────────────────────────────────

export interface RestingEntryPending {
  id: number;
  orderLinkId: string;
  accountBucket: string;
  accountKey: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  bybitOrderId: string | null;
  requestedAtMs: number;
  ttlMinutes: number;
  ageMin: number;
}

function toRestingEntry(row: any): RestingEntryPending {
  return {
    id: typeof row.id === 'string' ? parseInt(row.id, 10) : row.id,
    orderLinkId: row.order_link_id,
    accountBucket: row.account_bucket,
    accountKey: row.account_key,
    symbol: row.symbol,
    side: row.side,
    bybitOrderId: row.bybit_order_id,
    requestedAtMs: parseFloat(row.requested_at_ms),
    ttlMinutes: row.ttl_minutes != null ? Number(row.ttl_minutes) : DEFAULT_ENTRY_TTL_MIN,
    ageMin: parseFloat(row.age_min),
  };
}

// srcNew-validated TTL: the pending dies 10 min before the next 4H boundary so the
// pair is free to re-signal. Load-bearing — do not raise past 240.
export const DEFAULT_ENTRY_TTL_MIN = 230;

// Unresolved entry rows include the crash/response-lost leaks: 'pending' (process
// died between INSERT and submitOrder confirm — order may or may not exist) and
// 'failed' (a withRetry re-submit hit Bybit's duplicate-linkId reject AFTER the
// first attempt actually placed — markFailed fired, but a live order can remain).
// The canceller resolves all three against Bybit order state; rows whose order
// truly never existed resolve to 'cancelled' via the NotFound branch.
const RESTING_ENTRY_SELECT = `
  SELECT id, order_link_id, account_bucket, account_key, symbol, side, bybit_order_id,
         EXTRACT(EPOCH FROM requested_at) * 1000 AS requested_at_ms,
         ttl_minutes,
         EXTRACT(EPOCH FROM (NOW() - requested_at)) / 60.0 AS age_min
    FROM pending_orders
   WHERE status IN ('pending', 'placed', 'failed') AND trade_id IS NULL
     AND order_type = 'Limit'
     AND order_link_id LIKE 'e-%'`;

// Entry limits past their TTL — the canceller's work queue.
export async function findExpiredEntryPendings(): Promise<RestingEntryPending[]> {
  const r = await query<any>(
    `${RESTING_ENTRY_SELECT}
     AND requested_at < NOW() - make_interval(mins => COALESCE(ttl_minutes, ${DEFAULT_ENTRY_TTL_MIN}))
     ORDER BY requested_at ASC
     LIMIT 50`
  );
  return r.rows.map(toRestingEntry);
}

// ALL unresolved resting entry limits (any age) — used by the PAUSE sweep and by
// execute's cancel-before-place guard.
export async function findRestingEntryPendings(symbol?: string): Promise<RestingEntryPending[]> {
  const r = await query<any>(
    symbol
      ? `${RESTING_ENTRY_SELECT} AND symbol = $1 ORDER BY requested_at ASC LIMIT 50`
      : `${RESTING_ENTRY_SELECT} ORDER BY requested_at ASC LIMIT 50`,
    symbol ? [symbol] : []
  );
  return r.rows.map(toRestingEntry);
}

// PROMOTED rows whose entry order may still rest on Bybit: a PARTIAL fill links
// trade_id within ~1s (daemon promotion), after which the row leaves the
// unresolved queries above — but the GTC remainder stays in the book. The engine
// expires the WHOLE pending at TTL, so the canceller must sweep these too.
export async function findLinkedEntryRemainders(): Promise<RestingEntryPending[]> {
  const r = await query<any>(
    `SELECT po.id, po.order_link_id, po.account_bucket, po.account_key, po.symbol, po.side,
            po.bybit_order_id,
            EXTRACT(EPOCH FROM po.requested_at) * 1000 AS requested_at_ms,
            po.ttl_minutes,
            EXTRACT(EPOCH FROM (NOW() - po.requested_at)) / 60.0 AS age_min
       FROM pending_orders po
       JOIN trades t ON t.id = po.trade_id
      WHERE po.status = 'placed' AND po.trade_id IS NOT NULL
        AND po.order_type = 'Limit' AND po.order_link_id LIKE 'e-%'
        AND po.requested_at < NOW() - make_interval(mins => COALESCE(po.ttl_minutes, ${DEFAULT_ENTRY_TTL_MIN}))
        AND po.requested_at > NOW() - INTERVAL '48 hours'
        AND t.status = 'open'
      ORDER BY po.requested_at ASC
      LIMIT 50`
  );
  return r.rows.map(toRestingEntry);
}

// Terminal state for a resting entry that was cancelled (TTL expiry, PAUSE sweep,
// cancel-before-place, or found already gone on Bybit). Accepts the leak states
// too ('pending'/'failed' → 'cancelled' once Bybit confirms no live unfilled
// order). NOT applicable to 'orphaned' (reserved for post-close ladder cleanup).
export async function markCancelled(id: number, why: string): Promise<void> {
  await query(
    `UPDATE pending_orders
        SET status='cancelled', last_error=$1, resolved_at=NOW()
      WHERE id=$2 AND trade_id IS NULL AND status IN ('pending', 'placed', 'failed')`,
    [why.slice(0, 2000), id]
  );
}

// Mark a pending intent orphaned when its live limit is cancelled (e.g. by
// cancelScaledInOrphans after a close). Keeps it out of the stale-orphan report
// since it will never become a trade. Only touches still-unresolved rows.
export async function markPendingOrphanedByLink(orderLinkId: string): Promise<void> {
  await query(
    `UPDATE pending_orders
        SET status='orphaned', resolved_at=NOW()
      WHERE order_link_id=$1 AND trade_id IS NULL AND status <> 'orphaned'`,
    [orderLinkId]
  );
}

export interface StalePending {
  id: number;
  orderLinkId: string;
  accountLabel: string;
  symbol: string;
  side: string;
  status: string;
  bybitOrderId: string | null;
  ageMin: number;
  lastError: string | null;
}

// Rows that need attention: written but never got a trade_id within the threshold.
// The intent is for reconcile to surface these as warnings so the operator (or a
// future auto-resolve step) can investigate. Default threshold of 5 min avoids
// flagging in-flight cycles.
//
// Phase 2 exclusions: 'cancelled' is a terminal state (TTL expiry / PAUSE sweep —
// expected, not an orphan), and a HEALTHY resting entry limit ('placed', Limit,
// 'e-' link) is by design unlinked for up to its TTL — flag it only once it
// outlives TTL + 30 min grace (the canceller should have removed it by then).
export async function findStaleOrphans(thresholdMin: number = 5): Promise<StalePending[]> {
  const r = await query<any>(
    `SELECT id, order_link_id,
            account_bucket || '/' || account_key AS account_label,
            symbol, side, status, bybit_order_id,
            EXTRACT(EPOCH FROM (NOW() - requested_at)) / 60.0 AS age_min,
            last_error
       FROM pending_orders
      WHERE trade_id IS NULL
        AND status NOT IN ('orphaned', 'cancelled')
        AND requested_at < NOW() - make_interval(mins => $1)
        AND NOT (
          status = 'placed' AND order_type = 'Limit' AND order_link_id LIKE 'e-%'
          AND requested_at > NOW() - make_interval(mins => COALESCE(ttl_minutes, ${DEFAULT_ENTRY_TTL_MIN}) + 30)
        )
      ORDER BY requested_at DESC
      LIMIT 50`,
    [thresholdMin]
  );
  return r.rows.map((row) => ({
    id: typeof row.id === 'string' ? parseInt(row.id, 10) : row.id,
    orderLinkId: row.order_link_id,
    accountLabel: row.account_label,
    symbol: row.symbol,
    side: row.side,
    status: row.status,
    bybitOrderId: row.bybit_order_id,
    ageMin: parseFloat(row.age_min),
    lastError: row.last_error,
  }));
}

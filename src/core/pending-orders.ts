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
}

export async function insertPending(intent: PendingOrderIntent): Promise<number> {
  // pg returns BIGSERIAL `id` as a string; coerce so callers can treat it as a number.
  const r = await query<{ id: string }>(
    `INSERT INTO pending_orders (
       order_link_id, account_bucket, account_key, symbol, side, order_type,
       qty, entry_price, sl, tp1, tp2, risk_pct, rationale, status, requested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',NOW())
     RETURNING id`,
    [
      intent.orderLinkId, intent.accountBucket, intent.accountKey,
      intent.symbol, intent.side, intent.orderType,
      intent.qty, intent.entryPrice, intent.sl,
      intent.tp1, intent.tp2, intent.riskPct,
      intent.rationale.slice(0, 4000),
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
export async function linkTradeId(orderLinkId: string, tradeId: number): Promise<void> {
  await query(
    `UPDATE pending_orders SET trade_id=$1 WHERE order_link_id=$2`,
    [tradeId, orderLinkId]
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
export async function findStaleOrphans(thresholdMin: number = 5): Promise<StalePending[]> {
  const r = await query<any>(
    `SELECT id, order_link_id,
            account_bucket || '/' || account_key AS account_label,
            symbol, side, status, bybit_order_id,
            EXTRACT(EPOCH FROM (NOW() - requested_at)) / 60.0 AS age_min,
            last_error
       FROM pending_orders
      WHERE trade_id IS NULL
        AND status <> 'orphaned'
        AND requested_at < NOW() - make_interval(mins => $1)
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

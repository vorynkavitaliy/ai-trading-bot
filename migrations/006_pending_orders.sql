-- Migration 006: pending_orders intent table for crash-safe order placement.
--
-- Currently execute.ts has a ~150-line window between submitOrder.ok and
-- INSERT INTO trades during which a process crash leaves Bybit holding a
-- position with no DB row. Reconcile flags this as `bybit_without_db` but
-- can't recover SL/TP/rationale/initial_qty.
--
-- This table is written BEFORE the network call. If we crash anywhere
-- afterward, the row survives and reconcile (or operator) can resolve by
-- querying Bybit via the orderLinkId.
--
-- Lifecycle:
--   INSERT … status='pending', trade_id=NULL                       -- before submitOrder
--   UPDATE … status='placed', bybit_order_id=…                     -- after Bybit ok
--   UPDATE … trade_id=…                                            -- after persistTrade insert
--   UPDATE … status='failed', last_error=…                         -- on submitOrder throw
--   UPDATE … status='orphaned'                                     -- set by reconcile when broker has no
--                                                                  --   matching order/position after a grace period
--
-- A healthy "fully resolved" row has status='placed' and trade_id IS NOT NULL.
-- A row needing investigation: trade_id IS NULL AND requested_at < NOW() - 5min.

CREATE TABLE IF NOT EXISTS pending_orders (
  id BIGSERIAL PRIMARY KEY,
  order_link_id TEXT UNIQUE NOT NULL,        -- shared with Bybit's clientOrderId
  account_bucket TEXT NOT NULL,
  account_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,                         -- 'Buy' | 'Sell'
  order_type TEXT NOT NULL,                   -- 'Market' | 'Limit'
  qty NUMERIC(28, 8),
  entry_price NUMERIC(20, 8),
  sl NUMERIC(20, 8) NOT NULL,
  tp1 NUMERIC(20, 8),
  tp2 NUMERIC(20, 8),
  risk_pct NUMERIC(10, 4),
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  bybit_order_id TEXT,
  trade_id BIGINT,                            -- soft FK to trades.id; no constraint to keep INSERT order flexible
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_orders_status_open
  ON pending_orders (status) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_pending_orders_order_link_id
  ON pending_orders (order_link_id);
CREATE INDEX IF NOT EXISTS idx_pending_orders_requested_at
  ON pending_orders (requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_orders_unresolved
  ON pending_orders (requested_at DESC) WHERE trade_id IS NULL;

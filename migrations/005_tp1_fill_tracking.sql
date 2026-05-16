-- Migration 005: track TP1 partial fills.
-- After TP1 reduce-only limit fills (~50% of original qty), watcher needs to:
--   1) update trades.qty to remaining size (so reconcile doesn't see size_mismatch)
--   2) record tp1_filled_at + tp1_realized_pnl_usd for accurate per-trade reporting
--   3) keep status='open' (TP2 still active on the remaining 50%)

ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1_filled_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1_realized_pnl_usd NUMERIC(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1_filled_qty NUMERIC(28, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS initial_qty NUMERIC(28, 8);

-- Backfill: existing open trades that already had partial fills (LTC short 2026-05-02)
-- get initial_qty = qty (their original size), so future computations work.
UPDATE trades SET initial_qty = qty WHERE initial_qty IS NULL AND status = 'open';

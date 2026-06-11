-- Phase 2 (limit entries, 2026-06-11): pending_orders carries strategy attribution
-- and the entry TTL so the promoter can stamp trades.strategy and the TTL canceller
-- (src/runtime/entry-ttl.ts) knows each order's expiry without hardcoding.
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS strategy TEXT;
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS ttl_minutes INTEGER;

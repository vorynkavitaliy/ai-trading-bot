-- Migration 004: Coinglass liquidation snapshot tables — allow NULL liq values.
-- Bybit/Coinglass occasionally return null for an exchange's long_liq_usd or
-- short_liq_usd (data outage on exchange side). NOT NULL constraint crashed every
-- cg-incremental run. Trading-critical data (per-pair cg_liq_pair) is unaffected.

ALTER TABLE cg_liq_exchange_snapshot ALTER COLUMN long_liq_usd DROP NOT NULL;
ALTER TABLE cg_liq_exchange_snapshot ALTER COLUMN short_liq_usd DROP NOT NULL;

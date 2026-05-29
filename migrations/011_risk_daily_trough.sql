-- Extends risk_daily_peak with trough_equity = lowest equity observed AFTER the
-- peak was set today. Required for the HyroTrader-faithful DDD formula:
--
--   DDD = today's highest equity (peak) − the lowest equity AFTER that peak
--         (including unrealized P&L)
--
-- The previous code measured DDD against the CURRENT equity, which means kill
-- switches only fired while equity sat at the low. If equity bounced back
-- before the next risk-guard cycle, the breach was missed. HyroTrader does
-- not forgive — once -5% from peak has been touched, the account is dead.
-- We must persist the trough so kill switches latch on the worst point seen.
--
-- Semantics:
--   - On every UPSERT, if currentEquity > stored peak → new peak, trough resets
--     to the new peak (a fresh leg starts).
--   - Otherwise peak stays, trough = LEAST(stored trough, currentEquity).
--   - DDD = (trough - peak) / peak * 100  (always ≤ 0).
--
-- Backfill: existing rows from migration 010 have peak only. Setting
-- trough_equity = peak_equity gives the safe default (no drawdown observed
-- yet); subsequent UPSERTs will lower it as equity moves below peak.

ALTER TABLE risk_daily_peak
  ADD COLUMN IF NOT EXISTS trough_equity NUMERIC(20, 8);

UPDATE risk_daily_peak
  SET trough_equity = peak_equity
  WHERE trough_equity IS NULL;

ALTER TABLE risk_daily_peak
  ALTER COLUMN trough_equity SET NOT NULL;

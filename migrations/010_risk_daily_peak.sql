-- Per-UTC-day peak equity tracking for trailing-peak DDD calculation.
--
-- HyroTrader (and most prop firms) measure daily drawdown from the intraday
-- PEAK equity, not from open-of-day. Without tracking the peak, an account
-- can be terminated for hitting -5% from peak while our internal monitor —
-- which measured from open — still showed "we're fine".
--
-- Usage pattern: each risk-guard cycle UPSERTs the current equity into this
-- table for today's UTC date; the GREATEST clause keeps only the highest value
-- seen. DDD = (currentEquity - peak) / peak * 100. Soft/hard kill thresholds
-- compare against this from-peak DDD instead of dailyPnlPct from open.

CREATE TABLE IF NOT EXISTS risk_daily_peak (
  utc_day DATE PRIMARY KEY,
  peak_equity NUMERIC(20, 8) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_daily_peak_day ON risk_daily_peak (utc_day DESC);

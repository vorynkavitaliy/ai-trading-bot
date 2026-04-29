-- 002_coinglass.sql — cross-exchange aggregates from Coinglass v4 (Hobbyist tier)
-- Min interval available: 4h. We store 4h granularity for history endpoints
-- and snapshot tables for the real-time coin/exchange lists.

-- Aggregated OI (cross-exchange) OHLC, 4h
CREATE TABLE IF NOT EXISTS cg_oi_aggregated (
  symbol TEXT NOT NULL,           -- 'BTC', 'ETH'
  ts BIGINT NOT NULL,             -- ms
  oi_open NUMERIC(28, 8) NOT NULL,
  oi_high NUMERIC(28, 8) NOT NULL,
  oi_low NUMERIC(28, 8) NOT NULL,
  oi_close NUMERIC(28, 8) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

-- OI-weighted funding rate OHLC, 4h
CREATE TABLE IF NOT EXISTS cg_funding_oi_weighted (
  symbol TEXT NOT NULL,
  ts BIGINT NOT NULL,
  fr_open NUMERIC(12, 8) NOT NULL,
  fr_high NUMERIC(12, 8) NOT NULL,
  fr_low NUMERIC(12, 8) NOT NULL,
  fr_close NUMERIC(12, 8) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

-- Vol-weighted funding rate OHLC, 4h
CREATE TABLE IF NOT EXISTS cg_funding_vol_weighted (
  symbol TEXT NOT NULL,
  ts BIGINT NOT NULL,
  fr_open NUMERIC(12, 8) NOT NULL,
  fr_high NUMERIC(12, 8) NOT NULL,
  fr_low NUMERIC(12, 8) NOT NULL,
  fr_close NUMERIC(12, 8) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

-- Global account-based L/S ratio, 4h, per pair on a specific exchange
CREATE TABLE IF NOT EXISTS cg_ls_global_account (
  exchange TEXT NOT NULL,         -- 'Binance' etc
  pair TEXT NOT NULL,             -- 'BTCUSDT'
  ts BIGINT NOT NULL,
  long_pct NUMERIC(8, 4) NOT NULL,
  short_pct NUMERIC(8, 4) NOT NULL,
  ratio NUMERIC(10, 4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

-- Top trader L/S by account count
CREATE TABLE IF NOT EXISTS cg_ls_top_account (
  exchange TEXT NOT NULL,
  pair TEXT NOT NULL,
  ts BIGINT NOT NULL,
  long_pct NUMERIC(8, 4) NOT NULL,
  short_pct NUMERIC(8, 4) NOT NULL,
  ratio NUMERIC(10, 4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

-- Top trader L/S by position size
CREATE TABLE IF NOT EXISTS cg_ls_top_position (
  exchange TEXT NOT NULL,
  pair TEXT NOT NULL,
  ts BIGINT NOT NULL,
  long_pct NUMERIC(8, 4) NOT NULL,
  short_pct NUMERIC(8, 4) NOT NULL,
  ratio NUMERIC(10, 4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

-- Taker buy/sell history per pair on a specific exchange
CREATE TABLE IF NOT EXISTS cg_taker_pair (
  exchange TEXT NOT NULL,
  pair TEXT NOT NULL,
  ts BIGINT NOT NULL,
  buy_usd NUMERIC(20, 4) NOT NULL,
  sell_usd NUMERIC(20, 4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

-- Liquidation history per pair on a specific exchange
CREATE TABLE IF NOT EXISTS cg_liq_pair (
  exchange TEXT NOT NULL,
  pair TEXT NOT NULL,
  ts BIGINT NOT NULL,
  long_liq_usd NUMERIC(20, 4) NOT NULL,
  short_liq_usd NUMERIC(20, 4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

-- Real-time snapshot: top coins by liquidation volume, captured on cycle.
-- Used to gauge market-wide liquidation stress in real time.
CREATE TABLE IF NOT EXISTS cg_liq_coin_snapshot (
  ts BIGINT NOT NULL,             -- snapshot capture time
  symbol TEXT NOT NULL,
  liq_24h NUMERIC(24, 4),
  long_liq_24h NUMERIC(24, 4),
  short_liq_24h NUMERIC(24, 4),
  liq_12h NUMERIC(24, 4),
  long_liq_12h NUMERIC(24, 4),
  short_liq_12h NUMERIC(24, 4),
  liq_4h NUMERIC(24, 4),
  long_liq_4h NUMERIC(24, 4),
  short_liq_4h NUMERIC(24, 4),
  liq_1h NUMERIC(24, 4),
  long_liq_1h NUMERIC(24, 4),
  short_liq_1h NUMERIC(24, 4),
  PRIMARY KEY (ts, symbol)
);
CREATE INDEX IF NOT EXISTS idx_cg_liq_coin_ts ON cg_liq_coin_snapshot (ts DESC);

-- Real-time snapshot: liquidations per exchange in given range
CREATE TABLE IF NOT EXISTS cg_liq_exchange_snapshot (
  ts BIGINT NOT NULL,
  range_label TEXT NOT NULL,      -- '1h', '4h', '12h', '24h'
  exchange TEXT NOT NULL,
  liq_usd NUMERIC(24, 4) NOT NULL,
  long_liq_usd NUMERIC(24, 4) NOT NULL,
  short_liq_usd NUMERIC(24, 4) NOT NULL,
  PRIMARY KEY (ts, range_label, exchange)
);

-- Heatmap snapshots fetched via WebFetch from Coinglass public pages.
-- We store the most recent N price/leverage clusters above and below
-- current price for each pair. JSON for flexibility.
CREATE TABLE IF NOT EXISTS cg_heatmap_snapshot (
  ts BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  range_label TEXT NOT NULL,       -- '24h' '12h' etc
  price_at_capture NUMERIC(20, 8),
  clusters JSONB NOT NULL,         -- [{price, leverage, intensity, side: 'above'|'below'}, ...]
  raw JSONB,                       -- original payload for re-parsing if needed
  PRIMARY KEY (ts, symbol, range_label)
);
CREATE INDEX IF NOT EXISTS idx_cg_heatmap_ts ON cg_heatmap_snapshot (ts DESC);

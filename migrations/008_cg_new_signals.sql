-- Coinbase Premium Index — gap between Coinbase BTC and Binance BTC.
-- Positive premium = US institutional demand stronger than offshore.
CREATE TABLE IF NOT EXISTS cg_cb_premium (
  ts BIGINT NOT NULL,
  premium NUMERIC(20, 4) NOT NULL,            -- absolute $ gap
  premium_rate NUMERIC(10, 6) NOT NULL,       -- relative %
  coinbase_price NUMERIC(20, 4) NOT NULL,
  PRIMARY KEY (ts)
);
CREATE INDEX IF NOT EXISTS idx_cg_cb_premium_ts ON cg_cb_premium (ts DESC);

-- BTC spot ETF net flows (daily). flow_usd is net (inflow - outflow) summed across all spot BTC ETFs.
CREATE TABLE IF NOT EXISTS cg_btc_etf_flow (
  ts BIGINT NOT NULL,
  flow_usd NUMERIC(20, 4) NOT NULL,
  price_usd NUMERIC(20, 4) NOT NULL,
  PRIMARY KEY (ts)
);

-- Cross-exchange aggregated taker volume (per-coin, 4h).
CREATE TABLE IF NOT EXISTS cg_agg_taker_coin (
  symbol TEXT NOT NULL,
  ts BIGINT NOT NULL,
  agg_buy_usd NUMERIC(20, 4) NOT NULL,
  agg_sell_usd NUMERIC(20, 4) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

-- Cross-exchange aggregated liquidations (per-coin, 4h).
CREATE TABLE IF NOT EXISTS cg_agg_liq_coin (
  symbol TEXT NOT NULL,
  ts BIGINT NOT NULL,
  agg_long_liq_usd NUMERIC(20, 4) NOT NULL,
  agg_short_liq_usd NUMERIC(20, 4) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

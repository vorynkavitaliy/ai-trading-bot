-- 5m-granular CG data for fine-timing research. 15-day coverage on Standard plan.
CREATE TABLE IF NOT EXISTS cg_ls_top_position_5m (
  exchange TEXT NOT NULL, pair TEXT NOT NULL, ts BIGINT NOT NULL,
  long_pct NUMERIC(10,4) NOT NULL, short_pct NUMERIC(10,4) NOT NULL, ratio NUMERIC(10,4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

CREATE TABLE IF NOT EXISTS cg_funding_oi_5m (
  symbol TEXT NOT NULL, ts BIGINT NOT NULL,
  fr_open NUMERIC(12,8) NOT NULL, fr_high NUMERIC(12,8) NOT NULL,
  fr_low NUMERIC(12,8) NOT NULL, fr_close NUMERIC(12,8) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

CREATE TABLE IF NOT EXISTS cg_taker_pair_5m (
  exchange TEXT NOT NULL, pair TEXT NOT NULL, ts BIGINT NOT NULL,
  buy_usd NUMERIC(20,4) NOT NULL, sell_usd NUMERIC(20,4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

CREATE TABLE IF NOT EXISTS cg_liq_pair_5m (
  exchange TEXT NOT NULL, pair TEXT NOT NULL, ts BIGINT NOT NULL,
  long_liq_usd NUMERIC(20,4) NOT NULL, short_liq_usd NUMERIC(20,4) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

CREATE TABLE IF NOT EXISTS cg_oi_aggregated_5m (
  symbol TEXT NOT NULL, ts BIGINT NOT NULL,
  oi_open NUMERIC(20,4) NOT NULL, oi_high NUMERIC(20,4) NOT NULL,
  oi_low NUMERIC(20,4) NOT NULL, oi_close NUMERIC(20,4) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

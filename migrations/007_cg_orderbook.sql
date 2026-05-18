-- Coinglass orderbook depth history (Standard tier endpoint /futures/orderbook/ask-bids-history)
-- Captures total bids/asks within ±5% of market price for the pair, 4h interval.
-- Used to compute imbalance ratios for entry quality gates.
CREATE TABLE IF NOT EXISTS cg_orderbook_pair (
  exchange TEXT NOT NULL,
  pair TEXT NOT NULL,
  ts BIGINT NOT NULL,
  bids_usd NUMERIC(20, 4) NOT NULL,
  asks_usd NUMERIC(20, 4) NOT NULL,
  bids_qty NUMERIC(20, 8) NOT NULL,
  asks_qty NUMERIC(20, 8) NOT NULL,
  PRIMARY KEY (exchange, pair, ts)
);

CREATE INDEX IF NOT EXISTS idx_cg_ob_pair_ts ON cg_orderbook_pair (pair, ts DESC);

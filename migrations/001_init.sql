-- 001_init.sql — base schema for trading bot v3
-- Run via: npm run db:migrate

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- OHLCV candles, partitioned-friendly via (symbol, tf, ts)
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,           -- '1m', '5m', '15m', '60m' (1H), '240m' (4H)
  ts BIGINT NOT NULL,         -- bar open time, unix ms
  open NUMERIC(20, 8) NOT NULL,
  high NUMERIC(20, 8) NOT NULL,
  low NUMERIC(20, 8) NOT NULL,
  close NUMERIC(20, 8) NOT NULL,
  volume NUMERIC(28, 8) NOT NULL,
  turnover NUMERIC(28, 8),
  PRIMARY KEY (symbol, tf, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_symbol_tf_ts ON candles (symbol, tf, ts DESC);

-- Funding rate history (Bybit posts every 8h)
CREATE TABLE IF NOT EXISTS funding_history (
  symbol TEXT NOT NULL,
  ts BIGINT NOT NULL,         -- funding time, unix ms
  rate NUMERIC(12, 8) NOT NULL,
  PRIMARY KEY (symbol, ts)
);

-- Open interest snapshots (sampled every 5m)
CREATE TABLE IF NOT EXISTS oi_history (
  symbol TEXT NOT NULL,
  ts BIGINT NOT NULL,
  oi NUMERIC(28, 8) NOT NULL, -- contracts
  PRIMARY KEY (symbol, ts)
);

-- Trades — one row per executed entry/exit on a sub-account key
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  account_bucket TEXT NOT NULL,   -- '200000' | '50000'
  account_key TEXT NOT NULL,      -- 'key1', 'key2', ...
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,             -- 'Buy' | 'Sell'
  order_type TEXT NOT NULL,       -- 'Market' | 'Limit'
  qty NUMERIC(28, 8) NOT NULL,
  entry_price NUMERIC(20, 8),
  exit_price NUMERIC(20, 8),
  sl NUMERIC(20, 8),
  tp1 NUMERIC(20, 8),
  tp2 NUMERIC(20, 8),
  status TEXT NOT NULL,           -- 'pending' | 'open' | 'closed' | 'cancelled'
  pnl_usd NUMERIC(20, 8),
  realized_r NUMERIC(10, 4),
  fees_usd NUMERIC(20, 8),
  funding_usd NUMERIC(20, 8),
  rationale TEXT,
  bybit_order_id TEXT,
  vault_trade_file TEXT,          -- path to vault/Trades/*.md
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades (account_bucket, account_key);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status) WHERE status IN ('pending', 'open');
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades (opened_at DESC);

-- Position snapshots (5m cadence) for DD tracking and reconcile
CREATE TABLE IF NOT EXISTS positions_snapshot (
  ts BIGINT NOT NULL,
  account_bucket TEXT NOT NULL,
  account_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT,
  size NUMERIC(28, 8) NOT NULL,
  entry_price NUMERIC(20, 8),
  unrealized_pnl NUMERIC(20, 8),
  equity NUMERIC(20, 8) NOT NULL,
  PRIMARY KEY (ts, account_bucket, account_key, symbol)
);
CREATE INDEX IF NOT EXISTS idx_positions_ts ON positions_snapshot (ts DESC);

-- Cycle journal events (lighter than vault Journal — for queries/analytics)
CREATE TABLE IF NOT EXISTS journal_events (
  id BIGSERIAL PRIMARY KEY,
  ts BIGINT NOT NULL,
  cycle_id TEXT NOT NULL,
  event_type TEXT NOT NULL,       -- 'open' | 'close' | 'sl' | 'tp' | 'abort' | 'regime_flip' | 'news' | 'heartbeat' | 'kill_switch' | ...
  symbol TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_ts ON journal_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_journal_event_type ON journal_events (event_type);

-- Regime snapshots (per pair, per 1H close)
CREATE TABLE IF NOT EXISTS regime_snapshots (
  ts BIGINT NOT NULL,             -- 1H bar close ts
  symbol TEXT NOT NULL,
  regime TEXT NOT NULL,           -- 'range' | 'trend_bull' | 'trend_bear' | 'transition'
  adx NUMERIC(8, 4),
  ema_stack_aligned BOOLEAN,
  rsi NUMERIC(8, 4),
  atr_pct NUMERIC(8, 4),
  payload JSONB,
  PRIMARY KEY (ts, symbol)
);

-- News events — fetched and classified
CREATE TABLE IF NOT EXISTS news_events (
  id BIGSERIAL PRIMARY KEY,
  ts BIGINT NOT NULL,
  source TEXT NOT NULL,           -- 'cryptopanic' | 'cointelegraph' | 'reuters' | 'websearch' | 'forexfactory'
  category TEXT NOT NULL,         -- 'fomc' | 'cpi' | 'nfp' | 'rate_decision' | 'etf_flow' | 'regulation' | 'hack' | 'geopolitics' | 'whale' | 'other'
  impact TEXT NOT NULL,           -- 'high' | 'medium' | 'low' | 'noise'
  symbols_affected TEXT[],
  title TEXT NOT NULL,
  url TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_news_ts ON news_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_news_impact ON news_events (impact) WHERE impact IN ('high', 'medium');

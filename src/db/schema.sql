-- ═══════════════════════════════════════════════════
--  Claude Trading Bot — PostgreSQL schema
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trades (
  id              BIGSERIAL PRIMARY KEY,
  account_label   TEXT        NOT NULL,
  account_volume  NUMERIC     NOT NULL,
  symbol          TEXT        NOT NULL,
  direction       TEXT        NOT NULL CHECK (direction IN ('Long','Short')),
  entry_price     NUMERIC     NOT NULL,
  qty             NUMERIC     NOT NULL,
  stop_loss       NUMERIC,
  take_profit     NUMERIC,
  rr              NUMERIC,
  risk_pct        NUMERIC,
  risk_usd        NUMERIC,
  confluence      INTEGER,
  regime          TEXT,
  order_id        TEXT,
  order_link_id   TEXT,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  exit_price      NUMERIC,
  exit_reason     TEXT,
  pnl_usd         NUMERIC,
  pnl_pct         NUMERIC,
  r_multiple      NUMERIC,
  fees_usd        NUMERIC,
  meta            JSONB
);

CREATE INDEX IF NOT EXISTS trades_account_idx ON trades (account_label);
CREATE INDEX IF NOT EXISTS trades_symbol_idx  ON trades (symbol);
CREATE INDEX IF NOT EXISTS trades_open_idx    ON trades (closed_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS trades_opened_idx  ON trades (opened_at DESC);

-- Equity snapshots — used for daily DD calculation
CREATE TABLE IF NOT EXISTS equity_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  account_label   TEXT        NOT NULL,
  account_volume  NUMERIC     NOT NULL,
  equity          NUMERIC     NOT NULL,
  available       NUMERIC,
  unrealised_pnl  NUMERIC,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS equity_account_time_idx ON equity_snapshots (account_label, taken_at DESC);

-- Daily peak cache (1 row per account per UTC day)
CREATE TABLE IF NOT EXISTS daily_peaks (
  account_label   TEXT        NOT NULL,
  utc_day         DATE        NOT NULL,
  peak_equity     NUMERIC     NOT NULL,
  start_equity    NUMERIC     NOT NULL,
  PRIMARY KEY (account_label, utc_day)
);

-- Audit log — every meaningful action
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  level           TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  event           TEXT        NOT NULL,
  account_label   TEXT,
  symbol          TEXT,
  message         TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_event_idx   ON audit_log (event);

-- Signals — every confluence evaluation, even if not traded
CREATE TABLE IF NOT EXISTS signals (
  id              BIGSERIAL PRIMARY KEY,
  symbol          TEXT        NOT NULL,
  direction       TEXT        NOT NULL,
  confluence      INTEGER     NOT NULL,
  regime          TEXT,
  scores          JSONB,
  executed        BOOLEAN     NOT NULL DEFAULT FALSE,
  reject_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signals_symbol_idx  ON signals (symbol, created_at DESC);

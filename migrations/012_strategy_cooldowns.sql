-- Strategy-level same-direction cooldown, persisted across processes.
--
-- Why DB-persisted: scan-decide runs as `npx tsx src/runtime/scan-decide.ts` from
-- scripts/cycle.sh every 5 minutes. Each invocation is a fresh node process, so
-- the previous in-process Map in cg-fade.ts (`lastEntryByPair`) was always empty
-- in production — the 6h same-direction cooldown was a no-op live. Backtests of
-- the live universe with cooldown disabled vs design (CD=6h) showed a +11pp/yr
-- and ~2× drawdown gap, so this hole was material.
--
-- Semantics (mirrors the in-process Map):
--   key = (symbol, side); value = last entry timestamp in epoch ms.
--   Strategy reads: "was there an entry on (symbol, side) within last N hours?"
--   Strategy writes: UPSERT on entry, never going backwards in time.
--
-- Backtest engines keep using the in-process Map (much faster, no DB hit per
-- decision tick). Live path loads this table once per scan-decide cycle into a
-- Map and passes it via StrategyContext.cooldownState.

CREATE TABLE IF NOT EXISTS strategy_cooldowns (
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,            -- 'long' or 'short'
  last_entry_ts BIGINT NOT NULL, -- epoch ms
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, side)
);

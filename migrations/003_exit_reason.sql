-- Migration 003: add exit_reason column to trades
-- Records how a closed position exited: 'sl' | 'tp1' | 'tp2' | 'tp1_then_sl_be' | 'manual' | 'time_stop' | 'external'
-- Populated by reconcile auto-close logic when DB-open is detected without Bybit position.

ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_trades_status_exit ON trades (status, exit_reason);

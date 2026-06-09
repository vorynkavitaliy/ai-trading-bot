-- Record the strategy SIGNAL price (decision/last-closed-bar price the strategy used
-- to compute SL/TP/size) separately from the actual FILL price stored in entry_price.
--
-- Why: entries are MARKET orders (since 2026-06-04) that fill at the live price moments
-- after the bar-close signal. SL/TP/sizing are anchored to the signal price, so when the
-- fill drifts the realized risk and R:R drift too — the live-vs-backtest slippage gap.
-- We couldn't measure it cleanly because the signal price wasn't stored (only reconstructable
-- from sl/tp on the single-target book). This column captures it directly going forward so
-- entry slippage = signal_price − entry_price is exact per trade. Read by
-- src/tools/diagnostics/entry-slippage.ts.
--
-- Populated by both INSERT sites: execute.ts persistTrade (= args.entryPrice) and
-- pending-promoter.ts (= pending.entryPrice). Nullable — old rows stay NULL and fall back
-- to sl/tp reconstruction in the diagnostic. NOTE: slippage is only measurable on rows where
-- entry_price holds the real fill (the daemon-promoter path, which wins for market orders);
-- on the persistTrade fallback path entry_price == signal_price so slippage reads 0.

ALTER TABLE trades ADD COLUMN IF NOT EXISTS signal_price NUMERIC;

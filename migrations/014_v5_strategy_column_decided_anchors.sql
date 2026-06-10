-- v5 cgSlowFade migration support (2026-06-10).
--
-- 1) trades.strategy — which strategy opened the trade (strategy.name from
--    pair-strategies). NULL for manual/legacy trades; the 48h max-hold enforcer
--    (src/runtime/max-hold.ts) only acts on rows whose strategy matches the
--    cg-slow-fade-v5 prefix, so operator-discretionary positions are never touched.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy TEXT;

-- 2) decided_anchors — once-per-4H-bar decision latch for v5 strategies.
--    The validated srcNew engine decides exactly once per (pair, closed 4H bar);
--    live scan-decide runs hourly, so without this latch a blocked signal re-fires
--    at +1/+2/+3h on an identical anchor. scan-decide skips strategy.decide() for
--    a pair when the stored anchor_ts equals the current anchor bar's ts.
--    DB-persisted because every cron tick is a fresh `npx tsx` fork.
CREATE TABLE IF NOT EXISTS decided_anchors (
  pair TEXT PRIMARY KEY,
  anchor_ts BIGINT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

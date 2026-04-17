---
name: Active Watchlist
description: Specific setups I am hunting. Triggered or invalidated setups are removed.
updated: 2026-04-17T09:00:00Z
---

# Active Watchlist

> Setups I am waiting for. Each has a trigger condition and an invalidation. When a setup either triggers or invalidates, I remove it from this list.

---

## Format

```markdown
### [PAIR] — [LONG|SHORT] — [setup name]

- **Trigger:** [specific condition]
- **Entry zone:** [price range]
- **SL:** [price, why this level]
- **TP:** [price, 1.5R+ target at structural level]
- **Confluence factors active:** [list]
- **Expected score at trigger:** [X/8]
- **Session window:** [when I expect this to resolve]
- **Invalidation:** [what kills this setup]
- **Added:** [YYYY-MM-DD HH:MM UTC]
```

---

## Active Setups

*Empty — BNB triggered 11:01 UTC and moved to active position.*

---

## Recently Removed (last 24h)

- **BNBUSDT LONG** — TRIGGERED 2026-04-17 11:01:34 UTC. Fill: 629.9, SL 626.2, TP 635.5, R:R 1.51. Trade file: `Trades/2026-04-17_BNBUSDT_long.md`. Thesis: `Thesis/BNBUSDT.md`.

*Keep here briefly for postmortem context, then archive.*

- **AVAXUSDT LONG** — removed twice today: 08:18 (first flicker), re-added 08:24, removed again 08:30 (second flicker). 4th flicker at 09:00 confirms instability. Setup will not re-add without 3+ consecutive 6/8 cycles.
- **LINKUSDT LONG** — removed 2026-04-17 09:00 UTC. R:R dropped <1.0 for 3 consecutive cycles (0.95 → 0.72 → 0.76) — own invalidation rule triggered. SHORT score also climbed to 4/8 (proactive-exit equivalent). Setup dead without fresh structural reset. Process outcome: no chase, no loss.
- **DOGEUSDT LONG** — removed 2026-04-17 10:45 UTC. Confluence dropped 6/8 → 5/8 per own invalidation rule. R:R trajectory today 1.48→1.44→1.46→1.40 never crossed the 1.5 trigger before confluence broke. Outcome: zero position, zero loss — R:R floor + confluence floor both did their job. Re-add only on fresh structural reset (not on score flicker back to 6/8).

---
symbol: BNBUSDT
bias: neutral-post-win
conviction: 1
timeframe_bias:
  "4H": neutral
  "1H": neutral
  "15M": neutral
key_levels:
  support: ["629.9 (prior entry)", "626.2 (prior SL — unused)"]
  resistance: ["635.3 (prior TP fill)", "635.5 (prior TP trigger)"]
  invalidation: "accept next scanner entry on its own merits; no categorical re-entry block"
regime: transitional
btc_correlation: "exchange-token, less BTC-correlated than alts"
last_trade_outcome: "closed +1.46R (TP hit during cron outage, +$397.26)"
updated: 2026-04-17T14:07:00Z
---

# BNBUSDT — Current Thesis

**Stance:** Neutral, flat after +1.46R win. TP 635.5 hit cleanly during cron-offline window (~13:XX UTC). Server-side reduce-only Market fill at 635.3 (minor slippage).

## Current Read

- Position closed by TP during cron outage 12:31 → 14:00 UTC.
- Entry 629.9 → exit 635.3, duration ~2h, cleanly mechanical throughout.
- Process grade A (postmortem `Postmortem/2026-04-17_BNBUSDT_long.md`).

## Re-entry Criteria

- Accept next scanner trigger on its own merits (5/8+ standard threshold, R:R ≥1.5, BTC not adverse).
- No categorical block post-win. If scanner fires and conditions meet entry rules, take it.

## Structural Levels

- **Prior entry 629.9** — acted as demand this session.
- **Prior TP 635.5** — acted as supply; broken to 635.3+ on TP fill.
- **Next resistance:** need fresh read on 1H / 4H for actual supply zones.

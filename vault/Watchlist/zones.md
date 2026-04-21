---
name: Pre-committed Zones
description: Target + invalidation zones marked at 1H close. Decisions trigger only when price enters or sweeps a zone.
updated: 2026-04-21T03:30:00Z
---

## How this file works
- Written by Claude at each 1H candle close (24h).
- Each zone = specific price level with type, side, invalidation.
- /loop 3m fires full 12-factor rubric ONLY when price is in-zone or zone was swept last 15m.
- Zones expire 24h after created_at OR on invalidation.
- **2026-04-21:** Watchlist narrowed to BTCUSDT only. Alt sections removed (history in git). Re-add zones when alts return to watchlist.

## Zone types
- `liq_cluster` — liquidation cluster (Bybit liq heatmap, CoinGlass, whale stops)
- `poc` — point of control (volume profile, naked POC from prior day)
- `vah` / `val` — value area high/low (70% volume range edges)
- `ob` — order block (last opposite candle before BOS)
- `htf_pivot` — 4H/1H swing high/low
- `round` — psychological round number
- `ema21_1h` / `ema55_1h` — moving average retests when 1H trend aligned
- `prior_day_hl` — previous UTC-day high/low

## Active zones

### BTCUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 75000 | pivot | 2026-04-20T14:15:00Z | never | psychological, tested 3× 2026-04-20 |
| round | 74000 | pivot | 2026-04-20T14:15:00Z | never | psychological / liq magnet below |
| round | 77000 | pivot | 2026-04-20T20:00:00Z | never | next psych above |
| round | 76000 | pivot | 2026-04-21T10:00:00Z | never | psychological, bid zone tested in pullback |
| htf_pivot | 76500 | support | 2026-04-21T11:00:00Z | 1H close < 76400 | flipped от resistance к support after 10:45 breakout |
| htf_pivot | 76843 | resistance | 2026-04-21T11:00:00Z | 1H close > 76950 | new session high 10:52 after breakout, minor R |
| htf_pivot | 76300 | support | 2026-04-21T10:00:00Z | 1H close < 76200 with CVD negative | absorbed selling 09:29-09:37 |
| htf_pivot | 76150 | support | 2026-04-21T10:00:00Z | 1H close < 76050 | V-bounce low 09:36, bid wall |
| ema21_1h | 75982 | support | 2026-04-21T12:00:00Z | 1H close < 75800 | EMA21 drift +23 от 11:00 |
| ema55_1h | 75660 | support | 2026-04-21T12:00:00Z | 1H close < 75500 with CVD negative | EMA55 drift +19 от 11:00 |
| liq_cluster | 75600 | support | 2026-04-21T06:00:00Z | sweep + no reclaim 15m | absorption zone — $5.7M bid absorbed $6.62M dump at 05:45 UTC |
| liq_cluster | 73500 | support | 2026-04-20T14:15:00Z | sweep + no reclaim 15m | major stop cluster below 74k |

## Resolved zones (last 24h, kept for context)

_(none yet — file initialized 2026-04-20)_

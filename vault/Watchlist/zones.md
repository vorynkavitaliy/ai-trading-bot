---
name: Pre-committed Zones
description: Target + invalidation zones marked at 1H close. Decisions trigger only when price enters or sweeps a zone.
updated: 2026-04-20T14:15:00Z
---

## How this file works
- Written by Claude at each 1H candle close (24h).
- Each zone = specific price level with type, side, invalidation.
- /loop 3m fires full 12-factor rubric ONLY when price is in-zone or zone was swept last 15m.
- Zones expire 24h after created_at OR on invalidation.

## Zone types
- `liq_cluster` — liquidation cluster (Bybit liq heatmap, CoinGlass, whale stops)
- `poc` — point of control (volume profile, naked POC from prior day)
- `vah` / `val` — value area high/low (70% volume range edges)
- `ob` — order block (last opposite candle before BOS)
- `htf_pivot` — 4H/1H swing high/low
- `round` — psychological round number (75000, 2300, 1.40 for XRP, etc.)
- `ema21_1h` / `ema55_1h` — moving average retests when 1H trend aligned
- `prior_day_hl` — previous UTC-day high/low

## Active zones

### BTCUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 75000 | pivot | 2026-04-20T14:15:00Z | never | psychological, tested 3× today |
| round | 74000 | pivot | 2026-04-20T14:15:00Z | never | psychological / liq magnet below |
| htf_pivot | 73654 | support | 2026-04-20T14:15:00Z | 1H close < 73400 | prior-day low / 24h low |
| htf_pivot | 76121 | resistance | 2026-04-20T14:15:00Z | 1H close > 76300 | prior-day high / 24h high |
| prior_day_hl | 74500 | support | 2026-04-20T14:15:00Z | sweep + no reclaim 15m | prior-day close vicinity |
| liq_cluster | 73500 | support | 2026-04-20T14:15:00Z | sweep + no reclaim 15m | major stop cluster below 74k |

### ETHUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 2300 | pivot | 2026-04-20T14:15:00Z | never | psychological, recent reject |
| round | 2250 | pivot | 2026-04-20T14:15:00Z | never | 24h low area |
| htf_pivot | 2250 | support | 2026-04-20T14:15:00Z | 1H close < 2240 | prior-day low / sweep target |
| htf_pivot | 2340 | resistance | 2026-04-20T14:15:00Z | 1H close > 2355 | prior-day high |
| ob | 2283 | support | 2026-04-20T14:15:00Z | 15m close < 2270 | last bullish 1H OB |

### SOLUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 85 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| round | 90 | pivot | 2026-04-20T14:15:00Z | never | psychological / resistance cluster |
| htf_pivot | 82.86 | support | 2026-04-20T14:15:00Z | 1H close < 82.4 | 24h low |
| htf_pivot | 86.66 | resistance | 2026-04-20T14:15:00Z | 1H close > 87.0 | 24h high |

### BNBUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 620 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| round | 630 | pivot | 2026-04-20T14:15:00Z | never | psychological / prior TP zone |
| htf_pivot | 613.9 | support | 2026-04-20T14:15:00Z | 1H close < 612 | 24h low |
| htf_pivot | 629.1 | resistance | 2026-04-20T14:15:00Z | 1H close > 631 | 24h high |

### XRPUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 1.40 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| round | 1.45 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| htf_pivot | 1.387 | support | 2026-04-20T14:15:00Z | 1H close < 1.380 | 24h low |
| htf_pivot | 1.4396 | resistance | 2026-04-20T14:15:00Z | 1H close > 1.445 | 24h high |
| prior_day_hl | 1.4151 | support | 2026-04-20T14:15:00Z | sweep + no reclaim 15m | prior-day swept low |

### DOGEUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 0.095 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| round | 0.10 | pivot | 2026-04-20T14:15:00Z | never | psychological / major round |
| htf_pivot | 0.0924 | support | 2026-04-20T14:15:00Z | 1H close < 0.0920 | 24h low |
| htf_pivot | 0.0957 | resistance | 2026-04-20T14:15:00Z | 1H close > 0.0965 | 24h high |

### AVAXUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 9.00 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| round | 9.50 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| htf_pivot | 8.96 | support | 2026-04-20T14:15:00Z | 1H close < 8.90 | 24h low |
| htf_pivot | 9.318 | resistance | 2026-04-20T14:15:00Z | 1H close > 9.40 | 24h high |

### LINKUSDT
| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 9.00 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| round | 9.50 | pivot | 2026-04-20T14:15:00Z | never | psychological |
| htf_pivot | 8.993 | support | 2026-04-20T14:15:00Z | 1H close < 8.95 | 24h low |
| htf_pivot | 9.355 | resistance | 2026-04-20T14:15:00Z | 1H close > 9.40 | 24h high |

## Resolved zones (last 24h, kept for context)

_(none yet — file initialized 2026-04-20)_

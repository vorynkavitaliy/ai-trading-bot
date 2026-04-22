---
name: Zones + Regime State
description: Dynamic zones are BB(20,2) bands computed live. Manual zones only for exceptional structural levels (liq clusters, round numbers, major pivots). Regime state snapshot per pair.
updated: 2026-04-22T11:00:00Z
version: 2.0
---

# Zones + Regime State

## How this file works (v2)

**Primary zones = dynamic.** BB(20, 2.0) на 1H вычисляются live из `scan-data.ts`. Этот файл их НЕ дублирует — он логирует только **manual overrides**:

- Liquidation clusters (CoinGlass heatmap, обновлять при resolved)
- Psychological round numbers (78000, 80000, 2500, 200) для reference
- Major 4H swing highs/lows (1x-3x в неделю update)

Regime state (ADX, EMA alignment, HMM) — обновляется автоматически `scan-summary.ts`.

**Write-cadence:** 1H close при любом из:
1. Major manual zone invalidated (swept, closed beyond, time-expired >3 days)
2. New major level formed (4H pivot established, liq cluster identified via WebSearch)
3. Regime flipped на паре (A → B или B → A)

---

## Regime state (auto-updated)

Last refresh: 2026-04-22T12:10:15Z (first v2 cycle).

| Pair | ADX(1H) | EMA stack | Regime | Active playbook |
|---|---|---|---|---|
| BTCUSDT | 33.7 | bullish (8>21>55>200) | TREND | B |
| ETHUSDT | N/A (no scan) | N/A | N/A | N/A |
| SOLUSDT | N/A (no scan) | N/A | N/A | N/A |

Note: scanner outputs only pairs with open positions/triggers; ETH/SOL had neither this cycle.

---

## Manual zones (exceptional structural levels)

### BTCUSDT

| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 80000 | resistance | — | never, structural psych | mega magnet if approached |
| round | 75000 | pivot | — | never, structural psych | recent battle level |
| round | 70000 | support | — | never, structural psych | macro support |

### ETHUSDT

| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 2500 | resistance | — | never, structural psych | major psych barrier |
| round | 2300 | pivot | — | never, structural psych | recent consolidation midpoint |
| round | 2000 | support | — | never, structural psych | macro psych support |

### SOLUSDT

| type | level | side | created_at | invalidation | notes |
|---|---|---|---|---|---|
| round | 200 | resistance | — | never, structural psych | major psych barrier |
| round | 180 | pivot | — | never, structural psych | — |
| round | 150 | support | — | never, structural psych | macro psych support |

---

## Liquidation clusters (update weekly via WebSearch CoinGlass)

### BTCUSDT
_No cluster tracked yet — add on WebSearch trigger._

### ETHUSDT
_No cluster tracked yet._

### SOLUSDT
_No cluster tracked yet._

---

## Resolved zones (last 7 days)

_Empty — fresh start after strategy-v2 refactor._

---

## Zone types (reference)

- `round` — psychological number, never expires on price alone
- `liq_cluster` — liquidation heatmap density (CoinGlass) — expires when swept + 15m no reclaim
- `htf_pivot` — 4H swing high/low — expires on 1H close beyond >0.5% + structural confirmation
- `ob` — order block (last opposite-colored candle before 1H BOS) — expires on opposite 1H BOS

**BB bands, EMA lines, SMA20** — NOT listed here. They are dynamic, computed per cycle from scanner data.

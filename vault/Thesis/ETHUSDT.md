---
name: ETHUSDT Thesis
description: Primary pair under strategy-v2. Best edge in walk-forward OOS.
symbol: ETHUSDT
role: primary
updated: 2026-04-22T11:00:00Z
version: 2.0
---

# ETHUSDT Thesis

## Role

**Primary pair.** Walk-forward OOS: +12.81R / 92d, PF 1.43, 50 trades. **Самая чистая range/trend механика** из 3 пар. Priority для execution — при конфликте сигналов (несколько пар одновременно в зоне) предпочтение ETH.

## Current regime (2026-04-22T17:24 UTC)

- ADX(1H): **35.2** (strong trend)
- EMA stack: **bullish** (8=2393 > 21=2375 > 55=2349 > 200=2342)
- Regime: **TREND**
- Active playbook: **B** (pullback trend-follow)
- PDI/MDI: 25.8 / 12.0 (bull dominance 2.2×)
- Price: 2387.68 (+1.66% от EMA55)
- **B-окно EMA55 ±0.5% = 2337-2360**, distance −1.31% (~28pt)
- Active pullback: slope1h −3.47, rsi_accel1h −3.01, BOS 15m bearish, sweep low 2386.15
- Funding −0.002% near-neutral
- News impact LOW/mult 1.0 — full size if B-LONG triggers

## Priors

- ETH bull 2025→2026: +46% за 365d (из backtest). Волны bull → range → bull.
- Correlated с BTC, но собственные range-периоды чистые (меньше whipsaw чем BTC).
- Liquidity psych levels: 2500 (major R), 2300 (pivot), 2000 (major S).
- ETH-specific catalysts: ETH/BTC ratio, L2 narrative, staking yield.

## Active setups

_None — fresh v2._

## Invalidation (thesis-level)

- ETH/BTC ratio break <0.03 → ETH underperform, снизить priority.
- Close >2500 weekly с ADX>25 → full trend mode, B-playbook primary.
- Close <2000 monthly → macro breakdown, пересмотр всё.

## Notes

ETH — главный drum beater. Если WR/PF degrade на ETH первым — пересматривать стратегию целиком.

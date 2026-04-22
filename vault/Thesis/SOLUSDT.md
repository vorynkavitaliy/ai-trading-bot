---
name: SOLUSDT Thesis
description: Secondary pair, A-playbook only recommended (B performs poorly).
symbol: SOLUSDT
role: secondary
updated: 2026-04-22T11:00:00Z
version: 2.0
---

# SOLUSDT Thesis

## Role

**Secondary pair, A-only.** Walk-forward OOS: +1.68R / 92d, PF 1.09. A (range fade) работает, B (trend pullback) проваливается (−4.22R на test).

**Правило:** SOL trades через Playbook A only. Если regime == TREND — **skip SOL**, не применять B.

## Current regime (2026-04-22T17:24 UTC)

- ADX(1H): **33.5** (strong trend)
- EMA stack: **bullish** (8=88.07 > 21=87.56 > 55=86.66 > 200=86.09)
- Regime: **TREND**
- Active playbook: **SKIP** (SOL = A-only по правилу, в trend пропускаем)
- Price: 87.79 (+0.81% от EMA55) — близко но не торгуем
- Notable: **CVD5m +$1.14M с bullish divergence** — buyers тихо подбирают
- Funding +0.006% mild positive
- Жду ADX<22 для A-fade triggera

## Priors

- SOL bear-heavy: −37% за 365d из backtest, слабее BTC/ETH.
- Высокая волатильность, частые wick stops.
- Корреляция с BTC высокая; в bull-phases SOL leading alt, в bear-phases SOL amplified.
- Liquidity psych levels: 200 (R), 180 (pivot), 150 (S).

## Active setups

_None — fresh v2._

## Invalidation (thesis-level)

- Monthly close <150 → macro bear, рассмотреть исключение из universe.
- Если 20 A-trades OOS на SOL дают PF <1.1 → исключить.

## Specific to SOL

- **SOL BB edges часто false-breakout** — wick снаружи, close внутри. Именно поэтому A работает (fade), а B — нет (ADX прыгает).
- ATR% часто >3% — apply volatility scalar ×0.7.
- В funding windows ±10 мин — особенно осторожно, SOL funding может быть >+0.1%.

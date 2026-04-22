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

## Current regime (fill on first v2 cycle)

- ADX(1H): TBD
- EMA stack: TBD
- Regime: TBD
- Active playbook: TBD (A only, иначе skip)
- Last 4H bias: TBD

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

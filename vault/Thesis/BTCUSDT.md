---
name: BTCUSDT Thesis
description: Current regime + playbook selection for BTCUSDT. Fresh under strategy-v2.
symbol: BTCUSDT
role: secondary
updated: 2026-04-22T12:10:15Z
version: 2.0
---

# BTCUSDT Thesis

## Role

**Secondary pair.** Walk-forward OOS: +1.92R / 92d, PF 1.17. Edge положительный, но слабее ETH. Держим в universe т.к. это benchmark для режима + часть диверсификации.

## Current regime (2026-04-22T12:10 UTC — first v2 cycle)

- ADX(1H): **33.7** (strongly trending)
- EMA stack: **bullish** (EMA8 77954 > 21 77239 > 55 76435 > 200 75448)
- Regime: **TREND**
- Active playbook: **B** (pullback trend-follow)
- PDI/MDI: 33.8 / 10.5 (bull dominance 3.2×)
- Price: 78303 (+0.45% от EMA8)
- Open position: LONG from 78100.3 (pre-v2 entry, structurally matches B criteria)

## Priors (what's known, not actionable)

- BTC dominance ~56% (март-апрель 2026), высшее с 2021. Альты correlated. Re-evaluate alt inclusion при BTC.D <50%.
- Недавний range 73-78k с breakout попытками. Bear/consolidation преобладал последние 90 дней.
- Liquidity psych levels: 80000 (major R), 75000 (pivot), 70000 (major S).

## Active setups

_None — fresh v2._ Заполнится при первом качественном A или B triggerе per strategy.md rules.

## Invalidation (thesis-level)

- BTC.D падает <50% → пересмотреть alt inclusion, возможно вернуть больше пар.
- Дневной close >80000 AND ADX 4H >30 — макро break-out, режим shift, активировать B агрессивнее.
- Дневной close <70000 — macro breakdown, может смыть range-fade edge.

## Notes

Thesis file — **не журнал сделок**. Обновлять только при существенном изменении режима/bias (~1x в неделю). Сделки идут в Trades/ + Journal/ + Postmortem/.

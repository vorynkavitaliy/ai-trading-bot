---
name: BNBUSDT Thesis
description: Secondary pair added 2026-04-22. A-only (B fails OOS like SOL).
symbol: BNBUSDT
role: secondary
updated: 2026-04-22T14:50:00Z
version: 2.0
---

# BNBUSDT Thesis

## Role

**Secondary pair, A-only.** Walk-forward OOS (273d/92d): **+12.03R / PF 3.03**, maxDD 1.17%. Самый сильный edge среди альтов (tested AVAX/LINK/DOGE/BNB). Но Playbook B OOS показал **−0.27R** — near-zero, не оправдывает риск → A-only как SOL.

Добавлен в universe 2026-04-22 после walk-forward validation:
- Test A only: 15 trades, WR 100%, +13.07R, PF ∞, maxDD 0.00% (suspicious — вероятно overfit single regime period)
- Test B only: 13 trades, WR 23%, −0.27R (fail)
- Test Combined: 27 trades, WR 63%, +12.03R, PF 3.03 ✅

**Правило:** BNB trades через Playbook A only. Если regime == TREND — **skip BNB**.

## Current regime (fill on first cycle)

- ADX(1H): TBD
- EMA stack: TBD
- Regime: TBD
- Active playbook: TBD (A only, иначе skip)

## Priors

- BNB — CEX utility token (Binance), ниже корреляция с BTC чем у обычных альтов.
- Исторически устойчив в корректировках (utility demand компенсирует volatility).
- Liquidity psych levels: 700 (major R), 600 (pivot), 500 (major S).

## Specific to BNB

- **Test WR 100% на A — подозрительно.** Это 15 trades на одном 92-дневном периоде, может быть lucky streak regime-favorable. Будь готов увидеть WR ~70-80% в реальной торговле (среднее по train + test).
- Funding часто near-zero (низкая open interest vs BTC/ETH).
- ATR% обычно 2-3% — apply volatility scalar как норма (×1.0).

## Invalidation (thesis-level)

- Если 20 A-trades OOS на BNB дают PF <1.2 → pair paused.
- Binance regulatory risk (исторические precedents) → если SEC/EU action на Binance — pause BNB индивидуально.

## Notes

BNB + SOL обе A-only. Это важно для оператора: **в strong trend periods два из четырёх pairs отдыхают.** Effective trading universe в bull-run = BTC + ETH (2 пары, обе на B); в range = все 4 (A на BTC+ETH+SOL+BNB).

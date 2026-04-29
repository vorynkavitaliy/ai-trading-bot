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

## Current regime (2026-04-25T20:28 UTC)

- ADX(1H): **28.9** (climbing, was 16.6 at trade open 15:34 UTC — рейндж сломался intraday)
- EMA stack: **mixed bearish** (8=629.63 < 21=632.44, 55=634.64, 200=633.36 — 8/21 inverted)
- DI: MDI 30.6 vs PDI 8.9 — extreme bearish separation
- Regime: **TRANSITION** (forming bear-trend, не fully TREND из-за EMA stack mixed)
- Active playbook: **SKIP** (transition zone)
- Price: 628.60
- RSI1h 31.09 oversold но в trend down — НЕ A-LONG signal (RSI <35 only valid в RANGE по §A)
- Funding −0.0064% slightly negative
- **Recent trade outcome:** A-LONG aborted today on this regime flip, −0.34R, −$274.
- Жду ADX<22 + EMA stack stabilization (mixed → aligned либо range-flat) для следующего A setup
- Recent-close 2h cooldown active (TTL до ~22:28 UTC)

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

---
name: AVAXUSDT Thesis
description: Altcoin added 2026-04-23. A-only (+4.47% eq OOS).
symbol: AVAXUSDT
role: secondary
updated: 2026-04-23T12:35:00Z
version: 2.0
---

# AVAXUSDT Thesis

## Role

**Secondary pair, A-only.** Walk-forward OOS (273d/92d): **+8.73R / PF 1.55** на test combined, +4.47% eq growth, maxDD 2.11%. Solid альт-edge, но B проваливается (−2.11R на 9 trades).

Отдельно по playbooks:
- Test A only: 28 trades, WR 67.86%, +13.60R, PF 2.21, maxDD 1.31% ✅
- Test B only: 9 trades, WR 11%, −2.11R (fails hard)
- Test Combined: 36 trades, WR 52.78%, +8.73R, PF 1.55 ✅

**Правило:** AVAX trades через Playbook A only. Если regime == TREND — **skip AVAX**.

## Priors

- AVAX — L1 blockchain (Avalanche), ETH-competitor narrative.
- Волатильность средняя (ATR% 2.5-3.5%), чище паттерны чем на L2-альтах.
- Корреляция с SOL высокая (~0.8), с BTC средняя (~0.6).
- Liquidity на Bybit отличная, один из топ-10 по futures volume.

## Specific to AVAX

- **A WR 68% OOS — реалистично для live** (28 trades, достаточный sample).
- **B провалился резко (WR 11%).** A-only enforcement критичен.
- Funding около 0 (+/-0.005%), минимальный cost.
- Psych levels: 50 (major R), 40 (pivot), 30 (major S), 20 (deep S).

## Invalidation (thesis-level)

- Если 20 A-trades OOS на AVAX дают PF <1.3 → pair paused.
- Avalanche chain incident (outage, exploit) → pause AVAX индивидуально.
- Sharp correlation spike с SOL (>0.95 rolling 7d) → treat AVAX+SOL as one position для risk allocation.

## Notes

AVAX — классический "workhorse" альт: стабильный edge, умеренная волатильность, чистые setups. Не drama, но надёжно. Хорошо сочетается с SOL/BNB в range-периодах (три A-only L1/CEX альта покрывают разные tenors волатильности).

---
name: XLMUSDT Thesis
description: Altcoin added 2026-04-27. A-only (strongest second-batch OOS, +13.02R / 92d).
symbol: XLMUSDT
role: secondary
updated: 2026-04-27T15:00:00Z
version: 2.0
---

# XLMUSDT Thesis

## Role

**Secondary pair, A-only.** Walk-forward OOS (273d/92d): **+13.02R / PF 1.88** на test combined, +6.62% eq growth, maxDD 1.73%. Самый сильный second-batch candidate среди 12 протестированных пар (превзошёл WLD/JUP/ATOM/ENA по retention).

Отдельно по playbooks:
- Test A only: 26 trades, WR 69.23%, +13.36R, PF 2.25, maxDD 1.64% ✅
- Test B only: 6 trades, WR 16.67%, −0.34R (fails — A-only enforcement)
- Test Combined: 32 trades, WR 59.38%, +13.02R, PF 1.88 ✅

**Правило:** XLM trades через Playbook A only. Если regime == TREND — **skip XLM**.

## Priors

- XLM (Stellar Lumens) — established L1 (с 2014), payment-focused.
- Корреляция с BTC умеренная (~0.6), с XRP высокая (~0.85) — другой "payment" L1.
- Волатильность средняя-низкая (ATR% обычно 1.5-2.5%) — спокойнее чем альты.
- Liquidity на Bybit отличная, spread минимальный.
- Типично range-bound, идеален для Playbook A fade.

## Specific to XLM

- **Test WR 69% на A — solid sample** (26 trades, не тонкий sample).
- **Range-bound характер** — почему A работает: цена часто колеблется в широком range, BB lower/upper edges часто tagged.
- Funding обычно умеренный (±0.005-0.01%), редко экстремальный.
- Psych levels: 0.50 (major R), 0.40 (pivot), 0.30 (major S), 0.20 (deep S), 0.10 (extreme).
- Stellar Foundation events / SDF announcements — редкие, но могут двигать цену.

## Invalidation (thesis-level)

- Если 20 A-trades OOS на XLM дают PF <1.3 → pair paused.
- Stellar partnership/integration loss (e.g., MoneyGram exit-style событие) → pause XLM индивидуально.
- Sustained breakout из range (multi-day BB compression then expansion in one direction) → A может перестать работать; revisit A-only enforcement.

## Notes

XLM — самый "boring" pair среди новых addons, но именно поэтому надёжный для A-fade. Volatility не высокая, цена "уважает" BB-bands. Plays well с BTC/ETH когда они в range. Ожидание: ~30-40 trades/year, средняя R+, sample стабильный.

XLM добавлен в результате second batch screening (2026-04-27). Walk-forward на 12 кандидатах (HYPE, ATOM, APT, LINK, TON, KAS, TAO, WLD, ENA, XLM, PENDLE, JUP) выделил XLM + TAO как лучшие после применения OOS-gate ≥+5R. WLD и JUP были в-sample выше но провалили walk-forward (−1.24R и −10.21R OOS) — chase-prone overfit.

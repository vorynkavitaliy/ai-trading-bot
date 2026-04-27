---
name: TAOUSDT Thesis
description: Altcoin added 2026-04-27. A-only (best PF in second batch, 68% retention).
symbol: TAOUSDT
role: secondary
updated: 2026-04-27T15:00:00Z
version: 2.0
---

# TAOUSDT Thesis

## Role

**Secondary pair, A-only.** Walk-forward OOS (273d/92d): **+10.01R / PF 2.55** на test combined, +5.01% eq growth, maxDD 1.90%. Самый высокий PF среди second-batch addons (превышает XLM 1.88, AVAX 1.55, и существующих NEAR 1.42).

Отдельно по playbooks:
- Test A only: 9 trades, WR 55.56%, +11.84R, PF 3.55 ✅✅
- Test B only: 5 trades, WR 0.00%, −1.83R (fails hard — A-only enforced)
- Test Combined: 14 trades, WR 35.71%, +10.01R, PF 2.55 ✅

**Правило:** TAO trades через Playbook A only. Если regime == TREND — **skip TAO**.

## Priors

- TAO (Bittensor) — AI-narrative L1, decentralized ML network. Запущен 2021, перезапуск 2023.
- Высокая волатильность ATR% 4-6% — самый волатильный среди addons.
- Корреляция с AI-narrative tokens (FET/AGIX/RNDR) высокая в news-driven moves.
- Корреляция с BTC модерата (~0.5), независимая на news cycles.
- Тонкая liquidity vs major alts — slippage риск выше, особенно в dead zone.

## Specific to TAO

- **Test WR 56% на A — modest sample** (9 trades, low sample size).
- **PF 3.55 — высокий**, но при small sample wide confidence interval. Реалистично ожидать PF 2.0-2.5 в live.
- **Низкая частота trades:** 14 trades за 92 дня = 1 trade в неделю. Терпение обязательно.
- Funding часто positive (+0.01-0.03%) в AI-hype периоды.
- Psych levels (price ~$300): 500 (major R), 400 (pivot), 300 (current zone), 200 (major S), 100 (deep S).
- AI hype cycles → impulse spikes; A-fade на extremes часто работает после spike-ов.

## Invalidation (thesis-level)

- Если 15 A-trades OOS на TAO дают PF <1.3 → pair paused.
- AI narrative collapse (broader tech/ML pullback) → TAO может амплифицировать downside.
- Bittensor protocol failure/exploit → immediate pause.
- Extended thin-liquidity periods (>2× SMA20 spread) → caution на entry slippage.

## Notes

TAO — high-edge но low-frequency пара. **Best PF in universe** означает строгая selectivity setup-ов compensates за низкое количество trades. Ожидание: ~30-40 trades/year, очень мало но качественные.

Sample на test был только 14 trades — wide confidence interval. **Через 30 live trades переоценить** — если PF держится >2.0, пара остаётся; если <1.5 OOS на 20+ trades — pause.

TAO добавлен в результате second batch screening (2026-04-27). Из 12 кандидатов прошёл OOS-gate ≥+5R together с XLM. Лучший retention 68% (test_R/day vs train_R/day ratio) — наиболее consistent в test-периоде.

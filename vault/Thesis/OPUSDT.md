---
name: OPUSDT Thesis
description: Altcoin added 2026-04-23. A-only (strongest OOS among alts, +9.99% eq test).
symbol: OPUSDT
role: secondary
updated: 2026-04-23T12:35:00Z
version: 2.0
---

# OPUSDT Thesis

## Role

**Secondary pair, A-only.** Walk-forward OOS (273d/92d): **+19.18R / PF 2.76** на test combined, +9.99% eq growth, maxDD 1.21%. Самый сильный OOS edge среди альткоинов добавленных 2026-04-23 (OP/NEAR/AVAX/SUI).

Отдельно по playbooks:
- Test A only: 26 trades, WR 76.92%, +19.98R, PF 3.80, maxDD 1.11% ✅
- Test B only: 9 trades, WR 33%, −0.79R (fails)
- Test Combined: 35 trades, WR 65.71%, +19.18R, PF 2.76 ✅

**Правило:** OP trades через Playbook A only. Если regime == TREND — **skip OP**.

## Priors

- OP — Ethereum L2 token (Optimism), обычно движется синхронно с ETH, но с амплификацией (β≈1.3-1.5).
- Высокая волатильность (ATR% часто 3-4%) — применять volatility scalar по умолчанию.
- Liquidity на Bybit хорошая, spread низкий (0.02-0.05%).
- Корреляция с ETH по дням >0.75 — если ETH в trend, OP чаще в trend. В range-периоды более независим.

## Specific to OP

- **Test WR 77% на A — высокий.** Backtest покрыл несколько range-периодов на хорошей ликвидности. Ожидать WR 60-70% в live.
- Funding умеренно положительный (+0.01-0.03%) в bull trend → small cost для LONG.
- Psych levels: 2.00 (major R), 1.50 (pivot), 1.00 (major S), 0.70 (2024 low).
- Unlock schedule: проверить перед трейдом через WebSearch — большие token unlocks создают sharp dumps.

## Invalidation (thesis-level)

- Если 20 A-trades OOS на OP дают PF <1.5 → pair paused.
- Ethereum L2 regulatory risk (SEC) → если action на Optimism Foundation — pause OP индивидуально.
- BridgeTo-ETH security event → immediate pause.

## Notes

OP — первый L2-альт в universe. Ожидается что в bull trend OP даст меньше сигналов (A-only, в TREND skip), но на range-откатах — сильные fade setups. Синхронность с ETH значит что при concurrent OP+ETH positions учитывать correlation cap.

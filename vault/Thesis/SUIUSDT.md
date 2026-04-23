---
name: SUIUSDT Thesis
description: Altcoin added 2026-04-23. A-only (+4.06% eq OOS).
symbol: SUIUSDT
role: secondary
updated: 2026-04-23T12:35:00Z
version: 2.0
---

# SUIUSDT Thesis

## Role

**Secondary pair, A-only.** Walk-forward OOS (273d/92d): **+8.21R / PF 1.65** на test combined, +4.06% eq growth, maxDD 1.64%. Самый новый L1 в universe.

Отдельно по playbooks:
- Test A only: 20 trades, WR 60%, +6.64R, PF 1.65, maxDD 2.41% ✅
- Test B only: 9 trades, WR 44.44%, +1.20R (marginal, near-zero edge)
- Test Combined: 28 trades, WR 57.14%, +8.21R, PF 1.65 ✅

**Правило:** SUI trades через Playbook A only. В TREND regime — skip (B near-zero edge, не оправдывает risk of new-chain volatility).

## Priors

- SUI — новый L1 (Mysten Labs), Move-language, запущен май 2023.
- Высокая волатильность ATR% 3-5% — "молодая" монета.
- Низкая корреляция с BTC на коротких tenors (<0.5) — может двигаться независимо на news.
- Liquidity на Bybit улучшилась в 2024-2025, но в dead zone (22-00 UTC) spread шире обычного.

## Specific to SUI

- **Новая монета = меньше истории.** 365d backtest покрывает не всю life-cycle. Будь готов к regime shifts при новых events (token unlock, chain upgrade).
- **Token unlock schedule критичен.** Unlock cliffs создают резкие dumps. Проверяй calendar перед LONG setup.
- Psych levels динамичные (монета растёт): 5.00 (recent R), 3.00 (pivot), 2.00 (S), 1.00 (deep S).
- Funding волатильный (±0.02%), особенно при hype-циклах Move ecosystem.

## Invalidation (thesis-level)

- Если 15 A-trades OOS на SUI дают PF <1.3 → pair paused.
- Major token unlock (>2% circulating) в ±48h → temporary pause.
- Mysten Labs operational/legal event → pause SUI индивидуально.

## Notes

SUI — самый "experimental" в universe. Добавлен несмотря на короткую историю из-за consistent range-fade edge (WR 60% + PF 1.65 OOS). **Ожидается pause/revisit через 30 live trades** — если edge сохраняется, promote к full secondary; если деградирует — drop.

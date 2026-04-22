---
name: Lessons Learned v2
description: Paid-in-P&L wisdom since strategy-v2. Quarantined pre-v2 lessons in archive/lessons-v1.md. Read before every /trade-scan cycle.
type: playbook
priority: 2
version: 2.0
created: 2026-04-22
---

# Lessons Learned v2

> Каждая запись здесь оплачена real P&L в период strategy-v2 (2026-04-22+).
> **Pre-v2 уроки** в `archive/lessons-v1.md` — применимы только к archived постмортемам.
> Re-читать этот файл после каждого losing trade и перед любым исключением из правил.

---

## How this file works

После каждой закрытой сделки — особенно убытков, но и характерных побед — извлекается lesson. Добавляется сюда только если:

**Lesson принадлежит сюда если:**
- Противоречит моему первому импульсу (импульс ненадёжен)
- Я нарушил правило больше одного раза
- Она сохранила или могла сохранить реальный P&L
- Обобщается за пределы конкретной сделки

**Lesson НЕ сюда если:**
- Специфична одному сетапу, уже зафиксирована в strategy.md entry/exit rules
- Переоткрытие того что уже есть здесь — в этом случае добавить date-stamp к существующей
- Неотделима от удачи/невезения (не учиться на шуме)

### Entry format

```markdown
## [YYYY-MM-DD] — Short rule statement

**Context:** одно предложение про ситуацию.
**What I did:** что реально сделал (обычно неправильно).
**What I should have done:** что говорит правило.
**Why it matters:** обобщаемый принцип.
**Tags:** `[категория]` `[категория]`
```

### Tag vocabulary

- `[ego-hold]` — держал убыток past the rule
- `[fomo]` — вошёл потому что не смог сидеть вне
- `[oversize]` — размер больше правила
- `[news-react]` — торговал заголовок без структуры
- `[regime-misread]` — неправильный playbook в неправильном режиме
- `[transition-skip-violation]` — взял сделку в ADX 22-25
- `[bb-tight-sl]` — SL внутри ATR noise на A
- `[b-low-wr-panic]` — закрыл B-сделку после серии losses (нормальная variance)
- `[pair-pick]` — выбрал слабую пару когда ETH давал сигнал
- `[counter-regime]` — A в trend, B в range
- `[post-loss-rage]` — вошёл сразу после SL на той же паре
- `[weekend-trade]` — торговал в пятницу 22 — воскресенье 22 UTC
- `[funding-clip]` — вошёл в funding window
- `[dead-zone]` — вошёл в 22-00 UTC
- `[peak-giveback]` — не снизил планку при day P&L ≥ +0.5%
- `[win-learned]` — выигрыш с обобщаемым правилом

---

## Lessons

<!-- Новые записи добавлять СВЕРХУ (reverse chronological) -->

### [2026-04-22] — Strategy v2 started, fresh lessons counter

**Context:** Рефакторинг после 22-trade диагностики (WR 27%, −7.33R за 5 дней). Старые v1 lessons карантинированы в archive/lessons-v1.md.
**What I did:** Принял strategy.md v2 (Playbook A + B, regime-gated, 3 пары) после walk-forward validation.
**What I should have done:** То же.
**Why it matters:** Чистый старт — это обнуление mental debt. Старые lessons v1 полезны для понимания постмортемов 2026-04-17..22, но не для новых решений. Новые сделки — новые правила.
**Tags:** `[win-learned]`

---

## Archived wisdom (pre-v2)

Старые lessons v1 → [archive/lessons-v1.md](archive/lessons-v1.md).

Ключевые v1 темы, которые автоматически **уже отражены** в strategy.md v2 — не нужно копировать:

1. **Structural SL + ATR buffer** → strategy.md § Stop-Loss.
2. **No post-loss re-entry on same pair** → strategy.md § Hard blocks #4.
3. **News-bias 2-cycle confirm** → crypto-news-analyzer skill.
4. **Server-side SL within 5 min** → CLAUDE.md inviolable rules.
5. **Trust Bybit API over Telegram** → reconcile.ts + audit.ts.
6. **Pre-commit invalidation rules** → strategy.md § Abort clauses.
7. **Regime-mismatch в range** → whole point of strategy.md v2.

---
trade: 2026-04-22_BTCUSDT_long_3
date: 2026-04-22
outcome_r: +1.58
outcome_usd: +2053.59
process_grade: F
category: vault_sync_failure
---

# Postmortem — BTCUSDT LONG #3 (2026-04-22 08:13 UTC)

## TL;DR

Trade сработал по плану: LONG 78120 → TP 78500 server-side, +1.58R (+$2053.59 combined). Сетап A-setup 10/12, lesson о широком SL из trade #2 применён (240pt vs 157pt). Однако **vault не был закрыт в момент исполнения TP** — reconcile C537 обнаружил divergence `vault_without_bybit`. **Process grade F** — не за результат, а за нарушение дисциплины ведения журнала: позиция жила в реальности, но в vault осталась "open" ~30 минут, нарушив reconcile-инвариант.

## Trade Snapshot

| Field | Value |
|---|---|
| Direction | LONG |
| Entry | 78120 (market, C495 08:13 UTC) |
| SL | 77880 (240pt, ATR-buffered) |
| TP | 78500 (380pt, liq_cluster magnet) |
| Confluence | 10/12 A-setup (v1 rubric — trade открыт до v2 transition) |
| Risk | 0.5% × news_mult 0.5 = ~0.25% effective |
| Size | 50k: 1.041 BTC / 200k: 4.166 BTC |
| Duration | ~4ч (08:13 UTC → ~12:14-12:20 UTC) |
| Outcome | **+1.58R / +$2053.59 combined** |

## What Went Right

1. **SL lesson из trade #2 применён корректно.** Trade #2 закрылся −1R именно на слишком узком SL (157pt inside 1H ATR wick range). Здесь SL 240pt = ниже nearS 77976 + ATR buffer ~96pt — classic structural-plus-buffer.
2. **Funding window discipline.** Вход 08:13 UTC, после того как окно 08:00 ±10 мин закрылось. Правило honored.
3. **Pre-commit discipline в C494 (override path).** Unlock-condition "BOS 15m confirmed + 2-cycle CVD sustained" был явно прописан в override C494, дождались материализации в C495 (а не приняли желаемое за действительное).
4. **V2 transition handling.** После refactor (11:00 UTC) в первом v2-cycle (C535) сделка формально классифицирована как совпадающая с Playbook B (TREND + EMA stack + pullback), не ретрофитили TP под v2-rule (3R/Chandelier). Честно держали plan, заданный при входе.
5. **TP = liq_cluster magnet**, а не arbitrary level. 78500 = round-psych + visible stop cluster. Цена дошла, сработала, откатилась.

## What Went Wrong (PROCESS FAILURE)

1. **Vault не обновлён в момент TP.** Server-side TP сработал между C536 (12:13 +1.13R mark 78351) и reconcile C537 (12:45 позиция отсутствует). В окне ~30 минут vault утверждал "open", реальность — "closed". Нет audit trail для момента закрытия, нет Close Summary в trade-файле, нет Telegram-уведомления о TP hit.

2. **Нарушен инвариант `aligned: true`.** Это класс ошибки, именно о котором предупреждает CLAUDE.md: "Phase 0 Reconcile — BLOCKING. Fix before any decision." Если бы в следующий cycle я сразу лез открывать новую сделку, reconcile меня заблокировал бы. Инвариант сработал как safety net — но сам факт его срабатывания = F.

3. **Не инструментировано обнаружение server-side fill.** Нет механизма, который бы между cycle-tick'ами проверял, не сработал ли TP/SL. Исполнение события видно только через reconcile в начале следующего /loop. Это архитектурное ограничение (по желанию — watcher-процесс), но дисциплина требует явной фиксации TP в Journal.

4. **Telegram-heartbeat не послан на момент TP hit.** Операторский контракт "immediately on open/close/abort/SL hit" нарушен. Оператор узнал бы о +$2053 только через мою ручную инициативу — silence на материальном событии.

## Root Cause

**Gap между server-side execution и vault-narrative в паузе между /loop cycles.** Claude-brain живёт только во время /loop fire; TP исполняется Bybit-движком независимо. Без per-cycle `audit.ts` check (или dedicated watcher) событие проскакивает. Дисциплина-компенсатор: при mark, близком к TP, **в предыдущем cycle** explicitly прогнозировать "TP will likely fire within this interval" → первый следующий cycle обязан начаться с order-history pull, а не pure scan.

## Lesson (for lessons-learned.md)

**"Когда mark приближается к TP в пределах ≤0.5×ATR последнего часа, следующий /loop начинается не со scan, а с `audit.ts` + `pnl-day.ts`. Если позиция пропала — немедленно закрыть vault, отправить TG, только потом переходить к новым setup-ам. TP hit без vault-update = F, даже если PnL положительный."**

Тег: `[vault-sync-discipline]`.

## Cost

- **Outcome:** +$2053.59 (+1.58R combined — positive).
- **Process cost:** нет materialized loss, но нарушена audit trail, пропущен TG-alert, инвариант reconcile упал.
- **DD impact:** None (day +0.84%).

## What I'd Do Differently

**Same setup, correct execution:**
- Entry/SL/TP identical — plan был верный.
- В C536 (+1.13R, mark 78351, TP 78500 = 149pt away) **pre-flag:** "TP likely within 1-2 cycles; next cycle must start with audit.ts".
- В C537 начать с `audit.ts` → если empty → `pnl-day.ts` + order-history → зафиксировать close в vault в первые 30 сек cycle.
- Сразу после reconcile-fix → TG-сообщение: "BTC LONG закрыт TP 78500, +$2053, +1.58R".

**Architectural note (backlog, not this cycle):** добавить в `trader.md` phase-preamble: "if последний known unrealized R ≥ +1.0 AND distance_to_tp ≤ 0.5×ATR → cycle начинается с audit, не scan."

## Next Action

- ✅ Vault обновлён (`status: closed`, `realized_r: 1.58`, Close Summary записан).
- ✅ Postmortem (этот файл).
- Append lesson в `Playbook/lessons-learned.md` с tag `[vault-sync-discipline]`.
- Journal C537 — явный "Reconciliation event" блок.
- Telegram оператору: TP hit + process-gap acknowledgement.
- Продолжить scan phase только после завершения выше.

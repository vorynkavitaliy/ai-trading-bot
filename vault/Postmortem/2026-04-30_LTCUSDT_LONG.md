---
trade_file: vault/Trades/2026-04-30_LTCUSDT_LONG.md
symbol: LTCUSDT
side: LONG
opened_at: 2026-04-30T00:14:22Z
closed_at: 2026-04-30T00:38:02Z
duration_min: 23.7
realized_r: 0.4286
pnl_usd_combined: 312.26
process_grade: B
---

# Postmortem — LTCUSDT LONG (2026-04-30, TP1 hit)

## Outcome

Первая live-сделка на strategy v3 (VP-SMC FINAL). Открыта в 00:14 UTC сразу после закрытия funding window 00:00–00:10 UTC. TP1 (55.55, POC) сработал через 23.7 минуты.

- Entry 55.25 → Exit 55.55 (+0.54%)
- realized R = 0.43 (per-leg, full close)
- Combined PnL: +$312.26 (Ivan +$61.96, Vitalii +$250.30; net of Bybit fees)

## What went well

1. **Strategy entry rules сработали как описано.** VAL touch + re-entry above + bull-FVG в 8H + выше PWL + кулдаун чист + permissive Coinglass — все 9 правил прошли. Engine правильно идентифицировал сетап.
2. **Risk-guard корректно дождался funding window.** В C069 движок выдал ENTER LONG, но `BLOCKED: funding window` правильно отложил исполнение до 00:10 UTC. После закрытия окна (C071) — actionable, моментальное исполнение.
3. **Reconcile-then-fix дисциплина.** Когда позиции закрылись Bybit-side server-side TP, reconcile отловил divergence на C077 и я остановил анализ до восстановления state (DB UPDATE через скрипт).

## What went wrong (критично — для lessons-learned)

**TP1 закрыл 100% позиции, а не 50% как требует strategy.md.**

- strategy.md §Exits: «TP1 fill action: Close 50%, move SL → breakeven»
- Реальное поведение execute.ts: TP1 ставится как `takeProfit` единственный full-position на момент создания ордера. TP2 не закладывается в Bybit. Когда TP1 hit — закрывается 100%, и leg на TP2 не существует.
- Cost: упущенный edge на остаток до TP2. Backtest показывал среднюю expR 0.21R на LTC при 50/50 разделении TP1/TP2; полный TP1 close даёт всегда 0.43R на winners но zero upside от runners. На MaxDD влияния нет (стоп всё равно −1R на losers).

**Process_grade: B** — execute правильный, но архитектурно стратегия не реализована полностью.

## Action items

1. **Кандидат-правило для lessons-learned:** «TP1 100% close — gap в execute.ts. Реализовать partial-close + SL→BE move через post-fill watcher или через Bybit conditional orders.» Codify в lessons-learned после одной-двух live trades подтверждающих закономерность.

2. **Закрытые TP-events не auto-update DB.** После server-side close Bybit, DB остаётся `status: open` до следующего reconcile + ручного close-trade.ts. Это работает, но требует диагностический скрипт каждый раз. Кандидат: расширить reconcile.ts чтобы при `db_without_bybit` он сам запрашивал closed-pnl и обновлял row автоматически.

3. **execute.ts вернул `ok: false` на BNB partial fill.** Vitalii 200k получил `max_qty exceeded` из-за узкого stopDist при больших sizing. Нужен fallback (split order, ограничить qty по symbol limit) или явный pre-check на per-symbol max contracts. (Отдельная сделка — не относится к LTC, но та же запись в gap-list.)

## Что меняем в стратегии

Ничего — strategy.md остаётся локированной. Lessons informs **next revision**, не текущие решения.

## Process grade

**B** — Strategy gates всё проверили, исполнение прошло, server-side SL установлен. Минус — gap в TP1/TP2 partial logic (architectural, не behaviour) и ручной DB close. Один настоящий выход через TP1 без full TP2 leg = недополучение edge, но не потеря.

---
id: TASK-007
title: "Truthful limit-entry fill state: defer trade-row + Telegram until position credited"
epic: EPIC-001
sprint: ""
status: done
assignee: dev-node-ts
reviewer: code-reviewer
severity_threshold: important
blocked_by: []
created: 2026-05-27
updated: 2026-05-27T09:53:26Z
iteration: 2
artifacts:
  - src/runtime/execute.ts
  - src/runtime/auto-execute.ts
  - src/core/tg-templates.ts
  - src/core/pending-orders.ts
  - src/runtime/reconcile.ts (or account-monitor.ts — promotion mechanism)
live_sensitive: true
acceptance:
  - "execute.ts:504 — gridSlots[].filled отражает ФАКТИЧЕСКИЙ fill (slot 1 filled только если actualFilledQty > 0), не хардкод s.level === 1"
  - "execute.ts:496 — убрать fake fallback `if (actualFilledQty === 0) actualFilledQty = slots[0].qtyNum`. Если позиция не зачислена — qty остаётся 0, состояние честное"
  - "execute.ts persistTrade — НЕ создаёт trades row со status='open' если slot 1 LIMIT не заполнился (actualFilledQty === 0). Вместо этого: pending_orders row остаётся (intent сохранён), trades row создаётся позже при фактическом fill"
  - "Promotion mechanism: когда pending limit заполняется позже (позиция появляется на Bybit), создаётся trades row из pending_orders intent. Место: reconcile.ts bybit_without_db handler ИЛИ account-monitor.ts on-position-appears. Связывает pending_orders.trade_id"
  - "Telegram notifyOpen: если slot 1 LIMIT pending (не filled) — сообщение говорит 'Slot 1 ⏳ pending', НЕ '✅ filled'. Опционально follow-up сообщение 'вход подтверждён' когда лимитка реально заполнится"
  - "Slot 1 остаётся LIMIT (operator decision 2026-05-27) — НЕ менять на market. Maker fee + лучший вход на mean-reversion fade"
  - "auto-execute.ts:117 — пересмотреть hardcoded '--order-type limit'. execute.ts:402 useMarket logic + комментарий :396-398 (про market anchor) привести в соответствие с limit-реальностью либо удалить misleading комментарий"
  - "Race-safety: promotion mechanism идемпотентен (не создаёт дубль trades row если reconcile + daemon оба видят fill). По pending_orders.order_link_id или WHERE NOT EXISTS"
  - "Typecheck чистый, smoke pass"
  - "Manual integration: разместить limit-entry который не заполнится сразу → DB НЕ должна показать open trade + Telegram 'pending'; когда лимитка заполнится → trades row появляется + 'вход подтверждён'"
---

## Context

**Инцидент 2026-05-27 09:01 UTC**: XRP SHORT scaled-in сигнал. Telegram сообщил «Slot 1 ✅ filled • 230,652 XRP», но фактически:
- На Bybit **НЕТ позиции** на всех 3 аккаунтах
- Только 3 pending Sell Limit ордера (slot 1 @ 1.3346 НЕ заполнен — цена не дошла)
- DB записал 3 trades rows (#240/241/242) `status=open` qty=slot1 entry=1.3346 — **фантомные**

**Root cause — цепочка:**
1. `auto-execute.ts:117` хардкодит `'--order-type', 'limit'` → slot 1 всегда Limit
2. `execute.ts:402` `useMarket = isFirst && args.orderType === 'market'` → slot 1 НЕ market (т.к. orderType='limit')
3. `execute.ts:445-455` ждёт 30s зачисления позиции → `actualFilledQty` = 0 (лимитка не заполнилась)
4. `execute.ts:496` `if (actualFilledQty === 0) actualFilledQty = slots[0].qtyNum` → **притворяется заполнено**
5. `execute.ts:504` `filled: s.level === 1` → хардкод slot 1 = filled
6. `execute.ts:646 persistTrade` → INSERT trades status='open' (фантом)
7. Telegram notifyOpen рендерит «✅ filled» (`tg-templates.ts:106`)

**Design противоречие:** комментарий `execute.ts:396-398` гласит «Slot 1 is MARKET for guaranteed immediate fill», но auto-execute всегда шлёт limit → задуманный market-anchor путь НИКОГДА не срабатывает в проде.

**Последствия фантомных rows (устранено вручную 2026-05-27):**
- risk-guard (DB status='open') считал XRP открытой → занимала 1 из 7 parallel slots + heat% + блок re-entry (duplicate check `risk-guard.ts:226`)
- reconcile bybit_without_db divergence каждые 5 мин
- **Cleanup сделан**: #240/241/242 → status='cancelled' (orchestrator, 2026-05-27 09:30). Pending limits оставлены активными.

**Критично:** механизма promotion pending→trades НЕТ. trades row создаётся только синхронно в `execute.ts persistTrade`. Если лимитка заполнится позже — некому создать row → нужен новый механизм.

## Inputs

- `src/runtime/execute.ts` — scaledIn путь (строки 286-505), persistTrade (509-560), main (646)
- `src/runtime/auto-execute.ts:117` — hardcoded order-type
- `src/core/tg-templates.ts:69-115` — notifyOpen gridSlots rendering
- `src/core/pending-orders.ts` — insertPending/markPlaced/linkTradeId (НЕТ promotion)
- `src/runtime/reconcile.ts:230-240` — stale orphan detection (pending без trade_id) — кандидат на promotion hook
- `src/runtime/account-monitor.ts` — daemon position-appears events (альтернативный promotion hook)
- `src/runtime/risk-guard.ts:119,226` — как считаются open positions

## Approach

<!-- architect заполняет. Ключевые вопросы:
1. Где делать promotion (reconcile bybit_without_db vs daemon on-position-appears)? Reconcile проще (уже сканирует), daemon быстрее (<1s).
2. Как execute.ts должен завершаться когда slot 1 limit не заполнился за 30s? Оставить pending_orders, НЕ persistTrade, Telegram 'pending'.
3. Promotion идемпотентность — pending_orders.order_link_id как ключ.
4. Follow-up Telegram при фактическом fill — нужен ли отдельный notify?
5. Что с slots 2/3 — они тоже pending limits, как отражать в trades row qty (initial_qty)?
-->

## Out of scope

- НЕ менять slot 1 на market (operator решил оставить limit)
- НЕ трогать стратегии cg-fade.ts
- НЕ менять TP1=TP2 single-target поведение (отдельный known issue из аудита)
- НЕ менять backtest engine

## Notes

### orchestrator 2026-05-27T09:30:00Z
Operator решения: (1) slot 1 = LIMIT, чинить reporting + defer trade-row до fill; (2) оставить pending лимитки, DB фантомы вычищены (#240/241/242 cancelled). Promotion mechanism — НОВЫЙ компонент, требует архитектурного дизайна.

### dev-node-ts 2026-05-27T12:40:00Z — implemented (iteration 1), status: review
Реализовано по analysis.md §Design + §Dev brief. Operator решения Q1/Q2/Q3 включены. Typecheck чистый (`npx tsc --noEmit`). 6 коммитов поверх c820062 (TASK-006 tip):

- `bd29e7c` fix(execute): honest limit-entry fill state — убран fake `if(actualFilledQty===0)…`, `gridSlots[].filled = level===1 && actualFilledQty>0`, persistTrade фильтрует `!pendingOnly && qty>0` и НЕ создаёт фантомный open row, `initial_qty` выставляется явно, `AccountResult.pendingOnly/plannedQty/plannedEntry`, frontmatter writer вынесен в `trade-journal.ts`, stale «Slot 1 is MARKET» комментарии переписаны.
- `d8d5ab3` feat(runtime): `pending-promoter.ts` — `promotePendingToTrade(pending, {size,avgPrice})` идемпотентно (`SELECT … FOR UPDATE WHERE trade_id IS NULL`), entry_price = Bybit avgPrice (fallback на planned при <=0), qty=initial_qty=actual size, rationale из pending (Q1). `findUnpromotedPending` + `markPendingOrphanedByLink` в `pending-orders.ts`.
- `340c3da` feat(telegram): `notifyOpen` ветка `status:'pending'` (🟡 ОРДЕР РАЗМЕЩЁН, slot 1 ⏳ pending, «ожидает заполнения»), новый `notifyEntryConfirmed` (✅ ВХОД ПОДТВЕРЖДЁН), execute.ts передаёт status + planned qty когда all-pending.
- `904e3da` feat(runtime): wiring — daemon `account-monitor.ts` `tryPromotePending` на size>0 без DB-trade, reconcile catch-net в `bybit_without_db` ветке (accountByLabel поднят над Phase A). Оба пути идемпотентны.
- `a46f245` feat(risk-guard): Q2 — duplicate check учитывает активную лимитку (`pending_orders` trade_id IS NULL, status IN pending/placed). openPositionsCount/heat НЕ трогал (по analysis recommendation: незаполненная лимитка не должна занимать parallel slot/heat).
- `a7edf11` feat(reconcile): Q3 — `cancelScaledInOrphans` помечает pending `status='orphaned'` по order_link_id при отмене лимитки.

auto-execute.ts:117 (`--order-type limit`) — НЕ менял (по analysis Part 4 корректно by design). НЕ запускал daemon/execute/backtest (tester). Operator WIP (pair-strategies.ts, cycle.sh, board/index.json, staged deletions, untracked btc-*/grid-*/wf-* files, settings.json) не тронут.

Замечание для reviewer: execute.ts/account-monitor.ts в рабочем дереве уже несли operator WIP (60-attempt wait loop, closePending), на который TASK-007 опирается; эти изменения попали в коммиты bd29e7c/340c3da/904e3da вместе с моими (один файл — один stage), т.к. отделить построчно нельзя.

### dev-node-ts 2026-05-27T13:45:00Z — rework (iteration 2), status: review
Исправлен единственный Important из review.md (§Important #1). Phase-A promotion call (`reconcile.ts` ~131-141) был не обёрнут в try/catch → transient DB throw из `promotePendingToTrade` пропагировал до `process.exit(1)` и ронял весь цикл, включая Phase-B close journaling (нарушение inviolable Rule 4). Теперь блок `findUnpromotedPending` + `promotePendingToTrade` обёрнут в try/catch: на throw → `log.warn(...)` с context (account/symbol/side/err) и fall-through на `bybit_without_db` divergence (как daemon path и уже-обёрнутый stale-orphan sweep в этом же файле). Exception больше не пропагирует. Typecheck чистый (`npx tsc --noEmit`).

- `eeb6eed` fix(reconcile): guard promotePendingToTrade so a DB throw can't abort the cycle.

Закоммичен ТОЛЬКО `src/runtime/reconcile.ts`. Operator WIP (cg-fade.ts, btc-*, deletions, cycle.sh, settings.json, board/index.json) не тронут. Nits 1-3 не блокирующие — оставлены.

### tester 2026-05-27T09:53:26Z — PASSED → done
Static clean (`npx tsc --noEmit`, 7 commits bd29e7c..eeb6eed, only pre-existing TODO in risk-guard:171). Smoke 7/7 pass. Reconcile dry-run ran clean, exit 4 (=divergence, not crash) — iter2 try/catch guard exercised live (3 XRP `bybit_without_db` passed through fall-through, no abort). All 8 acceptance points verified in committed code: fake-fallback removed, `pendingOnly`/honest `filled`, `initial_qty` explicit, pending-promoter `FOR UPDATE`+`created` idempotency, daemon+reconcile wiring, pending/confirmed Telegram, risk-guard pending-aware dup, orphan-on-cancel, reconcile guard. DB: #240/241/242 cancelled, no new phantom open rows. Git scope clean (operator WIP untouched).

**Operator steps:** (1) `npm run monitor:restart` — daemon active since May26, runs OLD code, TASK-007 daemon promotion NOT live until restart. (2) Current XRP limits have now filled but won't auto-promote because pending rows #118/119/120 are trade_id-linked to the cancelled #240/241/242 (leftover manual-cleanup state, not a code regression) — null those trade_ids or journal manually if a DB row is wanted. See TASK-007.test.md.

### code-reviewer 2026-05-27T09:49:48Z — re-review iteration 2, APPROVED → testing
Important #1 исправлен в `eeb6eed`. Верифицировано на `reconcile.ts:131-147`: промоушн обёрнут в try/catch, на throw `log.warn(..., {account,symbol,side,err})` (не silent) + fall-through на `bybit_without_db` divergence — exception не пропагирует, Phase-B close journaling защищён. Паттерн совпадает с dust-close/stale-orphan/daemon guards. `npx tsc --noEmit` чисто. Коммит трогает только reconcile.ts (+15/-9), без operator WIP/cycle.sh. Новых Important нет (catch scoped узко, divergence не теряется). Nits suppressed per TEAM.md §2 (iter ≥ 2). См. TASK-007.review.md iter 2.

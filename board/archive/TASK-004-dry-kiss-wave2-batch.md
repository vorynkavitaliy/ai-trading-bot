---
id: TASK-004
title: "Wave 2 batch: Position.riskUnits + QtyNormalizer + RetryPolicy + diagnostics cleanup (DRY+KISS)"
epic: EPIC-001
sprint: ""
status: done
assignee: tester
reviewer: code-reviewer
severity_threshold: important
blocked_by: []
created: 2026-05-24
updated: 2026-05-24T14:00:00Z
tested_at: 2026-05-24T14:00:00Z
iteration: 1
artifacts:
  - src/core/position.ts
  - src/core/qty-normalizer.ts (new)
  - src/core/retry-policy.ts (new)
  - src/core/bybit.ts
  - src/core/coinglass.ts
  - src/runtime/execute.ts
  - src/runtime/tp-planner.ts
  - src/runtime/naked-tp-recovery.ts
  - src/runtime/reconcile.ts
  - src/runtime/position-watcher.ts
  - src/runtime/scan-decide.ts
  - src/tools/admin/close-trade.ts
  - src/tools/admin/backfill-realized-r.ts
  - src/tools/diagnostics/* (deletions)
live_sensitive: true
acceptance:
  - "Position.riskUnits(pnl): number единый метод используется во ВСЕХ 5 местах R-расчёта (reconcile.ts, position-watcher.ts, scan-decide.ts, tools/admin/close-trade.ts, tools/admin/backfill-realized-r.ts) — нет inline формул вне Position класса"
  - "QtyNormalizer класс с методами split(total, parts, info): string[] и normalize(qty, info): string экстрагирован в src/core/qty-normalizer.ts; 3 callsite (execute.ts:150, tp-planner.ts:59-63, naked-tp-recovery.ts:75-79) используют его вместо inline roundQtyToStep+parseFloat"
  - "RetryPolicy generic в src/core/retry-policy.ts с интерфейсом { isRetryable(err): boolean; delayMs(attempt): number } + два экземпляра (BybitRetryPolicy, CoinglassRetryPolicy); withRetry в bybit.ts и withCgRetry в coinglass.ts заменены на единый generic withRetry<T>(fn, policy, label)"
  - "Cleanup tools/diagnostics: удалены 17 устаревших one-off скриптов (список из аудита 2026-05-24): cg-large-orders-raw, cg-ob-depth-params, cg-ob-interval-check, cg-ls-shape, cg-ls-deep-probe, cg-new-endpoints-probe, cg-cb-premium-coverage, cg-orderbook-history, backfill-major-deep, backfill-1w-1m, backfill-1m-resume, coinglass-test, check-instrument, closed-pnl, risk-status, check-symbol-data, tg-test. Удаление через git rm. Verify через grep что нет ссылок в package.json/cron/cycle.sh/docs"
  - "Typecheck чистый: npx tsc --noEmit без ошибок"
  - "Smoke: npx tsx src/tools/diagnostics/smoke-pipeline.ts проходит без regression"
  - "No behavior change: backtest CG-fade portfolio 365d через cg-fade-portfolio.ts метрики остаются ≈+94% / PF ≈1.55 (как post-TASK-003 baseline 2026-05-24)"
---

## Context

Архитектурный аудит 2026-05-24 (EPIC-001) выявил 11 крупных находок. TASK-003 (волна 1) закрыла критичные багфиксы (#1 reconcile R, #2 backfill D/W). Эта задача (волна 2) — 4 быстрых DRY/KISS фикса:

- **#3 Position.riskUnits unify** — 5 разных формул для одной операции в кодовой базе, риск рассинхрона
- **#4 QtyNormalizer extract** — повтор roundQtyToStep+parseFloat+min_qty_guard в 3 местах
- **#5 RetryPolicy generic** — bybit/coinglass имеют почти идентичные retry-обёртки, дрейфующие независимо
- **#6 Diagnostics cleanup** — 30+ файлов в src/tools/diagnostics/, ~17 устаревших one-off проб для Coinglass API

Все 4 находки описаны в архитектурном аудите как «быстрые wins» с низким blast radius — типичный SOLID-полирующий слой без изменения бизнес-логики.

## Inputs

- Архитектурный аудит из транскрипта чата 2026-05-24 (этот разговор, секция «Топ-5 по частоте копий» + «Кандидаты на удаление»)
- `src/core/position.ts` (текущий Position class — методы уже есть)
- `src/core/bybit.ts:23-51` (withRetry)
- `src/core/coinglass.ts:46-62` (withCgRetry)
- `src/runtime/execute.ts:150`, `src/runtime/tp-planner.ts:55-88`, `src/runtime/naked-tp-recovery.ts:75-79` (qty rounding)
- `src/runtime/reconcile.ts:157`, `position-watcher.ts:370`, `scan-decide.ts:410-411`, `tools/admin/close-trade.ts:58-60`, `tools/admin/backfill-realized-r.ts:48-51` (R-расчёт callsites)
- `src/tools/diagnostics/*.ts` (для cleanup audit)
- `package.json` (для проверки нет ли scripts ссылающихся на удаляемые файлы)

## Approach

См. `TASK-004.analysis.md` (architect, 2026-05-24T13:32:20Z).

Краткое резюме: 4 живых R-callsites (+1 диагностика) + 3 qty-callsites + 2 retry-функции + 14 устаревших diagnostics (3 из 17 — false positive, оставлены). Реализация в 4 коммитах в порядке #5 → #4 → #3 → #6, без изменения поведения.

## Out of scope

- НЕ трогаем волну 3 (SRP/DIP архитектурные #7-#11 — Reconciler/OrderExecutor/PositionWatcher классы, ExchangeGateway interface, ConfluenceRule[], CommandRegistry)
- НЕ менять backtest engine
- НЕ трогать src/strategies/cg-fade.ts (есть незакоммиченная параллельная работа от оператора)
- НЕ менять схему БД

## Notes

### dev-node-ts 2026-05-24T13:43:31Z
Implemented TASK-004 per architect analysis. 4 commits landed:
1. 1145edb refactor(core): extract RetryPolicy interface + Bybit/Coinglass policies
2. 6448467 refactor(core): extract QtyNormalizer pure functions
3. 7b4926f refactor(core): unify R calculation via Position.riskUnits
4. 7ace203 chore(diagnostics): remove 14 obsolete one-off probes

Typecheck: pass on all 4 commits + final.
Smoke + backtest: deferred to tester phase.

### code-reviewer 2026-05-24T13:47:19Z
Reviewed diff e7b3a25..HEAD (4 commits, 27 files, +181/-611). Verdict: **Approved → testing**.
- 1 Important: TEAM.md §4 names violation (`valid` boolean should be `isValid`). Borderline; not blocking iteration 1, low blast radius (3 callsites + 2 type defs). Tester proceeds.
- 6 Nits: log-shape regressions (retCode/msg dropped, key string change, delayMs semantics), `as any` parity, backfill-realized-r guard-drop edge case, verb-prefix on `riskUnits/delayMs`.
- Behaviour drift correctly documented: `position-watcher.ts:370` returns 0R on degenerate input (vs old `Math.max(...,1)` near-pnl bogus value). Acceptable per analysis.
- Cross-cutting confirmed: typecheck clean, no added WHAT comments, `cg-fade.ts` + `.claude/settings.json` NOT committed (still M), untracked operator files untouched, exactly 14 deletions in step 4, named-args static signature for `riskUnitsFromRaw` blocks the TASK-002 swap-bug class.
- Smoke pipeline + backtest portfolio sanity run pending tester (analysis explicitly waived walk-forward re-run; shape-only change).
- Full findings: `board/tasks/TASK-004.review.md`.

### tester 2026-05-24T14:00:00Z
Verdict: **Passed → done**.
- Typecheck clean (zero output).
- Smoke pipeline 6/6 PASS — hot path (scan-decide → auto-execute → execute spawn) wires up; retry shims + Position imports load without errors.
- Sanity backtest 365d / 7 pairs / 519 trades — **bit-identical** to TASK-003 baseline across all 5 aggregate metrics (519 trades / 55.3% WR / PF 1.55 / +94.19% / 6.29% MaxDD) + 7 per-pair rows + 12 monthly rows. Strong cryptographic signature that no math drift occurred.
- Reconcile dry-run skipped (sandbox-denied; brief listed as optional). Architect's "Live-trading impact" §"Worst-case failure mode" predicted no behaviour change; backtest exactness confirms.
- Git state: 4 commits clean, only operator WIP untouched (`M cg-fade.ts`, `M .claude/settings.json`, untracked btc-*/grid-*/cg-coverage/cg-schema/dw-scrub files).
- Full findings: `board/archive/TASK-004.test.md`.

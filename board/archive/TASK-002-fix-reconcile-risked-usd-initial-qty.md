---
id: TASK-002
title: "Verify/fix reconcile.ts:188 riskedUsd uses initial_qty, not qty (TP1-partial inflation)"
epic: EPIC-001
sprint: ""
status: done
assignee: architect
reviewer: ""
severity_threshold: important
blocked_by: []
created: 2026-05-24
updated: 2026-05-24T09:00:39Z
iteration: 0
artifacts:
  - src/runtime/reconcile.ts
  - src/core/position.ts
live_sensitive: true
acceptance:
  - "Доказано grep-ом / чтением кода: использует ли Position.fromOpenTrade(t).riskedUsd() поле t.initial_qty или t.qty"
  - "Если бага НЕТ — анализ-файл TASK-002.analysis.md с цитатой кода + git blame подтверждающий что fix применён"
  - "Если баг ЕСТЬ — фикс в коде, пересчёт realized_r через src/tools/admin/backfill-realized-r.ts для всех TP1-partial трейдов, regression-тест что новые значения совпадают с Bybit closedPnL в пределах 0.01R"
  - "live trial метрики (WR/PF) пересчитаны после fix"
---

## Context

Согласно CLAUDE.md (раздел «Known outstanding issues»):

> `src/runtime/reconcile.ts:188` uses `t.qty` (remaining qty after TP1 partial) for `riskedUsd` calc → inflates live `realized_r` by ~2× on TP1-partial trades. Fix: use `initial_qty` field.

Архитектурный аудит 2026-05-24 подтвердил, что в кодовой базе **могут существовать** два пути вычисления riskedUsd:
- `Position.fromOpenTrade(t).riskedUsd()` в `reconcile.ts:157` (через Position-класс)
- Inline calc в `position-watcher.ts:370` и в других местах

Нужно верифицировать: реально ли Position-класс читает `t.initial_qty` или fallback на `t.qty`? И корректно ли `reconcile.ts:188` использует именно initial_qty?

Этот баг искажает live-метрики realized_r и влияет на отчёты, alert-логику и принятие решений по стратегии.

## Inputs

- `src/runtime/reconcile.ts` строки 150–200
- `src/core/position.ts` метод `fromOpenTrade()` и `riskedUsd()`
- `src/runtime/position-watcher.ts:~370` (другой источник R-расчёта для сравнения)
- `src/tools/admin/backfill-realized-r.ts` (используется для пересчёта)
- CLAUDE.md строки 162–166 (формулировка бага)
- DB: схема `trades` таблицы — какие поля доступны (initial_qty? qty? оба?)
- migrations/ — когда добавлено поле initial_qty
- git log -p src/core/position.ts — история изменений

## Approach

<!-- Заполняется architect → tech-lead. -->

## Out of scope

- НЕ трогать другие места R-расчёта в этой задаче (DRY-унификация Position.riskUnits() — отдельный таск).
- НЕ менять схему БД.
- НЕ менять backtest engine (он считает R по своей логике).

## Notes

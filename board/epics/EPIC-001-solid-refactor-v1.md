---
id: EPIC-001
title: "SOLID refactor v1: устранение находок аудита 2026-05-24 по принципам OOP/SOLID/KISS/DRY в hot-path и core/ слоях"
status: active
created: 2026-05-24
updated: 2026-05-24T08:55:59Z
target_sprint: ""
tasks: []
acceptance:
  - "Все 11 находок аудита (см. транскрипт 2026-05-24) либо устранены, либо явно отложены с обоснованием"
  - "Нет регрессий: backtest CG-fade portfolio сохраняет метрики (PF ≥ 1.4, MaxDD ≤ 7%, +88%/год на $200k) после рефакторинга"
  - "Hot-path (scan-decide → auto-execute → execute, position-watcher, reconcile) проходит smoke-pipeline без ошибок"
---

## Motivation

<!-- Why this epic exists. Business or technical driver. -->

## Scope

<!-- What this epic delivers. -->

## Out of scope

<!-- What this epic does NOT deliver — explicit boundary. -->

## Success criteria

<!-- Measurable outcome. -->

## Risks / unknowns

<!-- What could derail this epic. Architect adds here. -->

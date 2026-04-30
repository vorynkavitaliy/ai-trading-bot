---
trade_file: vault/Trades/2026-04-30_BNBUSDT_LONG.md
symbol: BNBUSDT
side: LONG
opened_at: 2026-04-30T00:33:37Z
closed_at: 2026-04-30T02:30:53Z
duration_min: 117.3
realized_r: -0.97
pnl_usd_combined: -159.68
process_grade: B
---

# Postmortem — BNBUSDT LONG (2026-04-30, SL hit)

## Outcome

Партиальное открытие из C075 (Ivan 50k = 135.38 BNB). Vitalii 200k был отклонён Bybit `max_qty` per-symbol limit. SL hit через 117 минут.

- Entry avg fill 618.00 (limit submitted 618.80 — slippage в нашу сторону на open ~0.13%)
- SL trigger 617.4586 → exit 617.50 (slippage в нашу сторону на close ~0.007%)
- realized R = −0.97
- PnL: **−$159.68 net** (Bybit reported, includes fees)

## What went well

1. **Server-side SL сработал точно.** Цена пробила 617.4586, Bybit закрыл по 617.50. Никаких manual interventions.
2. **Risk-guard корректно остановил Vitalii leg.** Хотя Bybit-side reject был техническим (max_qty), а не риск-лимитом — DB не зафиксировал failed leg, только Ivan. Reconcile state остался чистым.
3. **Floating loss был ограничен <0.07% от combined equity.** Heat-cap корректно ограничил размер.

## What went wrong

1. **Ставка с очень узким стопом (1.34 пункта = 0.22%) на BNB при типичной волатильности 1H ~0.5%.** Engine видел high R:R (TP2 = 7.36R), но узкий стоп отрицательно меняет вероятность достижения TP до hit стопа. Strategy.md `minStopAtr: 0.5` — означает стоп должен быть ≥ 0.5×ATR. BNB 1H ATR ≈ 0.6-1.0, наш стоп 1.34 при ATR ~5 = 0.27×ATR. Это **должно было быть отклонено** на min-stop gate.

   **Action item:** проверить `minStopAtr` enforcement в `decide()`. Если 0.27×ATR прошло через гейт — баг в engine. Если нет — strategy.md параметр требует ревизии для случаев когда PWL-buffer SL даёт слишком тугой стоп.

2. **Стратегия имеет асимметрию stop-vs-noise.** Сетап выглядит хорошим (R:R 7.36) но при таком узком стопе — wiggle ATR закрывает позицию задолго до того как у trade появляется шанс пойти в плюс. Это classic «picked up pennies, got hit by truck» pattern в mean-reversion с PWL-anchored stops.

3. **Vitalii leg не удалось retry с меньшим size.** При reject `max_qty` не было fallback split-order логики. Vitalii остался без позиции, в результате полный risk per trade был не 0.375% × 2 = 0.75% от combined, а ~0.077%. Плюс +ve effect: меньше потерь, но также меньше edge utilization.

## Action items

1. **Проверить min-stop gate в decide() на BNB.** Если пропустил 0.27×ATR — bug. Если нет — strategy gap.
2. **Vitalii retry-with-reduced-qty** — if reject `max_qty`, retry с `qty = max(min_qty, max_qty)` чтобы не пропускать leg.

## Process grade

**B** — следование стратегии было полным, исполнение корректное, server-side SL отработал. Минусы — узкий стоп возможно не должен был пройти gate, и partial-fill semantics не отлажены. Не grade A (нет ошибок исполнения), не C (есть documented gaps).

---
trade_file: "[[Trades/2026-04-18_XRPUSDT_long]]"
symbol: XRPUSDT
direction: long
outcome: loss
r_multiple: -0.30
duration_minutes: 3
closed_reason: proactive-exit
process_grade: D
lesson_tag: [peak-score-trap, pause-between-mechanical-fires, dont-chain-correlated-entries]
generalizable: true
written: 2026-04-18T07:10:00Z
---

# Postmortem — XRPUSDT LONG — 2026-04-18 (London open +3min)

> Written after every closed trade. Win or loss. The purpose is not to celebrate or mourn — it is to extract learning.

---

## What I Expected

Scanner fired XRP L:6/8 S:4/8 на следующем цикле после DOGE fill. 6/8 = structural-entry threshold, R:R 1.5 mechanical trigger. Я ожидал: "scanner отработал — mechanical layer = edge; my job is to not override." Принял сигнал без дополнительного фильтра.

## What Actually Happened

- [07:00] DOGE fired 5/8 Bull, mechanical fill.
- [07:03] XRP fired 6/8 Bull, mechanical fill. 3 минуты разрыв между correlated alt-Bull entries.
- [07:06] Следующий scan цикл: XRP уже L:4/8 S:4/8 dir=None. TypeScript proactive-exit сработал ДО того как я дочитал output.
- Exit 1.4688, -$376, -0.3R, 2m 59s. Два аккаунта (50k + 200k).

## The Delta

- **Market did:** XRP показал мини-пик ровно при 6/8 scoring, затем моментально сложился.
- **I expected:** Normal post-entry drift, как DOGE (который спокойно держит +0.1R).
- **The gap was caused by:** Peak-score trap — exactly the failure mode I codified in Thesis/DOGEUSDT.md вчера: "scoring peaked AS structure extended away." Вчера DOGE это демонстрировал при 7/8 — сегодня XRP это сделал при 6/8, за 1 цикл после entry. Моя ошибка: не применил вчерашний urok к сегодняшнему entry.

## Process Review

- [x] **Entry Rules followed?** YES — mechanical 6/8 crossover + R:R 1.5. All 6 steps passed.
- [x] **Correlation check?** NO — **principal failure.** DOGE уже был открыт (correlated alt-Bull). Я пометил "correlation HIGH" в trade file but did NOT pause to evaluate whether taking 2nd correlated position was edge-accretive or edge-dilutive. Scanner said YES, я сказал YES reflexively.
- [x] **Pause between mechanical fires?** NO — **second failure.** Back-to-back mechanical fires on correlated alts without cool-down. I should have imposed a 1-cycle pause to distinguish "real 6/8" from "peak-score flicker that'll vanish in 3 min."
- [x] **SL structurally placed, within 5 min?** YES — server-side at submission.
- [x] **Sized per risk_r?** YES — mechanical.
- [x] **Updated Trades/ file as position evolved?** PARTIAL — first update written, second update was in progress when system closed.
- [x] **Resisted adding / moving SL?** YES — no management.
- [x] **Applied proactive exit framework correctly?** **TypeScript layer applied it faster than I could.** Я был в процессе "hold 1 more cycle per own 2-cycle rule" когда system уже закрыла. Claude-layer response was too slow — system saved us.
- [x] **Wrote Postmortem within 1 hour?** YES — within 10 min.

## Grade: **D (process)**

Причина D, а не F: system proactive-exit ограничил loss до -0.3R вместо -1R (saved ~$874). Entry-decision process был reflexive, correlation-blind, и ignored вчерашний же urok про peak-score trap. Grade ability to act on entry — F. Grade output — D (thanks to system).

## Generalizable Lesson

**Не принимай back-to-back mechanical fires на коррелированных парах без 1-цикла паузы.**

**Why:** Scanner работает по кросс-секционным срезам — если N correlated alts одновременно показывают 5-6/8, это обычно НЕ N независимых сигналов, а один и тот же уставший move, который сканер увидел с 5-6 углов. Первый fire может быть real edge, второй через 3 мин на коррелированном алте = ехать на том же поезде в полчаса до станции.

**How to apply:**
- Если открыл correlated position в цикле N, не принимай mechanical fire на correlated pair в цикле N+1 без внешней проверки.
- Внешняя проверка = один из: (a) другая direction, (b) другой timeframe структурный setup, (c) подтверждение что первая позиция крепкая (>+0.3R и signal stable).
- Если нет внешней проверки — HOLD цикл, дай scanner ре-подтвердить сигнал. Если на N+2 цикле всё ещё 6/8 — это настоящий setup, не peak-score trap.

**Symmetry с вчерашним:**
- 17-Apr: DOGE 7/8 но R:R 0.53 → R:R gate SAVED нас (no entry).
- 18-Apr: XRP 6/8 и R:R 1.5 → нет gate для peak-score-after-correlated-fire → loss.
- → Gap в правилах: **нужен "pause-after-correlated-mechanical-fire" gate**, эквивалент R:R floor.

## Addendum — Code vs Claude

TypeScript proactive-exit был быстрее чем мой Claude-layer analysis цикл. Это OK в данном случае — система работает именно для этого. Но указывает что в будущем:
- Если я могу application-layer pause ДО того как mechanical открывает, потери были бы НУЛЬ вместо -0.3R.
- Лучшая защита — не позволить fire случиться, чем обрабатывать proactive-exit post-fact.

→ Append to `lessons-learned.md` with tag `pause-between-mechanical-fires`.

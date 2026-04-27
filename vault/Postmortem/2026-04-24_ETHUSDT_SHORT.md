---
date: 2026-04-24
symbol: ETHUSDT
direction: Short
playbook: B
regime_at_entry: TREND (ADX 31.3)
regime_at_exit: RANGE (ADX 19.4)
entry_time: "2026-04-24T00:11:40Z"
entry_price: 2330.27
exit_time: "2026-04-24T16:03:40Z"
exit_price: 2320
hold_minutes: 972
tp1: 2251
tp1_hit: false
sl: 2358
sl_hit: false
close_reason: strategy-B-abort-ADX-below-20
realized_r: 0.37
pnl_usd_50k: 70.89
pnl_usd_200k: 284.75
pnl_usd_combined: 355.64
pnl_pct_day: 0.14
process_grade: A
---

# Postmortem — ETHUSDT SHORT 2026-04-24

## Итог

**+0.37R / +$355.64 (+0.14% day) за 16h 12min.** Закрыто по strategy §B Abort (ADX<20 на 16:00 UTC 1H close). Peak PnL +$1280 / +0.99R в C1988. TP1 2251 не достигнут — trade вышел на 52pt выше target.

## Entry context (C1733, 00:11 UTC)

Первая сделка за 2 дня после strategy v2 refactor. Все 6 Playbook B SHORT entry conditions met:
- ADX(1H) 31.3 ≥ 25 ✓
- EMA8 2325 < EMA21 2332 < EMA55 2341 < EMA200 2344 ✓ (inverted stack)
- MDI 24.8 > PDI 16.4 ✓
- Price touches EMA55 (2340.75 от 2331.32 = −0.40%) ✓
- Close < EMA55 (2331 < 2341) ✓
- RSI(1H) 48.06 < 55 ✓

Entry cleared funding window (just expired 00:10) + dead zone (just ended 00:00). Risk 0.51% 50k / 0.51% 200k. Leverage 10× compliant.

## Trajectory

| Cycle | Time (UTC) | Mark | PnL combined | R | Key event |
|---|---|---|---|---|---|
| C1733 | 00:11 | 2330.27 | 0 | 0 | Entry |
| C1974 | 13:26 | 2322.51 | +$365 | +0.28 | First scan this session |
| C1988 | 14:28 | 2302.65 | **+$1280** | **+0.99** | PEAK — psych 2300 broken |
| C1996 | 15:06 | 2303.33 | +$1262 | +0.97 | 2nd 2300 test |
| C2005 | 15:49 | 2318.62 | +$547 | +0.42 | ADX 22 → 20.8, DMI flip |
| C2008 | 16:03 | 2319.99 | +$355 | +0.37 | ADX 19.4 → **CLOSED** |

## Что получилось ✅

**1. Setup execution textbook-perfect.** Entry conditions all met при opening, mapped exactly к strategy.md §B SHORT rules. No override, no shortcut, no gut-feel. Process discipline A.

**2. Rule obedience на winning trade.** Position была в +0.37R profit когда strategy trigger fired. Easy to rationalize "structure still partially bearish, let's squeeze more." Instead: executed rule precisely per plan. Это то, что отличает системного трейдера от дискреционного.

**3. Peak capture via structural reading.** В C1988 (peak +0.99R) я правильно идентифицировал all metrics strongest yet (spread 4.75pt new peak, MDI dominance 6.0pt, slope1h −2.37 deepest). Event TG sent. Если бы закрыл там → +3.6× текущего результата. Strategy в данном случае "оставить на поле" было правильным решением ex-ante (3R TP1 был близко), но ex-post знаю "что оставил на столе".

**4. Discipline через 16 hours.** Trade был открыт 972 минуты. 40+ циклов /loop, многочисленные retraces, проба EMA21. Ни одного импульсивного действия. SL 2358 never moved. TP1 server-side. 

**5. Cross-pair discipline.** Через всю сессию 8/8 пар были проверены per-pair. Никогда не открыл новую сделку despite nearby trigger candidates (OP, NEAR approached but never прорвали RSI 65). Отказ от counter-trades сохранил focus на primary trade.

**6. News filter discipline.** Stale ceasefire catalyst был downgraded classifier'ом несколько раз. Не paniced, не reweighted. Ended с legitimate tariff news at exit (would have helped SHORT) — irrelevant to decision since rule was primary.

## Что могло быть лучше ⚠️

**1. Peak take-profit vs strategy TP1.** В C1988 позиция достигла +0.99R (vs 2.86R TP1 target). Strategy rule = wait for TP1. Identity rule = "let winners run, trail Chandelier after TP1". Но retrace от +0.99R обратно к +0.37R = $925 giveback = 72% of peak profit. Trailing SL at breakeven + some ATR buffer после +1R could have locked minimum +0.5R или 0.8R in worst case.

**Potential improvement:** Add rule "after +1R in Playbook B (not yet at TP1), move SL to entry +0.2R lock". Would lock min ~+0.2R with no threat к rest of TP1 run. Requires backtest to validate (could reduce mean R).

**2. OBI5 wall interpretation был noisy.** OBI5 на ETH flipped multiple times (−0.96 ask / +0.94 bid / etc) через ~15 cycles. Каждый flip я интерпретировал как signal, но они быстро меняли направление. Lesson: OBI5 в consolidation = noise, не signal. Respect primary trend metrics (ADX/MDI/stack) over orderbook flux.

**3. Compression watching could trigger earlier exit.** Spread peaked 4.75pt at C1996, compressed к 1.76pt at exit. Compression ratio 63% — sign of stack weakening. If I had compression-based pre-abort rule (e.g. "spread drops to <50% of peak" → move SL tight), would have exited proactively at ~+0.6R vs waiting для explicit ADX<20.

**Potential improvement:** Define compression threshold как soft signal. Pair с DMI convergence (dominance <1pt) → tighter risk management.

## What I will NOT change

**1. Strategy explicit abort rules primary.** Was tempted at C2005 (ADX 20.8, DMI 0.3pt) to close proactively. Didn't — waited для 16:00 1H close. Abort fired clean. Discipline to wait for explicit rule over panic-close = correct. 

**2. Hold duration.** 16h 12min is near 48h max и unusual для Playbook B (typically trail Chandelier exits earlier). Trade was structurally sound until ADX cooled. Holding was правильно по playbook.

## Lessons (to append to lessons-learned.md if generalizable)

**[2026-04-24] — Playbook B trail-protect at +1R для pre-TP1 cushion**

**Context:** ETH B-SHORT from C1733 reached +0.99R peak at C1988, retraced к +0.37R at exit C2008 на ADX<20 abort. Gave back 72% of peak profit.

**What I did:** Held per strategy rules (SL fixed at initial, TP1 server-side). Allowed full retrace к abort trigger without proactive tightening.

**What I could do:** Soft-rule "after unrealized +1R, move SL к entry +0.2R (lock floor)" would've caught protection at peak and exited +0.2R при retrace instead of +0.37R но с floor guaranteed.

**Why it matters:** Playbook B трейды могут быть долгими (many hours), и peak-to-abort drawdown может реверсировать значительный % profit. R-preservation floor улучшит expected-value distribution. Requires backtest validation before implementing (may reduce mean R while improving variance).

**Tags:** [trail-floor-rule] [peak-giveback] [playbook-b]

## Process grade: A

Entry: A (clean execution)
Management: A (no tweaks, no panic)
Exit: A (strategy rule obeyed precisely)
Psychology: A (no FOMO on peak, no fear на retrace)
Documentation: A (every cycle journaled)

Giving Grade A, not A+, because of peak-giveback vulnerability (72%). Грид future rule improvement identified.

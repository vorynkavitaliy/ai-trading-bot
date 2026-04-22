---
trade_file: 2026-04-22_BTCUSDT_long_1.md
symbol: BTCUSDT
direction: long
opened: 2026-04-22T00:12:00Z
closed: 2026-04-22T03:30:00Z
r_multiple: 1.5
process_grade: A
---

# Postmortem — BTCUSDT LONG 2026-04-22 #1

## Outcome

**+1.5R net** (+$1873.60, +0.76%). TP 77000 hit cleanly после ~3.5h hold через deep drawdown phase.

## Process grading

**Grade: A** (not A+ из-за entry timing — можно было подождать 15m close confirmation).

### What went right

1. **Halt discipline preserved capital для this setup**. 7+ hours halt после 5-SL stop — это цена, которую я заплатил вчера. Сегодня setup 9/12 standard B+ пришёл чистым, и я его взял без жадности (0.5% risk только).

2. **12-factor rubric executed symmetrically**. Factor-by-factor scoring в C431-C432 не sided с bias — честно оценил 9/12 LONG (не 10/12, не натягивал). Это выставило правильный risk-per-trade к размеру setup.

3. **Post-funding window respect**. Entry 00:12 = после 00:10 funding window close. HARD rule соблюдено, без compromise.

4. **System-signal trust при −0.41R DD**. At C444 позиция была −0.41R с BOS 3m bearish confirmed + CVD5m −\$2M. Эмоциональный impulse говорил close. `can_proactive_exit=false` держала — и через 3 мин CVD +\$3.62M burst recovered к −0.17R. Это система, не я, сохранила trade.

5. **1H-Close Protocol execution at 01:00**. Zone maintenance выполнен вовремя — stale zones expired (3), EMA zones refreshed, round 76000 upgraded к KEY support. Это освободило mental bandwidth и обновила decision context.

### What went wrong (minor)

1. **No 15m close confirmation wait**. Entered at 00:12 market, не waited for 00:15 15m close above 76000. Could have saved 30-70pt на entry had I used limit at 76200 pullback. Acceptable choice given momentum character, но subtly.

2. **No B/E move**. Mgmt plan сказал "move SL к BE at +1R = 76700". Never had the chance — TP fill happened before BE trigger logged. Not a miss, но process discipline требовал active BE-move logic.

3. **Cycle heartbeat cadence was frequent (3-min)** during the −0.41R stress — could have reduced vigilance, though useful to log the recovery.

## Counterfactual

**Had I taken C425 LONG (10/12, hypothetical)** во время halt period: entry ~75586, TP 76500 would have hit by 00:00 UTC = +2.6R. Missed +1R vs today's +1.5R due to halt commitment. **Net decision-set value of halt ≥ 0** (including 6+ SL hits avoided pre-halt).

**Had I closed at C444 (−0.41R)** когда "looked bearish": realized −0.41R on 0.5% = −0.2% equity loss + bad habit reinforcement. Current outcome +1.5R is **+1.91R delta vs capitulation**.

## Lessons reinforced (not new)

- Halt discipline > opportunity FOMO (lesson 2026-04-21).
- Scanner's `can_proactive_exit` flag is load-bearing при DD stress (ref `memory/feedback_anti_hallucination.md`).
- CVD bursts (+$1-3M) often mark accumulation/liquidation endings (`crypto-market-microstructure.md`).

## No new lesson

Все signals проверили existing playbook rules. Nothing emerged что не известно.

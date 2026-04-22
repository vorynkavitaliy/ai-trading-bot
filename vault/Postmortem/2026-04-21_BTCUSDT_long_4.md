---
trade: 2026-04-21_BTCUSDT_long_4
symbol: BTCUSDT
direction: long
entry: 76300
sl: 76020
tp: 77000
r_multiple: -1.0
realized_pnl_usd: -384
hold_duration_min: 12
process_grade: A-
outcome_grade: F
confluence_strict: 9/12
confluence_moderate: 10/12
---

# Postmortem — BTC LONG #4 (C245-C250)

## The trade

Long limit 76300 retest of broken htf_pivot, SL 76020, TP 77000, R:R 2.50.
Risk 0.125% effective (0.5% B+ × 0.25 HIGH-impact news mult).
Placed C245 14:42, filled C246 14:45, stopped out C250 14:57.
Hold 12 min, −1R clean, −\$384 total.

## What I got right

1. **Trigger timing**: Waited until 3 unlock conditions from C243 pre-commit met (2/3 technically satisfied — news 2-cycle + CVD sustained). Did not jump at first C243 signal (7/12) или first zone break C244 (8/12).

2. **Entry structure**: Limit retest at broken R→S, not market chase. Self-validating — would not have filled if market ran without retest. Textbook SMC (`stop-hunting-market-traps.md`).

3. **SL placement**: Structural 76020 below ema21 + round 76000 cluster. Cleanly invalidated if thesis wrong. No Widen temptation despite drawdown.

4. **Sizing discipline**: Caught own sizing error (forgot news mult in first attempt at 0.5%), cancelled clean (audit verified no race condition, no fill), replaced at correct 0.125%. Reference C226 race-condition lesson applied correctly.

5. **Hold discipline**: Grace period honored. Opposite score tracking kept at 2-3/12 throughout, never crossed 8/12 exit threshold. No emotional bail at −0.58R.

6. **Separation of process от outcome**: Took the trade because process said yes, not because expectation of win.

## What I got wrong

1. **Distribution regime underweighted**. Day had **6 failed reclaims** by C246. Each one absorbed. The 7th had same signature: push к resistance (76500) → absorbed → failure. I had written "7th reclaim skepticism warranted" in C244, but rubric unlock C245 (news 2-cycle + CVD sustained) overrode skepticism. **Failed reclaim count should be explicit rubric cap factor.**

2. **F1 gave 1 moderate vs 0 strict**. C226 lesson from TODAY says: "bos_3m alone = fragile, F1=1 needs bos_15m minimum". I rationalized 3-cycle sustained bos_3m + CVD growing as "confirmation" — but bos_15m never fired. In hindsight, strict C226 (F1=0) would have been 8/12 = skip. Self-override of fresh lesson = violation of "one-brain" principle.

3. **MACD1h hist never actually flipped positive**. It recovered от −49 к −8.7 but stayed negative throughout position lifetime. I took this as "improving" but it's still net bearish momentum. A cleanly valid setup would have had MACD hist POSITIVE, not near-zero-still-negative.

4. **Failed to note "in_zone=in_pivot_dead_zone"**. Price oscillating exactly between htf_pivot 76300 and htf_pivot 76500 (range \$200) is structurally ambiguous — neither committed breakout nor reversal. Better signal quality comes от decisive commitment above/below zone cluster, not inside it.

## Process grade: A-

- Entry/exit/sizing mechanics: A (including sizing-error self-correction)
- Thesis: C (allowed news/CVD confirmation to override distribution-regime skepticism)
- Discipline: A (grace period, structural SL, no emotional interference)

**Outcome grade**: F (−1R). But outcome ≠ process в R-based framework. This is a legitimate sample от edge distribution. Over many samples with same process, B+ setups должны win ~55-60% at R:R 2.5 = positive EV. Один −1R doesn't invalidate process.

## What I will change

1. **Add "failed reclaim count" as rubric factor**. If ≥5 failed reclaims observed earlier same session, require +1 factor bar (10/12 instead of 9/12 for standard) OR explicit override rationale.

2. **Strict C226 enforcement**: F1=1 requires bos_15m minimum, NO exceptions. Sustained 3-cycle bos_3m без bos_15m = F1=0. This trade would have been 8/12 = skip.

3. **MACD hist polarity threshold**: F2 (Classic Tech) requires MACD hist POSITIVE (not "improving") for bullish entry. "Recovering от deeper negative" is insufficient — momentum must be confirmed.

4. **Zone-dead-zone filter**: When price between two pivots within \$200, structural state is ambiguous. Require commitment (15m close outside zone) before rubric full-scoring.

## Day summary after 4 losses

- 4× SL today: AVAX #1, AVAX #2, BTC #3 (full 1R each), BTC #4 (−1R effective даже at 0.125% sizing due to fee/slippage)
- Day P&L **−\$1450** (−0.59% across both accounts)
- Daily DD: 1.08/1.08%, safe от 4% kill
- **Resume halt till 00:00 UTC** decision reaffirmed. No more trades today. 4 losses = stop, no questions.

## Research citations

- `stop-hunting-market-traps.md` — limit retest mechanics (used correctly for entry structure)
- `demand-supply-dynamics.md` — distribution regime (should have weighted more heavily)
- `trading-in-the-zone.md` — process over outcome (applying here)
- `trading-habits-burns.md` — cold on losers (closing wrote up cleanly)

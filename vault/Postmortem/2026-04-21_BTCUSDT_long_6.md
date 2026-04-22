---
trade: 2026-04-21_BTCUSDT_long_6
symbol: BTCUSDT
direction: long
entry: 75959.7
sl: 75800
tp: 76500
r_multiple: -1.0
realized_pnl_usd: -765
hold_duration_min: 22
process_grade: A-
outcome_grade: F
confluence: 8/12
---

# Postmortem — BTC LONG #6 (C283-C291)

## The trade

LONG limit at round 76000 break-and-retest. Entry 75959.7 (+40pt beneficial slippage), SL 75800, TP 76500, R:R 2.50, risk 0.25% effective ($625). Placed after regime pivot (cancelled deep-retest LONG #5). Filled C284 16:38, SL hit C291 17:00. Hold 22 min.

## What I got right

1. **Operator feedback absorbed**: recognized limit-missing pattern, pivoted strategy.

2. **Regime detection was correct**: BTC was in breakout regime at C283 (slope1h first positive, round 76000 swept, rsi_accel +2.614). Range-regime deep retest at ema55 was wrong thesis — correctly cancelled.

3. **Break-and-retest structure**: canonical SMC entry at just-broken round number. Textbook execution per `stop-hunting-market-traps.md`.

4. **Entry quality**: limit filled at 75959.7 (better than 76000 by +40pt). Price dipped briefly к limit level before bouncing +0.58R in my favor within 1 minute. Perfect timing.

5. **Sizing discipline**: 0.25% conservative (half standard) post-4xSL day. Max loss = $625 + slippage. Within risk budget.

6. **Hold discipline**: position went through +0.58R peak, back to breakeven, down to −0.63R, back up, then final drop к SL. I held through all oscillations because SHORT opposite never crossed 8/12 threshold. No panic exits.

7. **Trade management**: SL structural below liq_cluster 75600 buffer + ema21 flipped-R buffer. Did not widen. Did not cancel. Let structure invalidate.

## What I got wrong

1. **CVD divergence warning heeded but trade taken anyway**. At placement time, CVD5m was −$807k while price was at breakout high 76087. This was classic distribution-trap signature — exactly the pattern that killed LONG #4 earlier today. I flagged it in rationale but placed trade regardless because "limit at better structural level protects me". The limit DID fill at good price, but the underlying distribution thesis manifested exactly as warned.

2. **News-flip concern was real**. Between C284 (fill +0.58R) and C290 (−0.63R), news bias flipped from "risk-on" to "risk-off" with new bearish triggers (Trump Fed nominee Senate, Core Scientific debt). Per CLAUDE.md 2-cycle rule, I held through single-cycle flip (correct) but continued deterioration across 2+ cycles means the news shift was real. Should have considered this as exit signal when combined с slope1h flipping negative + sustained CVD negative.

3. **Same pattern as LONG #4**: break-and-retest at flipped level, CVD divergence flagged, filled, profitable briefly, then dumped. Two-for-two this pattern today = maybe today's regime just incompatible with breakout entries given persistent distribution selling. Lesson: **when CVD divergence is flagged at setup AND this pattern cost −1R earlier same session, the next occurrence warrants skip or even smaller size**.

## Process grade: A-

- Regime detection: A
- Entry structure: A
- Fill execution: A (best-possible)
- Sizing: A (conservative, adjusted for day state)
- SL placement: A (structural + buffer)
- Hold discipline: A (through full swing, no interference)
- **Setup selection**: C (ignored my own CVD divergence warning AND same-day pattern failure)

**Outcome grade**: F (−1R, day total −$2215).

## What I will change

1. **CVD divergence at setup = hard skip after same-session pattern failure**. Today LONG #4 (−1R) at 76300 break-and-retest had identical CVD divergence warning. LONG #6 at 76000 break-and-retest had identical CVD divergence warning. Both failed same way. Rule: **second occurrence of same CVD-divergence-flagged pattern in one session = skip, not retry**.

2. **Add "failed-pattern-count" to rubric as explicit cap**. If same setup pattern failed ≥1 time earlier same session, require +1 factor bar (10/12 instead of 9/12, 9/12 instead of 8/12 threshold). This is generalization of earlier "failed-reclaim count" candidate lesson from LONG #4 postmortem.

3. **Proactive exit on combined deterioration signals** even when opposite-score technically below threshold. Criteria: **news flip к opposing bias + structural indicator (slope1h, MACD) flip + sustained CVD (not 3m spike) в opposing direction** = consider exit at breakeven-area before SL hit. NOT mechanical SHORT-score ≥ 8/12 alone.

## Research citations

- `stop-hunting-market-traps.md` — break-and-retest (correct structure, but wrong regime context)
- `trading-in-the-zone.md` — process over outcome (applied during hold discipline)
- `crypto-market-microstructure.md` — CVD divergence at breakout = distribution signature (ignored twice today)

## Day summary after 5 losses

- **5× SL**: AVAX #1, AVAX #2, BTC #3 (−1R each, 0.5% risk); BTC #4 (−1R, 0.125% risk); BTC #6 (−1R, 0.25% risk)
- **2 clean cancels**: BTC #2 (invalidated quickly), BTC #5 (regime pivot)
- **Day P&L**: **−$2215** (−0.90% of equity)
- **Daily DD**: 1.39% (far from 4% kill)
- **Total DD from peak**: 1.93-1.95%

**Final decision**: HALT trading rest of day till 00:00 UTC. 5 SL = definitive stop, no operator override will change that. Process has been disciplined; pattern suggests today's regime incompatible with my edge. Accept loss, preserve capital for tomorrow.

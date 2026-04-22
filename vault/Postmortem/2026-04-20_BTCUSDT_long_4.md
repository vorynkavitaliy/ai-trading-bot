---
name: Postmortem 2026-04-20 BTCUSDT LONG #4
symbol: BTCUSDT
direction: Long
trade_file: 2026-04-20_BTCUSDT_long_4.md
outcome: win
r_multiple: 0.67
process_grade: A
---

# Postmortem — BTCUSDT LONG #4

## Trade fact sheet
- Entry: 76000 @ 18:33:00Z (limit fill after place-limit 18:03:50Z).
- Exit: 76200 @ ~20:33Z (trailing SL trigger).
- Duration: ~2h.
- Confluence at entry: 10/12 (A-setup).
- Risk taken: 0.5% per account.
- Realized R: +0.67.
- Realized P&L: +$833.20 combined.

## What went right (process grade A)
1. **Entry execution clean.** htf_pivot 76121 pre-committed R в zones.md, bullish breakout + retest setup took clean entry at round 76000. Cross-pair structure 5/8 1h bullish supported это как не одиночку.
2. **Margin compliance verified.** Earlier #3 cancel lesson (false alarm at assumed 3× leverage) codified — this entry confirmed 10× config actual, 12.8% margin < 25% cap.
3. **Grace period respected.** No exits in first 9 min.
4. **+1R → SL to BE executed.** Once 76300 touched @ 18:51, SL moved 75700 → 76000 per exit-rules.md. Trade becomes risk-free.
5. **+1.5R → Trailing activated.** 76450 crossed @ 20:23, SL moved BE → 76200 via 1× ATR(1H). Both accounts executed via execute.ts cleanly.
6. **No manual override at stress.** 76% give-back от peak $1706 testing rules; stayed mechanical; rules won (eventually captured +0.67R instead of panicking out at 0R or worse).
7. **Flow signals respected.** Despite repeated CVD5m ±$3M flips (spoofing), interpreted as walls + absorbed. Did not fake out.

## What could have been better
1. **Trail width too wide for post-sweep volatility.** Used 1× ATR(1H) = 300 pts below peak 76499 → SL 76200. Pullback from 76500 was 300 pts almost exactly (normal market breathing). Trade gave back $1255 of $2088 peak to exit at +$833. **Capture ratio 40%.**
2. **Didn't consider partial-close variant.** At +1.5R could have booked 50% and trailed runner wider. Would have captured ~+1R guaranteed + optional upside.
3. **Peak stoch15m 97.78 was extreme reversal signal.** When that fired, could have pre-emptively tightened trail. Trade-off: risk of whipsaw on normal cooling stoch.

## Key learnings
- **Lesson**: post-breakout 1× ATR trail is too permissive when sweep-and-reject is typical BTC behavior. Consider tighter post-sweep trail (0.5× ATR) OR partial-close at +1.5R.
- **Affirmation**: mechanical rules work. Gave-back 76% mid-trade drew emotional pressure; adhering to "no override at stress" rule saved the trade.
- **Affirmation**: zone-gate + 12-factor rubric produced actionable A-setup at right time.

## Impact on rules
- No immediate rule change — rules executed correctly.
- Consider codifying "partial-close at +1.5R option" in exit-rules.md after similar cases accumulate (N=3-5 trades).

## Outcome
**Net positive day**: day baseline −$X at 18:33 → closed day +$306.92. Single-trade +$833.20 lifted day from red to green.

Day P&L: **+$306.92 (+0.12%)** — below 0.25% daily target but positive.

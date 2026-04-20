---
date: 2026-04-19
symbol: BTCUSDT
direction: Long
entry: 76008
exit: 75771
entry_time: 2026-04-19T13:28:00Z
exit_time: 2026-04-19T14:04:22Z
hold_minutes: 36
r_multiple: -0.48
realized_gross_usd: -927.42
process_grade: C+
outcome_grade: C
closed_reason: indecisive-structure-scratch-exit
---

# Postmortem — BTCUSDT Long 2026-04-19

## Summary

Second trade of NY+Лондон overlap session. Opened at C328 on news-flip A-setup (10/12) after 12+ cycles of news-blocked FLAT discipline. Market had rallied 400+ pts during news block; I entered at local high. Price never went into profit, oscillated underwater 36 min with BOS1h flipping bullish↔none (indecision signal). Scratch-closed at C340 at -0.48R (-$927.42) before full SL hit (-0.75R / -$1406 equivalent). Post-close price fell 200 additional pts validating exit decision.

## Timeline

| Cycle | Time | Event | R | Unrealized |
|---|---|---|---|---|
| C328 | 13:28 | Opened 76008 (above quoted 75982 fill slippage) | 0 | $0 |
| C329-C331 | 13:31-13:37 | Initial dip -$163 → -$112 → -$331 | -0.08 → -0.19 | |
| C332 | 13:40 | Bounce to -$91, structure holding | -0.06 | -$91 |
| C333-C337 | 13:43-13:55 | Flat consolidation -$155 → -$425 | -0.08 → -0.22 | |
| C338 | 13:58 | **BOS flipped bullish→none (1st time)**, re-score 9/12 | -0.28 | -$555 |
| C339 | 14:01 | **BOS restored bullish**, MACD +89 new max, RECOVERY to -$183 | -0.11 | -$183 |
| C340 | 14:04 | **BOS flipped back to "none" (2nd time)**, OBV turned negative, MACD cooling, -$927, scratch close | -0.48 | -$927 |
| C341 | 14:07 | Post-close: BTC -200 pts more (scratch validated, saved ~$500) | | |

## Process Evaluation (Grade: C+)

### What went right

1. **Signal identification accurate at open**: 10/12 A-setup with all factors confirming (bullish BOS, MACD +68 peak, OBV positive first time, momentum +DI cross -DI, news flip neutral, all TFs >50). By the rubric, this was a textbook qualifying signal.
2. **Proper risk sizing**: 0.75% risk for A-setup per rules.
3. **Respected SL discipline**: Never widened SL, never averaged down.
4. **Identified indecision early**: Recognized BOS oscillating (bullish→none→bullish→none) as "indecisive market" signal at C340 rather than waiting for full SL hit.
5. **Defensive scratch exit**: Cut -0.48R instead of -0.75R. Post-close drop of 200 pts validated the decision (would have been SL hit anyway, saved ~$500).
6. **Documented everything**: Trade file with full cycle tracking, TG alerts, journal entries, correct vault writes.

### What went wrong — CORE LESSON

**Entry was chasing, not an edge.**
- Market had ALREADY rallied 400+ pts (BTC 75548 at C311 → 76008 at C328 entry).
- XRP had moved +170 pts from my earlier close without me riding it.
- News-flip signal qualified ONLY because prices had already run up.
- I entered AT the local high, expecting continuation.
- No pullback, no retest, no OB tap — just "indicators say yes, open."

**The rubric confirmed a signal, but the signal had already played out.**
The 10/12 A-setup was actually measuring a trend that had already expressed itself. Classic lag — indicators lag price, so when all 12 factors align, the move is often already done.

### What I should have done

Opción A: **Wait for pullback to OB level.** Enter at 75600-75700 retest (EMA21 area) rather than 76000 breakout. R:R would have been 2.0+ instead of 1.36.

Opción B: **Use limit order at OB tap.** `place-limit` at 75650, SL 75400, TP 76500 — would have gotten better entry OR limit expired and avoided bad trade.

Opción C: **Size down.** Given late entry, reduce risk from 0.75% to 0.25%. Smaller stop loss on inferior entry.

## Outcome Evaluation (Grade: C)

Negative R outcome, but not disaster. Scratch close at -0.48R better than SL hit -0.75R. Day ended net negative but within acceptable drawdown.

## Key Statistics

- **R multiple**: -0.48 (vs -0.75R SL = scratch saved 0.27R).
- **Realized gross**: -$927.42.
- **Max drawdown within trade**: -0.48R ($927) at C340 close.
- **Best point in trade**: -0.06R ($91) at C332 brief recovery. NEVER IN PROFIT.
- **Hold time**: 36 min (well within 48h max).
- **DD impact**: daily DD grew from 0.14% → 0.58% at worst. Still well below 5% limit.

## Generalizable Lessons

### New lesson to codify (candidate):

**"A-setup confirmed after 400+ pt move = chase, not edge"**

When the 12-factor rubric qualifies a LONG after market has already rallied >300 pts на instrument's ATR (or equivalent) in 30-60 min, the signal is *lagging the move*. Factors align because prices already expressed the trend — you're buying the top of the expression, not the beginning.

**Filter**: Before opening any rubric-qualified LONG, check: has instrument already moved >50% of daily ATR в last hour? If yes — wait for pullback, don't chase.

**Concrete threshold**: For BTC, if 1h chg > +0.7% and you're at local high, require pullback entry (not market entry). For alts с ATR% > 2%, require 30% retracement before entering.

Alternative framing: **"Would this signal look as good if price were 200 pts lower?"** If yes, wait для pullback. If no, entry is already late.

### Confirmed lessons (validated):

1. **Scratch exit > SL hit when structure indecisive** — saved $500 this trade. BOS oscillating "bullish ↔ none" = not a trend, exit without waiting for full stop.
2. **Multiple grade A technical confluence isn't enough if timing is late** — all 10 factors confirmed, but entry price was wrong.
3. **36 min without progress = meaningful signal to re-evaluate** — position never in profit = не trending for me, even если structure technically valid.

## Account Status Post-Close

- **Portfolio**: FLAT.
- **50k equity**: $49376 (DD 1.25%).
- **200k equity**: $197553 (DD 1.22%).
- **Day realized**: -$662.71 net (XRP +$264.71, BTC -$927.42).

## Next Action

- No immediate re-entry. Wait 2-3 cycles minimum для clean structural setup.
- Consider SHORT only if bearish BOS forms + SHORT rubric reaches 9/12+.
- Apply new "Chase filter" lesson to any future late-qualifying setups.

---
symbol: ETHUSDT
direction: short
status: closed
opened: 2026-04-19T20:03:30Z
closed: 2026-04-20T03:59:45Z
entry: 2291.48
exit: 2285.12
sl: 2315
tp: 2220
size_usd: 54954.87
leverage: 0
risk_r: 0.25
confluence_score: 10
confluence_type: A-setup
regime: range-with-breakdown
session: ny
btc_state_at_entry: range-eff_regime-fresh-breakdown
news_multiplier: 1.0
trade_category: structural-breakdown-reentry
thesis_snapshot: "Fresh 1H BOS bearish ETH+BTC после 25-cycle consolidation. Sharp breakdown: BTC -229 pts one cycle, cross-pair 3m BOS 7-8/8 bearish, RSI1h 28.45 continuation."
expected_duration: intraday
order_ids:
  50k_open: 748aee52-797f-4d72-822d-3beaa8672748
  200k_open: ea05689a-b680-405b-b4a4-998e3027494b
  50k_close: c2ad01ff-5344-4799-85cc-66e4a158f6d7
  200k_close: 3677b368-c96d-458e-a576-371fd21b4d3c
closed_reason: narrative_shift_defensive
r_multiple: 0.27
realized_gross_approx_usd: 151
realized_net_approx_usd: ~90
fees_usd: ~60
---

## Close Summary (2026-04-20 03:59 UTC)

**Defensive close on structural thesis breakdown over 6.5-hour hold.** Realized **+0.27R / +$151 gross, ~$90 net** after fees.

### Why close (structural, not panic)

Over ~8 hours (20:03 UTC → 03:59 UTC) the bear structure materially weakened:

| Metric | At entry (20:03) | At peak +0.57R | At close (03:59) | Change |
|---|---|---|---|---|
| ETH 1H BOS | bearish | bearish | **none** | 🔴 lost |
| ETH 15M BOS | bearish | bearish | **none** | 🔴 lost |
| ETH 3M BOS | bearish | bearish | **bullish** | 🔴 reversed |
| ETH RSI1h | 28.45 | 26.11 | **39.54** | +11 pts recovery |
| ETH MACD1h | -2.05 | -3.12 | **+0.063** | 🔴 sign flip |
| BTC slope1h | -6.01 | -0.04 | **+2.61** | 🔴 strong bull |
| ETH RSI 15M | 32.66 | ~30 | **53.92** | above 50 |
| ETH RSI 3M | bear | bear | **64.55** | strongly bullish |

**Peak-give-back: 53%** (+0.57R → +0.27R) — exactly the pattern codified в ETH #1 candidate lesson.

### Rule application

Per `vault/Trades/2026-04-19_ETHUSDT_short.md` candidate lesson (now proven to recur):

> "Below +1R (peaks +0.3R to +1R): when opposing-side momentum compounds 3+ cycles (slope reduction >50%, chg5_15m sustained positive) AND price stalls 2+ cycles in range → consider defensive close locking ≥50% of peak R."

All conditions met:
- Peak +0.57R → current +0.27R = 53% give-back
- BTC slope compounded -6.01 → +2.61 (multi-hour bull drift)
- chg5_15m flipped and sustained positive
- Price stagnated 2279-2286 for 10+ cycles before slowly drifting up

### Symmetric override test

"If LONG at +0.57R peak, gave back 53%, structure (BOS) flipped, MACD sign-flipped, opposite regime momentum compounded — would I close defensively?" → **Yes**. Symmetric, override valid.

### Execution

- **Close market on 50k + 200k sub-accounts** via `execute.ts close --reason narrative_shift`
- Entry 2291.48 → Exit ~2285.12 (mark at close request)
- 50k qty 4.80, 200k qty 19.23 — combined 24.03 ETH
- Gross: (2291.48 − 2285.12) × 24.03 ≈ **$152.83**
- Estimated fees: ~$60 (4 market fills)
- **Estimated net: ~$90 / +0.27R banked**

## Immediate Takeaway

**The ETH #1 candidate lesson "Peak-protection below +1R milestones" now has 2 data points — enough to codify.** Today's timeline:

- **XRP LONG** (morning): peak +1.24R, gave back 54%, closed defensively at +0.58R. Formal rule "Lock 50% of peak R at +1R" codified.
- **ETH SHORT #1** (afternoon): peak +0.40R, gave back 48%, closed defensively at +0.11R. Candidate lesson "Peak-protection below +1R" proposed.
- **ETH SHORT #2** (this trade): peak +0.57R, gave back 53%, closed defensively at +0.27R. Same pattern, different hold duration.

Pattern: **intraday SHORT positions in this market display systematic ~50% peak-give-back after 1-3h of consolidation post-peak**, even when structure initially holds. Requires proactive exit при confluence of (a) peak-give-back ≥50%, (b) opposing-side structure flips (BOS lost or reversed), (c) multi-hour time decay без follow-through.

Lesson candidate will be codified в `vault/Playbook/lessons-learned.md` after postmortem review.

# ETHUSDT SHORT #2 — 2026-04-19 — structural breakdown reentry

## Setup

**Trigger**: 25-cycle consolidation (74890-74970 BTC) broke via fresh 1H BOS bearish. ETH broke below 2294 sweep zone. Multi-pair 3m BOS 7-8/8 bearish.

**Prior trade**: Closed ETHUSDT SHORT at C441 19:06 UTC @ 2298.40, +0.11R net / +$66.59. Defensive exit on 3-cycle BTC deceleration. Structure was cooling.

**Why re-entry valid (not revenge):**
1. 57 minutes elapsed (19:06 → 20:03)
2. Fresh 1H BOS bearish — NEW structural signal не existing когда closed
3. Cross-pair 3m BOS 7-8/8 bearish — broad confirmation NEW
4. Price broke below 2294 nearS area — decisive break not oscillation
5. BTC -229 pts in one cycle = real structural move, not chop

## 12-Factor Confluence (SHORT, C460 20:03 UTC)

| # | Factor | Score | Rationale |
|---|--------|-------|-----------|
| 1 | SMC | 1 | 1H BOS bearish FRESH + 3m bearish + cross-pair 7-8/8 |
| 2 | Tech | 1 | RSI1h 28.45 (continuation per ADX>25), MACD -2.05 deeper |
| 3 | Volume | 1 | OBV -83554 negative |
| 4 | Multi-TF | 1 | 4H 39.49, 1H 28.45, 15M 32.66 all aligned bearish |
| 5 | BTC | 1 | eff_regime range but 1h=down, BTC -229 pts |
| 6 | Regime | 1 | Range qualifies SHORT (Bear OR Range) |
| 7 | News | 1 | neutral, mult 1.0 |
| 8 | Momentum | 1 | ADX 37.2, MDI 29.5 >> PDI 11.5 |
| 9 | Volatility | 1 | ATR mid-range |
| 10 | Liq clusters | 0 | no data |
| 11 | Funding/OI | 0 | no data |
| 12 | Session+Time | 1 | NY session, 237 min to funding |

**Total: 10/12 A-setup**

## Execution

- **Entry**: 2289 (market)
- **SL**: 2315 (tighter — между 2300 psych resistance и EMA21 2321)
- **TP**: 2220 structural
- **R:R**: (2289-2220)/(2315-2289) = 69/26 = **2.65R**
- **Risk**: 0.25% (consistent with ETH #1)
- **Fills**: 50k 4.80 qty $124.8 risk; 200k 19.23 qty $499.98 — combined $624.78

## Invalidation

- ETH 1H close > 2315 (SL zone reclaim)
- ETH 1H close above 2322 (EMA21 reclaim with volume)
- Cross-pair 3m BOS drops <4/8 bearish AND BTC slope1h flips > +2 sustained 2 cycles
- News risk-on 2-cycle

## Management

- +1R (entry-26 = 2263): SL → breakeven 2289
- +1.2R (entry-31 = 2258): SL → entry+0.4R (2278.4)
- +1.5R (entry-39 = 2250): full trail 1× ATR1h activates, protect BE+1R
- Per 2026-04-19 peak protection lesson: monitor for 3-cycle BTC deceleration (exit trigger at ≥+1R peak 50% protect)
- News risk-on 2-cycle: defensive close even с profit

## Peak-protection candidate lesson applied

Spirit of "Lock 50% of peak R at +1R" from prior ETH #1 postmortem — applying this time from the start. Peak protection starts earlier с tighter SL.

---
symbol: ETHUSDT
direction: short
opened: 2026-04-19T17:36:40Z
closed: 2026-04-19T19:06:30Z
entry: 2308.1
exit: 2298.4
sl_planned: 2355
tp_planned: 2220
r_gross: 0.21
r_net: 0.11
realized_net_usd: 66.59
realized_gross_approx_usd: 124
closed_reason: narrative_shift_defensive
process_grade: B+
outcome_grade: B
---

# Postmortem — ETHUSDT SHORT — 2026-04-19

## One-line summary

**Defensive close on 3-cycle BTC momentum deceleration + 48% peak give-back. Realized +$66.59 net (+0.11R) after ~$57 fees on 1h 30min trade.**

## Trade Timeline

| Cycle | Time (UTC) | Event | Notes |
|---|---|---|---|
| C407 | 17:25 | Limit placed @ 2325 | EMA21 retest, 10/12 confluence |
| C411 | 17:36 | Limit cancelled, market entry @ 2308.1 | Per new `feedback_limit_order_distance` rule (ADX>25 → limit ≤0.3%) |
| C416 | 17:51 | Big breakdown → +0.19R | 8/8 cross-pair bos_15m bearish, news flipped risk-off |
| C419 | 18:00 | ETH 1H BOS bearish confirmed | Peak $165 territory |
| C427 | 18:24 | New peak +0.37R / +$221 | Third-leg continuation strong |
| C435 | 18:48 | **ALL-TIME peak +0.40R / +$239** | RSI 27, MACD -1.73, OBV -120k, BTC slope -6.92 |
| C436-C437 | 18:51-18:54 | Oscillation: $239 → $165 → $210 | 1-cycle news blip, OBV reversal then re-deepening |
| C439-C441 | 19:00-19:06 | **3-cycle BTC deceleration** | slope1h -6.92→-2.57→-2.20→-1.78, chg5_15m sustained positive |
| C441 | 19:06 | **Defensive close @ 2298.40** | Judgment override, +$66.59 net banked |

## Process Grade: B+

**What worked:**
1. **Limit cancel + market entry discipline** (C411) — applied new operator feedback rule immediately, avoided "sit idle while move happens"
2. **Signal scoring** — correctly identified 10/12 A-setup at entry, re-validated through oscillation cycles
3. **Patience through oscillations** — held through C423/C428 retraces, correctly identified them as noise (OBV re-deepening pattern)
4. **Judgment override documented** — exit based on 3-cycle structural deceleration, not panic

**What was marginal:**
1. **Late on defensive exit** — peak was +0.40R at C435, I held until C441 (6 cycles = 18 min later), price gave back 48% of peak before I closed. By C439 the deceleration pattern was clear (2-cycle BTC slope easing), but rigid rule-compliance kept me waiting one more cycle for confirmation.
2. **Peak-give-back protection gap** — my pre-commit rules (Peak Proximity Trail, Lock-50%) all start at +1R. Today's peak never crossed +1R, so no rule fired. Discovered a gap: need protection logic for +0.3R-to-+1R peaks too when momentum clearly exhausts.
3. **Fee drag significant** — $57 fees / $124 gross = 46% of gross realized. Market orders on 2 subs (open+close = 4 fills) ate nearly half of capture. Consideration for future: limit-close near target when momentum stalls может reduce fee drag.

## Outcome Grade: B

- **+$66.59 net**: positive, banked defensively. Process-valid.
- **R-math**: +0.11R net / +0.25% risk = ~0.44× risk captured. Below 1R minimum target, но thesis-valid exit.
- **Relative to peak**: banked ~28% of peak $239 (after fees). Gross 52% before fees.
- **HyroTrader DD impact**: DD peaked 1.14% at C435 (best day), closed at 1.17-1.21% (still within all limits).

## Lessons to codify (if pattern recurs)

### Candidate lesson: "Peak-protection below +1R milestones"

**Context**: Peak +0.40R / +$239 at C435, gave back 48% to +0.21R / +$124 at C441 before I closed on judgment override.

**Rule proposal** (add to `lessons-learned.md` if pattern confirms in next 2-3 similar trades):
- When peak reaches +0.3R-to-+1R AND opposing-side structural signals compound 3+ cycles (slope reduction >50%, chg5_15m sustained opposing, RSI recovering > 3 pts):
  - Consider defensive close locking ≥50% of peak R value
  - Even если formal Peak Proximity Trail trigger (+1R) не сработал
  - Honor the SPIRIT of peak-protection, not только letter of the rule
- Requires **symmetric override test**: would I close LONG в mirror conditions? If yes → close SHORT.

### Candidate lesson: "Fee drag on intraday market trades"

Today 4 market fills on 2 subs = $57 fees ≈ 46% of gross. On short-duration high-fee trades, this is significant drag. Consideration: place-limit near target level когда momentum stalls, позволяя maker rebate vs taker fee saves ~50% of close cost.

## Comparison vs the earlier XRP LONG (same day)

**XRP LONG earlier**: peak +1.24R, closed +0.58R defensively on news flip (2-cycle rule). Peak give-back 54%. Lesson written: "Lock 50% of peak R at +1R".

**This ETH SHORT**: peak +0.40R, closed +0.21R defensively on structural deceleration. Peak give-back 48%.

**Pattern**: **both** trades show 48-54% peak give-back as recurring intraday dynamic. My existing rules catch the +1R case (XRP) but NOT the sub-+1R case (this ETH). Gap identified.

## Meta-reflection

This was a textbook "trend-continuation post-impulse" trade. Entry was disciplined (structural break confirmation at C411), management was rule-honoring (refused correlated BTC stack, didn't move SL prematurely), exit was judgment-based but not panicked. Net positive despite fee drag. The +1R milestone would have fired my rules; +0.40R peak slipped under. Process-valid; outcome-decent; **structure gap identified for codification**.

Day 2026-04-19 trade summary:
- XRP LONG: +0.58R gross / defensive on 2-cycle news flip
- BTC LONG: -0.48R gross / scratch on chase-lag pattern
- ETH SHORT: +0.11R net / defensive on structural deceleration

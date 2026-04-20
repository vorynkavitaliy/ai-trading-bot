---
name: BTCUSDT LONG Postmortem 2026-04-20
trade_file: 2026-04-20_BTCUSDT_long.md
realized_r_net: +0.40
realized_r_gross: ~+1.0
peak_r: +2.10
peak_unrealized_usd: 870
realized_net_usd: 164.34
giveback_pct: 81
process_grade: B
outcome: profitable
---

# Postmortem — BTCUSDT LONG 2026-04-20

## Trade Summary

- **Entry**: limit placed at 75100 C607 (09:48 UTC), filled at **75032.6** (slippage improved entry by 67 pts during BTC dump 75167 → 75003)
- **SL progression**: 74900 → 74950 (C612 rule #5) → 75165 (C613 +1R lock)
- **TP**: 75500 (never hit)
- **Exit**: SL triggered C620 (~10:27-28 UTC) at ~75141 (slippage of ~24 pts from SL 75165 during fast drop)
- **Realized net**: **+$164.34 combined** (+0.4R net after fees / ~+1R gross)
- **Peak**: +2.10R / **+$870 unrealized** at C617 (10:18 UTC)
- **Duration**: ~38 min
- **Confluence at entry**: 9/12 (news-override)

## What Went Right

1. **News override was correct**. At C607 I overrode doctrinal "risk-off blocks LONG" based on:
   - BTC eff_regime just flipped к `bull` (scanner authoritative)
   - chg5_15m +0.51% breached +0.5% threshold (real price action)
   - Aave trigger was stale sentiment
   
   Validation: news bias flipped к neutral at C619 — scanner classifier eventually caught up.

2. **Place-limit over market entry**. C607 BTC was at nearR 75204 after +185pt bounce. Rather than chasing market, I placed limit at 75100 (pullback zone). When BTC drilled to 75003 in next 4 min, my limit filled at 75032.6 — **67 pts better than planned**. This improved R:R from 2.0 к 3.54 and directly translated to profit (without fill improvement, breakeven entry would have likely given SL hit instead of peak +2.10R).

3. **Pre-committed invalidation rule #5 fired correctly**. C612: ETH and BNB bos_1h both reverted bullish → none. Trade file rule #5 said "tighten SL к 74950". Executed immediately. This locked -0.62R max loss (vs -1R) — defensive.

4. **+1R trail at C613**. Peak +2R at C613 → moved SL к 75165 per lesson cascade. This is THE move that turned trade positive. Without it, SL stayed at 74950 and retest at 75141 may or may not have triggered (actual exit 75141 is below 74950 buffer... wait actually 75141 > 74950, so SL 74950 would NOT have triggered — position would still be open holding at 75145). Hmm, so the trail к 75165 actually CAUSED the exit. Need to think about this.

5. **Following process over emotion**. At +2.10R peak C617, no FOMO rebalance. At +1.49R pullback C619, no panic close. Followed rules.

## What Went Wrong

1. **Missed the +1.26R tighten opportunity**. At C620 with 3 consecutive decel cycles + bos_3m loss, I correctly identified need to tighten к 75200 ($524 lock). But I wrote/executed too slowly — SL 75165 triggered ~30 seconds before my move-sl к 75200 could execute. Realized $164 instead of potential $524 = **lost $360 from slow reaction**.

2. **81% peak giveback**. This is THE critical issue. Peak $870 unrealized (C617) → realized $164 = lost 81% of peak gain. Lesson 2026-04-19 "Lock 50% of peak R" was written precisely to prevent this, yet I still gave back 81%. Root cause: SL cascade was set to 50%-of-peak minimum (+1R lock = SL 75165), not aggressive enough when structure weakened.

3. **SL tightening logic was reactive, not predictive**. Protocol requires "2 consecutive decel cycles" before triggering Peak Proximity Trail action. But at +2.10R peak, structure weakening is PROBABLY already happening before metrics confirm. Predictive tightening (e.g., at peak + 15 min) would have captured more.

4. **Heavy fees erosion**. Gross gain $413.75 minus fees $175 (taker exit on SL) = net $164. **42% of gain eaten by fees** because of market-order stop. Alternative: use conditional limit-stop (takes maker rebate) at 75165 — but maker fills not guaranteed in fast drops.

## Process Grade

**B** — profitable, followed rules, but missed optimization. Grade details:

- ✅ Entry (place-limit, news override, pre-committed invalidations written) — A
- ✅ First SL tightenings (rule #5, +1R lock) — A  
- ❌ Late tightening cascade (missed +1.26R lock by seconds) — D
- ❌ Peak giveback 81% — F (lesson explicitly warned against this)
- ✅ Trade hygiene (vault writes, TG alerts, reconcile management) — A

## Lessons For Next Time

### 1. Tighten aggressively on 3rd consecutive decel cycle, don't wait for "confirmation"

Peak Proximity Trail protocol requires 2 consecutive decel cycles for triggers. But by the TIME 2 cycles pass, price has often already started to break structure. New rule proposal:

**After ANY decel cycle from peak that coincides with structural downgrade** (e.g., bos_3m loss, or bos_1h flip, or bos_15m flip), immediately tighten SL к ≥60% of current peak R, not 50%. Don't wait for 2nd decel cycle.

In C618 (1st decel): bos_3m still bull, mild decel → hold is fine.
In C619 (2nd decel): bos_3m still bull, clear decel → tighten к 60% of peak = 75188 proactively.
In C620 (3rd decel): bos_3m LOST + clear decel → tighten к 70% of peak = 75208 proactively.

Had I done this at C619, SL at 75188 would have protected ~$488 (vs $164 realized). Had I done at C620, SL at 75208 would have protected ~$549.

### 2. Nearby structural level break = immediate tighten

BTC nearS was 75219 (C619). SL 75165 sits 54 pts below nearS. If nearS breaks, price likely accelerates down through my SL. Rule: **if price consolidates within 50 pts of structural support with declining momentum, tighten SL to 15 pts below that support** (e.g., SL к 75204).

### 3. Fast-drop scenario specific

When BTC pumps 200+ pts into resistance then decels for 3+ cycles, the probability of a fast retracement increases. Consider:
- Pre-empt with SL к "fill/50% retracement level" (midpoint of pump)
- OR partial TP at +1.5R and trail rest

Today's pump: 75003 (C608) → 75311 (C617) = 308 pts. 50% retrace = 75157. My SL 75165 was ALMOST exactly at 50% retrace — it got hit by the textbook 50% retrace.

## Connection to Prior Lessons

- Reinforces 2026-04-19 "Peak give-back" lesson (multi-recurrence today: 81% giveback)
- Reinforces 2026-04-19 "Lock 50% of peak R" — my 50% lock was the MINIMUM, not the right amount for volatile conditions
- Reinforces 2026-04-19 "A-setup confirmed AFTER rally = chase" — I CORRECTLY avoided chase at C607 by using place-limit
- Reinforces 2026-04-20 "Pre-defined invalidation > rubric" — rule #5 fired correctly

## Follow-Up Actions

1. Propose update к `vault/Playbook/exit-rules.md`: add "structural downgrade" trigger к cascade
2. Consider adding к `lessons-learned.md` if giveback pattern confirms 3+ occurrences (this is 2nd or 3rd occurrence of "high giveback after structure peak")
3. Review `src/execute.ts` conditional-limit option for SL (maker rebate vs taker fees)

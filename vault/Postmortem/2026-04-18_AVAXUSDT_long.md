---
trade_file: "[[Trades/2026-04-18_AVAXUSDT_long]]"
symbol: AVAXUSDT
direction: long
outcome: loss
r_multiple: -0.15
duration_minutes: 3
closed_reason: proactive-exit
process_grade: D
lesson_tag: [post-loss-streak-filter, macro-regime-shift, chase-in-wrong-direction]
generalizable: true
written: 2026-04-18T08:40:00Z
---

# Postmortem — AVAXUSDT LONG — 2026-04-18 (London +1h 36min)

## What I Expected

5/8 mechanical fire в Bull regime, R:R 1.5 mechanical trigger. Accept scanner since flat and pause-rule technically не применялась.

## What Actually Happened

- [08:36] Entry 9.544, immediately -$52 at fill.
- [08:39] Closed ~9.535, -$45/-0.15R, 3 min.

**5-th mechanical fire today. 5-th loss or scratch. Pattern:**
- XRP L:6/8 Long (07:03) → -$376 (-0.3R)
- BNB L:5/8 Long (07:15) → -$40 (scratch)
- DOGE L:5/8 Long (07:00) → -$64 (-0.25R)
- BNB S:5/8 Short (08:18 limit) → pending
- AVAX L:5/8 Long (08:36) → -$45 (-0.15R)

Total realized today: ~-$525 / ~-1.05R across 4 closed trades.

## The Delta

- **Market did:** Morning rally peaked ~07:21, funding window killed momentum, BTC weakening accelerated after 08:00.
- **I expected:** Each mechanical fire to be a legitimate standalone signal.
- **Gap cause:** **Market regime was actively shifting bullish → bearish throughout session.** Every alt-Bull 5/8 fire was a dead-cat bounce in a transitional-to-bearish tape. Scanner саw local 5/8 but missed the macro rotation. R:R floor + individual confluence weren't enough — needed a **post-loss-streak filter**.

## Process Review

- [x] Entry rules followed? YES (mechanical)
- [x] Correlation check? PARTIAL — AVAX is alt-Bull, I was flat, pause-rule не применялась. But context was 4 prior losses same session same direction.
- [x] SL structural? YES
- [x] Updated Trades/ file? YES
- [x] Applied proactive exit? System did.

## Grade: **D (process)**

Grade D — не F (system proactive-exit contained loss to -0.15R) — но все ещё bad process. Claude (я) had information to block this trade: 4 prior losses in same direction. I didn't apply it. Scanner fires are not instructions; they're signals to evaluate.

## Generalizable Lesson

**Post-loss-streak filter: after 3 losses in same direction same session → reduce OR block same-direction signals until regime confirms OR time-based reset.**

**Why:** Market regime shifts happen. When scanner fires 5/8 repeatedly on same direction and losses accumulate — that's signal scanner has lost edge temporarily. Trading against your own short-term stat drift is lighting fees.

**How to apply:**
- Track realized R per session by direction.
- If LONG losses ≥ 3 in one session → next LONG fire requires 6/8 threshold OR explicit macro confirmation.
- If SHORT losses ≥ 3 → symmetric rule.
- Reset counter at session transition (07/13/17/22 UTC) OR after 1 winning trade.

**Symmetry с morning XRP lesson:** That was peak-score trap (score at top of move). This is scanner-edge-drift (scanner fires reliably but market went sideways/against). Related but distinct.

→ Append to `lessons-learned.md` with tag `post-loss-streak-filter`.

## Action for remaining session

Block further LONG accepts на remaining 4h London/Overlap window unless:
- BTC flips back to L:4+ (regime confirmation)
- OR pair shows 6/8+ на 2 consecutive cycles (structural confirmation, not flicker)

**Currently pending:** SOL LONG limit just placed by scanner. **DO NOT accept SOL fill** — 5th alt-Bull Long in a row, same pattern, no edge. Cancel limit.

**BNB SHORT limit pending** — this is opposite direction, aligns with bearish macro. Let it fill if price gets there.

## Day P&L Summary

- Realized: XRP -$376, BNB ~-$40, DOGE ~-$64, AVAX ~-$45 = **~-$525 (~-1.05R)**
- DD: ~-1.05% of combined $125k
- Still far within 5% daily limit (~-$6,250)
- Budget remaining: ~$5,725 before kill switch

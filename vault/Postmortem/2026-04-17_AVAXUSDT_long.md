---
trade_file: "[[Trades/2026-04-17_AVAXUSDT_long]]"
symbol: AVAXUSDT
direction: long
outcome: win
r_multiple: 0.84
duration_hours: 0.3
closed_reason: proactive-exit
process_grade: A
lesson_tag: [win-learned]
generalizable: true
written: 2026-04-17T11:36:00Z
---

# Postmortem — AVAXUSDT LONG — 2026-04-17

## What I Expected

Scanner fired 5/8 L + R:R 1.5 on Bull regime. Scanner's standard-entry logic doesn't gate on SHORT score — but I noted SHORT was already at 4/8 (my own proactive-exit threshold) and called the entry MARGINAL with tight leash: "SHORT ≥5/8 OR LONG <4/8 OR asymmetry inversion = immediate close." I wrote tighter discretionary rules than the TypeScript layer — and that's the thing I want to remember.

Confluence at entry: 5/8 L, 4/8 S. Regime Bull. R:R 1.5 (SL 1.23% below, TP 1.78% above).

## What Actually Happened

- [11:13:55] — Opened both subs (50k 1086.9 qty + 200k 4347.8 qty @ 9.545). SL 9.428 / TP 9.715 server-side reduce-only.
- [11:14] — Immediate -0.05R (mark 9.539). Tight leash concern live.
- [11:18] — Recovery: mark 9.57, SHORT dropped 4→3. Asymmetry widened to +2. Tight concern relaxed.
- [11:22] — Further recovery: mark 9.593, L score lifted 5→6/8. Confirmation signal.
- [11:25] — +$306 unrealized (~+0.70R). Sustained 6/8.
- [11:28] — Peak: mark 9.656 (~+0.95R, +$603 unrealized). Approaching +1R trigger 9.662 and TP 9.715.
- [11:31:50] — Scan cycle: L:6→5/8, SHORT:3→4/8. Asymmetry +3 → +1. R:R recalc 1.04 (would not open fresh).
- [11:31:52] — **TypeScript proactive-exit fired** (CLAUDE.md "opposite direction scores 4/8+ → close position"). Market exit 9.654 both subs. Realized: +$107 on 50k + +$428 on 200k = **+$535 (+0.84R)**.

## The Delta

- **Market did:** Strong push from 9.545 → 9.656 (+$603 unrealized), then momentum faded as alt-cohort lost confluence; SHORT side lifted to 4/8.
- **I expected:** Either a continuation to TP 9.715 (~+1.47R) or a proactive exit if SHORT strengthened.
- **The gap was caused by:** Market reverted before TP was touched. Distribution signature (peak profit coincides with signal decay). Classic alt-rotation chop today.

## Process Review

- [x] **Did I follow the Entry Rules?** Yes. 5/8 standard threshold met, R:R 1.5 floor cleared, BTC not adverse, slot available, heat OK.
- [x] **Was SL structurally placed, within caps, within 5 min?** SL 9.428 = 1.23% below entry, within 3% alt cap. Set server-side at placement. ✓
- [x] **Did I size per risk_r, not emotion?** Orchestrator sized per system rules, 4:1 ratio across subs. ✓
- [x] **Did I update the Trades/ file as position evolved?** Yes — opened, three mid-life entries (11:14, 11:18-11:28 summary), closed with summary.
- [x] **Did I resist widening SL / moving TP?** Yes. SL stayed 9.428 through the hold. No tightening attempts.
- [x] **Did I close for the right reason?** The TypeScript layer closed on its mechanical rule. I didn't interfere. Correct.
- [x] **Did I write this postmortem within 1h of close?** Yes (11:32 close → 11:36 postmortem).

**Process grade: A**

*Justification:* Marginal entry was accepted with explicit tight leash; mechanical system caught the reversal at +0.84R before a drift back to entry could erode gains. Discretionary and mechanical layers agreed on direction though differed on threshold — the tighter one (TypeScript 4/8) won, which is the correct principle for protecting open profit.

## Lesson

**Lesson statement:** When discretionary and mechanical exit rules disagree, the TIGHTER one protects open profit — don't loosen a tight mechanical rule with a looser discretionary override.

**Why it generalizes:** The TypeScript "SHORT ≥4/8 → close" rule is not a suggestion; it is the one-brain-consistent-logic principle in code. My thesis tightened entry-time exit rules ("SHORT ≥5/8") as a concession to having entered when SHORT was already 4/8. But once the trade was in profit, the tighter 4/8 rule was the protective one — and letting it fire captured +0.84R vs. potentially giving it all back. The general principle: profit-locking exits should defer to the TIGHTER rule, not the lower one.

**Tag(s):** `[win-learned]`

**Action:**
- [x] Add to `Playbook/lessons-learned.md` 
- [x] Update `Thesis/AVAXUSDT.md` (closed, awaiting clean structural reset before next entry)
- [ ] No Watchlist update needed (AVAX is not currently on Watchlist)

## Outcome Attribution

- **Process contribution:** 80% — entered on valid mechanical signal with tight-leash acknowledgment; let the system manage the exit at the right moment.
- **Luck contribution:** 20% — market moved in my favor before SHORT lifted; if SHORT had ticked to 4/8 at -0.3R instead of +0.95R, I'd have banked a loss, not a win.

*A perfectly-executed marginal entry can still take a -0.5R cut on average; the +0.84R outcome here is on the favorable side of that distribution. Not to be extrapolated as "marginal is fine" — the edge was process + luck, not process alone.*

## What I'd Do Differently

- [x] Yes, same entry, same management

*Justification:* Marginal 5/8 + SHORT 4/8 entries are acceptable IF the discretionary tight-leash is set at entry AND the mechanical 4/8 proactive-exit can fire without override. Today both conditions held. If I'd ignored the tight-leash warning at entry, I might have been looser on the close. If I'd overridden the proactive-exit at 11:31 (thinking "+0.95R is almost +1R, let TP take it"), I'd have risked giving back all the gain on the next candle.

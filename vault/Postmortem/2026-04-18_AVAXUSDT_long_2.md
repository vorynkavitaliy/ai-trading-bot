---
trade_file: "[[Trades/2026-04-18_AVAXUSDT_long_2]]"
symbol: AVAXUSDT
direction: long
outcome: scratch
r_multiple: 0
duration_minutes: 0.5
closed_reason: claude-override-post-loss-streak
process_grade: B+
lesson_tag: [scanner-filter-gap, claude-override-required, post-loss-streak-enforcement]
generalizable: true
written: 2026-04-18T10:41:00Z
---

# Postmortem — AVAXUSDT LONG #2 — 2026-04-18 (claude-override)

## What I Expected

Scanner cooldowns would keep alt-Bull LONG pairs blocked for the remainder of the loss-streak window. I wrote the post-loss-streak filter at 08:40 expecting cooldowns (120m) + R:R floor + confluence threshold to suffice as mechanical safeguards until I could manually disable fires.

## What Actually Happened

At 10:39 UTC — exactly 120 min after AVAX #1 close — cooldown expired and scanner autonomously fired 5/8 LONG AVAX. **Market order filled on both sub-accounts before I could evaluate.** The scanner does not know about my filter; it runs mechanically on threshold + cooldown + R:R alone.

I closed the position 28 seconds later via `src/close-now.ts` at ~BE. Net: flat PnL (minus ~$40-80 fees).

## The Delta

- **I expected:** cooldowns would give me time to manually cancel/evaluate on refire.
- **Reality:** scanner fires AS SOON as cooldown expires if threshold met. Market order. Instant fill.
- **Gap cause:** my filter is a Claude-layer rule, not a TypeScript enforcement. No cross-terminal "freeze same-direction scanner fires" mechanism exists.

## Process Review

- [x] Filter rule applied? YES (closed within 28s of fill)
- [x] Entry authorized by rules? NO (filter should have blocked)
- [x] Claude-layer override executed? YES (src/close-now.ts)
- [x] Vault written? YES
- [x] Damage contained? YES (flat, ~$40-80 fees, not -$250 loss)

## Grade: **B+ (process)**

- **A:** I applied the filter within 28s of fire — fast override.
- **Not A+:** the trade filled in the first place. Ideally scanner should have been blocked BEFORE fire.
- **B+ compromise:** I caught it, closed it, learned the gap. Small fee cost, no R damage.

## Generalizable Lesson

**Claude-layer filters must be enforced by Claude-layer action, not by scanner obedience.**

**Why:** Scanners are mechanical. Confluence + R:R + cooldown are the only gates. Any rule that says "skip this fire because of context X" — where X lives only in Claude's mind (loss streak, macro reading, news event) — CANNOT be enforced by the scanner. Claude MUST be the override.

**How to apply:**
- Every cycle during a loss streak: first check scanner output, SECOND check if any auto-exec happened.
- If auto-exec on blocked pair → close within next cycle. No deliberation.
- Eventually: code the filter into TypeScript. Add a "freeze-same-direction" flag settable via CLI/Redis that scanner respects.
- Until coded: write on `Watchlist/active.md` a "DO NOT ACCEPT" note for pairs matching the streak pattern, as a reminder each cycle.

**Symmetry с existing lessons:**
- Morning XRP lesson: peak-score trap (score high at reversal top)
- Morning AVAX lesson: post-loss-streak filter (scanner edge drift)
- This lesson: **enforcement gap** — filters in lessons-learned.md are not automatically applied; they require Claude-action each cycle.

→ Append to `lessons-learned.md` with tag `claude-override-required`.

## Action for remaining session

- **Treat scanner fires as signals to evaluate, never as instructions to accept.**
- Every cycle during remaining London + Overlap: if any LONG auto-exec, close within same cycle.
- Consider: at session transition 13:00 UTC, reset post-loss-streak counter. Until then: block.

## Day P&L Summary (updated 10:41)

- Realized pre-AVAX#2: -$525 (-1.05R)
- AVAX #2 cost: ~$40-80 fees, ~0 price delta = ~$-60 impact
- **Total realized: ~-$585 / ~-1.17R**
- DD: ~-1.17% of combined $125k
- Well within 5% daily limit (~-$6,250). Budget remaining: ~$5,665.

---
trade_file: "[[Trades/2026-04-17_BNBUSDT_long]]"
symbol: BNBUSDT
direction: long
outcome: win
r_multiple: 1.46
duration_hours: 2.0
closed_reason: tp
process_grade: A
lesson_tag: [win-learned]
generalizable: true
written: 2026-04-17T14:05:00Z
---

# Postmortem — BNBUSDT LONG — 2026-04-17

## What I Expected

Clean 5/8 standard confluence + R:R 1.51 from Watchlist trigger. BNB was the ONE pair that cleared news-filter at 10:27 UTC and held. Target TP 635.5 at local 1H resistance, SL 626.2 below structural support. Expected intraday resolution within London/Overlap session.

## What Actually Happened

- [11:01:34] — Opened @ 629.9 both subs (50k 16.89 + 200k 67.56 qty). Server-side SL/TP attached.
- [11:10 – 12:31] — 30 cycles of monitoring. Score oscillated 5/2-3 stable. Mark drifted 630 → peak 633.2, never crossed +1R trigger 633.6 for discretionary BE-trail. Consolidation cycle after cycle.
- [12:31+] — Last monitored cycle. Cron went dormant for ~1.5h.
- [13:XX UTC] — **Server-side TP fired @ 635.3 (0.03% slippage below 635.5 TP level).** Position closed both subs autonomously. Realized +$397.26 (+1.46R).
- [14:00 UTC] — Resumed cycle; audit revealed position gone + closedPnL record confirmed +$397 realized.

## The Delta

- **Market did:** consolidated at 632-633 for 90 min post-12:31 in chop, then broke out higher through 635.5 during the cron gap, tagging TP.
- **I expected:** either cross of +1R (633.6) for discretionary BE-trail OR tag of TP 635.5 during continued session. Got TP.
- **The gap was caused by:** normal market dynamics. The only surprise was the cron outage coinciding with the final move.

## Process Review

- [x] **Entry Rules followed?** Yes — Watchlist setup explicit trigger, 5/8 + R:R 1.51 cleared min floor.
- [x] **SL structurally placed, within cap, set within 5 min?** SL 626.2 = 0.59% below entry, under 2% BTC / 3% alt caps. Server-side active immediately.
- [x] **Sized per risk_r?** Yes, orchestrator-sized, 4:1 across subs.
- [x] **Updated Trades/ file as position evolved?** Yes — 6+ timestamped entries documenting cycle-by-cycle health.
- [x] **Resisted widening SL / moving TP?** Yes. SL never moved (discretionary BE-trail never triggered, and that's OK).
- [x] **Closed for the right reason?** Yes — TP tag, fully mechanical, no discretionary interference.
- [x] **Wrote postmortem within 1h?** Yes.

**Process grade: A**

*Justification:* Clean mechanical entry + mechanical management + mechanical exit. Server-side orders performed their role during an unplanned automation outage. No discretionary overrides, no second-guessing. The fact that I missed the close in real-time doesn't diminish the process — the system functioned as designed.

## Lesson

**Lesson statement:** Server-side SL/TP orders are the lifeline when cron/automation fails — they execute trades independently of session state.

**Why it generalizes:** Automation will fail. Cron can stop, VPS can lag, API can 5xx. When that happens, the only thing standing between my thesis and an unbounded outcome is the ORDER SITTING ON THE EXCHANGE. Every position without a live server-side SL is a hope trade. This BNB trade survived a 90-minute cron outage — if I had been running with "mental stops" or Claude-monitored SLs, a breakout through 635.5 + reversal to 620 would have bled all gains back + into loss. The server-side TP locked the outcome.

**Tag(s):** `[win-learned]` (operational resilience)

**Action:**
- [x] Add to `Playbook/lessons-learned.md`
- [x] Update `Thesis/BNBUSDT.md` (flat, neutral-post-win)

## Outcome Attribution

- **Process contribution:** 90% — clean entry, disciplined hold, server-side orders.
- **Luck contribution:** 10% — directional move landed on TP exactly rather than reversing to SL during the outage.

## What I'd Do Differently

- [x] Yes, exactly the same

*Justification:* Trade worked as designed. The only improvement would be cron reliability (operational, not trade-level).

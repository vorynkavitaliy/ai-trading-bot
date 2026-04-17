---
date: YYYY-MM-DD
regime_eod: ""         # bull | bear | range | transitional — at end of day
btc_eod: ""            # bull | bear | range
fear_greed: 0
trades_opened: 0
trades_closed: 0
daily_pnl_r: 0.0
key_events: []
---

# Journal — {YYYY-MM-DD}

> One file per trading day. The narrative of the day — macro context, sessions, decisions made, decisions passed.
> Written continuously through the day as cycles fire. Final summary written at 22:00 UTC (dead zone).

---

## Pre-Market (Asian open, 00:00 UTC)

*What is the market coming in with? Overnight developments? Asian open reaction?*

- **BTC overnight:** [summary]
- **Key news overnight:** [summary or "none"]
- **Fear & Greed:** [value]
- **Expected session character:** [short predictions for London/NY]

## Asian Session (00:00–07:00 UTC)

*What happened in Asian hours. Usually brief — low activity.*

- [HH:MM] — [event / observation]

## London Session (07:00–13:00 UTC)

*The manipulation phase. Sweeps, reversals, trend establishment.*

- [HH:MM] — [event / setup / decision]

### London Decisions
- [HH:MM] — **Took:** [SYMBOL DIRECTION] — [brief why]
- [HH:MM] — **Passed:** [SYMBOL setup] — [brief why]

## NY+London Overlap (13:00–17:00 UTC) — Prime Window

*Best setups of the day tend to fire here. I scale up attention.*

- [HH:MM] — [event / setup / decision]

### Overlap Decisions
- [HH:MM] — **Took:** [SYMBOL DIRECTION] — [brief why]
- [HH:MM] — **Passed:** [SYMBOL setup] — [brief why]

## New York Session (17:00–22:00 UTC)

*Continuation or reversal of overlap direction. Distribution by US close.*

- [HH:MM] — [event / decision]

### NY Decisions
- [HH:MM] — [action]

## End-of-Day Summary (22:00 UTC)

**Trades closed today:**
- [SYMBOL DIRECTION] — [R outcome] — [one-line reason]

**Open positions at EOD:**
- [SYMBOL DIRECTION] — [R current] — [thesis snapshot]

**Regime at EOD:**
- BTC 4H: [state]
- Broad market: [risk-on / risk-off / mixed]

**What I did well today:**
- [1-2 points]

**What I'd do differently:**
- [1-2 points]

**Tomorrow's focus:**
- [what I'll be watching for in tomorrow's Asian/London]

**Update candidates:**
- Any lesson for `Playbook/lessons-learned.md`?
- Any thesis revision required on `Thesis/*.md`?
- Any anti-pattern I need to re-read?

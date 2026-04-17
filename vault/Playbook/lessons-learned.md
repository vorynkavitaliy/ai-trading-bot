---
name: Lessons Learned
description: Accumulated wisdom from my own trades. Each lesson is paid for in P&L. I never repeat them.
type: playbook
priority: 5
last_revised: 2026-04-17
---

# Lessons Learned

> **Every entry in this file cost me money. Most are losses; some are wins I nearly surrendered. I reread this file after losing streaks, before taking exceptions, and when the market feels like it's asking me to break a rule.**

---

## How This File Works

After every closed trade — especially losses, but also wins with notable features — I extract a lesson and decide whether it belongs here.

**Lesson belongs in this file if:**
- It contradicts my natural instinct (my instinct is unreliable)
- I've violated it more than once
- It saved or could have saved meaningful P&L
- It generalizes beyond a specific trade

**Lesson does NOT belong here if:**
- It's specific to one setup and already captured in Playbook entry/exit rules
- It's a rediscovery of something already in this file (instead, add a date-stamp to the existing entry)
- It's an outcome I can't separate from luck (don't learn from noise)

### Entry format

```markdown
## [YYYY-MM-DD] — Short rule statement

**Context:** one sentence on the situation that produced the lesson.
**What I did:** what I actually did (usually wrong).
**What I should have done:** what the rule says.
**Why it matters:** the generalizable principle.
**Tags:** `[category]` `[category]`
```

**Tag vocabulary:**
- `[ego-hold]` — held a loser past the rule
- `[fomo]` — entered because I couldn't sit out
- `[oversize]` — sized bigger than the rule
- `[news-react]` — traded the headline without structure
- `[session-misread]` — wrong session playbook applied
- `[regime-misread]` — wrong regime playbook applied
- `[tp-greed]` — moved TP farther mid-trade
- `[sl-widen]` — widened SL to avoid loss
- `[correlation-blind]` — took 3 correlated positions, one direction
- `[counter-btc]` — alt trade fighting BTC direction
- `[dead-zone]` — entered in the no-entry window
- `[funding-clip]` — entered within funding window
- `[win-learned]` — win that generalizes into a rule

---

## Lessons

*No lessons yet. This file grows as I trade.*

*Seed reminders from pre-accumulated feedback memory (will be consolidated into this file over time):*

### [2026-04-16] — TP Sizing in Range Markets

**Context:** Range market on ETHUSDT, 1H boundaries clear at $1580–$1640.
**What I did:** Set TP at fixed 3:1 R:R → target at $1720, way outside the range.
**What I should have done:** Set TP at opposite range boundary ($1640 from $1580 long) = 1.7R realistic target.
**Why it matters:** Demanding 3R in a 4% range means every winning trade reverts to breakeven before TP. R:R must respect the terrain.
**Tags:** `[tp-greed]` `[regime-misread]`

### [2026-04-16] — Trading Day Structure

**Context:** General observation across the first weeks of operation.
**What I learned:** Intraday trades resolve cleanly; multi-day holds accumulate funding and get whipsawed by news. Session awareness matters more than I initially weighted.
**How it applies:** Default to intraday exits. Use 72h only for genuine swing setups with clear 4H structure. Most positions should be closed by the end of the session they were opened in.
**Tags:** `[win-learned]` `[session-misread]`

### [2026-04-16] — Slot Replacement Over Queueing

**Context:** All 5 position slots full, new high-confluence signal appeared.
**What I learned:** Better to close the weakest open position (lowest confluence, worst R progress) and open the new one than to pass on the new signal. Position quality must be maximized, not position count.
**How it applies:** When all slots full AND new signal > weakest open position's original confluence score → replace.
**Tags:** `[win-learned]`

### [2026-04-16] — Inter-Terminal State

**Context:** Multiple terminals, same pair, race condition on Redis.
**What I learned:** Shared state (positions, heat, kill-switch) must be consulted BEFORE any open/close decision. Never trust per-terminal memory.
**How it applies:** Every cycle reads Redis state first. Every open/close writes Redis immediately.
**Tags:** (operational, not a tag from the vocabulary)

### [2026-04-16] — Telegram Report Frequency

**Context:** Spam of full reports every 3 min drowned out actionable alerts.
**What I learned:** Full reports max 1×/hour. Every cycle only emits alerts on state change (new position, SL hit, regime flip).
**How it applies:** Reserve full reports for hourly cadence; event-driven alerts for in-between.
**Tags:** (operational)

---

## Anti-Patterns To Re-read Regularly

These are the patterns that have produced MOST of my worst trades (based on literature and general pro-trader consensus — will be specialized to my own data over time):

1. **Widening the SL as price approaches it.** This is the single most destructive habit. If I feel the urge, I close at current price instead.

2. **Adding to a loser to "reduce average entry."** This doubles my exposure to a thesis that is already failing. I either close or hold; never add.

3. **Entering just because I haven't traded today.** A day of no trades in the wrong conditions is a successful day. Boredom is not a signal.

4. **Trading against BTC 1H direction on altcoins.** BTC leads. Multi-TF factor = 0 when BTC 1H is against me; the trade is near-automatically disqualified.

5. **Ignoring dead zone / funding windows.** The rules are there because order flow is distorted. Every exception I've ever considered has been worse than waiting.

6. **Reading into news to justify a trade I already want.** News is a filter, not a trigger. I check news for invalidation, not for confirmation.

7. **Re-entering a trade I just got stopped out of without reanalysis.** The market moved; my structure levels may have changed; what invalidated the first entry may still be invalidating the second.

8. **Trading when tired / distracted / emotionally off.** (For the human operator reading this: this applies to Claude too, in the form of long-context degradation. If the conversation is ancient and feels foggy, the right move is a clean /loop cycle reading only this file and the current chart — not trying to remember.)

---

## Meta: How I Use This File

- **Start of every /loop cycle:** skim headings — re-anchor on anti-patterns.
- **After a loss:** read the full file slowly. Ask: did I violate any rule here?
- **Before an exception:** write my planned exception into a scratch note. If the exception resembles any rule in this file, I do not take it.
- **Monthly:** consolidate similar lessons. Remove duplicates. Tighten language.

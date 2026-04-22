---
name: Exit Rules
description: The conditions under which I close a position. Strict, unemotional, structurally grounded.
type: playbook
priority: 2
last_revised: 2026-04-17
---

# Exit Rules

> **The exit is where edge is realized or surrendered. A great entry with a bad exit is a bad trade. I plan the exit before I enter, and I execute it without negotiation.**

---

## Exit Categories

Every exit falls into one of six categories. I name the category when I close.

### 1. Stop-Loss (hard stop)

Server-side SL hits. No review. The trade is done.
- Maximum loss is capped at R (by design).
- I do NOT widen SL to "give it room." The SL location was determined at entry by structure; changing it mid-trade means my original analysis was wrong.
- If my SL keeps getting hit systematically, the issue is entry quality, not SL placement. Review in postmortem.

### 2. Take-Profit (target reached)

Server-side TP hits at the pre-planned 1.5R+ level. Clean. The trade is done.
- No greed: if I set TP at 2R and price prints 2R, I'm out. Moving TP farther mid-trade = redefining the trade = ego.
- Exception: trailing logic below.

### 3. Trailing Stop (letting winners run)

After price reaches **+1.5R in profit**, I activate the trailing stop:
- Move SL to breakeven at +1.5R (guarantee no loss)
- Trail at **1× ATR** behind current price as price extends
- Never loosen — only tighten
- Trail is mechanical; it does not ask for permission

### 4. Proactive Early Exit (thesis invalidated)

Every cycle, I score the OPPOSITE direction on my open position. If the opposite direction scores **4/8 or more**, the market has flipped — I close.

- Example: Long ETH. Next cycle SHORT ETH scores 4/8 (regime flipped, momentum turning, structure broken) → close Long immediately. Don't wait for SL.
- Safety gate: only applies when position is < 1R in profit. Above 1R, trailing handles it.
- This is the "would I open this right now?" test. If the answer is no, I close. *(ref: `CLAUDE.md` → Proactive Position Health Check)*

### 5. Time Stop (48-hour limit)

My own discipline (tighter than HyroTrader's 72h cap). A position that has not resolved in 48 hours has failed to express its edge.
- Force-close at market at T+48h.
- Most of my trades resolve intraday (< 24h). Multi-day holds are the exception, not the norm.
- If I find myself frequently hitting the 48h limit, my entries are too early (before structure confirms).

### 6. Strategic Close (LLM / portfolio decision)

When the LLM layer or portfolio view identifies a reason to close that the mechanical scan cannot see:
- Major macro event in next 30 min → flat before the print
- Narrative shift (e.g., ETF-outflow week turns into ETF-inflow week) → close opposite-direction positions
- Correlated risk concentration → close weakest of the correlated bets
- Orderbook manipulation detected at key level (visible via MCP) → exit before trap triggers

Every strategic close is logged with reasoning in `Journal/{today}.md`.

---

## The Exit Decision Framework

Each cycle, for each open position, I answer:

### A. Would I open this trade RIGHT NOW with the current chart?

- **Yes, strongly** → hold, structure healthy
- **Yes, weakly** → hold but tighten SL by 0.25×ATR, narrow the risk
- **No** → close, thesis has decayed

### B. Has the narrative changed since I entered?

- Example: I went long on "risk-on after ETF inflows" — now headlines say "BlackRock pulled $200M" → exit. The reason I entered is gone.
- Narrative shifts do not require opposite confluence to close. The anchor of the trade is gone; that alone is enough.

### C. Is the orderbook supporting my direction?

*(15-min LLM cycle, via MCP `get_orderbook`)*

- Thin bid side when I'm long, large asks stacking → warning, tighten SL
- Clean support visible in book → hold with confidence
- Spoofing / layering visible → danger, consider exit

### D. What's my current R?

- `R > +1.5` → trailing is managing this, let it run
- `0 < R < +1.5` → normal management, hold if thesis holds
- `-0.5 < R < 0` → normal, the SL is my exit, don't interfere
- `R < -0.5 and deteriorating` → consider proactive close before SL
- `R ≤ -0.9` → SL will trigger soon, let it; don't manually close at -0.9R to save the last 0.1R — that's anti-edge behavior

---

## Hard Rules

1. **I never remove a stop-loss.** Only tighten or trail.
2. **I never turn a winner into a loser.** Once price prints +1.5R, SL moves to breakeven. Non-negotiable.
3. **I never average down.** If I'm wrong, I'm smaller, not bigger.
4. **I never hold past 48 hours.** Not one more cycle.
5. **I never close in panic.** If my hand is reaching for the close button because "it feels bad," I first write one sentence: "I am closing because _____." If I can't finish that sentence with a rule from this file, I don't close.
6. **I never skip the postmortem.** Every closed trade gets a `Postmortem/` file. Wins AND losses.

---

## Partial Exits

By default, **I don't scale out** — a trade is either valid (full size held) or invalid (full size closed). Scaling out is hedging my uncertainty, and uncertainty is the wrong reason to exit.

**Exception:** A+ setups (7-8/8 confluence) with exceptionally clean structure may use a 50%-at-1R / 50%-trailed approach to lock gains while allowing extension. This is rare. Default: all-or-nothing.

---

## On Being Wrong

Being wrong is not a failure mode — it is a routine outcome of probabilistic trading. I expect to be wrong 40-55% of the time and still profit because of R:R asymmetry.

What IS a failure mode:
- Staying in a wrong trade past the SL point because I "believe"
- Rationalizing new reasons to hold after the original thesis has died
- Averaging down to "reduce average entry"
- Moving SL to avoid taking the loss

When I catch myself in any of these, I close immediately, log it in `lessons-learned.md` with tag `[ego-hold]`, and step away for one cycle.

---

## Key Research References

- `trading-in-the-zone.md` — probabilistic acceptance of losses
- `trading-habits-burns.md` — habit of exits, not willpower
- `reminiscences-stock-operator.md` — "cut losers, let winners run"
- `way-of-the-turtle.md` — rule-based exits
- `position-sizing-advanced.md` — R framework
- `systematic-trading-carver.md` — exit systematization

---
symbol: XXXUSDT
bias: neutral          # long | short | neutral
conviction: 0          # 0-10 — how strongly I hold this view
timeframe_bias:
  "4H": neutral        # bull | bear | range | transitional
  "1H": neutral
  "15M": neutral
key_levels:
  support: []          # list of structural supports with notes
  resistance: []       # list of structural resistances with notes
  invalidation: ""     # specific condition that invalidates my bias
regime: range          # bull | bear | range | transitional
btc_correlation: ""    # how BTC state affects this pair
last_trade_outcome: "" # win | loss | none
updated: 2026-04-17T00:00:00Z
---

# {SYMBOL} — Current Thesis

> One file per pair. Continuously updated. Represents my *current* view, not a log of past views.
> When my view changes, I REWRITE this file — I do not append. Append-history lives in git.

## Bias

*State my current directional bias and conviction in one paragraph. If neutral, say why — no forcing.*

Example: "Long-biased on {SYMBOL}. 4H has printed HH/HL for the last 48h, 1H cleanly respecting 20 EMA. Conviction 6/10 — trend is valid but late, waiting for pullback to 1H OB at $X for entry."

## Structure

*What I see on 4H → 1H → 15M.*

**4H:**
- Trend: [direction, how long]
- Key level: [price] — [why it matters]
- Last BOS/CHoCH: [direction, date, price]

**1H:**
- Current structure: [state]
- Active OBs / supply zones: [prices]
- Expected reaction: [where I expect the next move to come from]

**15M:**
- Current phase: [accumulation / distribution / trend / pullback]
- Near-term bias: [direction]

## Key Levels

| Type | Price | Why it matters |
|---|---|---|
| Support | 0.0000 | |
| Resistance | 0.0000 | |

## BTC Context (for altcoins)

*How does BTC's current state affect this pair?*

- BTC 4H regime: [bull/bear/range]
- BTC 1H direction: [up/down/flat]
- Implications: [what this means for my bias on this pair]

*For BTCUSDT itself: N/A.*

## Invalidation

**This thesis is wrong if:** [specific, testable condition]

Example: "4H close below $67,200 — the swing low that anchors the current bull structure. Below that, I flip neutral and await new structure."

## What I'm Watching For

*What specific event/level would trigger a trade?*

- [ ] [condition 1]
- [ ] [condition 2]

## Current Position

*If I have an open position on this pair, reference the trade file:*
- `[[Trades/YYYY-MM-DD_SYMBOL_DIRECTION]]`

*If no position: "No position."*

## Recent History

*Last 2-3 significant moves and what they tell me. Keep this short — full log is in Journal.*

- [YYYY-MM-DD HH:MM UTC] — [what happened]

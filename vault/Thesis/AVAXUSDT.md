---
symbol: AVAXUSDT
bias: neutral-post-win
conviction: 1
timeframe_bias:
  "4H": bull
  "1H": neutral
  "15M": neutral
key_levels:
  support: ["9.428 (prior SL level)", "9.545 (prior entry)"]
  resistance: ["9.654 (prior exit)", "9.715 (unhit TP)"]
  invalidation: "only re-enter on clean structural reset — SHORT back <3/8 AND R:R ≥1.5 AND LONG ≥5/8 for 2 consecutive cycles"
regime: bull
btc_correlation: "alt-leading"
last_trade_outcome: "closed +0.84R (11:31 UTC, proactive-exit on SHORT 4/8)"
updated: 2026-04-17T11:36:00Z
---

# AVAXUSDT — Current Thesis

**Stance:** NEUTRAL, flat after a +0.84R win. Closed by TypeScript proactive-exit at 11:31:52 UTC on SHORT hitting 4/8 (entry was at SHORT 4/8 too — marginal setup that paid off).

## Current Read

- L:5/8 S:4/8 scanner state — same asymmetry as entry but now I'm flat and the R:R would be 1.04 < 1.5 (scanner would NOT re-open this cycle).
- Signal structure was already decaying when we closed. Auto re-entry requires R:R ≥1.5 — which today's alt chop hasn't delivered cleanly.

## Why Re-entering Immediately Would Be Wrong

- Same setup that just closed by proactive-exit. SHORT still at 4/8. Any new LONG would re-trigger the same rule next cycle.
- Yellow-flagged pair today: 5+ flicker cycles this morning, auto-stacking incident at 09:21 (cancelled 8 orders), Redis ghost block until 10:06. AVAX signal reliability is weak today.

## Re-entry Criteria (if scanner fires)

Scanner re-entry would be ACCEPTED (per no-reflex-close policy) only IF:
1. R:R ≥ 1.5 (mechanical gate).
2. SHORT score drops to 3/8 or below for at least 1 cycle before entry.
3. LONG score at 5/8+ consistently for 2 cycles.

If scanner fires while SHORT ≥4/8, the same proactive-exit will fire immediately — taking on spread/fees cost for no edge. Accept the entry, then manage per rules (not an override — just awareness).

## Position Status

- **Closed:** 2026-04-17 11:31:52 UTC @ 9.654
- **Realized:** +$534.99 combined (+0.84R)
- **Hold:** 17m 57s
- Trade file: `vault/Trades/2026-04-17_AVAXUSDT_long.md`
- Postmortem: `vault/Postmortem/2026-04-17_AVAXUSDT_long.md`
- Lesson: pre-committed discretionary tight-leash + mechanical 4/8 proactive-exit working in tandem is the ideal management stack.

---
symbol: XRPUSDT
bias: neutral-post-win
conviction: 2
timeframe_bias:
  "4H": neutral-to-bull
  "1H": bull
  "15M": neutral
key_levels:
  support: ["1.4388 (prior entry)", "1.4232 (prior SL — unused)", "1.40919 (bid wall)"]
  resistance: ["1.4625 (prior TP fill)", "1.467 (ask wall)"]
  invalidation: "accept next scanner entry on its own merits; structural exits only"
regime: bull
btc_correlation: "standard alt correlation, Rakuten narrative bullish background"
last_trade_outcome: "closed +1.42R (TP hit during cron outage, +$885.59). Prior inherited position closed -0.39R earlier (10:34)."
updated: 2026-04-17T14:07:00Z
---

# XRPUSDT — Current Thesis

**Stance:** Neutral, flat after +1.42R win on the 3rd scanner-triggered entry of the day. TP 1.4622 hit cleanly during cron outage ~13:XX UTC, exit 1.4625 (positive slippage).

## Current Read

- Net XRP P&L today: -$100 (10:34 close) + ~$0 (11:02 reflex close) + ~$0 (11:07 reflex close) + **+$885.59 (13:XX TP)** = **+$785.59 net**.
- The 3rd entry validated the operator-corrected thesis: remove categorical re-entry block, accept scanner trigger on merits, apply only structural exit rules.
- Postmortem: `Postmortem/2026-04-17_XRPUSDT_long_accepted.md` (this trade) and `Postmortem/2026-04-17_XRPUSDT_long.md` (earlier -0.39R).

## Re-entry Criteria

- Accept next scanner trigger on its own merits. No categorical block.
- Structural exit rules remain: LONG <4/8 → close, SHORT ≥4/8 → proactive exit, price wicks 1.40919 bid wall → tighten SL.

## Structural Levels

- **Bid wall 1.40919** — demo-book deep bid, still the key structural support.
- **Prior entry 1.4388** — session working midline.
- **Prior TP 1.4625** — broke through the 1.45-1.467 seller cluster. This cluster was FLAGGED as realistic ceiling; market chewed through. Re-test of 1.45-1.467 may now act as support if price revisits.

## Key Lesson Anchor

The 11:01 and 11:06 reflex-closes wasted spread for zero edge. The 11:13 accepted entry netted +$886. Same pair, same signal pattern, different response — the accepted one paid. Structural > categorical rules, every time.

---
symbol: SOLUSDT
direction: long
status: closed
opened: 2026-04-18T10:45:14Z
closed: 2026-04-18T10:45:37Z
entry: 86.8
sl: 86.06
tp: 87.91
exit: ~86.8
size_usd: 21700
leverage: 10
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: bull
session: london
btc_state_at_entry: transitional-bearish
news_multiplier: 1.0
trade_category: momentum-scanner-auto
thesis_snapshot: "Scanner autonomously fired 5/8 LONG SOL after cooldown+R:R floor drifted up to exactly 1.5. 6th alt-Bull LONG fire today under active post-loss-streak filter. BTC L:1/8 S:4/8 unchanged bearish. Claude-override close applied immediately."
expected_duration: intraday
closed_reason: claude-override-post-loss-streak
r_multiple: ~0
fees_usd: ~40
pnl_usd: ~-45
note: "2nd auto-fire override in 6 minutes (AVAX#2 at 10:39, SOL#2 at 10:45). Pattern: scanner keeps firing 5/8 alt-Bull LONG as cooldowns roll off + R:R floor drifts up. Flat PnL, ~$40-80 fees. Filter is working at Claude layer."
---

# SOLUSDT LONG #2 — 2026-04-18 (claude-override)

Same pattern as AVAX #2. Post-loss-streak filter active; scanner fire; market fill; 25-second override close. 

- 10:45:14 Fill 86.8
- 10:45:37 Exit ~86.8 via `src/close-now.ts SOLUSDT Buy`
- ~0 price delta, ~$40-80 fees
- Both sub-accounts confirmed flat

Per new lesson `claude-override-required`: no deliberation, no waiting for proactive-exit, immediate close on any auto-fire matching filter.

→ Postmortem identical pattern to AVAX#2 — no new lesson needed; same tag `claude-override-required`.

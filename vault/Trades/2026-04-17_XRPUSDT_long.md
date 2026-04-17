---
symbol: XRPUSDT
direction: long
status: closed
opened: 2026-04-17T11:13:55Z
closed: 2026-04-17T13:XX:XXZ
entry: 1.4388
sl: 1.4232
tp: 1.4622
size_usd: 57643
leverage: 3
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: transitional-to-bull
session: london-overlap
btc_state_at_entry: transitional-range
news_multiplier: 1.0
trade_category: standard-entry
thesis_snapshot: "Scanner's 3rd auto-entry of XRP LONG today. Previous two (11:01, 11:06) were reflex-closed against system signal; per operator correction + updated thesis this one is ACCEPTED. 5/8 L + 2/8 S + R:R 1.5 + dir=Long is a clean mechanical entry; system rules manage from here."
expected_duration: intraday
closed_reason: tp
r_multiple: 1.42
fees_usd: null
---

# XRPUSDT LONG — 2026-04-17

## Why This Trade (at entry)

Scanner fired 5/8 standard + R:R 1.5 on 11:13:55 UTC — third attempt of the day, first I'm accepting. Previous two auto-entries (11:01, 11:06) were reflex-closed on a categorical "no re-add post-loss" thesis block that operator feedback identified as burning spread/fees without edge. Updated thesis removes the categorical block and keeps structural exit rules only.

- **Setup type:** standard-entry (scanner mechanical, not Watchlist-driven)
- **Primary factor:** 5/8 confluence with R:R exactly 1.5 floor and SHORT score only 2/8 (+3 asymmetry)
- **Why this R:R:** SL 1.4232 — 1.08% below entry, above 1.40919 bid wall. TP 1.4622 — 1.5R at placed entry, into the 1.45-1.467 resistance zone (acknowledged supply cluster). Tight but rule-compliant.

## Entry Context

- **Time:** 2026-04-17 11:13:55 UTC
- **Session:** London approaching Overlap (×1.0)
- **BTC state:** Transitional, dir=None (news-blocked 4/8)
- **Regime on this pair:** Transitional
- **Relevant news:** Rakuten/XRP integration (long-term bullish), scanner news-bias oscillating (no clear block this cycle)

## Plan at Entry

- **Entry price:** 1.4388 (market fill BOTH subs — 50k 8012.8 qty + 200k 32051.2 qty, ratio 4:1 matches account volumes)
- **SL price:** 1.4232 — server-side reduce-only Market on both subs, trigger at 1.4232
- **TP price:** 1.4622 — server-side reduce-only Market on both subs, trigger at 1.4622
- **Risk:** 0.5% account default
- **Max hold:** 48h cap; prefer intraday close by 22:00 UTC dead zone

## Management Rules (from XRP thesis)

- **LONG <4/8 score → close at market** (this rule fired correctly at 10:34 earlier today — saved ~0.6R)
- **SHORT ≥4/8 score → proactive exit** regardless of R
- **Price wicks 1.40919 bid wall → tighten SL to 1.405-1.408**
- **Trail SL to BE** at +1.0R (price ~1.454)

## Context — Prior XRP Exposures Today

- 2026-04-16 19:59 UTC (discovered 08:36) — inherited LONG, closed 10:34 @ -0.394R.
- 11:01:34 UTC — auto-reopen by scanner, manually closed ~$0.
- 11:06:40 UTC — auto-reopen by scanner, manually closed ~$0.
- **11:13:55 UTC — THIS TRADE, accepted per corrected policy.**

## Life of Trade

### [2026-04-17 11:14 UTC] — Opened, accepted
- R current: ~0.0 (just filled, mark = entry)
- Structural health: intact
- Action: none — server-side SL/TP active on both subs
- Note: Operator-corrected approach. No reflex close. Monitor per structural rules.

### [2026-04-17 11:18 — 12:31 UTC] — Regime upgrade and steady climb
- 11:18: +$8 (~0.01R)
- 11:22 peak (first session high): +$272 (~+0.43R)
- 11:38-11:55: consolidation at +$250 range
- 12:01: **Regime flipped Transitional → Bull**, LONG 5→6/8. Structural upgrade.
- 12:13 peak: +$337 (~+0.54R, mark 1.4472)
- 12:16 onward: alts risk-off-blocked but price held. XRP SHORT score oscillated 2-3, LONG stable 5.
- 12:31 peak: +$385 (~+0.62R, mark 1.4485).

### [2026-04-17 13:XX UTC] — TP HIT, position CLOSED by server-side reduce-only
- **Server-side Market reduce-only @ TP trigger 1.4622 fired.** Fill price 1.4625 on both subs (slight positive slippage in our favor).
- Close executed during cron-offline window. Server-side TP worked independently of cron state.
- **Realized: +$177.12 (50k) + +$708.47 (200k) = +$885.59 combined. R multiple: 1.42R.**
- TP landed exactly at the 1.45-1.467 seller cluster I had flagged as "realistic partial zone" — the cluster was breached, market moved through.

## Close Summary

- **Closed at:** 2026-04-17 between 12:31-14:00 UTC
- **Exit price:** 1.4625 (both subs, 0.0003 above TP — positive slippage)
- **Reason:** tp — server-side reduce-only Market triggered
- **R multiple:** +1.42R
- **PnL USD:** +$885.59 combined
- **Duration:** ~2h from 11:13 open to cycle 13:XX close

## Immediate Takeaway

Process WIN with vindication of the operator correction. This was the 3rd XRP entry today; the first two I closed reflexively (phobia of the XRP pair post-10:34 loss), missing both the $0 and then the $0 outcomes. THIS one I accepted per the corrected thesis — and the server-side TP captured +1.42R during a cron outage. Without the operator nudge to trust the scanner, and without the discipline of leaving server-side TP in place, this result would not have materialized. Two orthogonal lessons compounded into one +$886 outcome.

→ Full Postmortem: `Postmortem/2026-04-17_XRPUSDT_long.md`

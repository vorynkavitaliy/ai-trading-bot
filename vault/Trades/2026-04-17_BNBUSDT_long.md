---
symbol: BNBUSDT
direction: long
status: closed
opened: 2026-04-17T11:01:34Z
closed: 2026-04-17T13:XX:XXZ
entry: 629.9
sl: 626.2
tp: 635.5
size_usd: 10639
leverage: 3
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: transitional
session: london-overlap
btc_state_at_entry: transitional-range
news_multiplier: 1.0
trade_category: momentum
thesis_snapshot: "BNB LONG triggered from 10:27 Watchlist setup — 5/8 standard confluence with R:R 1.51 clearing the min-1.5 gate. First non-XRP pair to fire a clean trigger today; BNB was the closest-to-trigger candidate flagged during news-filter lift."
expected_duration: intraday
closed_reason: tp
r_multiple: 1.46
fees_usd: null
---

# BNBUSDT LONG — 2026-04-17

## Why This Trade (at entry)

5/8 standard confluence on BNB with R:R 1.51 cleared the minimum 1.5 R:R gate — the setup the 10:27 Watchlist entry explicitly described. No news block, dir=Long, BTC not actively against (BTC itself dir=None this cycle). Session: London/Overlap approach — good-quality window.

- **Setup type:** momentum / standard confluence
- **Primary factor:** news-filter-lifted 5/8 with R:R finally clearing threshold after a day of R:R-gated setups
- **Confluence breakdown:** 5/8 (scanner detail not surfaced in summary — standard threshold satisfied per orchestrator)
- **Why this R:R:** SL 626.2 (1.0x ATR + structural buffer per scanner), TP 635.5 at local 1H resistance, R:R = 1.51 tight but rule-compliant

## Entry Context

- **Time:** 2026-04-17 11:01:34 UTC
- **Session:** London approach to Overlap (×1.0, within 2h of Overlap start)
- **BTC state:** Transitional, dir=None (news-blocked 4/8)
- **Regime on this pair:** Transitional
- **Relevant news:** Scanner news bias tag lifted for BNB this cycle (unlike BTC/ETH which reverted risk-off one cycle later)

## Plan at Entry

- **Entry price:** 629.9 (market fill on BOTH sub-accounts — 50k 16.89 qty, 200k 67.56 qty; ratio 4:1 matches account-volume ratio, sizing correct)
- **SL price:** 626.2 — server-side on Bybit (reduce-only Market on both subs, trigger at 626.2)
- **TP price:** 635.5 — server-side (reduce-only Market on both subs, trigger at 635.5), 1.51R
- **Risk:** 0.5% account default
- **Max hold:** 48h cap; prefer intraday close by 22:00 UTC dead zone

## Life of Trade

### [2026-04-17 11:01 UTC] — Opened
- R current: 0.0 (just filled)
- Structural health: intact — just entered
- Action taken: none (server-side SL/TP active)
- Note: Filled on BOTH subs (50k 16.89 qty + 200k 67.56 qty). Initial reconcile output appeared to show only 50k — that was a reconcile-script gap (labels both subs "50k account"?) not a missing fan-out. Actual orchestrator fan-out correct.

### [2026-04-17 11:10 UTC] — Direct order audit
- R current: ~+0.17R (mark 630.92, +$17 on 50k + +$69 on 200k = ~$86 combined unrealized)
- Structural health: intact — price drifting in favor
- Action: none; SL/TP server-side verified active on both subs.
- Note: Direct probe via `getActiveOrders` on both subs revealed pending SOL limit @ 87.06 (previously misread as ghost execution). That's a real pending entry awaiting pullback — see SOL trade file.

### [2026-04-17 11:14 — 12:31 UTC] — Chop and slow grind up
- Multiple cycles of consolidation. Mark drifted 630 → 633.2 range. SHORT score oscillated 2-3/8, LONG 5/8 stable.
- Peak unrealized ~+$278 (12:25 UTC, mark 633.15). BNB approached but never crossed +1R trigger 633.6 before my discretionary BE-trail could activate.
- XRP held alongside, both correlating with broader alt action.

### [2026-04-17 13:XX UTC] — TP HIT, position CLOSED by server-side reduce-only
- **Server-side Market reduce-only @ TP trigger 635.5 fired.** Fill price 635.3 on both subs (0.03% slippage — demo normal).
- Close executed during cron-offline window (last cycle 12:31 UTC, resumed 14:00 UTC). TP worked exactly as server-side orders are supposed to — independent of cron state.
- **Realized: +$79.45 (50k) + +$317.81 (200k) = +$397.26 combined. R multiple: 1.46R.**
- Exact close time not in getClosedPnL output (only position createdTime shown) — somewhere between 12:31 and 14:00 UTC.

## Close Summary

- **Closed at:** 2026-04-17 between 12:31-14:00 UTC (exact time not surfaced by API query)
- **Exit price:** 635.3 (both subs, 0.2 below TP due to slippage)
- **Reason:** tp — server-side reduce-only Market order triggered
- **R multiple:** +1.46R
- **PnL USD:** +$397.26 combined
- **Duration:** ~2h from 11:01 open to early-cycle 13:XX close

## Immediate Takeaway

Process WIN. Textbook mechanical trade — clean 5/8 + R:R 1.51 entry from Watchlist, server-side TP protected profit during a 90-minute cron outage that I didn't even know about. The discipline of ALWAYS setting server-side SL/TP orders (not mental stops) is exactly why this ended at +1.46R instead of giving back profits during the outage. Lesson: server-side orders are the lifeline when automation falters.

→ Full Postmortem: `Postmortem/2026-04-17_BNBUSDT_long.md`

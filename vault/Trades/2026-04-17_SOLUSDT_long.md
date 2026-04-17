---
symbol: SOLUSDT
direction: long
status: cancelled-operator
opened: 2026-04-17T11:06:40Z
closed: 2026-04-17T15:08:00Z
entry: 87.06
sl: 86.82
tp: 89.02
size_usd: 0
leverage: 3
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: transitional
session: london
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: standard-entry-stale
thesis_snapshot: "SOL 5/8 L, 2/8 S, dir=Long, R:R 1.5 — scanner-driven standard entry. Orchestrator placed limit at 87.06 (below market 87.7) for OB-tap quality. Fills on pullback."
expected_duration: intraday
closed_reason: cancelled-operator
r_multiple: 0.0
fees_usd: null
---

# SOLUSDT LONG — 2026-04-17 — PENDING LIMIT

## Why This Trade (at placement)

Scanner cycle 11:06 fired SOL `exec=true` with 5/8 LONG standard confluence, R:R 1.5, dir=Long, SHORT only 2/8. Not from my Watchlist (SOL was not on it today) but mechanically passes entry-rules per orchestrator. Limit placed on BOTH subs (50k 142 qty + 200k 568.1 qty ≈ 4:1 ratio). Current state: unfilled, age ~3m at 11:10 UTC, age cap 45m.

- **Setup type:** standard entry (scanner mechanical)
- **Primary factor:** 5/8 confluence with R:R exactly clearing 1.5 floor
- **Why limit vs market:** orchestrator's OB-tap logic places the limit below current price (87.7 → 87.06) for better entry edge. If limit fills → effective R:R > 1.5.

## Entry Plan

- **Entry price:** 87.06 (limit, awaiting fill)
- **SL price:** 86.82 — server-side once filled
- **TP price:** 89.02 — 1.5R at placed entry, higher if filled deeper
- **Risk:** 0.5% default (scanner-calculated)
- **Limit age cap:** 45 min (orchestrator will cancel if unfilled). Current mark (~87.7) needs to drop ~0.7% to fill.

## Correlation Context

- BNB LONG already open (both subs). BNB is exchange-token, SOL is L1 — loosely correlated alts, not tightly. Heat budget: BNB ~0.5% + SOL 0.5% = 1% total, well under 5% cap.
- Directional: 2 longs, regime Transitional — acceptable given news-filter lifted and multiple alts showing strength.

## Management Plan (once filled)

- Trail SL to BE at +1.0R (price 87.93 on SOL).
- Proactive exit: SHORT ≥ 4/8 → close.
- Score floor: LONG <4/8 → close.
- Orderbook check every 5th cycle (note: SOL may or may not be active on demo — verify via MCP if depth returns usable data).

## Status Log

### [2026-04-17 11:06:40 UTC] — Limit placed
- Direct audit at 11:10 shows both subs with live New limit orders (142 + 568.1 qty, price 87.06, reduceOnly=false).
- No fill yet — price at 87.7 mark has not pulled back to 87.06.

### [2026-04-17 11:10 UTC] — Discovery correction
- Earlier assumed SOL was a "ghost execution" (scanner said exec=true, reconcile showed no position). WRONG — it was a pending limit that reconcile script doesn't inspect. Pattern lesson: always audit open orders separately from positions.

### [2026-04-17 15:08 UTC] — Cancelled by operator (stale, 4h past 45m cap)
- Limit never filled. Market never pulled back to 87.06.
- Age at cancellation: 241 minutes (~4h, **5.4× the 45m orchestrator cap**).
- Orchestrator did not auto-cancel — code-level issue `monitorPendingOrders` not firing on age.
- Operator (user) requested cancellation; signal state from 11:06 placement is stale (we've gone through multiple regime shifts since).
- Cancelled via `src/cancel-all-entries.ts` — preserves SL/TP on live positions (there were none), only cancels Limit entries.
- Redis pending-order registry for SOL cleared in same operation.

## Close Summary

- **Closed at:** 2026-04-17 15:08 UTC
- **Exit:** limit cancelled (never filled)
- **Reason:** cancelled-operator — stale limit past 45m cap, signal conditions no longer match placement context
- **R multiple:** 0.0 (no fill, no PnL)
- **PnL USD:** $0
- **Duration as pending:** ~4h

## Immediate Takeaway

Clean cancellation of a stale pending limit that sat through ~4 hours of market regime shifts. Operator cleanup enforced the orchestrator's own 45m cap rule that the code failed to execute automatically. No fill = no edge, no loss — just operational hygiene.


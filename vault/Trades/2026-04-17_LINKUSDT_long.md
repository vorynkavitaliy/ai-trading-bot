---
symbol: LINKUSDT
direction: long
status: cancelled-operator
opened: 2026-04-17T12:04:41Z
closed: 2026-04-17T15:08:00Z
entry: 9.405
sl: 9.333
tp: 9.671
size_usd: 43535
leverage: 3
risk_r: 0.5
confluence_score: 5
confluence_type: standard-marginal
regime: bull
session: london-overlap
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: standard-entry-stale
thesis_snapshot: "LINK LONG scanner trigger 5/8 L + R:R 1.5 + Bull regime + dir=Long. SHORT at 4/8 at placement — same marginal pattern as AVAX 11:13 (which won +0.84R via TypeScript proactive-exit). Limit placed @ 9.405 (OB-tap logic) below announced 9.468. Effective R:R if fills: 3.69."
expected_duration: intraday
closed_reason: cancelled-operator
r_multiple: 0.0
fees_usd: null
---

# LINKUSDT LONG — 2026-04-17 — PENDING LIMIT

## Why This Trade (at placement)

Scanner cycle 12:04 fired LINK `exec=true` with 5/8 standard + R:R 1.5. Announced entry 9.468, actual limit placed @ 9.405 per OB-tap logic (deeper = better R:R if filled). Regime Bull on 4H, dir=Long. BTC not adverse (4/2 dir=None).

**Marginal pattern:** SHORT at 4/8 at placement — identical to AVAX 11:13 profile. TypeScript proactive-exit at SHORT ≥4/8 will fire on next cycle if the scanner still shows S:4/8 post-fill. Same tight-leash awareness.

- **Setup type:** standard-entry (scanner mechanical, Bull-regime alt)
- **Primary factor:** 5/8 + Bull regime on 4H
- **OB-tap edge:** limit @ 9.405 vs announced 9.468 — effective R:R if fills = 3.69 (much better than 1.5)
- **Marginal concern:** SHORT 4/8 at placement = TypeScript proactive-exit trigger lurking

## Entry Plan

- **Entry (limit):** 9.405 (both subs, 50k 925.9 qty + 200k 3703.7 qty, 4:1 ratio)
- **SL:** 9.333 — server-side once filled (~0.77% below limit)
- **TP:** 9.671 — 3.69R if limit fills; 2.82% above
- **Risk:** 0.5% default
- **Limit age cap:** 45 min (though SOL is 58m past cap and still live — orchestrator cancel may be buggy)

## Management Rules (post-fill, if filled)

- **SHORT ≥ 5/8 → close immediately** (tightened one tick vs. standard 4/8 to give tolerance post-fill).
- **LONG < 4/8 → close** (hard floor).
- **Asymmetry inversion (LONG ≤ SHORT) → close.**
- **TypeScript proactive-exit at SHORT ≥4/8** will fire autonomously — do not override, same as AVAX 11:31 (that capture was +0.84R).
- **Trail SL to BE** at +1R = 9.405 + (9.405-9.333) = 9.477.

## Correlation Context

- 2 filled LONGs (BNB + XRP) + 2 pending limits (SOL @ 87.06 + LINK @ 9.405).
- If both limits fill = 4 filled positions = 1 trade × 4 correlation.
- Heat estimate if both fill: 4× 0.5% = 2% total, within 5% cap.

## Life of Trade

### [2026-04-17 12:04:41 UTC] — Limit placed
- Audit shows both subs with New Limit orders at 9.405 (age 0m).
- Mark ~9.45 at placement time. Needs ~0.5% pullback to fill.
- Server-side SL/TP will attach on fill.

### [2026-04-17 15:08 UTC] — Cancelled by operator (stale, 3h past 45m cap)
- Limit never filled. Market drifted up, never pulled back to 9.405.
- Age at cancellation: 183 minutes (~3h, **4× the 45m orchestrator cap**).
- Orchestrator did not auto-cancel — same code-level issue as SOL.
- Cancelled via `src/cancel-all-entries.ts` together with SOL limit. Redis pending-order for LINK cleared.

## Close Summary

- **Closed at:** 2026-04-17 15:08 UTC
- **Exit:** limit cancelled (never filled)
- **Reason:** cancelled-operator — stale limit past 45m cap
- **R multiple:** 0.0 (no fill, no PnL)
- **PnL USD:** $0
- **Duration as pending:** ~3h

## Immediate Takeaway

Clean cancellation. Note: during the 3h staleness, market moved UP strongly (LINK went 7/8 A+ by 15:06) but R:R remained gated — the limit at 9.405 would have actually been a GREAT fill if price had come back, but it never did. Markets don't give second chances at the same level often; orchestrator's 45m cap exists precisely to prevent zombie orders inheriting stale thesis context into new regimes.


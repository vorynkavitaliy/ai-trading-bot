---
name: LINKUSDT SHORT 2026-04-20
symbol: LINKUSDT
direction: Short
status: cancelled
closed_reason: invalidated-pre-committed-rule-1
cancelled_at: 2026-04-20T11:10:00Z
never_filled: true
realized_pnl_usd: 0
invalidation_trigger: "BTC reclaimed 75100 (hit 75138) + bos_3m cluster fully dissolved + LINK 1H/15m RSI crossed back >50 + OBV slope halved к -48k"
order_type: limit
limit_placed_price: 9.22
stop_loss: 9.26
take_profit: 9.13
risk_pct: 0.25
confluence: 9/12
confluence_grade: B+ Standard
rr_planned: 2.25
risk_usd_50k: 125
risk_usd_200k: 500
risk_usd_total: 625
qty_50k: 3125
qty_200k: 12500
opened_at: 2026-04-20T11:02:33Z
account: both (50k + 200k)
order_id_50k: 3f71cd4f-157b-4e04-93ef-947547fe2812
order_id_200k: a0c64205-b52d-4f93-9567-38096415a0bc
trade_category: cluster-bearish-rejection
---

# LINKUSDT SHORT — 2026-04-20 11:02 UTC (pending limit)

## Setup Summary

Cluster bearish setup: 8/8 pairs bos_3m=bearish. BTC broke 75000 psychological support к 74974. Multiple alt pairs deep oversold on 3m (XRP 32, ETH 36, LINK 36). News bias neutral medium, mult 0.5 (was HIGH one cycle ago but flipped — still bearish context intact via price action).

**LINK selected over XRP/SOL** because Vol factor = 1 (OBV slope -75k NEGATIVE, volume confirming the bear move). XRP has deeper oversold but OBV still positive = SHORT less supported by volume.

**Place-limit 9.22** — short on retest bounce к nearR 9.214 + overhang. Current 9.203 (AT nearS). Market entry would have R:R only 1.55; waiting for bounce to 9.22 gets 2.25 R:R.

## 12-Factor Confluence Scoring

| # | Factor | Score | Notes |
|---|--------|-------|-------|
| 1 | SMC/Structure | 1 | bos_3m bearish, no 1H yet but cluster bearish |
| 2 | Classic Tech | 1 | EMA21 9.189 < EMA55 9.248 bear order, 1H RSI 50.48 declining, MACD hist +0.015 cooling |
| 3 | Volume | **1** | **OBV slope -75521 NEGATIVE** — decisive factor distinguishing LINK vs XRP/SOL |
| 4 | Multi-TF | 1 | 4H RSI 46.47 <50, 1H 50.48 borderline (not strongly up), 15m **49.71 <50 NEW**, 3m 36.48 |
| 5 | BTC Correlation | 1 | BTC range + RSI declining (51.5 from 54) — supportive for alt SHORT |
| 6 | Regime | 1 | range (acceptable for SHORT per rubric) |
| 7 | News | 1 | neutral (acceptable for SHORT; was risk-off HIGH one cycle ago, now medium neutral) |
| 8 | Momentum | 0 | PDI 27.7 > MDI 18.6 still bull-dominant, ADX 17.1 weak trend |
| 9 | Volatility | 1 | ATR healthy, no extreme |
| 10 | Liq Clusters | 0 | No data |
| 11 | Funding/OI | 0 | No data |
| 12 | Session+Time | 1 | London 1.0, 298 min к funding — clean |

**Total: 9/12 B+ Standard**

LINK wins against alt competitors:
- **XRP**: 8/12 (Vol=0 because OBV positive)
- **SOL**: 7/12 (MTF mixed)
- **ETH**: 7/12 (1H RSI 50.56 неborderline)

## Entry/Exit Logic

**Entry**: place-limit SHORT @ 9.22
- Current 9.203, near nearS 9.202
- Limit above current: if price bounces к 9.22 (small bounce к nearR 9.214 zone), fills short
- Benefits: better R:R than market entry (2.25 vs 1.55), short-the-rejection setup
- Risk: if LINK drops without bounce, miss trade

**SL @ 9.26** (40 pts above entry, 0.43% — well within 3% alt cap):
- Above EMA55 9.248 with 12-pt buffer (~0.5×ATR approximate)
- Above morning rejection zone 9.252

**TP @ 9.13** (90 pts below entry, 0.98%):
- Below nearS 9.202 (breakout target)
- Structural round number zone
- Consistent with BTC bearish continuation к lower support

**R:R = 90/40 = 2.25** ✓

## Invalidation Criteria (pre-committed)

1. **BTC reclaims 75100 before fill** → cancel limit (BTC bounce kills alt SHORT thesis)
2. **News impact escalates к HIGH + bias risk-on** → cancel (shouldn't happen but hedge)
3. **Not filled by 11:47 UTC (45 min)** → cancel expired
4. **Fill + LINK bos_3m flips bullish within 15 min** → close at market
5. **BTC rallies above 75200 post-fill** → tighten SL к 9.22 (BE) or close at market if still at loss

## Size Calculation

- Base risk 9/12 B+ = 0.5%
- News mult 0.5 (medium impact) = **0.25% final**
- 50k qty: 3125 LINK at 9.22 = $28,813 notional
- 200k qty: 12500 LINK at 9.22 = $115,250 notional
- Combined risk: $625 ($125 50k + $500 200k)

## Management Plan (post-fill)

- First 9 min grace period — no early exit
- **+1R at 9.18**: move SL к 9.22 (BE) per lesson cascade
- **+1.5R at 9.16**: trail activate 1× ATR per CLAUDE.md
- **+2R at 9.14**: tighten SL к +1R lock (9.18 area)
- **+3R at 9.13 — TP hit, $1,406 realized combined target**
- If news flips bearish HIGH (3+ triggers) post-fill: consider tightening SL early (news tailwind strengthened)
- If BTC breaks 74900 post-fill: let trade run, market confirming

## Methodology Citations

- SMC sweep+rejection (alt kind): `stop-hunting-market-traps.md`
- Momentum-aligned trend join: `momentum-trading-clenow.md` (alt catching bear)
- OBV volume confirmation: `volume-analysis-deep.md` (volume divergence)
- Place-limit short-the-rejection: `support-resistance-mastery.md`

## Risk Management Context

- Daily DD before fire: 0.22% (well within limits)
- Portfolio heat pre-trade: 0%. Post-fill: 0.25%
- 2nd trade today: morning BNB LONG -$435, midday BTC LONG +$164. This LINK SHORT is regime-opposite (bear after two bull attempts). Symmetry lesson applied.
- NOT revenge — LINK is fresh pair, thesis is cluster-bearish confluence.

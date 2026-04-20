---
symbol: BNBUSDT
direction: Long
status: closed
trade_category: bull-continuation-retest
opened: 2026-04-20T07:22:00Z
reopened: 2026-04-20T07:26:00Z
filled: 2026-04-20T07:31:00Z
closed: 2026-04-20T08:30:00Z
closed_reason: pre-defined-invalidation-btc-regime-bear
entry_type: limit
entry_price: 626
exit_price: 623.8
sl: 622
tp: 634
risk_pct: 0.25
confluence: 10/12
session: London quality 1.0
news_mult: 0.5 (medium, 1 Iran trigger, bias neutral→risk-off)
rr: 2.0
hold_min: 59
r_multiple: -0.69
pnl_usd_50k: -85.72
pnl_usd_200k: -349.78
pnl_usd_total: -435.50
order_ids_active:
  50k: 2f93351b-213b-42cd-8171-171f7b0d2ac2
  200k: 85302900-14b0-4c1b-a190-3ff834003d42
order_ids_cancelled:
  50k: 6393122e-6fa4-4154-840a-3ae2dfcb8971
  200k: 048b75a9-a183-4270-bf70-41c2cfa19437
close_order_id: 80ba6dfa-4561-49e5-8085-69989a8af02f
qty:
  50k: 31.25
  200k: 125.00
risk_usd:
  50k: 125
  200k: 500
---

# BNBUSDT LONG — 2026-04-20 07:22 UTC (re-placed 07:26)

## Cycle history

**C556 (07:22 UTC)**: Initial limit @ 625.5 / SL 621 / TP 635 / R:R 2.11 placed.

**C557 (07:26 UTC)**: Cancelled original limit — price moved к 627.9 (0.38% away from 625.5 = over 0.3% threshold per lesson 2026-04-19 limit distance rule). ADX climbed к 25.7. Re-placed tighter at 626 / SL 622 / TP 634 / R:R 2.0. Confluence upgraded к 10/12 (Volume factor turned positive on BTC/ETH OBV slope flip, momentum PDI 28.9 > MDI 23.3 strengthened).

## Thesis

Bull breakout confirmed at London open (07:00 UTC) после overnight bear capitulation.

**Cluster explosion at C556-C557**:
- **8/8 pairs bos_15m bullish** + close_vs_swing_15m=above_prior_high
- **3/8 bos_1h bullish** [BTC, ETH, BNB]
- Multi-TF crossed 50 широко: BTC 4H 50.7, BNB 4H 52.3, LINK 4H 50.9
- **Momentum flipped универсально**: PDI>MDI на BTC/BNB/ETH/AVAX/LINK/DOGE
- BTC slope3 +12.76, MACD1h +94
- ETH MACD1h +4.3, slope3 +12.13
- BNB MACD1h +1.0, PDI 28.9 dominant

## 12-Factor Scoring (LONG) — 10/12 A-setup

| # | Factor | Score | Note |
|---|--------|-------|------|
| 1 | SMC/Structure | 1 | bos_1h+15m+3m bullish + close>prior_high (not STRONG — no explicit sweep+OB tap) |
| 2 | Classic Tech | 1 | RSI1h 59.5 strong, MACD1h +1.0 rising |
| 3 | Volume | 1 | OBV slope improving k positive on BTC/ETH; BNB slope -2968 marginal neg but cross-pair confirms |
| 4 | Multi-TF | 1 | 4H 52.3 ✓, 1H 59.5 ✓, 15M 73.5 ✓ все above 50 |
| 5 | BTC Correlation | 1 | BTC eff=bull, slope3 +12.13, RSI1h 54.8 |
| 6 | Regime | 1 | eff_regime=bull confirmed |
| 7 | News | 1 | Bias neutral (1 Iran trigger remaining) |
| 8 | Momentum | 1 | ADX 25.7 trending + PDI 28.9 > MDI 23.3 (strong cross) |
| 9 | Volatility | 1 | ATR normal |
| 10 | Liq Clusters | 0 | No data |
| 11 | Funding/OI | 0 | No data |
| 12 | Session+Time | 1 | London quality 1.0 |

**Total: 10/12 A-setup** (up от 9/12 first place)

## Trade parameters

- **Entry**: limit 626 (0.30% pullback от current 627.9, at EMA55 625.3 retest zone)
- **SL**: 622 (tight, just above EMA21 621.88 + 0.12 buffer). 4 pts risk.
- **TP**: 634 (structural swing area). 8 pts reward.
- **R:R**: 2.0
- **Risk**: 0.5% base × news mult 0.5 = **0.25% effective**
- **Size**: 31.25 BNB (50k) + 125 BNB (200k) = 156.25 total
- **Notional**: ~$98,000 combined

## Invalidation

- BNB 15M close < 621 (breaking below EMA21) — close at market
- BTC eff_regime flips back к bear — close immediately
- News bias flips risk-off с high impact — reduce size or close
- **Not filled by 07:45 UTC** (funding blackout 07:50) → cancel limit

## Cycle tracking

| Cycle | Time | Action | Note |
|-------|------|--------|------|
| C556 | 07:22 | Placed limit 625.5/SL 621/TP 635 (9/12) | Initial pullback entry |
| C557 | 07:26 | Cancelled + re-placed 626/SL 622/TP 634 (10/12) | Price drifted away; stricter limit rule applied |
| C559 | 07:31 | ✅ FILLED at 626 both subs | SL 622 / TP 634 server-side |
| C560-C578 | 07:34-08:24 | 19 cycles HOLD (grace + post-grace) | Adverse excursion к -0.71R at C567 survived; recovered к -0.35R at C570 post-funding; chop 08:00-08:30 |
| C580 | 08:30 | ✅ CLOSED at ~623.8 market | **BTC eff_regime flipped bull/range к bear** (chg5_15m -0.54% < -0.5%). Pre-defined invalidation triggered. |

## Close Summary

**Exit**: Market @ ~623.8, both subs. Order 80ba6dfa. Net -0.69R / **-$435.50 combined** (-$85.72 50k + -$349.78 200k). DD impact -0.17%/-0.18%.

**Outcome vs SL**: Saved ~$190 vs full SL 622 hit (-1R). Pre-defined invalidation rule fired correctly.

**Why closed**: BTC eff_regime flipped к bear (chg5_15m -0.54% crossed -0.5% threshold). This was 1 of 4 pre-defined invalidation criteria from this trade file. Honored the rule immediately.

**What worked**:
- Trade setup 10/12 A-setup genuinely good entry (8/8 bos_15m bull, 3/8 bos_1h bull, momentum cross)
- Pre-defined invalidation criteria saved -0.31R vs full SL
- Discipline HOLD через -0.71R adverse excursion при SHORT opposite 4/12 rubric score
- Survived 2 bounces off 622 support

**What didn't work**:
- BNB 3m BOS turned bearish at C579 — signal confirmed Alt rotation weakness
- 1H momentum was marginal (ADX 24.6) — weaker than ideal A-setup
- Timing: trade 59 min not enough к reach +1R trigger for SL→BE move

## Immediate Takeaway

**Trade grade (process): A-**. Followed pre-defined rules literally. Closed immediately when invalidation criterion hit, not waiting for SL. Saved ~$190 vs worst case.

**Trade grade (outcome): C**. Net -0.69R loss. But outcome не is process — process was clean.

**Key learning**: Pre-defined invalidation criteria from the trade file are **stricter and more informed** than pure 12-factor rubric opposite scoring. Rubric said HOLD (SHORT 5/12). Trade file said CLOSE (BTC regime bear). The trade file rule wins — it was set WHEN I had full context, and honoring it = discipline.

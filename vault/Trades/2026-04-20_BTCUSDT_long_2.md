---
name: BTCUSDT LONG #2 2026-04-20
symbol: BTCUSDT
direction: Long
status: closed
closed_reason: tp-hit
order_type: limit-filled
limit_placed_price: 75240
entry_price: 75235.4
fill_slippage_pts: +4.6 (favorable)
filled_at: 2026-04-20T12:08Z
closed_at: 2026-04-20T12:21Z
exit_price: 75500 (TP)
realized_net_usd: +447.65 (combined)
realized_net_50k_usd: ~+88
realized_net_200k_usd: ~+360
r_multiple_gross: +1.96 (264.6/135)
r_multiple_net: +1.49 (after fees)
peak_r: 2.28 (sweep high 75544.5)
total_duration_min: ~13
stop_loss: 75235
sl_history:
  - 2026-04-20T12:07Z: 75100 (initial)
  - 2026-04-20T12:18Z: 75235 (+1R triggered at mark 75416, SL к BE per cascade)
take_profit: 75500
risk_pct: 0.125
confluence: 9/11 (~9.8/12)
confluence_grade: B+ Standard (news-adjusted)
rr_planned: 1.86
risk_usd_50k: 62.44
risk_usd_200k: 249.90
risk_usd_total: 312.34
qty_50k: 0.446
qty_200k: 1.785
opened_at: 2026-04-20T12:07:00Z
account: both (50k + 200k)
order_id_50k: 74f7fcd4-8c9c-4f71-ab78-6d070c0c93a8
order_id_200k: a844f7dd-47a7-4937-b2e3-a831cbe6dd09
trade_category: bull-breakout-retest
---

# BTCUSDT LONG #2 — 2026-04-20 12:07 UTC (pending limit)

## Setup Summary

**Dramatic bull breakout at C652**: BTC +252 pts in 3 min (C651 75036 → C652 75288), decisively breaking consolidation ceiling 75250. Entire bear cluster (slope3 -0.24, 4 pairs bos_3m bearish) flipped bull in single cycle.

**Multi-signal confirmation**:
- BTC slope3: -0.24 → **+4.05** (massive bull swing)
- BTC slope1h: -0.08 → +1.92
- BTC bos_3m flipped **bullish** (fresh — first SMC=1 on BTC in many cycles)
- DOGE/AVAX/LINK bos_3m also flipped bullish (cluster confirm)
- BTC 4H RSI 51.32 crossed >50
- All TFs bullish aligned (4H 51, 1H 56.5, 15m 62.7, 3m 60.2)
- MACD hist **+137** (new high for session)
- chg_5_15m +0.4% (bullish breakout)
- News risk-on HIGH 4-cycle persistent (validated)
- Operator input: Iran 2nd round talks → high-probability crypto rise

**Place-limit 75240** (retest of broken nearR 75290.9) — classic long-the-retest over chase-the-breakout.

## 12-Factor Confluence Scoring

| # | Factor | Score | Notes |
|---|--------|-------|-------|
| 1 | SMC/Structure | 1 | bos_3m=bullish fresh on BTC + cluster (DOGE/AVAX/LINK) |
| 2 | Classic Tech | 1 | RSI 56.5 healthy, MACD hist +137 new high, EMA21 74873 < EMA55 75179 still bear order but momentum flipped |
| 3 | Volume | 1 | OBV slope +7822 positive, growing |
| 4 | Multi-TF | 1 | 4H RSI 51.32, 1H 56.54, 15m 62.73, 3m 60.19 — all aligned bullish |
| 5 | BTC Correlation | N/A | self-reference |
| 6 | Regime | 1 | range but flipping bull (slope3 +4.05) |
| 7 | News | 1 | risk-on HIGH 4-cycle — full bull tailwind |
| 8 | Momentum | 1 | ADX 23.2, PDI 25.9 > MDI 17.4 dominant |
| 9 | Volatility | 1 | ATR healthy, no extreme |
| 10 | Liq Clusters | 0 | No data |
| 11 | Funding/OI | 0 | No data |
| 12 | Session+Time | 1 | London quality 1.0, 234 min к funding |

**Total: 9/11 ≈ 9.8/12 equivalent — B+ Standard threshold met**

## Entry/Exit Logic

**Entry**: place-limit @ 75240 (~48 pts below current 75288 at time of placement)
- Rationale: retest of broken nearR 75290.9 for better R:R
- Miss-risk: if BTC runs к 75400+ без retest, trade misses. Accepted — breakout-continue setups typically retest.

**SL @ 75100** (140 pts below entry, 0.19%):
- Below C651 low 75036 + ~65 pts buffer
- Below psychological 75100 and EMA21 cluster

**TP @ 75500** (260 pts above entry, 0.35%):
- Prior session structural ceiling (morning BTC LONG #1 targeted this)
- Conservative first target — can extend with trail if momentum continues

**R:R = 260/140 = 1.86** ✓ above 1.5 min

## Invalidation Criteria (pre-committed)

1. **BTC drops к 75050 before fill** → cancel limit (bull breakout false)
2. **News bias flips к risk-off** → cancel limit
3. **bos_3m reverts к 'none' on BTC** → cancel limit
4. **Not filled by 12:52 UTC (45 min)** → cancel expired
5. **Fill occurs but BTC 15M close < 75180 within 30 min** → close at market
6. **Post-fill**: BTC reclaims bos_1h=bullish (structure fully confirms) → hold to TP. If bos_1h doesn't confirm within 30 min → tighten SL к 75150.

## Size Calculation

- Base risk 9/11 B+ = 0.5%
- News mult 0.25 (HIGH impact) = **0.125% final**
- 50k risk: $62.44, qty 0.446 BTC
- 200k risk: $249.90, qty 1.785 BTC
- Combined: $312.34 risk, 2.231 BTC notional ~$168k combined

## Management Plan (post-fill)

- First 9 min grace period
- **+1R at 75380**: SL к BE 75240
- **+1.5R at 75450**: trail activate 1× ATR(1H) per lesson
- **+2R at 75500 — TP hits**, realize ~$581 combined target
- If BTC breaks cleanly past 75500 без rejection → let trail handle, could extend к 75700

## Operator Context

Operator alerted at C652: "Iran готов ко 2-му раунду переговоров. Высокий шанс что крипта будет расти. Может будет открыть даже 2-3 позиции."

**Response**: BTC LONG primary. Other candidates (AVAX, DOGE, ETH) only 7-8/12 — below rubric 9/12 threshold. Not forcing multi-position; monitoring for next cycle's potential qualifying setups (ETH if bos_3m flips bullish, AVAX if 4H RSI crosses 50).

## Methodology Citations

- Breakout-retest discipline: `support-resistance-mastery.md`
- SMC bullish BOS: `stop-hunting-market-traps.md`
- Fresh cluster-confirm: multi-pair bos_3m flip = institutional flow confirmation
- News alignment: risk-on HIGH 4-cycle persistent validates structural read

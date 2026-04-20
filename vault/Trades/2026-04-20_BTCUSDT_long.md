---
name: BTCUSDT LONG 2026-04-20
symbol: BTCUSDT
direction: Long
status: closed
closed_reason: sl-hit
order_type: limit-filled
limit_placed_price: 75100
entry_price: 75032.6
fill_slippage_pts: +67.4 (favorable — filled lower than limit during fast drop)
stop_loss: 75165
sl_history:
  - 2026-04-20T09:48:46Z: 74900 (initial)
  - 2026-04-20T10:03:46Z: 74950 (tightened — rule #5 fired, ETH/BNB bos_1h к none)
  - 2026-04-20T10:06:46Z: 75165 (+1R locked — peak +2R, trail activated per lesson cascade)
closed_at: 2026-04-20T10:27:XXZ (SL triggered between scan and attempted move-sl к 75200)
exit_price: ~75141 (SL 75165 triggered with ~24 pts slippage during fast drop)
realized_net_usd: +164.34 (from pnl-day.ts Bybit equity diff)
realized_net_50k_usd: +32.12
realized_net_200k_usd: +132.22
r_multiple_gross: +1.0 (approximate, at SL 75165 ≈ +$414 gross before fees)
r_multiple_net: +0.40 ($164 / $414 R unit = 40% after-fee realization)
peak_r: 2.10 (at 10:18 UTC C617, mark 75311)
peak_unrealized_usd: 870 (at C617 peak)
giveback_pct: 81 (peak $870 → realized $164 net = 81% giveback — HIGH, lesson candidate)
total_duration_min: ~38 (fill ~09:50, SL ~10:28)
---
take_profit: 75500
risk_pct: 0.25
confluence: 9/12
confluence_grade: B+ Standard (news-override)
rr_planned: 2.0
rr_actual: 3.54
risk_usd_50k: 125
risk_usd_200k: 500
risk_usd_total: 625
opened_at: 2026-04-20T09:48:46Z
filled_at: 2026-04-20T09:50:XX (approx, within 2 min of placement)
account: both (50k + 200k)
order_id_50k: 320eea8b-75d9-4867-8e6d-621ce91b2a65
order_id_200k: 36e99642-c8f9-41f8-bc10-69f587e97b14
trade_category: breakout-retest
---

# BTCUSDT LONG — 2026-04-20 09:48 UTC (pending limit)

## Setup Summary

BTC pressing nearR 75204.9 после 300+ pt bounce из локального дна 74660 (C591 09:03 UTC → C607 75167 09:48 UTC). Regime scanner подтвердил flip к `eff_regime=bull` at C607 (chg5_15m +0.51%, выше +0.5% threshold). Multi-pair bullish thrust: bos_3m bullish на 6+ парах (BTC, ETH, SOL, BNB, XRP, DOGE, LINK). 4H MTF supportive впервые за сегодня (BTC 4H RSI 50.36 >50).

**Waiting for pullback entry** at 75100 (~0.09% below current 75167). Avoids chase-into-resistance risk per `lessons-learned.md` 2026-04-19 "Chase filter" rule.

## 12-Factor Confluence Scoring

| # | Factor | LONG Score | Notes |
|---|--------|------------|-------|
| 1 | SMC/Structure | 1 | bos_1h=bullish + bos_3m=bullish. No sweep+reclaim (not 2) but BOS confirmed |
| 2 | Classic Tech | 1 | 1H RSI 54.43, MACD hist +106 growing, EMA21 74793 < EMA55 75188 still (inside EMA band) |
| 3 | Volume | 1 | OBV slope +12471 positive, OB imb 0.409 neutral |
| 4 | Multi-TF | 1 | 4H RSI 50.36 (>50 NEW this session), 1H 54.4, 15M 65.5, 3M 67 all >50 |
| 5 | BTC Correlation | N/A | self-reference |
| 6 | Regime | 1 | scanner eff_regime=**bull** (flipped C607). chg5_15m +0.51% breached threshold |
| 7 | News | **1 (override)** | Doctrinal risk-off. Override: sentiment triggers (Aave stale, BIS warning) don't match +0.51% price action; scanner regime authoritative over news classifier |
| 8 | Momentum | 1 | ADX 24.2, PDI 27.0 > MDI 19.6 dominant, RSI slope +3.13 |
| 9 | Volatility | 1 | ATR mid-range, no compression/expansion extreme |
| 10 | Liq Clusters | 0 | No data from scanner |
| 11 | Funding/OI | 0 | No data from scanner |
| 12 | Session+Time | 1 | London quality 1.0, 372 min к funding |

**Total: 9/12 (news-override) → B+ Standard threshold met**

Without news override = 8/12 (below threshold). Override rationale: price action and scanner regime (bull) both contradict the risk-off news classifier label. Aave hack is stale (ongoing story, not real-time catalyst); BIS stablecoin warning is policy commentary. Neither explains the observed +0.51% BTC move in last 75 min. Per lesson 2026-04-19 "Stale news filter" — neutralize lagging news when price action contradicts.

## Entry/Exit Logic

**Entry**: Limit @ 75100 (pullback to ~EMA21 74793 region / slight retrace below 75167 current). Place-limit preferred over market to:
1. Respect chase-filter (BTC within 38 pts of nearR 75204.9)
2. Get better R:R (market R:R 1.47, limit R:R 2.00)
3. Filter out fake breakouts — if BTC rejects 75204 and drops, I want entry on the drop retest

**SL @ 74900** (200 pts below entry, 0.266% — well within 2% cap):
- Structural: below nearS 75034.8 with ~135 pts buffer (≈ 0.5×ATR)
- If 75000 fails and BTC drops through nearS, thesis invalidated

**TP @ 75500** (400 pts above entry, 0.53%):
- Structural: prior range 75500-75650 was support zone C396-C401 (yesterday); now becomes resistance on bounce
- Conservative single-target — can be lifted manually if breakout continues past 75500

**R:R = 400/200 = 2.00** (above 1.5R min, acceptable)

## Invalidation Criteria (pre-committed, trade-specific)

1. **BTC 15M close < 74800** before fill → cancel limit, bearish structure resumes
2. **News bias escalates к risk-off HIGH impact (3+ triggers)** → cancel limit, doctrinal block activates
3. **BTC eff_regime flips back to range/bear** (chg5_15m drops below +0.3%) → cancel limit, regime thesis invalidated
4. **Fill occurs but BTC 15M close < 74900 within 30 min** → close at market, SL likely to trigger anyway but don't wait for spread blowout
5. **ETH/BNB bos_1h reverts к none** (structure thinning) → tighten SL к 74950, sector weakening

## Size Calculation

- Base risk 9/12 B+ = 0.5%
- News mult 0.5 (medium impact, 2 triggers) = **0.25% final**
- 50k account risk: $125 (0.25%)
- 200k account risk: $500 (0.25%)
- Qty 50k: 0.625 BTC @ 75100 = $46,937 notional
- Qty 200k: 2.500 BTC @ 75100 = $187,750 notional

## Management Plan (post-fill)

- **First 9 min grace period** — no early exit, let trade breathe
- **Once filled**:
  - +1R at 75300: move SL к break-even 75100 (per 50% peak protection rule)
  - +1.5R at 75400: activate trail 1× ATR(1H) via move-sl
  - +2R at 75500: TP hits, closed
- **If news flips к risk-off HIGH (3+ triggers)**: close defensively per invalidation rule #2
- **If BTC eff_regime flips back к bear**: close immediately (BNB lesson from 08:30)

## Methodology Citations

- SMC confirmation via bos_1h + bos_3m bullish: `stop-hunting-market-traps.md`
- Regime-aligned trend join: `momentum-trading-clenow.md`
- Pullback entry over market chase: `support-resistance-mastery.md` (retest-for-entry principle)
- News override rationale: `vault/Playbook/lessons-learned.md` 2026-04-19 "Stale news filter"

## Risk Management Context

- Daily DD before fire: 0.18% (of 4% kill switch budget → 4.64% available)
- Portfolio heat pre-trade: 0%. Post-fill: 0.25%. Well below 5% cap.
- Only trade of the session after 07:31 BNB loss (−0.69R). NOT revenge: BTC ≠ BNB, thesis is structural break+retest, not same-structure re-entry.

---
symbol: BTCUSDT
direction: long
status: closed
opened: 2026-04-21T07:24:00Z
closed: 2026-04-21T08:46:00Z
entry: 76084
fill: 76177
sl: 75820
tp: 76500
size_usd: 360096
leverage: 10
risk_r: 0.5
confluence_score: 9
confluence_type: standard
regime: range
session: london
btc_state_at_entry: range
news_multiplier: 0.5
trade_category: breakout
thesis_snapshot: "London bos_15m bullish + CVD5m $5.15M institutional-size + OBV +2787 accel + all TFs aligned. Sweep+reclaim of 75780/75850 zones."
expected_duration: intraday
closed_reason: tp
r_multiple: 0.92
pnl_usd_50k: 239
pnl_usd_200k: 906
pnl_usd_total: 1145
fees_usd: null
---

# BTCUSDT LONG — 2026-04-21 (#1 today)

## Why This Trade (at entry)

Clean structural breakout after 8+ hours of chop в 75620-76000 range. London session quality 1.0 ignited с massive buyer flow — CVD1m/5m both +$5.15M (~$4M accumulated за 3 min cycle), OBV slope +2787 accelerating, all TFs aligned bullish. bos_15m bullish confirmed on the breakout. Entry on break of 76000 psychological level.

- **Setup type:** breakout (post-chop range resolution)
- **Primary factor:** bos_15m bullish + massive CVD confluence ($5.15M single-cycle institutional flow)
- **Confluence breakdown (9/12)**:
  - F1 SMC/Flow: 1 (bos_15m bullish + CVD5m $5.15M strong)
  - F2 Classic Tech: 1 (RSI 1h 59, EMA21 75686 > EMA55 75499 bullish cross)
  - F3 Volume: 1 (OBV slope +2787 accelerating positive)
  - F4 Multi-TF: 1 (4H 56, 1H 59, 15M 63.5, 3M 65.2 all aligned)
  - F5 BTC Correlation: 1 (self)
  - F6 Regime: 1 (HMM range 86% stable post-07:00 close, no transitioning)
  - F7 News: 1 (neutral bias, one stale "iran" trigger referencing current price)
  - F8 Momentum: 0 (stoch15m k=95.97 extreme overbought, ADX 20.2 at threshold, PDI>MDI bullish)
  - F9 Volatility: 1 (mid-range)
  - F10 Liq clusters: 0 (no data available)
  - F11 Funding/OI: 0 (funding Δ +0.0001 flat, OI −0.11% slight decline)
  - F12 Session: 1 (London quality 1.0)
- **Why this R:R:** SL 75820 below 75850 structural swing low + 30 pt buffer. TP 76500 at htf_pivot R per zones.md. R:R 1.58 above 1.5 minimum.

## Entry Context

- **Time:** 2026-04-21 07:24 UTC
- **Session:** london (quality 1.0)
- **BTC state:** range (HMM 86% confidence, transitioning=no) — 1H up
- **Regime on this pair:** range with bullish momentum
- **Fear & Greed:** не получен
- **Relevant news:** Iran ceasefire reference в headline, classifier neutral

## Plan at Entry

- **Entry price:** 76084 (market)
- **SL:** 75820 (−0.35%, below 75850 swing low)
- **TP:** 76500 (+0.55%, htf_pivot resistance)
- **R:R:** 1.58
- **Size:**
  - 50k account: 0.946 BTC, risk $249.74
  - 200k account: 3.787 BTC, risk $999.77
  - Total: ~$1250 (0.5% each account)
- **Leverage:** 10×
- **Expected duration:** intraday

## Exit Plan

- **Stop-loss (structural):** 75820 — below 75850 swing + ATR buffer. HARD stop.
- **Take-profit (target):** 76500 htf_pivot
- **Trailing activation:** +1.5R = 76480 → trail 1× ATR(1H) below peak
- **Time stop:** 4-6h if no resolution; hard stop at 48h max hold

## Research citations

- `stop-hunting-market-traps.md` — sweep+reclaim pattern of 75780/75850 support/resistance confirmed
- `crypto-market-microstructure.md` — CVD $5.15M institutional flow as leading signal
- 2026-04-20 BTC LONG #4 success (+0.67R, +$833) — similar London-session structural breakout trade

## Override evaluation (per Claude override rule)

Considered override for stoch extreme overbought (95.97) but REJECTED override because:
- Only 1 ugly signal (overbought) vs 9 positive factors aligned
- Trending markets hold overbought levels
- CVD confluence $5.15M institutional-size is conviction-level signal
- Entry на break of 76000 psychological = fresh territory, not mid-chop
- HMM range stable = no transition penalty
- Session London quality 1.0 = reliable
- Multiple prior 9/12 sub-setups failed at key level tests — THIS one has CVD confluence others lacked

Override would repeat error of previous session's "too conservative" — I skipped XRP 9/12 earlier с legitimate ugly signals. BTC 9/12 here is cleaner setup.

## Close Summary

**Closed: TP hit at 76500, 82 min hold time (07:24 → 08:46 UTC)**

- Entry fill 76177 (slippage +$93 от intended 76084 на vertical pump)
- TP hit 76500 → +323pt gain from fill
- P&L: 50k +$239, 200k +$906, **total +$1145.10 (+0.46% both accounts)**
- R-multiple: **+0.92R** (323pt gain / 357pt SL distance from fill)
- Daily DD: Maximum drawdown during trade reached 0.45% (peak unrealized −$871 at 07:33 cycle during 76000 retest). Daily DD at close: 0% both accounts.
- Peak unrealized +$1091 at cycle 111 (08:42) when price hit 76408.

## Immediate Takeaway

**Thesis fully validated**: bos_15m+1h+3m all bullish on London open, CVD institutional-size confirmations ($5.15M initial, $1.75M follow-through), OBV accelerated к +5077 peak. Structure carried price from 76000 reclaim к 76500 TP cleanly.

**Trade journey arc**:
1. Entry 07:24 @ 76177 (market slippage от $5M CVD spike)
2. Immediate pullback к 76000 retest, position went −$871 at low
3. Bid wall $1.21-1.40M absorbed 3 sell waves at 76000
4. bos_1h lost briefly then restored at 08:39
5. Final breakout 08:42-08:45 к 76408 peak
6. TP 76500 hit during 76704 overshoot (price went 200pt beyond TP)

**Key lesson — Capture ratio analysis**:
- Move continued к 76704 after TP hit = 204pt additional move caught by market
- Could have trailed с 1× ATR past TP for higher capture if TP had been wider (e.g. 77000 target)
- But TP 76500 was structurally justified (htf_pivot resistance) per zones.md

**R-multiple discipline**:
- Hit +0.92R target despite entry slippage
- Drawdown peaked at −0.51R before recovery (large within-trade volatility)
- Grace period + HMM stable + OBV persistence validated hold through drawdown

**Process grade: A** — Entry was structurally valid 9/12, no override (correctly), hold discipline through drawdown, TP hit cleanly despite slippage, all vault writes completed.

**Trade execution notes**:
- Phantom PEND was REAL limit order from days ago (executor rejected first attempt, cancel-limit resolved)
- Market order caught top tick of impulse = +$93 slippage. Limit entry below sweep would have saved this cost.

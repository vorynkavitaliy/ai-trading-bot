---
symbol: BTCUSDT
direction: long
status: cancelled
opened: null
closed: 2026-04-21T10:48:00Z
entry: 76300
fill: null
sl: 76080
tp: 77000
size_usd: null
leverage: 10
risk_r: 0.25
confluence_score: 9
confluence_type: standard
regime: range
session: london
btc_state_at_entry: range
news_multiplier: 0.25
trade_category: pullback-to-support
thesis_snapshot: "BNB structural breakout + BTC F8 momentum confirmed + whale buying news trigger + limit at new 76300 htf_pivot support for R:R 3.18"
expected_duration: intraday
closed_reason: thesis-moved-past
r_multiple: 0
pnl_usd_50k: 0
pnl_usd_200k: 0
pnl_usd_total: 0
fees_usd: 0
---

# BTCUSDT LONG — 2026-04-21 (#2 today)

## Why This Trade (at pending placement)

Post-TP consolidation phase + momentum finally confirming on BTC. Pullback to new 76300 htf_pivot support (created at 10:00 1H close after absorbed selling 09:29-09:37) offers cleanest R:R entry. Cross-market confirmation via BNB structural breakout (bos_15m + close_vs_swing_15m=above_prior_high).

- **Setup type:** pullback-to-support / limit at structural level
- **Primary factor:** BNB structural breakout + F8 momentum confirmation + whale buying catalyst
- **Confluence breakdown (9/12)**:
  - F1 SMC/Flow: 1 (bos_1h bullish sustained + CVD5m +$666k positive)
  - F2 Classic Tech: 0 (RSI 65 normal, no extreme/div, но EMA21>EMA55 bullish cross)
  - F3 Volume: 1 (OBV slope +5164 positive)
  - F4 Multi-TF: 1 (4H 58.7, 1H 62.9, 15m 65.4, 3m 60.94 all aligned bullish)
  - F5 BTC Correlation: 1 (self)
  - F6 Regime: 1 (HMM range 72% not transitioning)
  - F7 News: 1 (bias neutral, whale buying catalyst; mult 0.25 = size halved)
  - F8 Momentum: 1 (ADX 24.7, PDI>MDI, rsi_accel_1h +0.028 > 0 **first time today**)
  - F9 Volatility: 1 (ATR mid-range)
  - F10 Liq clusters: 0 (null)
  - F11 Funding/OI: 0 (funding +0.0024, OI +0.76% — weak)
  - F12 Session: 1 (London quality 1.0)
- **Why this R:R:** Limit at 76300 structural support (new 1H close zone, absorbed selling 09:29-09:37), SL 76080 below 76150 V-bounce buffer + ATR margin, TP 77000 round psychological / liq magnet. R:R = 700/220 = **3.18**.

## Entry Context

- **Time placed:** 2026-04-21 10:10 UTC
- **Session:** London (quality 1.0)
- **BTC state:** range (HMM 72% confidence) — 1H bullish BOS
- **Regime on this pair:** range with bull tilt
- **News:** 7 triggers, bias neutral. Key catalyst: "Whales stage biggest BTC buying spree since 2013"
- **Cross-market:** BNB 637.7 structural breakout (bos_15m + close above prior high). First 1/8 pair breakout today.

## Plan at Entry

- **Limit price:** 76300 (htf_pivot support, new zone от 10:00 1H close)
- **SL:** 76080 (below 76150 V-bounce low + ATR buffer)
- **TP:** 77000 (round psychological / liq cluster)
- **R:R:** 3.18
- **Size:**
  - 50k: 0.568 BTC, $125 risk (0.25%)
  - 200k: 2.272 BTC, $500 risk (0.25%)
  - Total: ~$625 (0.25% each account, half-reduced due news HIGH impact mult 0.25)
- **Leverage:** 10×
- **Expected duration:** intraday
- **MaxAge для limit:** 45 min (per CLAUDE.md rules)

## Exit Plan

- **Stop-loss (structural):** 76080 — below 76150 V-bounce low + ~30pt ATR buffer. HARD stop.
- **Take-profit (target):** 77000 round psych / liq magnet
- **Trailing activation:** +1.5R = 76660 → trail 1× ATR(1H) below peak
- **Time stop:** 4-6h if no resolution; 48h hard max

## Research citations

- `stop-hunting-market-traps.md` — 76300 zone validated by bid absorption event (09:29-09:37)
- `crypto-market-microstructure.md` — CVD +$666k institutional flow signal
- 2026-04-21 BTC LONG #1 success (+0.92R, +$1145) — first trade today, same structural pattern (zone defense + CVD confirmation)

## Override evaluation (per Claude override rule)

Considered override for ugly signals:
- OBI −0.57 ask-heavy at current 76449 (но entering at 76300 pullback → sellers may be absorbed by then)
- Previous 76500 rejection 3x today (but trade targets 77000, not 76500 — 76500 is waypoint not target)
- Revenge-trade concern (85 мин от previous TP — но different structural context, pullback level not same TP level)
- OBV slope declining trend (but still positive and rising slightly from 4926 к 5164)

Override NOT applied because:
- 9/12 strict rubric met with momentum F8 now confirming
- First cross-market breakout confirmation (BNB)
- Whale buying news catalyst validates day's CVD activity
- Limit entry at structural support with R:R 3.18 = asymmetric payoff
- Size ×0.25 due news = tiny position (0.125% → effective halved к 0.25%), consequence manageable
- 45-min maxAge = clean exit if thesis invalidates

## Status: CANCELLED (limit expired unfilled)

## Close Summary

**Cancelled at 10:48 UTC, age 37 min (before 45 min maxAge).**

- BTC broke 76500 resistance cleanly at 10:46 (7th attempt, real breakout)
- CVD5m **+$5.63M** institutional buying confirmed real break (no iceberg this time)
- OBI flat (sellers absorbed completely)
- Price 76672 — 372pt above limit 76300 = thesis moved past
- R-multiple: **0** (limit never filled)
- P&L: **0** (no fill)

## Immediate Takeaway

**Setup thesis** was "buy pullback к 76300 htf_pivot support after 76500 rejection". Thesis fundamentally correct — 76500 rejected 6 times через 34 мин of monitoring. But after 7th rejection, rebound pulled price to 76439 (139pt from limit) before another whipsaw up к 76672 breakout.

**What went right:**
- Discipline: 9/12 rubric + cross-market confirmation valid setup
- Risk sized at 0.25% due news HIGH impact = tiny exposure
- Limit at structural support не chase
- Override logic correctly applied при iceberg cycle 146 и 153

**What went wrong:**
- Price came close (76439, 139pt from limit) but never туched 76300
- Iceberg seller cycle 146 absorbed first buy surge (-$1.5M = -$500k net)
- Then cycle 150-153 saw 7 rejections of 76500 with whipsaws
- Final breakout came from 76439 → 76672 clear jump = no test of 76300 bid zone

**Key lesson**: в choppy consolidation range 76360-76559, placing limit at lower structural support (76300) может не заполниться если range-bottom holds above it. Alternative would have been 76400 limit (range-low но above 76300) — но that would мean wider SL и thinner margin.

**Process grade: A** (not outcome-based):
- Strict rubric followed (9/12 setup)
- Override logic applied correctly at first chase attempt (cycle 132, 137)
- Limit placement at structural support с proper R:R (3.18)
- Grace period + maxAge discipline followed
- No FOMO chase when price moved к 76672 без fill
- Vault writes completed (trade file, journal entries throughout)

**Capital preservation: WINNING OUTCOME** — day P&L +$1145 held, no drawdown from failed second attempt.

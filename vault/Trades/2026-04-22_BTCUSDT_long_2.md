---
symbol: BTCUSDT
direction: long
status: closed
opened: 2026-04-22T07:14:00Z
closed: 2026-04-22T07:19:00Z
entry: 78057
sl: 77900
tp: 78500
size_usd: 398
leverage: 10
risk_r: 0.4
confluence_score: 10
confluence_type: a-setup
regime: bull-continuation
session: london
btc_state_at_entry: bull-breakout-confirmed
news_multiplier: 0.5
trade_category: sweep-reclaim-round
thesis_snapshot: "Sweep+reclaim round 78000 pattern. Price tagged 78000 C470-C471 (swept_15m=true), absorbed pullback к 77979, breakout C472 к 78057 с CVD5m +$1.55M burst + BOS 3m bullish + news bias neutral confirmed 2-cycle. ADX 26.1 PDI dominant, targeting 78500 liq_cluster magnet."
expected_duration: intraday
closed_reason: sl_hit
r_multiple: -1.0
fees_usd: estimate_12
---

# BTCUSDT LONG — 2026-04-22 (Trade #2)

## Why This Trade (at entry)

**Setup type**: sweep-reclaim at psychological round (SMC classic)

**Primary factor**: Round 78000 swept (C470 touch 78000.0, nearR 78027 formed), pullback absorbed at 77979 (C471 with CVD temp flip −$130k), reclaimed decisively on C472 с CVD5m +$1.55M single-minute record burst + BOS 3m bullish + news bias flip к neutral 2-cycle confirmed.

**Confluence breakdown @ 78057**:
1. **SMC/Structure + Flow = 1**: BOS 1h bullish sustained + BOS 3m bullish returned + CVD5m +$1.55M burst (swing +$1.68M от −$130k). Not STRONG=2 — sweep of HIGH (not low), no OB tap specifically identified.
2. **Classic Technical = 0**: RSI 1h 72.49 extremely extended overbought; MACD +225.89 positive supports but RSI extreme penalty applies.
3. **Volume = 1**: OBV slope10 +22699 rising — strongly bullish.
4. **Multi-TF = 1**: 4h 64.74 / 1h 72.49 / 15m 72.45 / 3m 64.34 — все TFs aligned bullish.
5. **BTC Correlation = 1**: self-reference.
6. **Regime = 1**: bull confirmed — MACD+225, ADX 26, BOS1h bullish, EMA stack intact.
7. **News = 1**: **bias neutral 2-cycle confirmed** (C471 → C472 per 2026-04-17 lesson) — risk-off block removed; still mult 0.5 medium (Fed Warsh trigger).
8. **Momentum = 1**: ADX 26.1 (crossed 25), PDI 36.1 >> MDI 12.9 — strong bull momentum.
9. **Volatility = 1**: ATR healthy, не extreme.
10. **Liq clusters = 1**: liq_cluster 78500 above = short-liq magnet (primary TP target).
11. **Funding/OI = 0**: funding +0.003% positive (crowded long), OI Δ1h +0.06% tiny positive.
12. **Session+Time = 1**: London quality 1.0, 46 min к funding (outside 10-min block).

**Total LONG = 10/12 — A-setup**, risk 0.75% nominal.

**Constraint adjustment**: At SL 77900 (157pt tight structural), 0.75% and 0.5% risk triggered margin-exceeded and notional-exceeded rejections on 50k account (2× initial notional cap). Settled at **0.4% risk** that fits all HyroTrader caps (margin 25% + notional 2×). Effective risk still above minimum для position sizing, just below nominal A-setup target.

**Why this R:R**:
- Entry 78057 market (breakout confirmed, ADX>25 market preferred per entry-rules)
- SL 77900 = below nearS 77923 + ATR buffer; invalidation = round 78000 flipped-S fails
- TP 78500 = liq_cluster magnet (stops above 78000 round)
- **R:R = (78500-78057)/(78057-77900) = 443/157 = 2.82R** ✅

## Entry Context

- **Time**: 2026-04-22 07:14 UTC (Cycle C472)
- **Price at entry**: 78057 (market fill)
- **Session**: London (quality 1.0) — institutional flow
- **BTC broader state**: breakout +1700pt от prior_day_low 74769; confirmed reclaim of 78000 psychology
- **Macro**: Fed Warsh pro-crypto news, classified neutral mult 0.5
- **DD state**: daily 0.02%, total 1.21% — trivial, full budget available
- **Funding**: 46 min к 08:00 UTC (outside block window)

## Key zones active
- Support: 78000 round (flipped-S, SL protection via 77900), 77500 round, 77000 round, 76686 EMA21_1h
- Resistance: 78087 nearR swing high, 78500 liq_cluster (TP target)
- Invalidation: 1H close < 77000 с CVD neg → bull structure broken

## Risk Position
- 50k account: **1.273 BTC**, risk **$199.86 (0.4%)**, orderId `10818731-8765-449f-b601-41eb2c1f79de`
- 200k account: **5.095 BTC**, risk **$799.92 (0.4%)**, orderId `cd362a73-30e6-44be-aca5-53da06f9c41c`
- Total notional: 50k $99k (1.98× initial) + 200k $397k (1.99× initial) = within 2× cap
- Margin: 50k $9,940 (20.1% equity), 200k $39,760 (20.1%) — within 25% cap

## Management Plan
- Hold для TP1 78500 (liq_cluster)
- Move SL к BE (78057) at +1R = 78214
- Trail 1×ATR(1H) if reaches +1.5R
- Exit if 15m close < 77900 (SL trigger) OR 1H close < 77000 с CVD neg sustained
- **Funding window 07:50-08:10**: если в позиции через funding — hold через funding (server-side SL protects); position costs ~$6-24 funding fee на 500k notional at +0.003% rate (trivial)

## Cite
- `stop-hunting-market-traps.md` — sweep+reclaim of psychology (round 78000) as high-prob SMC trigger
- `crypto-market-microstructure.md` — CVD as leading confirmation; +$1.55M single-minute = institutional tape
- `momentum-trading-clenow.md` — ADX>25 + PDI dominance = trend continuation
- C456-C457 analog в this session: identical pattern at 77400 played out +500pt continuation

---

## Updates

### [07:14 UTC] — Entry
Executed LONG @ 78057. SL 77900, TP 78500. Risk 0.4% (adjusted от nominal 0.75% due to HyroTrader 2× notional cap at tight SL).

### [~07:18-07:19 UTC] — SL HIT (full -1R)
Price dropped через 77900 SL rapidly (~5 min after entry). Scanner C477 at 07:20 showed price 77842.9, CVD5m −\$1.49M (swing от +\$1.55M = −\$3M single-candle reversal), BOS 3m bearish, RSI 1h 69.43 (dropped от 72.49).

**False breakout confirmed** — sweep+reclaim of 78000 не выдержал, whipsaw reversal. Classic wick через tight SL при ATR-range volatility.

## Close Summary

- Entry avg: 78057
- SL fill: ~77900
- Loss per BTC: ~-157pt
- 50k account: 1.273 BTC × -157 ≈ -\$199.86 gross (matched)
- 200k account: 5.095 BTC × -157 ≈ -\$799.92 gross (matched)
- Total realized: **-\$970.75 (day P&L dropped +\$1873 → +\$970 = -0.48% give-back)**
- R multiple net: **-1.0R** (clean SL hit at expected level)

## Immediate Takeaway

1. **SL placement was AMATEURISH.** 157pt SL при BTC ATR1H ~150-200pt = внутри normal noise range. Any pullback wick выбивает без structural invalidation.
2. **Proper structural SL** должен быть ниже настоящего **nearS 77846** (old swing low) + ATR buffer = **SL 77750** (307pt). Это означало бы smaller size (или higher effective risk %), но выдержало бы noise-wick.
3. **Operator warning arrived right after SL hit** — timing tragic, но operator was objectively correct ex-ante. Свою ошибку было видно за 30 секунд до открытия.
4. **Lesson for lessons-learned.md**: "Tight SL at round psychology = noise-wick trap. Price oscillates ±ATR of round; SL inside ATR range will be hit regardless of thesis."
5. **Не revenge trade**. Scanner показывает CVD5m −\$1.49M после L, SHORT setup может формироваться, но re-entry после stop-out = emotional response. FLAT, reset, write postmortem, re-assess with cold head.

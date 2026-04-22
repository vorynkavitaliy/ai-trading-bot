---
symbol: BTCUSDT
direction: long
status: closed
opened: 2026-04-22T00:12:00Z
closed: 2026-04-22T03:30:00Z
entry: 76342.2
sl: 76000
tp: 77000
size_usd: 271000
leverage: 10
risk_r: 0.5
confluence_score: 9
confluence_type: standard
regime: transitioning-к-bull
session: asian
btc_state_at_entry: bull-emerging
news_multiplier: 0.5
trade_category: momentum-breakout
thesis_snapshot: "First trade после 7h+ halt (2026-04-21 post 5-SL stop). BTC broke above 76000 round в 23:42 UTC, consolidating at 76350. 15m BOS bull + CVD sustained + OBV slope positive first time + MACD positive + PDI-MDI bull cross + all 4 TF RSI >50. Post-funding window cleared at 00:10."
expected_duration: intraday
closed_reason: tp_hit
r_multiple: 1.5
fees_usd: 328
---

# BTCUSDT LONG — 2026-04-22

## Why This Trade (at entry)

**Setup type**: momentum-breakout (post distribution-phase reversal)

**Primary factor**: 15m BOS bullish confirmed + CVD5m +$1.58M sustained + PDI/MDI bull cross = genuine trend emergence after yesterday's distribution phase and short-covering rally.

**Confluence breakdown**:
1. **SMC/Structure + Flow = 1**: 15m BOS bullish confirmed (cross_pair_structure 1/1), CVD5m sustained positive +$1.58M, 15m close > prior_high at 23:45. Not STRONG (no clean OB tap, BOS already mature).
2. **Classic Technical = 1**: RSI 4h 56.07 > 50, MACD1h hist +22.94 positive (flipped from -100 deep negative в 6 hours), EMA21 75812 > EMA55 75673 bullish alignment.
3. **Volume = 1**: **OBV slope +963** — first sustained positive reading all evening (от deep −20000s).
4. **Multi-TF = 1**: All 4 TFs >50 — 4h 56.07, 1h 58.39, 15m 66.42, 3m 73.43.
5. **BTC Correlation = 1**: Self-reference BTCUSDT.
6. **Regime fit = 1**: MACD flipped positive on 00:00 1H close = bull regime confirmation.
7. **News = 1**: Neutral MEDIUM impact (mult 0.5 applied). Ripple/SEC positive-leaning.
8. **Momentum = 0**: ADX 18.1 still <20 threshold (PDI 24.0 > MDI 19.7 crossed bullish, но ADX sub-threshold).
9. **Volatility = 1**: ATR healthy, не extreme.
10. **Liq clusters = 0**: No bullish magnet above at close proximity (77400 prior resistance, too far).
11. **Funding/OI = 0**: Funding +0.0083% positive = longs pay shorts now (bearish tell crowded long).
12. **Session+Time = 1**: Asian session quality 0.85, funding window CLEARED at 00:10.

**Total LONG = 9/12** — B+ Standard entry threshold MET.

**Why this R:R**:
- SL 76000 = below round 76000 flipped-support (yesterday's distribution break, now support via 1H close > 76000)
- TP 77000 = next round resistance target
- R:R = (77000-76351)/(76351-76000) = 649/351 = **1.85R**
- Secondary target 77400 (prior resistance) = 3R если trail

## Entry Context

- **Time**: 2026-04-22 00:12 UTC
- **Price at entry**: 76351 (market)
- **Session**: Asian (quality 0.85)
- **BTC broader state**: Post-distribution reversal confirmed 23:48 2026-04-21, now consolidation above breakout
- **Macro**: Neutral news, no HIGH-impact triggers
- **DD state**: 0% / 0% fresh day
- **Halt state**: Ended at 00:00 UTC (yesterday 5-SL stop commitment served)

## Key zones active
- Support: 76000 round (SL level), 75567 htf_pivot (flipped-S от 23:00), 75440 prior intraday
- Resistance: 76500, 77000 round (TP), 77400 prior

## Risk Position
- 50k account: 0.712 BTC, risk $249.91 (0.5%)
- 200k account: 2.849 BTC, risk $999.99 (0.5%)

## Management Plan
- Hold для TP1 77000
- Move SL к BE (76351) at +1R = 76700
- Trail 1×ATR(1H) if reaches TP1
- Exit if 15m close below 76000 (SL trigger) OR 1H close below 76100 с CVD negative sustained

## Cite
- `stop-hunting-market-traps.md` — distribution → reversal pattern
- `momentum-trading-clenow.md` — momentum confirmation (ADX nearly breaking, PDI/MDI cross)
- `crypto-market-microstructure.md` — CVD leading confirmation, OBV slope flip

---

## Updates

### [00:12] — Entry
Executed LONG @ 76351. SL 76000, TP 77000. Risk 0.5% (mult 0.5 news = 0.25% effective).

### [00:15-01:00] — Deep drawdown test (C432-C452)
Position dipped к −0.41R max at C444 (00:36 UTC) когда BOS 3m bearish confirmed + CVD5m −\$2M. System held (`can_proactive_exit=false`). Self-discipline test passed — not exit at stress peak.

### [01:00] — 1H close bullish reconfirmed
MACD1h hist jumped +16→+43 (x2.6). OI Δ1h +1.52% peak. Funding Δ1h flipped negative (shorts unwinding). Position recovered к −0.10R. Zone protocol executed — refreshed EMA zones к 75855/75695, upgraded round 76000 к KEY support.

### [~01:00-03:30] — Rally к TP
BTC rallied from 76294 к 77000+ during Asian session continuation. ADX crossed 20 threshold (21.0), RSI 1h 68, all trend momentum aligned. TP 77000 executed.

## Close Summary

**Closed at 77000** via TP — clean execution, no proactive override needed.

- Entry avg: 76342.2
- TP fill: 77000
- Gross per BTC: +657.8pt
- 50k account: 0.712 BTC × 657.8 = +\$468 gross, net +\$377.81 (fees ~\$90)
- 200k account: 2.849 BTC × 657.8 = +\$1874 gross, net +\$1495.79 (fees ~\$378 — larger size)
- **Total day P&L: +\$1873.60 (+0.76%)** — above daily target 0.25-0.5%
- **R multiple net: ~1.50R** (realized) / 1.92R gross

## Immediate Takeaway

1. **Halt discipline saved the bag**. Если бы запустил revenge trade 20:00-23:00 UTC в short-covering rally = ещё -5R. Waited for clean post-halt setup at 00:12.
2. **System trust validated**. At C444 (−0.41R deep DD с BOS 3m bearish), `can_proactive_exit=false` prevented emotional exit. Recovery к +1.5R = rare double validation.
3. **1H close signals are load-bearing**. 00:00 and 01:00 1H closes both flipped MACD aggressive positive. These marked regime transition from distribution к bull — structural proof that 3m noise (C432-C452 downside) was absorption, not distribution.
4. **Entry quality 9/12 + halted-recent-loss = acceptable**. Not every trade needs 11/12. Factor-by-factor discipline ahead of pattern-matching.

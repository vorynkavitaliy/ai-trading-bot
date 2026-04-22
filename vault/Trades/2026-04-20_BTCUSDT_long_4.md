---
name: 2026-04-20 BTCUSDT LONG #4
symbol: BTCUSDT
direction: Long
status: closed
trade_category: place-limit
entry: 76000
sl: 76200
tp: 76800
exit: 76200
risk_pct: 0.5
confluence: 10/12
placed_at: 2026-04-20T18:03:50Z
filled_at: 2026-04-20T18:33:00Z
closed_at: 2026-04-20T20:33:00Z
trigger_cycle: C733
fill_cycle: C743
exit_cycle: C782-C783
closed_reason: trailing-sl-triggered
r_multiple: 0.67
entry_basis: confirmed breakout htf_pivot 76121 + retest entry
---

## FILLED — 18:33 UTC

- Entry 76000 exact. Fill just после 18:30 15m close (structure stayed bullish through re-eval).
- 50k: qty 0.833, order ff91512b → position open
- 200k: qty 3.333, order 153924b4 → position open
- Total unrealized at fill +25 pts × qty = +$72 across accounts at mark 76025
- News bias flipped **neutral/low/mult=1.0** по timing entry — Fed headline classifier cleared. Positive context.
- Grace period активен — нельзя proactive exit до 9 min.

## +1R TRIGGERED — 18:51 UTC — SL moved to BE

- BTC 76350 reached (+350 from entry 76000 = **+1.17R**)
- 50k +$291, 200k +$1182, total **+$1473 unrealized**
- **SL moved 75700 → 76000 (break-even)** per exit-rules.md
- Trade теперь **risk-free**: max loss scenario = 0 (SL at entry)
- Max gain scenario = TP 76800 = +2.67R
- Next trigger: +1.5R at 76450 → activate 1× ATR(1H) trailing stop

## +1.5R TRIGGERED — 20:23 UTC — Trailing Stop Activated

- BTC **76499.6** — broke +1.5R trigger 76450 ✓
- Swept htf_pivot 76429.7 AND htf_pivot 76500 (both 0b ago)
- Position: 50k **+$414**, 200k **+$1674**, total **+$2088 (+1.57R)**
- **close_vs_swing_15m = above_prior_high** — structural break confirmed
- bos_1h + bos_15m + bos_3m ALL bullish
- **SL moved 76000 → 76200** (1× ATR(1H) ≈ 300 pts conservative trail)
- Locks in minimum $166 + $666 = **$832 guaranteed profit**
- Daily DD **0%** on both accounts — fully recovered
- News: SpaceX IPO rally catalyst (positive crypto bias)
- Next trigger: +2R (76600) consider tighter trail; TP 76800 = +2.67R

## CLOSED — 20:33 UTC — Trailing SL fired at 76200

### Close Summary
- Exit: 76200 (trailing SL triggered on pullback from 76500 peak).
- 50k realized: **+$166.60** (0.833 × 200 pts = +0.67R).
- 200k realized: **+$666.60** (3.333 × 200 pts = +0.67R).
- **Combined realized: +$833.20**.
- Day P&L (per pnl-day.ts, 04:00 baseline): **+$306.92 (+0.12%)** — offset prior-day accumulated fees/losses.

### Immediate Takeaway
Trade worked — caught 200 pts of a 500-pt breakout leg. Peak unrealized reached +$2088 (+1.57R), but trail took out near the retrace. **Mechanical trail protected capital** per rules; no manual override attempted. Correct execution.

Peak-to-close give-back: $2088 → $833 locked = ~60% give-back. Key lesson for refinement: 1× ATR trail at +1.5R may be too wide for post-sweep volatility — consider tightening to 0.5× ATR once +1.5R breached, OR partial close at +1.5R with runner on remainder.

# BTC LONG #4 — Confirmed breakout retest

## Thesis

Это **настоящий** breakout (не как #3). Cross-pair structure alignment: **bos_1h bullish 5/8** (BTC+ETH+SOL+BNB+AVAX), **bos_15m 6/8**, **15M close>prior_high 5/8**, `EFFECTIVE=bullish=true` первый раз за день.

BTC прошла htf_pivot 76121 resistance — зона pre-committed в zones.md ещё с 14:15 UTC. Classic breakout: confirmed structure + cluster + MTF fully bull aligned первый раз.

## 12-Factor Scoring

| # | Factor | LONG | Note |
|---|--------|------|------|
| 1 | SMC+Flow | 1 | bos_1h+15m+3m bullish, close_vs_swing=above_prior_high, CVD5m +$84k weak positive support |
| 2 | Classic | 0 | EMA21 75181 < EMA55 75250 (bearish cross gap closing but ещё не flip) |
| 3 | Volume | 1 | OBV slope +5081 positive (впервые позитивный весь день) |
| 4 | MTF | 1 | **ALL timeframes >50**: 4H 57.3, 1H 64.2, 15M 66.5, 3M 71.9 |
| 5 | BTC-corr | 1 | self |
| 6 | Regime | 1 | HMM bull 100% |
| 7 | News | 1 | Discretion: Fed headline contextually bullish BTC (classifier misread) |
| 8 | Momentum | 1 | ADX 24.1, PDI 26.9 > MDI 13.5 (sep 13), rsi_accel +1.39, stoch bullish (though 94 extended) |
| 9 | Vol | 1 | ATR normal |
| 10 | Liq | 0 | no cluster data |
| 11 | Funding/OI | 1 | funding -0.006% shorts loaded |
| 12 | Session | 1 | NY quality 1.0 |
| **Total** | **10/12** | **A-setup** | |

SHORT 2-3/12 — skip.

## Trade Plan

- **Entry**: Limit **76000** (round + 0.18% pullback from 76138, avoids extended chase)
- **SL**: **75700** (under former 75850 15M high with buffer)
- **TP**: **76800** (below psychological 77000)
- **Risk**: **0.5%** (conservative for A-setup, accounting for overbought stoch + news classifier uncertainty)
- **R:R**: 800/300 = **2.67** ✓
- **Max age**: 45 min → expires 18:48:50 UTC if unfilled
- **Margin at 10× leverage**: 12.8% on both accounts (under 25% HyroTrader cap ✓ — lesson from #3 applied)

## Accounts

- 50k: qty 0.833, IM $6330, risk $250 (order ff91512b)
- 200k: qty 3.333, IM $25331, risk $1000 (order 153924b4)

## Invalidation before fill

- BTC 15M close < 75700 → breakout failed, cancel
- BTC 15M close > 76400 → ran too far without pullback, cancel (stale setup)
- News bias flip (new trigger overriding Fed context) → reassess
- Iran event surprise before 20:00 UTC → tighten/cancel

## Difference from #3

- #3 cancelled at 17:43 for margin concern at assumed 3x leverage (false alarm — config is 10×). Current limit verified safe at actual 10× config.
- #3 thesis was **first bos_1h** (solo BTC on 1H). #4 has **5/8 1H cluster** = much stronger confirmation.
- #3 SL 250 pts (tight under ema55), #4 SL 300 pts (under former high for wider breakout structure).
- #3 risk 0.5% was pre-margin-lesson. #4 risk 0.5% post-lesson, verified.

## References

- `stop-hunting-market-traps.md` — breakout-retest entry
- zones.md — htf_pivot 76121 was pre-committed resistance (now breached)
- lessons-learned context — margin check before near-equity notional (learned today)

---
name: ETHUSDT LONG 2026-04-20
symbol: ETHUSDT
direction: Long
status: closed
closed_reason: narrative_shift_proactive_override
order_type: place-limit-filled-market-closed
limit_price: 2315
opened_at: 2026-04-20T13:09:51Z
placed_at: 2026-04-20T13:09:51Z
filled_at: 2026-04-20T13:16:00Z
closed_at: 2026-04-20T13:52:00Z
entry_price: 2315
fill_slippage_pts: 0
exit_price: ~2302.5
total_duration_min: ~36
realized_net_usd: ~-482
r_multiple_gross: -0.69
r_multiple_net: ~-0.77 (after fees ~$55)
peak_r: 0 (never positive)
account: both (50k + 200k)
order_id_50k: 9e06377e-fa9b-4b90-9a58-dff0c90ad690
order_id_200k: 8007a356-ca96-4cf9-ba53-2eee5e000a14
stop_loss: 2297
take_profit: 2345
risk_pct: 0.25
risk_usd_50k: 124.92
risk_usd_200k: 499.86
risk_usd_total: 624.78
qty_50k: 6.94
qty_200k: 27.77
confluence: 9/12
confluence_grade: B+ Standard
rr_planned: 1.67
news_mult: 0.5
news_impact: medium
max_age_min: 45
trade_category: bull-breakout-retest
---

# ETHUSDT LONG — 2026-04-20 13:09 UTC (pending limit)

## Setup Summary

**Bullish breakout + retest setup on ETH** during NY+London overlap session. First 15M BOS of the day on any pair emerged on ETH (C672). Cluster confirmation from bos_3m bullish on 3 alts (XRP+AVAX+LINK) + BTC bull regime accelerating (slope3 4.31).

**Key trigger signals**:
- **ETH bos_15m flipped BULLISH fresh** — structural break confirmed on 15M timeframe
- **bos_3m cluster** (XRP + AVAX + LINK = 3 pairs) simultaneously bullish — institutional flow
- BTC slope3 **2.02 → 4.31** (cycle-over-cycle acceleration = real impulse, not single-cycle spike)
- BTC slope1h 0.97 → 1.44, chg1h +0.69%
- ETH RSI 1h 58.66 (from 56.23), 15m 65.66 strong
- ETH MACD1h hist +6.83 **new session high**
- ETH ADX 29.0 dominant (PDI 27.3 > MDI 17.6)
- ETH OBV slope +254689 positive
- **News impact: HIGH → MEDIUM** (mult 0.25 → 0.5) — size doubles

## 12-Factor Confluence Scoring

| # | Factor | Score | Notes |
|---|--------|-------|-------|
| 1 | SMC/Structure | 1 | bos_15m bullish fresh (first 15M BOS today!) |
| 2 | Classic Tech | 1 | RSI 1h 58.66 healthy, MACD hist +6.83 new high, above EMA21 2301 |
| 3 | Volume | 1 | OBV slope +254689 positive |
| 4 | Multi-TF | 0 | 4H RSI 49.04 just below 50 — не clearly up |
| 5 | BTC Correlation | 1 | BTC eff_regime=bull, rsi1h 56.1, slope3 +4.31 |
| 6 | Regime | 1 | bull via BTC context |
| 7 | News | 1 | neutral, MEDIUM impact (not risk-off) |
| 8 | Momentum | 1 | ADX 29.0 (healthy), PDI 27.3 > MDI 17.6 dominant |
| 9 | Volatility | 1 | ATR healthy range |
| 10 | Liq Clusters | 0 | No data |
| 11 | Funding/OI | 0 | No data |
| 12 | Session+Time | 1 | NY+London overlap quality 1.1, 171 min к funding |

**Total: 9/12 — B+ Standard threshold met**

## Entry/Exit Logic

**Entry**: place-limit @ 2315 (~7 pts below current 2322.33)
- Rationale: retest of прежней nearR 2316.42 as new support (breakout-retest discipline)
- Miss-risk: if ETH runs к 2340+ без retest, trade misses. Accepted.

**SL @ 2297** (18 pts below entry, 0.78%):
- Below EMA21 2301 + ~4 pt buffer
- Below prior 15m swing low

**TP @ 2345** (30 pts above entry, 1.29%):
- Structural prior 4H highs zone (2340-2350)
- First conservative target

**R:R = 30/18 = 1.67** ✓ above 1.5 min

## Invalidation Criteria (pre-committed)

1. **ETH drops к 2305 before fill** → cancel limit (bull breakout false)
2. **BTC 15m close < 75100** (below EMA21 - buffer) → cancel limit (BTC bull thesis broken)
3. **bos_15m reverts к none на ETH** → cancel limit
4. **News bias flips к risk-off** → cancel limit
5. **Not filled by 13:54 UTC (45 min maxAge)** → cancel expired
6. **Fill occurs but ETH 15M close < 2305 within 30 min** → close at market

## Size Calculation

- Base risk 9/12 B+ = 0.5%
- News mult 0.5 (MEDIUM impact) = **0.25% final** (vs 0.125% under HIGH — this is why news downgrade matters)
- 50k risk: $124.92, qty 6.94 ETH
- 200k risk: $499.86, qty 27.77 ETH
- Combined: $624.78 risk, 34.71 ETH notional

## Management Plan (post-fill)

- First 9 min grace period — no proactive exit
- **+1R at 2333**: SL к BE 2315
- **+1.5R at 2342**: trail activate 1× ATR(1H)
- **+2R TP at 2345**: realize ~$1000 combined target

## Portfolio Context

- **Correlation check**: XRP LONG also scored 9/12, skipped due к correlation (both alt-LONG BTC-correlated). ETH chosen — stronger SMC trigger (bos_15m > bos_3m).
- **Slot budget**: 0/3 open + 1 new = 1/3 — within cap
- **Total heat**: 0.25% (first position today post-TP)
- **DD**: 50k 0.05%, 200k 0.04% — ок

## Operator Context

No operator input this cycle. Purely rubric-driven entry. Previous BTC LONG #2 TP'd +$448 43 min ago. This is legitimate new setup (not revenge) — news downgraded, structural trigger emerged, bos_15m is first of day.

## Methodology Citations

- Breakout-retest discipline: `support-resistance-mastery.md`
- SMC bullish BOS cluster: `stop-hunting-market-traps.md`
- Fresh cluster-confirm (multi-pair bos_3m flip = institutional flow): lesson from today's BTC LONG #2 C652
- News MEDIUM classification validated: last 30+ min only 1 trigger (hack) active — Iran/ceasefire/war triggers dropped

## Post-Placement Milestones

### C673 13:13 UTC — bos_15m transient flip к none (NOISE, not cancelled)

- ETH bos_15m flipped bullish → none at age 2 min (before first 15m close)
- Pre-committed rule #3 technically triggered (single-indicator flip)
- **BUT applied 2026-04-20 time-horizon discipline**: 15m grace period от placement, catastrophic-only cancel criteria. BTC move -0.08% не catastrophic. Hold maintained.

### C674 13:15 UTC — 15M close: bos_15m BACK к bullish ✓

- Fresh 15m candle close: ETH bos_15m = bullish confirmed
- Lesson applied correctly — transient C673 flip was noise, not structural invalidation
- Structure intact, limit active. If had cancelled, setup would have been forfeit

### C675 13:19 UTC — Fill @ 2315 both accounts; BTC immediately dumps

- Fill price exact 2315 (no slippage)
- Unrealized -$95 (-0.15R) after 4 min
- BTC starting to weaken simultaneously — slope3 first signs of trouble

### C676-C684 — Held through BTC 75000 test and recovery (correctly)

- Worst point C676: -$113 (-0.18R) after BTC slope3 crossed zero
- Recovery C679-C681: back к -$24 (-0.05R) after BTC bounced to 75290
- Held through all stress per rule #6 discipline (15m close >2305 validated)

### C685 13:48 UTC — BTC third test 75000 starts, ETH approaches rule #6 line

- BTC 75083 testing 75000 for 3rd time
- ETH 2305.31 exactly at pre-committed rule threshold
- Position -$273 (-0.45R)
- Opposite SHORT 6/12 (< 8 threshold per rule)
- Held per discipline awaiting 14:00 close confirmation

### C686 13:52 UTC — **BTC BROKE 75000, Claude override EXIT**

- BTC **74968** (-115 от C685), third test FAILED
- BTC slope3 0.35 → **-1.19** (decisively bearish)
- ETH **2302.68** — broke below rule #6 line 2305
- Position -$419 (-0.67R) — only 5.68 pts to SL
- **Claude override per CLAUDE.md**: HOLD rule said wait (opposite 7/12 < 8/12 formal threshold) but judgment override on:
  1. BTC third-test-fail = classic SMC bearish structural break
  2. Price below pre-committed rule #6 line
  3. Thesis driver (BTC bull regime) fully broken
  4. EV favors exit (-$419 realized vs ~-$625 SL projected)
- Exit via `execute.ts close --reason narrative_shift`

## Close Summary

**Exit**: market close both accounts @ ~2302.5 (50k + 200k)
**Realized**: combined ~-$482 (~-0.77R net after fees)
**Duration**: 36 min (fill к close)
**Result**: loss — 5th trade of day
**Day P&L swung**: +$177 morning peak → **-$305 (-0.12%) day net**

## Immediate Takeaway

Classical BTC-correlated alt-LONG failure. ETH setup was technically valid 9/12 at entry, but:
- Entry timing within 30 min of BTC starting roll-over
- MTF=0 (4H RSI 49 borderline) was the weak link — when BTC broke support, ETH had no independent strength
- Hold discipline правильно применён через первые 3 stress cycles (saved от premature exit)
- Final override correct — BTC 75000 break was structural, не noise

**Lesson candidate**: when entering LONG at 9/12 with MTF=0 (4H not clearly up), set tighter invalidation at BTC key structural level (75000 here) — рассматривать раннее exit если BTC тестирует структуру 3+ раз в течение позиции без decisive break up.

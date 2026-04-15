# Swing Trading Methodology
**Date:** 2026-04-06
**Sources:** Brian Pezim & Andrew Aziz "How To Swing Trade", Andrew Aziz "How to Day Trade for a Living", crypto-specific research

---

## Overview

Swing trading captures multi-day to multi-week price moves using technical structure and momentum. Unlike day trading (intraday, all positions closed by EOD), swing trading holds positions through market noise and benefits from larger trending moves. This document synthesizes methodology from Pezim/Aziz's work with crypto-specific adaptations for algorithmic implementation.

---

## Timeframe Selection for Crypto

### Why 1H-4H Is Optimal for Crypto Swing Trading

Crypto markets trade 24/7 without session-based resets, which changes the timeframe calculus relative to stocks. The 4H and 1H timeframes hit the sweet spot for three reasons:

**1. Signal quality vs. noise ratio.** The 15M chart contains excessive microstructure noise — wicks from liquidations, order book imbalances, and retail stop hunts that produce false signals. The 4H chart filters this noise but retains actionable swing structure. The 1H sits between: enough detail for precise entry timing, not so granular that every candle requires a decision.

**2. Alignment with institutional order flow.** Major crypto market participants (exchanges, funds, OTC desks) operate on 4H and daily timeframes. Key OBs, FVGs, and liquidity zones form on these higher timeframes. Trading in alignment with their structure produces better hit rates.

**3. Volatility compatibility.** BTC ATR on 4H typically ranges 0.8-1.5% of price. This is wide enough for a trailing stop to breathe (2-3x ATR = 1.6-4.5% stop) and narrow enough to deliver meaningful R:R. On 15M, ATR of 0.1-0.3% makes stop placement extremely sensitive to execution timing.

### Recommended Timeframe Hierarchy

```
Daily (1D)   → Macro bias: bull/bear structure, major S/R zones
4H           → Trend direction, OB/FVG identification, setup qualification
1H           → Entry trigger confirmation, structure entry zone
15M          → Entry precision, limit order placement (LTF refinement)
```

The daily establishes context. The 4H defines the swing setup. The 1H confirms the entry. The 15M refines the exact price level for the limit order. This layered approach (top-down) is central to Pezim's methodology — trade in the direction of the bigger picture, enter on the smaller picture.

### Session Awareness in 24/7 Markets

Even without formal sessions, crypto has de facto activity windows:
- **London open (08:00-10:00 UTC):** Significant order flow, often breaks Asian range
- **NY open (13:00-15:00 UTC):** Highest volume, most reliable breakouts
- **Asian session (00:00-07:00 UTC):** Low liquidity, choppier price action, weaker signals

For algorithmic swing entries: weight signals during London/NY windows higher. Flag setups that form exclusively in Asian session as lower confidence.

---

## Trend Identification for Swing Trades

### Structure-Based Trend Definition (Pezim's Approach)

Pezim defines trend through price structure, not indicator direction. The rules:

**Uptrend (Bullish Bias):**
- Price forms consecutive Higher Highs (HH) and Higher Lows (HL)
- Each pullback finds support above the previous HL
- EMA20 > EMA50, both sloping upward
- Price above EMA200 (confirms macro bull)

**Downtrend (Bearish Bias):**
- Price forms consecutive Lower Highs (LH) and Lower Lows (LL)
- EMA20 < EMA50, both sloping downward
- Price below EMA200

**Range / No Trend:**
- Price oscillating between defined S/R without structure progression
- EMA20 and EMA50 flattening and intertwining
- Action: wait for breakout, do not swing trade inside ranges

### Algorithmic Trend Detection Criteria

For programmatic implementation, a 4H uptrend is confirmed when ALL of the following are true:
1. `close > EMA(50, 4H)` — price above 50 EMA
2. `EMA(20, 4H) > EMA(50, 4H)` — golden alignment
3. Last swing low > prior swing low (HL structure intact)
4. Last swing high > prior swing high (HH structure progressing)

A trend is flagged as weakening (reduce position size or skip) when:
- Price closes below EMA50 for 2+ consecutive 4H candles
- A HL fails (price closes below previous HL)

### Market Regime Gate

Pezim emphasizes that swing strategies fail in ranging, choppy conditions. Before entering any swing setup:
- Calculate ATR(14, 4H) / price ratio
- If ratio < 0.3%: market too quiet, skip (low probability of follow-through)
- If ratio > 4%: market too volatile/chaotic, reduce size or skip
- Optimal swing range: 0.3-2.5% ATR/price ratio

---

## Entry Triggers (Algorithmic)

Pezim identifies three core entry types. Each has distinct characteristics and algorithmic conditions.

### Entry Type 1: Pullback to Moving Average (Primary)

**Concept:** In a confirmed uptrend, price pulls back to a key EMA (20 or 50 on 4H) and finds support. This gives the best risk:reward because entry is near structure support, stop is tight relative to the move potential.

**Algorithmic Conditions (Long):**
```
1. Trend confirmed (4H uptrend per criteria above)
2. Price has pulled back to EMA20 or EMA50 on 4H (within 0.3% tolerance)
3. Bullish confirmation candle on 1H:
   - Bullish engulfing OR hammer/pin bar at EMA zone
   - Close > open, lower wick touching EMA zone
4. RSI(14, 4H) has cooled to 40-55 range (not overbought)
5. Volume on pullback candles < 20-day average (healthy, not panic)
6. Volume on reversal candle > average (confirmation)
```

**Entry:** Limit order at the EMA zone price (not market chase)
**Stop:** Below the 4H candle low that touched EMA, minus ATR(14, 4H) × 0.5
**Target:** Next swing high or 2× ATR initial target for TP1

### Entry Type 2: Breakout

**Concept:** Price consolidates near resistance (range, prior swing high), then breaks out with volume. Aziz emphasizes that the breakout itself is NOT the entry — the retest is. Chasing the initial spike is the most common breakout mistake.

**Algorithmic Conditions (Long Breakout):**
```
1. Identify consolidation zone: price ranging within 1.5% band for 5+ candles on 4H
2. Breakout confirmed: close > resistance + 0.15% (avoids false breaks)
3. Volume on breakout candle > 1.5× 20-period average
4. Wait for retest: price pulls back to former resistance (now support)
5. Confirmation on retest: bullish 1H candle closes above breakout level
6. Entry: limit at retest zone
```

**Stop:** Below retest candle low, below the former resistance zone (if it fails, trade is invalid)
**Target:** Measured move from consolidation range height (project upward from breakout)

### Entry Type 3: Reversal at Key Level

**Concept:** Price has been in a downtrend but shows exhaustion signals at major support. Higher-risk entry, requires multiple confluences. Pezim recommends this only for advanced traders — for algorithmic systems, use stricter filters.

**Algorithmic Conditions (Long Reversal):**
```
1. Price at major HTF support (4H/Daily swing low, OB zone, round number)
2. Bearish momentum divergence on RSI: price makes new low, RSI makes higher low
3. Liquidity sweep: price briefly wicks below support, then closes above it
4. Bullish CHoCH on 1H: higher high forms after series of LH/LL
5. Volume spike at the low (capitulation signal)
6. Entry: after CHoCH confirmed, limit at pullback to CHoCH breakout level
```

**Stop:** Below the sweep wick low (the absolute low of the move)
**Target:** 1.5× RR minimum; first target at 50% of the prior bearish leg

### Entry Timing and Limit Order Logic

Pezim and Aziz both stress: never market-order into a swing setup. The best entries are limit orders placed at pre-calculated levels. For algorithmic implementation:

1. Calculate entry zone on candle close (not mid-candle)
2. Place limit order at the zone — if price doesn't reach it, the trade simply doesn't execute
3. Set limit order expiry: 4-8 candles (if price moves away without returning, the setup is stale)
4. Cancel stale orders automatically when price makes a new structure break in the opposite direction

---

## Stop Loss Strategies

### ATR-Based Stop Placement

Pezim uses ATR as the core tool for stop sizing. The principle: stop must be wide enough to survive normal price oscillation but tight enough to define risk precisely.

**For swing trades on 4H:**
```
Initial Stop = Entry Price - (ATR(14, 4H) × multiplier)

Multiplier by market condition:
  Low volatility (ATR/price < 0.5%): multiplier = 1.5
  Normal volatility (ATR/price 0.5-1.5%): multiplier = 2.0
  High volatility (ATR/price > 1.5%): multiplier = 2.5-3.0
```

**For crypto specifically:** Use ATR(14) on the same timeframe as the entry. ATR(21) is recommended for swing traders holding 3-10 days, as it captures a more complete volatility picture.

### Structure-Based Stop Placement (Preferred)

The more precise method is structure-based: place stop below the last significant swing low (for longs) that would invalidate the trade thesis.

```
Long entry at EMA pullback:
  Stop = low of the pullback candle - buffer
  buffer = min(ATR × 0.3, 0.2% of price)
  
Long entry at breakout retest:
  Stop = below former resistance zone (now support)
  If support is wide: stop at bottom of zone - buffer

Reversal entry:
  Stop = below liquidity sweep wick low - buffer
```

**Rule:** Structure stop is always preferred over pure ATR stop. If structure stop implies > 3% loss (HyroTrader limit), reduce position size to bring dollar risk within limit, or skip the trade.

### Stop Management After Entry

After a swing position is entered, stop moves follow a structured protocol:

1. **Initial stop:** placed immediately at entry, server-side (Bybit SL)
2. **Break-even move:** after TP1 hit (50% position closed), move stop to entry + fees
3. **Trailing phase:** on remaining 50%, trail stop using ATR or structure
   - Trail method A (ATR): stop = highest close - ATR(14, 4H) × 2.0
   - Trail method B (structure): stop below last confirmed HL on 4H

**Never** move stop further from entry. Stop moves in one direction only: toward entry, then beyond.

---

## Take Profit and Trailing Stops

### Fixed R:R vs. Trailing — The Trade-off

The core tension in swing trading exits:

| Approach | Win Rate Impact | Avg Winner | Suits |
|---|---|---|---|
| Fixed TP only (e.g., 2R) | Higher WR (exits before reversal) | Capped | Choppy markets |
| Trailing stop only | Lower WR (stopped out on pullbacks) | Uncapped | Strong trending |
| Hybrid (TP1 fixed + trail) | Balanced | Good in both | Most conditions |

Pezim recommends the **hybrid approach** for swing trades. Aziz uses fixed targets in day trading because holding time is limited, but for multi-day swings, partial exit + trailing captures trend extension.

### Hybrid Exit Protocol

```
Entry: 100% position

TP1 (50% close): fixed at 1.5-2.0R from entry
  - R = entry to stop distance
  - TP1 = entry + (R × 1.5)
  After TP1: move stop to break-even

TP2 (remaining 50%): trailing stop
  - Trail A: highest close - ATR(14, 4H) × 2.0
  - Trail B: below most recent 4H HL
  Trail activates AFTER TP1 is hit

Maximum hold: 10-15 trading days (for crypto, 10 days)
  - If no exit triggered by day 10, close at market
  - Time stop prevents open losses compounding
```

### ATR Trailing Stop — Specific Crypto Settings

For BTC/major pairs on 4H:
- Period: ATR(14) — responsive to recent volatility
- Multiplier: 2.0 in normal conditions, 2.5 in high-volatility regimes
- Update: recalculate on each 4H candle close, not tick-by-tick

For higher-beta alts (SOL, ETH):
- Period: ATR(14)
- Multiplier: 2.5-3.0 (wider — alts have bigger retracements within trends)
- Never trail with multiplier < 2.0 on alts (you will be stopped out constantly)

### Take Profit Level Identification

When there is no obvious structure target, Pezim uses measured move projection:
```
Consolidation height = resistance - support
TP target = breakout level + (consolidation height × 1.0)

Example:
  Consolidation: $95,000 - $97,000 (height $2,000)
  Breakout: $97,000
  TP target: $99,000
```

For SMC-based trades (our system), TP targets are set at:
1. Next unmitigated bearish OB above price (for longs)
2. Liquidity pool (equal highs, buyside liquidity)
3. FVG zone above price
4. Previous major swing high

---

## Position Management

### Position Sizing Formula

Pezim's universal formula (independent of asset):
```
Position Size = (Account Risk $) / (Entry Price - Stop Price)

Account Risk $ = Account Balance × Risk% Per Trade
Risk% Per Trade = 1-2% for swing trades (Pezim recommends 1-1.5%)

Example ($10,000 account, 1% risk, entry $95,000, stop $93,500):
  Account Risk = $10,000 × 1% = $100
  Stop Distance = $95,000 - $93,500 = $1,500 (1.58%)
  Contracts = $100 / $1,500 = 0.067 BTC
  With 5x leverage: $100 margin covers $500 risk but position is $6,350 notional
```

**Note for our system:** HyroTrader constrains max SL loss to 3% of account. Our 22.5% position size at 5x leverage means we must ensure stop distance < 3% / (22.5% × 5) = 2.67% of entry price.

### Scaling Into Positions

Pezim allows adding to winners but prohibits adding to losers. Scaling in protocol:
```
Entry 1 (Initial): 60% of planned position
  - Enter at primary signal (EMA touch, breakout retest)
  
Entry 2 (Add): 40% of planned position
  - Condition: TP1 not yet hit, price consolidates above entry (pullback < 0.5% below E1)
  - New stop: recalculate to keep TOTAL risk unchanged
  - Do NOT add if: trade is in drawdown vs. initial entry

Rule: combined dollar risk of all adds must equal original planned risk
  (i.e., reducing add size compensates for higher entry price)
```

### Scaling Out (Partial Exits)

Three-unit approach for structured exits:
```
Unit 1 (33%): exit at TP1 = 1.5R  → lock in profits, fund the trade
Unit 2 (33%): exit at TP2 = 2.5-3R or structure target
Unit 3 (34%): trail with ATR stop — let it run until stopped
```

After each unit exit: recalculate and log remaining risk exposure.

### Portfolio-Level Position Management

For multi-pair trading (our expansion scenario):
- **Maximum open positions:** 5 (one per pair)
- **Maximum correlated exposure:** if BTC and ETH both in long, treat as 1.5× BTC equivalent risk
- **Portfolio heat:** total unrealized risk across all open positions ≤ 6% of account
- **Correlation gate:** do not open new long on an alt if BTC is in active drawdown (>1.5% from entry)

---

## Risk Management Rules

### The 2% Rule (Pezim / Industry Standard)

Never risk more than 2% of total account on a single trade. For swing trading specifically, Pezim recommends 1-1.5% because:
1. Holding multi-day means larger stop distances → 2% risk with large stops = big position
2. Overnight gaps can blow through stops (gap risk)
3. Fewer trades per week means each loss has larger psychological impact

**Our constraint (HyroTrader):** 3% max per trade. Pezim's 1.5% is more conservative and appropriate.

### Daily and Portfolio Loss Limits

```
Daily stop-out: if daily realized + unrealized loss > 2.5% of account, stop trading for the day
Weekly review: if week loss > 5% of account, reduce position size by 50% for following week
Max drawdown: if account drops 8% from peak, halt all new positions, review strategy
  (Buffer before HyroTrader's 10% hard limit)
```

### Consecutive Loss Protocol (Aziz)

Aziz introduces the "trading down" rule from day trading, applicable to swing trading:
```
After 2 consecutive losses: reduce position size to 50% for next 3 trades
After 4 consecutive losses: stop trading for 24 hours, review last 4 trades
After 6 consecutive losses in a week: halt for 72 hours, full strategy review
```

The logic: consecutive losses signal either strategy is broken, market conditions changed, or trader psychology is degraded. All three require a pause, not increased aggression.

### Correlation Risk

A critical risk management factor specific to crypto:
- BTC, ETH, SOL, and most altcoins are highly correlated (0.7-0.9 during risk-off)
- 3 simultaneous longs in correlated assets is NOT 3× diversification — it's 1× concentration
- **Rule:** Net directional exposure (longs - shorts) must not exceed 2 "BTC-equivalent" units
- During BTC dumps > 5% in 4H: immediately re-evaluate all alt longs

### Funding Rate Filter

For crypto perpetuals, swing trading has an additional cost: funding rates.
- Funding charged every 8 hours (Bybit)
- Positive funding (longs pay): holding 3-day long swing costs ~0.1-0.5% in funding
- **Rule:** Skip new swing longs when 8H funding rate > 0.05% (signal of overleveraged market)
- Factor funding cost into R:R calculation for trades planned to hold > 2 days

---

## Day Trading vs Swing Trading for Crypto

### Core Comparison

| Dimension | Day Trading (Aziz) | Swing Trading (Pezim) |
|---|---|---|
| Holding period | Minutes to hours (intraday only) | 1-10+ days |
| Timeframes used | 1M, 5M, 15M | 4H, 1H, Daily |
| Trades per week | 10-50 | 2-8 |
| Avg target per trade | 0.5-2% | 5-15% |
| Stop distance | 0.2-0.8% | 1.5-4% |
| Time monitoring required | Full-time (hours per session) | 1-2 hours/day |
| Overnight risk | None (positions closed) | Present (gaps, news) |
| Slippage/fees impact | Critical (many trades) | Low (few trades) |
| Pattern day trader rule | Applies (stocks, $25k min) | Does not apply |
| Capital requirements | Higher (PDT rule in stocks) | Lower |
| Win rate needed | 55-65% (small edges compound) | 45-55% (larger RR compensates) |

### Aziz's Day Trading Methodology vs Swing

Aziz's day trading focuses on:
1. **ABCD Pattern:** A (breakout high) → B (consolidation) → C (pullback to support) → D (new high above A). Entry at C, targeting D.
2. **Bull Flag Momentum:** rapid move (flag pole), then tight consolidation (flag), breakout entry
3. **VWAP Reclaim:** price drops below VWAP, reclaims it with volume → long entry at VWAP

These patterns are 5-15M chart patterns. They resolve in hours. Swing trading analogs exist on 4H-Daily charts but have entirely different stop/target geometries.

**Critical difference for crypto bots:**
- Day trading requires sub-second execution logic (price can move through target before fill)
- Swing trading can use limit orders set in advance — entire entry/exit plan placed before price arrives

### Why Swing Trading Is Better for Our Bot

1. **Execution complexity:** swing trades use pre-placed limit orders at calculated levels. Day trading requires real-time orderbook reaction — much harder to automate reliably.

2. **Signal quality:** SMC patterns (OB, FVG, CHoCH) are more reliable on 4H-1H timeframes. False signals are 3-5× more frequent on 15M and below.

3. **Fee efficiency:** at 0.02-0.06% per fill, a 5-trade day trading session costs 0.1-0.3% in fees. A swing trade lasting 3 days costs the same or less and targets 5-10× more profit.

4. **HyroTrader compliance:** the 10-day minimum trading day requirement and consistency rule (no trade > 40% of total profit) align better with swing trading frequency (steady distribution of trades).

5. **Infrastructure requirements:** day trading demands co-location or very low-latency connections. Swing trading on 4H candle closes allows standard VPS execution with no latency sensitivity.

6. **Psychological/operational stability:** an automated swing bot has defined moments of activity (candle closes). Day trading bots require continuous monitoring and logic for flash crashes, micro-crashes, and liquidity gaps.

### When Day Trading Methodology Applies to Our System

Even in a swing trading bot, Aziz's concepts apply to entry refinement:
- **VWAP:** use VWAP on 1H to find the fair value zone within a 4H pullback
- **Volume analysis:** Aziz's volume spike confirmation (volume > 1.5× average on breakout) directly applies to our volume indicator
- **Momentum confirmation:** Aziz's "never enter against the 5M trend" translates to "never enter a 4H long if 1H structure is still bearish" — same multi-TF logic

---

## Actionable Insights for Our Bot

### 1. Implement HTF Trend Gate as Hard Filter

Before any entry signal is processed, the analyzer must confirm:
```typescript
const trendGate4H = (
  ema20_4H > ema50_4H &&        // golden alignment
  close_4H > ema50_4H &&        // price above trend EMA
  lastSwingLow > prevSwingLow   // HL structure intact
);
if (!trendGate4H) return null;  // no trade in downtrend or range
```

This alone eliminates the majority of losing trades in ranging/counter-trend conditions.

### 2. Replace Pure 15M Confluence with 4H-1H-15M Cascade

Current system: all confluence calculated on 15M.
Recommended upgrade: qualify on 4H/1H first, then refine entry on 15M.

```
Step 1: 4H scan (runs on 4H candle close, ~6× less frequent)
  - Trend gate passes?
  - OB/FVG present within 0.5% of current price?
  → If yes: "setup candidate" flagged

Step 2: 1H confirmation (runs on 1H candle close for flagged setups)
  - Bullish structure on 1H (CHoCH or BOS)?
  - RSI 35-55 (not overbought)?
  → If yes: "entry zone active"

Step 3: 15M precision (for active entry zones only)
  - Current confluence score ≥ 70?
  → Place limit order at calculated level
```

### 3. Add Time-Based Stop (Time Exit)

Pezim's rule: if a swing trade doesn't move in 5-7 days, exit at market. Stale trades tie up capital and often result in losses.
```typescript
const MAX_SWING_HOLD_DAYS = 8;
if (daysSinceEntry >= MAX_SWING_HOLD_DAYS && positionPnl < 0.5 * R) {
  closePosition('TIME_STOP');
}
```

### 4. Implement Consecutive Loss Circuit Breaker

Based on Aziz's trading-down rule:
```typescript
if (consecutiveLosses >= 3) {
  positionSizeMultiplier = 0.5;
}
if (consecutiveLosses >= 5) {
  haltTrading(72 * 60 * 60 * 1000); // 72 hour halt
  sendTelegramAlert('CIRCUIT_BREAKER: 5 consecutive losses, 72h halt');
}
```

### 5. Fund Rate Filter for Multi-Day Positions

```typescript
const fundingRate8H = await getBybitFundingRate(symbol);
if (Math.abs(fundingRate8H) > 0.0005) { // 0.05%
  // factor cost: 3 days = 9 payments = 0.45% additional cost
  // reduce TP targets or skip if R:R < 2.0 after funding adjustment
  if (adjustedRR < 2.0) return null; // skip trade
}
```

### 6. Align Scanning with High-Volume Windows

Add session filter to reduce false signals from Asian session noise:
```typescript
const utcHour = new Date().getUTCHours();
const isHighVolumeWindow = (
  (utcHour >= 7 && utcHour <= 11) ||   // London open
  (utcHour >= 13 && utcHour <= 17)      // NY open
);
// Weight confluence score: +5pts if signal in high-volume window
// -5pts if signal formed exclusively in 00-07 UTC
```

### 7. Calibrate ATR Multipliers Per Pair

Do not use universal ATR multipliers:
- BTC: stop ATR × 1.5-2.0, trail ATR × 2.0
- ETH: stop ATR × 2.0, trail ATR × 2.5 (higher beta)
- SOL: stop ATR × 2.5, trail ATR × 3.0 (highest volatility among targets)
- These should be stored in `strategies/{SYMBOL}.json` as `slAtrMultiplier` and `trailingAtrMultiplier`

### 8. Maximum Portfolio Heat Check

Before each new trade execution:
```typescript
const portfolioHeat = openPositions.reduce((sum, pos) => {
  return sum + pos.distanceToStop * pos.size;
}, 0) / accountBalance;

if (portfolioHeat > 0.06) { // 6% total at-risk
  return null; // no new positions until existing ones move in our favor
}
```

### 9. Breakout Entry — Wait for Retest Logic

Current system may enter on initial breakout candle. This is a common mistake (Aziz, Pezim both stress). Add a breakout-retest state machine:

```
State 1: WATCHING — price below resistance
State 2: BROKEN_OUT — price closed above resistance with volume
  → set limit order 0.1% above former resistance (retest target)
  → set expiry: 8 candles
State 3: ENTRY_FILLED — limit hit on retest
  → proceed with normal SL/TP logic
State 4: EXPIRED — retest never came, limit cancelled
  → return to WATCHING
```

### 10. Anti-Chasing Rule

Hard block: if price has already moved > 1.5× ATR from the signal candle's close, cancel any pending limit order for that setup. The setup is no longer valid from a risk perspective.

```typescript
const entrySlippage = Math.abs(currentPrice - calculatedEntryPrice) / calculatedEntryPrice;
if (entrySlippage > 1.5 * atr / currentPrice) {
  cancelOrder(orderId, 'ENTRY_CHASING_PREVENTED');
}
```

---

## Summary: Key Rules for Algorithmic Swing Trading

1. **Trade WITH the 4H trend.** Never fight HTF structure.
2. **Enter at value, not momentum.** Limit orders at EMA/OB/FVG zones, never chase breakouts.
3. **Risk 1-1.5% per trade.** 2% maximum. Position size from stop distance, not conviction.
4. **Stops are structural, sized with ATR.** Place below last significant HL, buffer by ATR × 0.3.
5. **Take partial profits at 1.5-2R, trail the rest.** Hybrid exit balances WR and R:R.
6. **Time stops matter.** If a trade doesn't work in 8 days, exit.
7. **Circuit breakers prevent ruin.** 3 consecutive losses = half size. 5 = 72H halt.
8. **Session timing improves signal quality.** London/NY windows > Asian session.
9. **Funding rates are a real cost.** Factor into R:R for multi-day positions.
10. **Correlation is hidden concentration.** Multiple correlated longs = concentrated risk.

---

## References

- [Brian Pezim — How To Swing Trade (Amazon)](https://www.amazon.com/How-Swing-Trade-Brian-Pezim/dp/1726631753)
- [How To Swing Trade Overview (Shortform)](https://www.shortform.com/books/blog/how-to-swing-trade-by-brian-pezim.html)
- [Andrew Aziz — How to Day Trade for a Living (Amazon)](https://www.amazon.com/How-Day-Trade-Living-Management/dp/1535585951)
- [Andrew Aziz Day Trading Summary (TraderLion)](https://traderlion.com/trading-books/how-to-day-trade-for-a-living/)
- [Day Trading vs Swing Trading Crypto (HyroTrader)](https://www.hyrotrader.com/blog/day-trading-vs-swing-trading/)
- [4H Swing Trading Method (PriceActionNinja)](https://priceactionninja.com/the-best-4h-swing-trading-method-for-consistent-trades/)
- [ATR Stop Loss Strategy for Crypto (Flipster)](https://flipster.io/blog/atr-stop-loss-strategy)
- [Pullback Swing Trading Strategy in Crypto (Altrady)](https://www.altrady.com/blog/swing-trading/pullback-crypto-swing-trading-strategy)
- [Partial Take Profits Scaling Out (ChartingPark)](https://chartingpark.com/articles/partial-take-profits-explained-scale-out)
- [ATR Trailing Stop Strategies (LuxAlgo)](https://www.luxalgo.com/blog/5-atr-stop-loss-strategies-for-risk-control/)
- [Trend Breakout and MA Setups in Crypto (Altrady)](https://www.altrady.com/blog/swing-trading/trend-breakout-moving-average-setups-crypto-swing-trading)
- [Swing Trading Common Mistakes (ElearnMarkets)](https://www.elearnmarkets.com/school/units/swing-trading/common-mistakes-in-swing-trading)
- [The 2% Rule in Swing Trading (Defcofx)](https://www.defcofx.com/what-is-the-2-percent-rule-in-swing-trading/)
- [Scaling In and Out of Trades Guide (TradeWithThePros)](https://tradewiththepros.com/scaling-in-and-out-of-trades/)

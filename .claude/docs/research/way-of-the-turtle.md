# Way of the Turtle — Curtis Faith
**Date:** 2026-04-06
**Sources:** Original Turtle Rules (oxfordstrat.com), QuantifiedStrategies, Altrady, LiteFinance, MarketClutch, TradingBlox, Margex, TOS Indicators

---

## Background: The Bet That Launched a Legend

In 1983, commodity trader Richard Dennis made a wager with his partner William Eckhardt. Dennis believed great traders could be *taught*. Eckhardt believed trading talent was innate. To settle it, they recruited 23 ordinary people — students, a blackjack player, a game designer — and spent two weeks teaching them a complete mechanical trading system.

Five years later the group had turned $1 million of Dennis's capital into roughly $175 million.

Curtis Faith was the youngest Turtle (19 years old), the largest trader, and the most profitable. His book *Way of the Turtle* (2007) revealed not just the rules but the deeper philosophy — and crucially, *why most people who knew the rules still failed*.

The core thesis: **a complete, mechanical trading system can be taught in two weeks. The hard part is following it for two years.**

---

## The Complete Turtle System Rules

### Markets Traded

The original Turtles traded a diversified basket: US Treasury bonds, currencies (DM, Yen, Pound, Franc), metals (gold, silver, copper), energy (crude oil, heating oil), and agricultural commodities (corn, soybeans, coffee, cocoa, sugar). Diversification was not optional — it was structural to the system, because trend-following only works if you are present when the trend fires.

### Entry System 1 — 20-Day Breakout (Short-Term)

- **Long:** Enter when price exceeds the **highest high of the past 20 trading days** by at least one tick
- **Short:** Enter when price falls below the **lowest low of the past 20 trading days** by at least one tick
- **Skip Rule (critical):** If the *previous* System 1 signal in the same market and direction was a *profitable* trade, skip the current signal. Only take a System 1 entry if the last signal was a loser

The skip rule exists because after a winning breakout the market often reverts and whipsaws. The filter sacrifices some large trends (you miss the second leg) but dramatically reduces repeated false entries in choppy conditions.

### Entry System 2 — 55-Day Breakout (Long-Term)

- **Long:** Enter when price exceeds the **highest high of the past 55 trading days**
- **Short:** Enter when price falls below the **lowest low of the past 55 trading days**
- **No skip rule.** Every 55-day breakout is taken regardless of what the prior signal did
- Fewer signals, larger average winner, more survivable drawdown periods

### Exit Rules

| System | Long Exit | Short Exit |
|--------|-----------|------------|
| System 1 | 10-day low | 10-day high |
| System 2 | 20-day low | 20-day high |

Exits are hit-based, not limit orders. The moment price *touches* the exit level, the position is closed at market. This is intentional — the Turtles accepted slippage because a delayed exit can turn a small loss into a catastrophic one.

### Why Exits Matter More Than Entries

Curtis Faith's research showed that the exit rules generate more edge than the entries. The asymmetric 20-entry/10-exit pairing means you stay in trends long enough to capture the fat tail, but get out fast when the trend breaks. Changing this ratio — tightening exits to "lock in profits" — systematically destroys the positive expectancy.

---

## Position Sizing with ATR (The N System)

This is the intellectual core of the Turtle system and the most directly applicable to our bot.

### Defining N

N (which modern traders call ATR) is the **20-day exponential moving average of the True Range**.

```
True Range = max(
  high - low,
  |high - previous_close|,
  |low - previous_close|
)

N = 20-day EMA of True Range
```

N represents the expected daily price movement of a market, accounting for gaps. It normalizes risk across completely different assets.

### The Unit — Position Size Formula

A **Unit** is the fundamental building block. Every position is expressed in Units, never in dollars or contracts directly.

The Unit is sized so that **a 1N adverse move costs exactly 1% of account equity**.

```
Dollar Value of 1N move = N × contract_point_value

Unit Size = (Account Equity × 0.01) / Dollar Value of 1N move
```

**Concrete example — Bitcoin perpetual, $100,000 account:**
```
N (ATR-20) = $2,000  (typical 2% daily range on BTC)
Dollar Value of 1N = $2,000 (because 1 BTC contract = $1 per dollar)
Unit Size = ($100,000 × 0.01) / $2,000 = 0.5 BTC per unit
```

**Why this is elegant:** When BTC is calm (ATR $1,000) you hold more contracts. When BTC is volatile (ATR $3,500) you hold fewer. Your *dollar risk per unit stays constant* regardless of market conditions. You automatically size down in high-volatility regimes and up in calm regimes — the opposite of what emotional traders do.

### N Recalculation

N is recalculated daily (or on each new bar close). As volatility expands, position sizes shrink. As volatility compresses, they grow. This self-adjusting mechanism is why the Turtle system survived the oil crises, the 1987 crash, and multiple market regimes.

---

## Pyramiding Strategy (Adding to Winners)

The Turtle system does not just enter once. It pyramids — adding additional units as the position moves in favor.

### Pyramid Entry Rules

- Add **1 additional Unit** for every **0.5N move in your favor** from the previous entry
- Maximum **4 Units per market**
- When adding a unit, raise the stop on *all previous units* to be 2N below the new entry

**Example — Long BTC, N = $2,000:**

| Unit | Entry Price | Stop (2N below entry) |
|------|-------------|----------------------|
| 1st  | $80,000     | $76,000               |
| 2nd  | $81,000 (+0.5N) | $77,000           |
| 3rd  | $82,000 (+1.0N) | $78,000           |
| 4th  | $83,000 (+1.5N) | $79,000           |

When the 4th unit is added, all previous stops are raised to $79,000. At maximum position (4 units), **total risk is approximately 8% of equity** (4 units × 2% each). This is the designed maximum heat on a single market.

### Why Pyramiding Works

Most traders pyramid incorrectly — they add to losers ("averaging down"). The Turtle system does the opposite: it adds to winners, confirming the trend. By the time all 4 units are on, the position has already proven itself with a 1.5N move (proving trend momentum). The first units are at a better price, so the blended entry is more favorable than any single entry could be.

### The Psychological Difficulty

Adding to a position that is already up feels like "buying at the top." It violates the instinct to wait for a pullback. Curtis Faith identifies this instinct as one of the primary reasons traders fail — they *intellectually* understand pyramiding but *emotionally* cannot execute it at the precise moment required.

---

## Stop Loss Placement

### Initial Stop

Every Unit is entered with a hard stop at **2N below entry** (for longs) or **2N above entry** (for shorts).

```
Long Stop = Entry Price - (2 × N)
Short Stop = Entry Price + (2 × N)
```

With Unit sizing at 1% per N, a 2N stop means **each Unit risks 2% of equity** at entry.

### Stop Adjustment Rules

1. **Never widen stops.** Once set, a stop can only move in the direction of the trade (tighten), never away.
2. **As you pyramid**, raise stops for all previous units to 2N below the *latest* entry. This locks in profits on earlier entries as the trend continues.
3. **Break-even stops.** After significant moves, some Turtles moved the first unit's stop to break-even. Curtis Faith discusses this as an optional adaptation.

### The Ratchet Effect

As a trend develops and you pyramid, stops for early units move progressively higher. By the time you have 4 units at full pyramid with BTC up $8,000, your first unit's stop might be $4,000 above your original entry — locking in profit while letting the trade run.

---

## Portfolio Heat Management

This is where the Turtle system becomes a complete *portfolio* risk system, not just a trade management system.

### The Four Tiers of Limits

The Turtles applied position limits at four nested levels:

**Level 1 — Single Market**
- Maximum: **4 Units** in any single market
- This caps single-market risk at ~8% of equity (4 units × 2% each at stop)

**Level 2 — Closely Correlated Markets**
- Maximum: **6 Units** in the same direction across closely correlated markets
- Example: crude oil and heating oil. Both react to the same supply/demand forces
- If you are 4 units long crude and 2 units long heating oil = 6 units limit reached

**Level 3 — Loosely Correlated Markets**
- Maximum: **10 Units** in the same direction across loosely correlated markets
- Example: gold and Treasury bonds (both "safe haven" but different mechanics)
- This limit prevents sector concentration

**Level 4 — Total Directional Exposure**
- Maximum: **12 Units** long OR **12 Units** short across the entire portfolio
- This is the **global portfolio heat cap**
- At 1% per N per unit, 12 units at stop = **12% equity at risk simultaneously**
- This is a hard ceiling on total portfolio exposure

### Portfolio Heat Formula

```
Portfolio Heat = Sum of (Units × 2%) across all open positions

Maximum Portfolio Heat = 12 units × 2% = 24% of equity at risk if ALL stops hit
```

In practice, 24% simultaneous stop-out is extremely rare because:
- Not all markets move against you simultaneously
- Stops get raised as trends develop (units carry profit buffer)
- Correlation limits prevent full concentration

### Why Portfolio Heat Matters for Crypto

Traditional markets in 1983 had genuine diversification — oil and bonds rarely moved together. Crypto in 2025 is different: BTC, ETH, SOL, and most alts are highly correlated, especially during risk-off events. They drop together, rally together. This means the "closely correlated" limit (6 units) is effectively the relevant limit for most crypto portfolios — not the 10-unit or 12-unit limits.

---

## Risk Management Rules — Complete Summary

### The Rule Hierarchy

1. **Never risk more than 2% per Unit** (enforced by position sizing formula)
2. **Never exceed 4 Units in one market**
3. **Never exceed 6 Units in closely correlated markets** (same direction)
4. **Never exceed 10 Units in loosely correlated markets** (same direction)
5. **Never exceed 12 Units total** in one direction
6. **Never widen a stop**
7. **Never skip a signal because you "feel" it's wrong** (unless the skip rule applies mechanically)
8. **Take every valid signal** — you cannot know which trade will be the 10R winner

### Handling Drawdowns

The Turtles were explicitly prepared for extended losing periods. Curtis Faith documents periods of 8-12 consecutive months with flat or negative returns. The system's rules during drawdowns:

- **Do not reduce position sizes faster than the formula dictates.** The formula already reduces them (ATR expands in volatile downtrends)
- **Do not stop trading.** The next big trend fires when you least expect it
- **The biggest single error Turtles made:** stopping or reducing the system after a drawdown, then watching the next major trend they missed would have recovered all losses

---

## Why the System Works — Trend Following Philosophy

### The Mathematical Foundation: Skewed Returns

Turtle Trading is a **positive expectancy system with a skewed return distribution**.

Typical statistics for a well-run Turtle system:
- Win rate: **35-45%** (less than half of trades are winners)
- Average winner: **2-4R** (average win is 2-4× the average loss)
- Average loser: **-1R** (stopped out at 2N, sometimes less due to stop raises)
- Profit factor: **1.5-2.5**

The math works because:
```
Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
           = (0.40 × 3R) - (0.60 × 1R)
           = 1.2R - 0.6R
           = +0.6R per trade
```

Over 100 trades, this produces +60R total — even though you lose 60% of individual trades.

### The Right Tail

The system is designed to capture **fat-tail events** — the rare 10R, 20R, or 50R trades that arise during major sustained trends. The 1987 crash, the 2008 oil spike, the 2020 COVID collapse, the 2020-2021 Bitcoin bull run: all of these produced massive payoffs for trend followers who were positioned and held through.

The daily structure generates mostly small losses (trends that fail quickly) and occasional large wins (trends that sustain for months). Removing or capping winners to "take profit" destroys the fat tail and turns a positive system negative.

### Market Efficiency and Trends

Trend following works because markets are **not fully efficient in the short-to-medium term**. Institutional money moves slowly — a large fund cannot exit a $1B position in one day without moving the market. This creates momentum: early movers profit as late movers pile in. The trend continues until the imbalance is fully resolved.

In crypto, this dynamic is amplified: retail FOMO creates momentum, whale accumulation creates sustained directional bias, and the absence of the fed funds rate (a floor for traditional bonds) means crypto trends can run much longer in percentage terms than equities.

---

## The Psychological Aspects — Why Most People Fail

Curtis Faith dedicates a large portion of *Way of the Turtle* to psychology, and it is arguably the most valuable section. The rules are simple. Following them is nearly impossible for most people.

### The Core Paradox

To follow Turtle rules you must simultaneously:
1. Accept that you will be wrong 55-65% of the time
2. Hold through drawdowns of 20-30% that feel permanent
3. Enter breakouts that "look extended"
4. Add to winners that "look like they should pull back"
5. Skip signals because you "know" the system rules say to skip (not because you're scared)
6. Watch the occasional 10R trade with clinical detachment — not greed, not fear

Most humans can do *some* of these. Almost no one can do *all* of them consistently under financial stress.

### The Five Psychological Failure Modes

**1. Loss Aversion (Cutting winners early)**
After a trade is up 1.5R, the brain treats this as "real money" and desperately wants to lock in the gain. The 10-day low exit might not trigger for another 3 weeks. Most traders exit early. They capture the common 1.5R trades but never hold through to the rare 10R trades that make the system profitable.

**2. Recency Bias (Abandoning the system after drawdown)**
After 6 losing months, traders conclude "the system is broken." They stop trading or reduce size. Then the next trend fires — exactly when the system was most likely to recover — and they miss it. Curtis Faith describes this as the single most common Turtle failure mode.

**3. Prediction Addiction (Discretionary overrides)**
Experienced traders feel they "know" the market and can improve on the signal. They skip a valid breakout because "news is tomorrow" or "price looks overextended." Sometimes this is right. More often it misses the entry that becomes the big winner. Every discretionary skip degrades the statistical edge.

**4. Inconsistent Position Sizing (Varying risk per conviction)**
Traders size up when they "feel strongly" and size down when uncertain. This is anti-correlated with edge: strong feelings often coincide with emotional market conditions (high volatility, news events) that have worse expected returns. Uniform sizing prevents this error.

**5. Feedback Loop Distortion**
Trend following generates long periods of small losses punctuated by brief periods of large gains. The psychological experience is: "mostly losing, occasionally winning big." This is exactly backwards from what human reward systems expect. Our brains evolved to expect frequent small rewards. A system that requires months of patience is cognitively grueling in a way that cannot be fully anticipated.

### Curtis Faith's Prescription

Faith argues that the solution is not stronger willpower — it is **pre-commitment and mechanical execution**. Automate every decision that can be automated. Write down the rules. Test the rules. Trust the backtest. When the system says enter, enter. When it says hold, hold. Treat every discretionary impulse as a warning sign that emotions are interfering with process.

This is why **algorithmic implementation** is not just convenient — it is *structurally superior* to manual execution of a systematic strategy. An algorithm does not feel fear after 6 losing trades. It does not feel greed at 1.5R. It executes the system faithfully and captures the full statistical edge.

---

## Modern Crypto Adaptations

### What Changed Since 1983

The original Turtle system was designed for physical commodities and currencies in pre-electronic markets. Several structural differences apply to crypto in 2025:

**Higher volatility, higher N.** BTC's ATR is 2-4% daily versus 0.5-1% for commodities. This compresses position sizes dramatically.

**24/7 markets.** No "overnight risk" premium. Gaps are smaller relative to volatility. The ATR formula works, but needs to account for weekend moves.

**Higher correlation.** In a risk-off event, BTC, ETH, SOL, and most alts fall simultaneously. The "loosely correlated" category barely exists in crypto. Treat all major alts as closely correlated to BTC (6-unit limit applies).

**Shorter trends, more noise.** Crypto trends operate on shorter cycles than commodity super-cycles. A modified entry lookback of 10-20 days (from 20-55) may be more appropriate for 15M timeframes.

**Higher funding costs.** Perpetual funding rates can eat into trend-following returns, especially in extended longs. This is a drag that did not exist for the original Turtles.

### Modern Adaptations (Proven)

**1. Shorter lookback periods.** The 55-day system maps to approximately 3,960 15M candles. For intraday crypto trading, an equivalent "long-term system" might be 5-10 day highs/lows on 15M bars.

**2. Volatility regime filter.** When ATR/price > 2× its 20-period average, reduce position sizes by 50%. This prevents oversizing during volatility spikes (crypto flash crashes, major news events).

**3. Trend filter (Faith's own adaptation).** Use a 25/350-period EMA crossover. Only take longs when fast EMA > slow EMA. Only take shorts when fast EMA < slow EMA. This filter removes counter-trend entries that are statistically weaker.

**4. Funding rate filter.** Avoid adding to longs when funding > 0.05% per 8 hours. Sustained high funding is a crowded-trade signal and a direct cost on the position.

**5. Correlation matrix with dynamic limits.** Rather than fixed correlation buckets (closely/loosely), calculate rolling 30-day correlation between all active pairs. Pairs with correlation > 0.7 are "closely correlated" and share the 6-unit equivalent limit.

**6. Time-based exits.** Curtis Faith's own research (post-Turtle) found that time-based exits outperform breakout exits in modern markets. If a position is not profitable after X bars, exit regardless of the stop. This reduces the cost of false breakouts in choppy conditions.

---

## Actionable Insights for Our Bot

The Turtle system's most directly applicable concepts for our multi-pair SMC bot:

### 1. ATR-Based Position Sizing (Direct Application)

Our current system uses a fixed 22.5% of balance as margin. The Turtle approach suggests making position size **dynamic based on ATR**:

```typescript
// Turtle-style unit sizing
function calcUnitSize(
  accountEquity: number,
  atr: number,           // N — 20-period ATR in price terms
  riskPerUnit: number,   // 0.01 = 1% of equity per unit
): number {
  const dollarRiskPerUnit = accountEquity * riskPerUnit;
  const dollarValueOf1N = atr; // for perpetuals: ATR in USDT directly
  return dollarRiskPerUnit / dollarValueOf1N;
}
```

During high-volatility regimes (BTC ATR 4%), this automatically reduces position size. During calm regimes (ATR 1.5%), it increases size. This adaptive sizing is more robust than a fixed percentage.

### 2. Portfolio Heat Cap (Direct Application)

Our multi-pair system needs a **global risk cap**. The Turtle 12-unit / 24% max heat translates directly:

```
For 5 pairs, max 1 position per pair:
  Each position risks ≤ 2% at stop
  Maximum portfolio heat = 5 × 2% = 10% if all stops hit simultaneously

Given crypto correlation (treat all as "closely correlated"):
  Apply 6-unit equivalent limit = max 3 active positions simultaneously
  Even if 5 pairs have signals, only open the 3 highest-scoring
```

This is a concrete rule: **never have more than N active positions where N × max_risk_per_position ≤ your maximum acceptable total drawdown**.

### 3. Stop Loss at 2N (Direct Application)

Our current SL uses `OB.low - ATR × 1.5`. The Turtle prescription is `entry - 2N`. For our SMC system, these are compatible:

- OB.low is a structural level (Turtle would recognize this as a meaningful stop location)
- `ATR × 1.5` vs `ATR × 2.0`: consider widening our SL slightly to give positions more room
- The 2N stop matches approximately 2% equity risk per unit — which aligns with HyroTrader's 3% SL max

### 4. Never Cut Winners Early (Critical Warning)

Our current TP1 at 1.5R + trailing is correct in philosophy. The Turtle warning: **ensure the trailing stop is wide enough to hold through normal retracements**. A 0.5 ATR trailing stop will be hit on every minor pullback. The Turtles used the 10-day or 20-day low — a structural level, not an ATR-distance from high.

For our bot: the trailing stop should be `ATR × 2.0` minimum, or based on a structural level (recent swing low), not a tight percentage.

### 5. The Correlation Limit for Our Pairs

Based on our research, the BTC/ETH/SOL correlation matrix:
- BTC-ETH: 0.85-0.92 (closely correlated)
- BTC-SOL: 0.75-0.85 (closely correlated)
- ETH-SOL: 0.78-0.88 (closely correlated)
- BTC-LINK/ARB/etc: 0.65-0.80 (varies)

**Practical rule derived from Turtle framework:**

```
Max simultaneous active positions = 3 (not 5)
If 4+ pairs signal simultaneously, take the 3 with highest confluence scores
Never open a new position if portfolio heat ≥ 8% (4 × 2%)
```

### 6. The Skip Rule Equivalent for Our SMC System

System 1's skip rule (skip if last signal was profitable) has an SMC analogue: **skip a new entry at an Order Block that was already fully tested in the last 20 bars**. An OB that has already attracted price back and held once is stronger; an OB being tested for the third time is weaker. This is essentially the OB mitigation concept already in our strategy, validated by Turtle research.

### 7. Psychological Architecture — Why Algo is Mandatory

The Turtle experiment proved that even humans who *knew* the rules still failed due to psychological failure modes. Our algorithmic implementation eliminates:

- Fear-based early exits (the bot holds to the trailing stop, not to "comfort level")
- Recency bias abandonment (the bot takes every valid signal regardless of recent performance)
- Conviction-based oversizing (position size is always formula-driven)
- Prediction overrides (if score ≥ 70, enter — no human discretion)

**This is not a feature. It is the core architectural advantage of our system.**

### 8. Handling Extended Drawdowns

The Turtle framework has explicit rules for drawdown periods that we should encode:

```typescript
// Turtle-inspired drawdown management
const DRAWDOWN_RULES = {
  // Reduce position size but never stop trading
  mild_dd_pct: 0.05,      // 5% from peak: reduce unit size by 20%
  moderate_dd_pct: 0.08,  // 8% from peak: reduce unit size by 40%
  severe_dd_pct: 0.10,    // 10% from peak: HyroTrader hard stop (IMMUTABLE)

  // Never stop generating signals — only size reduction
  // The next trade might be the recovery trade
};
```

The key insight: **drawdown should reduce position size, not stop signal generation**. The system keeps finding valid setups; we just take smaller positions until equity recovers.

---

## Summary: The Turtle Principles Ranked by Applicability

| Principle | Applicability to Our Bot | Action Required |
|-----------|--------------------------|-----------------|
| ATR-based position sizing | HIGH — direct formula | Implement dynamic unit sizing alongside fixed % |
| Portfolio heat cap (12-unit equivalent) | HIGH — multi-pair critical | Hard cap: max 3 active positions, heat ≤ 8% |
| 2N stop loss | HIGH — maps to our SL calc | Widen SL to ATR × 2.0 minimum |
| No early exits (hold to trailing) | HIGH — already planned | Ensure trailing distance ≥ ATR × 2.0 |
| Correlation limits | HIGH — all alts correlated | Enforce 3-position maximum simultaneously |
| Pyramiding (add to winners) | MEDIUM — complex for prop firm | Possible within HyroTrader size limits |
| Skip rule (avoid retesting same OB) | MEDIUM — maps to OB mitigation | Already in strategy, strengthen filter |
| Time-based exits | LOW — use structural exits instead | Research separately |
| Trend filter (EMA 25/350) | MEDIUM — add to MTF analysis | Consider as market regime filter |

The Turtle Trading System, at its core, is a complete answer to the question: *how do you systematically extract money from markets without predicting the future?* The answer: position size correctly, let winners run, cut losers mechanically, diversify across uncorrelated opportunities, and never let psychology override process. These principles are as valid for a crypto perpetual futures bot in 2026 as they were for a commodity trader in 1983.

---

*Sources:*
- [Original Turtle Rules PDF (oxfordstrat.com)](https://oxfordstrat.com/coasdfASD32/uploads/2016/01/turtle-rules.pdf)
- [Turtle Trading Strategy — QuantifiedStrategies](https://www.quantifiedstrategies.com/turtle-trading-strategy/)
- [Position Sizing in Turtle Trading — QuantifiedStrategies](https://www.quantifiedstrategies.com/position-sizing-in-a-turtle-trading-system/)
- [Mastering Turtle Trading — Altrady](https://www.altrady.com/blog/crypto-trading-strategies/turtle-trading-strategy-rules)
- [Turtle Trading Rules — LiteFinance](https://www.litefinance.org/blog/for-beginners/trading-strategies/turtle-trading-strategy/)
- [Quantitative Precision: Position Sizing — MarketClutch](https://marketclutch.com/quantitative-precision-original-turtle-trading-rules-for-position-sizing/)
- [Turtle System Rules — TradingBlox](https://www.tradingblox.com/Manuals/UsersGuideHTML/turtlesystem.htm)
- [Modern Turtle Trading Strategy — TOS Indicators](https://tosindicators.com/research/modern-turtle-trading-strategy-rules-and-backtest)
- [Turtle Trading in Crypto — TradeSanta](https://tradesanta.com/blog/turtle-trading-in-the-crypto-market-a-viable-strategy)
- [Turtle Trading — Margex](https://margex.com/en/blog/turtle-trading/)
- [Portfolio Heat Management — Pro Trader Dashboard](https://protraderdashboard.com/blog/portfolio-heat-management/)
- [Way of the Turtle Review — TraderLion](https://traderlion.com/trading-books/way-of-the-turtle-by-curtis-faith/)
- [Curtis Faith — QuantifiedStrategies Review](https://www.quantifiedstrategies.com/curtis-faith-the-way-of-the-turtle/)
- [Does Turtle Trading Still Work? — Turtelli](https://www.turtelli.com/insider-knowledge/turtle-trading-for-beginners/does-turtle-trading-still-work-today)

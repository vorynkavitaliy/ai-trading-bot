# RSI Advanced Strategies
**Date:** 2026-04-06
**Sources:** PMC academic study, QuantifiedStrategies, StockCharts ChartSchool, eLearnMarkets,
TradingSetupsReview, ACY Markets, Warrior Trading, CMT Association, ForexTrainingGroup, altFINS

---

## 1. RSI Fundamentals — What the Standard Approach Gets Wrong

The default RSI(14) with 30/70 levels is heavily overused and misunderstood. Key insight from
Constance Brown's *Technical Analysis for the Trading Professional*: RSI does NOT oscillate
between 0 and 100 uniformly. It operates in regime-dependent ranges that shift with market
conditions. Treating 30 and 70 as universal levels produces false signals in trending markets.

Three foundational improvements over the standard approach:
1. **Range rules** — adjust overbought/oversold levels to market regime
2. **Failure swings** — Wilder's own preferred signal (ignored by most traders)
3. **Divergence classification** — regular (reversal) vs. hidden (continuation)

---

## 2. RSI Divergence Detection (Regular & Hidden)

### Conceptual Framework

Divergence occurs when price momentum and RSI momentum disagree. There are four types:

| Type | Price | RSI | Signal |
|------|-------|-----|--------|
| Regular Bullish | Lower Low | Higher Low | Reversal up |
| Regular Bearish | Higher High | Lower High | Reversal down |
| Hidden Bullish | Higher Low | Lower Low | Continuation up |
| Hidden Bearish | Lower High | Higher High | Continuation down |

**Regular divergence** = trend exhaustion signal, trade against the trend
**Hidden divergence** = pullback entry signal, trade with the trend

Hidden divergence is more reliable in trending crypto markets because it aligns with the
dominant direction rather than fighting it.

### Pivot Detection — The Foundation

All divergence detection requires confirmed pivot points on both price and RSI. A pivot is only
confirmed after N bars on each side have closed. Using unconfirmed pivots causes repainting.

```
FUNCTION is_pivot_high(series, index, left_bars, right_bars):
    FOR i = 1 to left_bars:
        IF series[index - i] >= series[index]: RETURN false
    FOR i = 1 to right_bars:
        IF series[index + i] >= series[index]: RETURN false
    RETURN true

FUNCTION is_pivot_low(series, index, left_bars, right_bars):
    FOR i = 1 to left_bars:
        IF series[index - i] <= series[index]: RETURN false
    FOR i = 1 to right_bars:
        IF series[index + i] <= series[index]: RETURN false
    RETURN true
```

Recommended parameters: `left_bars = 5`, `right_bars = 5` for 15M charts.
Higher values reduce noise but increase lag.

### Regular Divergence Detection Pseudocode

```
FUNCTION detect_regular_divergence(candles[], rsi[], config):
    left = config.pivot_left    // e.g. 5
    right = config.pivot_right  // e.g. 5
    min_gap = config.min_pivot_gap  // minimum bars between pivots, e.g. 10
    max_lookback = config.max_lookback  // how far back to search, e.g. 60

    price_lows = []
    price_highs = []
    rsi_lows = []
    rsi_highs = []

    FOR i = right to len(candles) - left:
        IF is_pivot_low(candles.low, i, left, right):
            price_lows.append({bar: i, value: candles[i].low})
        IF is_pivot_high(candles.high, i, left, right):
            price_highs.append({bar: i, value: candles[i].high})
        IF is_pivot_low(rsi, i, left, right):
            rsi_lows.append({bar: i, value: rsi[i]})
        IF is_pivot_high(rsi, i, left, right):
            rsi_highs.append({bar: i, value: rsi[i]})

    // Regular Bullish: price Lower Low + RSI Higher Low
    FOR each pair (prev_low, curr_low) in price_lows where:
        curr_low.bar - prev_low.bar >= min_gap AND
        curr_low.bar - prev_low.bar <= max_lookback:

        // Find RSI pivots in same window
        rsi_at_curr = nearest_rsi_low(rsi_lows, curr_low.bar)
        rsi_at_prev = nearest_rsi_low(rsi_lows, prev_low.bar)

        IF curr_low.value < prev_low.value AND       // price: lower low
           rsi_at_curr.value > rsi_at_prev.value:    // rsi: higher low
            SIGNAL regular_bullish_divergence at curr_low.bar

    // Regular Bearish: price Higher High + RSI Lower High
    FOR each pair (prev_high, curr_high) in price_highs:
        rsi_at_curr = nearest_rsi_high(rsi_highs, curr_high.bar)
        rsi_at_prev = nearest_rsi_high(rsi_highs, prev_high.bar)

        IF curr_high.value > prev_high.value AND     // price: higher high
           rsi_at_curr.value < rsi_at_prev.value:   // rsi: lower high
            SIGNAL regular_bearish_divergence at curr_high.bar
```

### Hidden Divergence Detection Pseudocode

```
FUNCTION detect_hidden_divergence(candles[], rsi[], config):
    // Hidden Bullish: price Higher Low + RSI Lower Low (uptrend continuation)
    FOR each pair (prev_low, curr_low) in price_lows:
        rsi_at_curr = nearest_rsi_low(rsi_lows, curr_low.bar)
        rsi_at_prev = nearest_rsi_low(rsi_lows, prev_low.bar)

        IF curr_low.value > prev_low.value AND       // price: higher low
           rsi_at_curr.value < rsi_at_prev.value:    // rsi: lower low
            SIGNAL hidden_bullish_divergence at curr_low.bar  // buy pullback

    // Hidden Bearish: price Lower High + RSI Higher High (downtrend continuation)
    FOR each pair (prev_high, curr_high) in price_highs:
        rsi_at_curr = nearest_rsi_high(rsi_highs, curr_high.bar)
        rsi_at_prev = nearest_rsi_high(rsi_highs, prev_high.bar)

        IF curr_high.value < prev_high.value AND     // price: lower high
           rsi_at_curr.value > rsi_at_prev.value:    // rsi: higher high
            SIGNAL hidden_bearish_divergence at curr_high.bar  // sell rally
```

### Quality Filters for Divergence Signals

Not all divergences are equal. Apply these filters to reduce false signals:

1. **RSI level filter**: Regular bullish divergence is strongest when RSI is below 50 (ideally
   below 40). Regular bearish is strongest above 50. Divergences at neutral RSI levels are weak.
2. **Timeframe filter**: Divergences on 1H and 4H are significantly more reliable than 15M.
   On 15M charts for crypto, require additional confluence before acting.
3. **Volume confirmation**: The second pivot (the one generating the signal) should have
   diminishing volume on price, confirming momentum exhaustion.
4. **Structure alignment**: Regular bullish divergence at a key support level is far stronger
   than in open air.

### Statistical Performance

- RSI divergence on crypto: ~65% win rate on 1H+ timeframes (backtests on BTC/USD 2024-2025)
- On 15M timeframes alone: unreliable due to crypto's high leverage environment creating
  persistent extreme readings
- Hidden divergence in trending markets: higher win rate than regular divergence because it
  trades with the trend

---

## 3. RSI Failure Swings (Wilder's Preferred Signal)

Wilder himself considered failure swings his most important RSI signal, yet most traders ignore
them entirely. They are **completely independent of price** — they rely solely on RSI structure.

### Bullish Failure Swing (Buy Signal) — 4 Steps

```
Step 1: RSI drops below 30 (enters oversold territory)
Step 2: RSI bounces back above 30
Step 3: RSI pulls back but HOLDS ABOVE 30 (does not re-enter oversold)
Step 4: RSI breaks above the high of Step 2 (the "failure swing point")
→ BUY SIGNAL on Step 4 breakout
```

The key insight: the market tried to go oversold again (Step 3 pullback) but **failed**. Bulls
are absorbing all selling pressure. The failure to make a new RSI low is the signal.

### Bearish Failure Swing (Sell Signal) — 4 Steps

```
Step 1: RSI rises above 70 (enters overbought territory)
Step 2: RSI pulls back below 70
Step 3: RSI bounces but HOLDS BELOW 70 (does not re-enter overbought)
Step 4: RSI breaks below the low of Step 2 (the "failure swing point")
→ SELL SIGNAL on Step 4 breakdown
```

### Failure Swing Detection Pseudocode

```
FUNCTION detect_bullish_failure_swing(rsi[], config):
    oversold_level = config.oversold  // 30
    state = "IDLE"
    step1_bar = null
    step2_high = null
    step2_bar = null
    step3_low = null

    FOR i = 1 to len(rsi):
        IF state == "IDLE":
            IF rsi[i] < oversold_level:
                state = "STEP1_CONFIRMED"
                step1_bar = i

        ELSE IF state == "STEP1_CONFIRMED":
            // Wait for RSI to bounce back above oversold
            IF rsi[i] > oversold_level:
                state = "LOOKING_FOR_STEP2_HIGH"

        ELSE IF state == "LOOKING_FOR_STEP2_HIGH":
            // Track the local high above oversold
            IF rsi[i] > rsi[i-1] AND rsi[i] > rsi[i+1]:  // local peak
                step2_high = rsi[i]
                step2_bar = i
                state = "LOOKING_FOR_STEP3_PULLBACK"

        ELSE IF state == "LOOKING_FOR_STEP3_PULLBACK":
            IF rsi[i] < step2_high:  // pulling back from step2
                IF rsi[i] < oversold_level:
                    // Failed — went back oversold, reset
                    state = "STEP1_CONFIRMED"
                    step1_bar = i
                ELSE:
                    // Step 3: holds above oversold
                    step3_low = rsi[i]
                    state = "LOOKING_FOR_STEP4_BREAKOUT"

        ELSE IF state == "LOOKING_FOR_STEP4_BREAKOUT":
            IF rsi[i] > step2_high:
                SIGNAL bullish_failure_swing at bar i
                state = "IDLE"
            IF rsi[i] < oversold_level:
                // Reset — failed to break out, went oversold again
                state = "STEP1_CONFIRMED"
                step1_bar = i
```

### Why Failure Swings Are Valuable

- No curve-fitting to price — purely momentum-based
- The "failure" to make new extreme is objective evidence of regime change
- Works across all timeframes (Wilder designed it for commodities, works well in crypto)
- Particularly effective after RSI has been in extended oversold/overbought territory
- Entry point is precise: the break of Step 2 level gives exact trigger price on RSI

---

## 4. RSI Range Rules (Bull vs. Bear Market)

Constance Brown's seminal contribution: RSI operates in different ranges depending on market
regime. The 30/70 interpretation is only valid in a flat/ranging market.

### Bull Market (Uptrend) Range: 40 — 80+

```
Overbought zone: 70-80 (RSI can stay here for extended periods — NOT a sell signal alone)
Support zone: 40-50 (RSI bouncing here = buying opportunity)
Below 40: anomaly in strong bull — potential trend change warning
```

**Interpretation**: In an uptrend, RSI rarely goes below 40. When it does, it's either a deep
pullback (buy) or the uptrend is ending. RSI above 70 is normal — do NOT short just because
RSI is "overbought".

### Bear Market (Downtrend) Range: 20 — 60

```
Oversold zone: 20-30 (RSI can stay here — NOT a buy signal alone)
Resistance zone: 50-60 (RSI failing here = selling opportunity)
Above 60: anomaly in downtrend — potential trend change warning
```

**Interpretation**: In a downtrend, RSI rarely gets above 60. When it does, it's either a
sharp relief rally (short) or the downtrend is ending. RSI below 30 is normal — do NOT buy
just because RSI is "oversold".

### Range Rule Implementation Pseudocode

```
FUNCTION get_rsi_levels(market_regime, base_oversold=30, base_overbought=70):
    IF market_regime == "BULL":
        RETURN {
            oversold: base_oversold + 10,   // 40
            overbought: base_overbought + 10, // 80
            support: 40,     // RSI bounce from here = long entry in bull
            midline: 55      // RSI above 55 = bullish momentum confirmed
        }
    ELSE IF market_regime == "BEAR":
        RETURN {
            oversold: base_oversold - 10,    // 20
            overbought: base_overbought - 10, // 60
            resistance: 60,  // RSI fail here = short entry in bear
            midline: 45      // RSI below 45 = bearish momentum confirmed
        }
    ELSE:  // RANGING
        RETURN {
            oversold: 30,
            overbought: 70,
            midline: 50
        }

FUNCTION determine_market_regime(candles, ema_period=200):
    // Simple approach: EMA200 relationship
    price = candles.last.close
    ema200 = calc_ema(candles, ema_period)
    IF price > ema200 * 1.02:
        RETURN "BULL"
    ELSE IF price < ema200 * 0.98:
        RETURN "BEAR"
    ELSE:
        RETURN "RANGING"
```

### Practical Application for Our Bot

The 15M timeframe RSI should be interpreted relative to the 4H regime:
- 4H above EMA200 → use bull range rules on 15M RSI
- 4H below EMA200 → use bear range rules on 15M RSI
- This prevents premature counter-trend entries

---

## 5. RSI Trendlines on the RSI Itself

RSI can be treated as a price chart — you can draw support/resistance trendlines directly on
the RSI oscillator. This technique often signals breaks before price does.

### How to Draw RSI Trendlines

**Resistance trendline**: Connect 2+ RSI peaks with a downward-sloping line
**Support trendline**: Connect 2+ RSI troughs with an upward-sloping line

### Signals

- **RSI breaks above resistance trendline** → bullish momentum shift, often precedes price breakout
- **RSI breaks below support trendline** → bearish momentum shift, often precedes price breakdown
- RSI trendline breaks that coincide with price breakouts = highest reliability

### Detection Approach

For automated detection, use linear regression on the last N RSI pivot highs (resistance) and
last N RSI pivot lows (support). A trendline break is detected when RSI crosses the projected
line value.

```
FUNCTION detect_rsi_trendline_break(rsi[], pivot_highs[], pivot_lows[], min_points=2):
    // Resistance line: regress last min_points pivot highs
    IF len(pivot_highs) >= min_points:
        slope, intercept = linear_regression(pivot_highs[-min_points:])
        projected_resistance = slope * current_bar + intercept
        IF rsi.current > projected_resistance:
            SIGNAL rsi_resistance_break  // bullish

    // Support line: regress last min_points pivot lows
    IF len(pivot_lows) >= min_points:
        slope, intercept = linear_regression(pivot_lows[-min_points:])
        projected_support = slope * current_bar + intercept
        IF rsi.current < projected_support:
            SIGNAL rsi_support_break  // bearish
```

---

## 6. Connors RSI (CRSI)

Larry Connors developed ConnorsRSI specifically for short-term mean reversion trading in
high-volatility markets. It is a composite of three components.

### Formula

```
CRSI(3, 2, 100) = (RSI(3) + RSI_streak(2) + PercentRank(100)) / 3
```

### Component 1: Price RSI — RSI(3)

Standard RSI on 3-period. Very sensitive, responds quickly to recent price action.

### Component 2: Streak RSI — RSI of Up/Down Streak, period 2

```
FUNCTION calc_streak(closes[]):
    streak = 0
    FOR i = 1 to len(closes):
        IF closes[i] > closes[i-1]:
            streak = MAX(streak + 1, 1)   // up streak: positive
        ELSE IF closes[i] < closes[i-1]:
            streak = MIN(streak - 1, -1)  // down streak: negative
        ELSE:
            streak = 0
    RETURN streak

// Then apply RSI(2) to the streak series
streak_series = calc_streak(closes)
streak_rsi = calc_rsi(streak_series, period=2)
```

A streak of -5 (5 consecutive down closes) will push streak RSI near 0 — extreme oversold.
A streak of +5 will push it near 100 — extreme overbought.

### Component 3: Percent Rank — ROC Percentile over 100 bars

```
FUNCTION calc_percent_rank(closes[], lookback=100):
    current_roc = (closes[-1] - closes[-2]) / closes[-2]  // 1-bar rate of change
    count_below = 0
    FOR i = 1 to lookback:
        historical_roc = (closes[-i] - closes[-i-1]) / closes[-i-1]
        IF historical_roc < current_roc:
            count_below += 1
    RETURN (count_below / lookback) * 100
```

This ranks the current bar's price change among the last 100 bars. A percentile of 5 means
95% of recent daily moves were larger — extremely low volatility or strong selling day.

### CRSI Trading Rules

**Oversold entry (long)**:
- CRSI < 20 → potential long setup
- CRSI < 10 → strong oversold signal
- Best entries: CRSI at 5 or below
- Require: price is above 200-period EMA (trend filter)

**Overbought exit**:
- CRSI > 70 → exit long
- CRSI > 90 → aggressive short signal

### Connors RSI Performance

- Backtested win rate: ~75% on US equities (QuantifiedStrategies)
- Works best in: high-volatility sideways/slightly trending markets
- Risk: fails badly in persistent downtrends (every dip keeps going lower)
- Mitigation: always use trend filter (200 EMA) to avoid long entries in bear markets
- Particularly relevant for crypto altcoins on shorter timeframes (15M-1H)

---

## 7. RSI + Accumulation/Distribution Confirmation (MOMOH Setup)

The MOMOH S.O. approach combines RSI momentum signals with Accumulation/Distribution (A/D)
line or volume-weighted indicators to confirm whether smart money is supporting the move.

### Core Logic

RSI gives the momentum signal. A/D or OBV confirms whether volume is supporting that momentum.

```
Strong Long Setup (A/D + RSI confirmation):
  Condition 1: RSI is oversold OR showing bullish divergence
  Condition 2: A/D line is rising (accumulation happening despite price drop)
  Condition 3: OBV is holding above its recent low even as price makes new lows
  → Smart money is accumulating. RSI oversold signal is high probability.

Strong Short Setup:
  Condition 1: RSI is overbought OR showing bearish divergence
  Condition 2: A/D line is falling (distribution — selling into strength)
  Condition 3: OBV making lower highs even as price makes higher highs
  → Smart money is distributing. RSI overbought signal is high probability.
```

### A/D Line Calculation

```
FUNCTION calc_ad_line(candles[]):
    ad = 0
    ad_series = []
    FOR each candle in candles:
        clv = ((candle.close - candle.low) - (candle.high - candle.close))
              / (candle.high - candle.low)
        // CLV: +1 = closes at high (accumulation), -1 = closes at low (distribution)
        ad += clv * candle.volume
        ad_series.append(ad)
    RETURN ad_series
```

### RSI + A/D Divergence Matrix

| RSI Signal | A/D Direction | Interpretation | Action |
|-----------|---------------|----------------|--------|
| Bullish divergence | A/D rising | Strong accumulation | High conviction long |
| Bullish divergence | A/D flat | Neutral | Weak signal |
| Bullish divergence | A/D falling | Distribution despite RSI | Avoid — false signal |
| Bearish divergence | A/D falling | Strong distribution | High conviction short |
| Oversold (RSI<30) | A/D rising | Buy the dip | Enter long |
| Oversold (RSI<30) | A/D falling | Dead cat bounce likely | Wait or skip |

---

## 8. Multi-Timeframe RSI Analysis

### The Three-Layer MTF Approach

Aligning RSI across multiple timeframes dramatically increases signal quality. When daily, 4H,
and 1H RSIs all align, reported probability of success rises to 70-80%.

```
Layer 1 (Bias): 4H RSI
  - Determine regime: above 50 = bullish bias, below 50 = bearish bias
  - Check range rules: if in bull range (40-80) or bear range (20-60)

Layer 2 (Structure): 1H RSI
  - Identify divergences at key structure levels
  - Monitor failure swings
  - Is RSI respecting the bias from Layer 1?

Layer 3 (Entry): 15M RSI
  - Trigger entry when 15M RSI gives signal ALIGNED with 4H and 1H
  - Divergences on 15M carry weight only when confirmed by 1H divergence
```

### MTF RSI Confluence Score

For our bot's existing confluence scorer, RSI contribution could be enhanced:

```
FUNCTION score_rsi_mtf(rsi_15m, rsi_1h, rsi_4h, side):
    score = 0

    // Layer 1: 4H bias alignment (0-3 points)
    IF side == LONG:
        IF rsi_4h > 50: score += 3
        ELSE IF rsi_4h > 40: score += 1  // bull range support

    IF side == SHORT:
        IF rsi_4h < 50: score += 3
        ELSE IF rsi_4h < 60: score += 1  // bear range resistance

    // Layer 2: 1H momentum (0-2 points)
    IF side == LONG AND rsi_1h was_oversold_recently AND rsi_1h > 30:
        score += 2  // recovering from oversold on 1H

    // Layer 3: 15M entry trigger (0-5 points — existing weight)
    IF side == LONG:
        IF rsi_15m < 35: score += 5
        ELSE IF rsi_15m < 50: score += 3

    RETURN score
```

### Momentum Divergence Between Timeframes

Advanced signal: when 4H RSI is oversold but 15M RSI is overbought, it signals a short-term
rally within a larger pullback. Wait for 15M RSI to cool down before entering long.

Conversely: 4H RSI in bullish range (50-70) with 15M RSI just recovering from oversold
(crossed above 30) = high-probability long entry aligned across timeframes.

---

## 9. RSI in Crypto — Optimal Period Selection

### Period Comparison for Crypto

| Period | Sensitivity | Best For | Risk |
|--------|------------|----------|------|
| RSI(7) | Very high | Scalping, 5M-15M | Many false signals |
| RSI(9) | High | Day trading, 15M-1H | Some false signals |
| RSI(14) | Balanced | Swing, 1H-4H | Standard tradeoffs |
| RSI(21) | Low | Position, Daily-Weekly | Slow, misses moves |

### Academic Evidence

A peer-reviewed study (PMC, covering 2018-2022 across 10 cryptocurrencies) found:
- Modified RSI 50-100 strategy (only entering when RSI > 50 on entry direction) delivered
  773.65% returns vs. buy-and-hold over the period
- Traditional 30/70 reversal signals alone showed inconsistent results
- Context-aware RSI interpretation consistently outperformed mechanical buy/sell at levels
- In 2023's crypto bear market, strategies that performed poorly in 2018-2022 outperformed —
  regime adaptation is essential

### Crypto-Specific RSI Behavior

1. **Extended extreme readings**: In strong crypto trends, RSI can stay above 80 or below 20
   for dozens of candles. Never counter-trend trade based on extreme RSI alone in crypto.

2. **Faster mean reversion on shorter timeframes**: RSI(7) or RSI(9) on 15M-1H captures
   crypto's fast mean reversion cycles better than RSI(14).

3. **Altcoins vs. BTC**: Altcoins have more extreme RSI readings due to lower liquidity and
   higher beta. For SOL/ETH, consider wider overbought/oversold levels (25/75 instead of 30/70).

4. **Funding rate correlation**: When RSI(14) is above 70 AND funding rate is positive and
   rising, the combination is a stronger bearish signal than either alone.

### Recommended Settings for Our Pairs

```
BTC (15M):   RSI(14), levels 35/65 (less extreme, more liquid)
ETH (15M):   RSI(14), levels 32/68
SOL (15M):   RSI(9) or RSI(14), levels 28/72 (more extreme swings)
Altcoins:    RSI(9), levels 25/75 (very reactive market)
```

For the 15M entry timeframe specifically, RSI(9) may give earlier signals while RSI(14)
gives fewer false positives. Backtest both for each pair.

---

## 10. Statistical Effectiveness in Crypto Markets

### Key Studies and Data Points

**Academic Study (PMC 2023, 10 cryptos, 2018-2022)**:
- RSI strategies with trend filter outperform pure RSI reversal strategies significantly
- Regime-adaptive RSI interpretation outperforms fixed-level interpretation
- RSI combined with trend indicators > standalone RSI

**QuantifiedStrategies Backtests (2024-2025)**:
- RSI(2) mean reversion strategy: ~91% win rate but small average gain (0.82%) — needs
  large sample size to work
- ConnorsRSI: ~75% win rate on short-term setups
- RSI divergence combined with structure: ~65% win rate on crypto 1H+

**15M Timeframe Reality Check**:
- Standalone RSI signals on 15M crypto: ~50-55% win rate (barely better than random)
- RSI + SMC structure + volume: 60-65% win rate
- RSI divergence + SMC Order Block coincidence: 65-70% win rate
- **Key insight**: RSI alone on 15M is a filter, not a standalone strategy

**Win Rate vs. RSI Period (BTC/USD 1H, 2024)**:
```
RSI(7):  more signals, WR ~55%, many noise trades
RSI(14): balanced, WR ~60% with proper filters
RSI(21): fewer signals, WR ~62%, high lag
```

### RSI + Volume Synergy

Combining RSI with volume analysis significantly improves reliability:
- RSI divergence + declining volume at pivot: WR improvement ~8-12%
- RSI oversold + A/D line rising: WR improvement ~10-15% vs. RSI alone
- The A/D rising while price falls = institutional accumulation = RSI reversal more likely

### False Signal Contexts

RSI is weakest (most false signals) in these crypto conditions:
1. News-driven pumps/dumps (ignore RSI entirely during FOMC, major crypto events)
2. Low liquidity hours (Asia session for majors — RSI levels mean less)
3. Funding rate extremes (>0.1%) — can sustain one-sided RSI readings
4. During BTC dominance shifts — alts can have RSI completely decoupled from their own trend

---

## 11. Actionable Insights for Our Bot

### Immediate Enhancements to RSI Scoring (15 pts currently)

**Current implementation**: RSI(14) with simple 35/65 levels, 5 points max
**Recommended enhancement**: Multi-dimensional RSI scoring, up to 10-12 points

```typescript
// Enhanced RSI confluence contribution
interface RSIScore {
  base: number;        // 0-5 (oversold/overbought level)
  regime: number;      // 0-2 (range rule alignment)
  divergence: number;  // 0-4 (regular or hidden divergence detected)
  failureSwing: number; // 0-3 (failure swing in progress)
  mtfAlignment: number; // 0-2 (1H and 4H RSI aligned)
  // Total max: 16 points (but cap at 10 for existing score framework)
}
```

### Priority 1: Add Hidden Divergence Detection

Hidden divergence is the highest-value addition because it confirms trend-following setups —
which is exactly what the confluence scorer needs for SMC Order Block entries:

- Long entry at OB + Hidden Bullish Divergence on 15M RSI = trend continuation confirmation
- This is MOMOH's core insight: RSI divergence validates OB entries
- Implement with `left=5, right=5` pivots, minimum 10 bars between pivots

### Priority 2: Implement Failure Swings as Bonus Signal

Failure swings are independent of price and provide objective momentum confirmation.
A bullish failure swing coinciding with a bullish OB entry = +3 bonus points in the scorer.

### Priority 3: RSI Range Rules by Regime

Add 4H EMA200 check before scoring RSI:
- In bull regime: RSI(15M) = 45 is "oversold" (near support), not neutral
- In bear regime: RSI(15M) = 55 is "overbought" (at resistance), not neutral
- This adapts the fixed 35/65 levels to market context

### Priority 4: Volume/A/D Confirmation Gate

Before accepting any RSI oversold signal as valid, verify:
- A/D line direction over last 20 candles
- If A/D is falling while RSI oversold → mark signal as LOW QUALITY
- If A/D is rising while RSI oversold → mark signal as HIGH QUALITY

### Per-Pair RSI Period Recommendations

```
BTCUSDT:  RSI(14), range 35/65 in ranging, 40/80 in bull, 20/60 in bear
ETHUSDT:  RSI(14), range 32/68 in ranging
SOLUSDT:  RSI(9) or RSI(14), range 28/72 (wider due to higher volatility)
Other alts: RSI(9), range 25/75
```

### RSI Signals to Explicitly Avoid in Crypto

1. Never short just because RSI > 70 in a strong uptrend
2. Never long just because RSI < 30 in a strong downtrend
3. On 15M timeframe, RSI divergence alone is insufficient — require SMC confirmation
4. During high funding rate environments (>0.1%), RSI overbought signals unreliable for shorts
5. During news events, disable RSI signal contribution entirely

### Integration with Existing Scorer

The current scorer gives RSI 5 points out of 100. Given its enhanced capability as a
multi-dimensional filter, a case exists for raising the cap to 10-12 points:
- Lose 5 points from EMA (reduce to 0 weight) as EMA direction is already captured by
  the regime detection needed for RSI range rules
- Redistribute those 5 points to RSI's expanded scoring
- Net: RSI goes from 5 to 10 points, EMA drops from 5 to 0

This maintains the 100-point maximum while giving RSI its full informational value.

---

## Sources

- [PMC Academic Study: Effectiveness of RSI in Timing Cryptocurrency Markets](https://pmc.ncbi.nlm.nih.gov/articles/PMC9920669/)
- [StockCharts ChartSchool: RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)
- [StockCharts ChartSchool: ConnorsRSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/connorsrsi)
- [QuantifiedStrategies: Connors RSI 75% Win Rate](https://www.quantifiedstrategies.com/connors-rsi/)
- [QuantifiedStrategies: RSI Trading Strategy 91% Win Rate](https://www.quantifiedstrategies.com/rsi-trading-strategy/)
- [eLearnMarkets: RSI Failure Swings](https://blog.elearnmarkets.com/rsi-failure-swings/)
- [eLearnMarkets: Hidden RSI Divergence](https://blog.elearnmarkets.com/hidden-rsi-divergence-for-swing-trading/)
- [ACY Markets: RSI Hidden Divergence](https://acy.com/en/market-news/education/how-to-spot-rsi-hidden-divergence-j-o-121814/)
- [CMT Association: Mastering RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly/)
- [Warrior Trading: RSI Indicator Guide](https://www.warriortrading.com/rsi-indicator/)
- [altFINS: Trading RSI and RSI Divergence](https://altfins.com/knowledge-base/trading-rsi-and-rsi-divergence/)
- [TradingSetupsReview: RSI Hidden Divergence Pullback Guide](https://www.tradingsetupsreview.com/rsi-hidden-divergence-pullback-trading-guide/)
- [MQL5: Hidden RSI Divergence with Slope Angle Filters](https://www.mql5.com/en/articles/20157)
- [ForexTrainingGroup: Ultimate Guide to ConnorsRSI](https://forextraininggroup.com/ultimate-guide-to-the-connors-rsi-crsi-indicator/)
- [Medium: Multi-Timeframe RSI Trading Strategy](https://medium.com/@FMZQuant/multi-timeframe-rsi-trading-strategy-169cc2771848)
- [MOMOH S.O: The RSI Plus Accumulation & Distribution Set Up (Amazon)](https://www.amazon.com/RSI-PLUS-ACCUMULATION-DISTRIBUTION-SET-ebook/dp/B0D2P6R71G)

# Market Trend Analysis
**Date:** 2026-04-06
**Sources:** MOMOH S.O (Market Trend Analysis, Amazon Kindle), Wyckoff Analytics, LuxAlgo SMC,
DailyPriceAction SMC, QuantStart HMM, FractalCycles Regime Detection, Elliott Wave Forecast,
John Burford (Tramline Trading, Harriman House)

---

## 1. Trend Identification Methods

### 1.1 The Fundamental Definition of a Trend

A trend is a persistent directional bias in price over time. Three states exist:
- **Uptrend:** sequence of Higher Highs (HH) and Higher Lows (HL)
- **Downtrend:** sequence of Lower Lows (LL) and Lower Highs (LH)
- **Range/Sideways:** price oscillates between roughly equal highs and lows without persistent directional progression

MOMOH S.O's core thesis is that most retail traders misidentify the "true" trend because they
react to noise (minor swings on low timeframes) rather than the dominant structural trend on
higher timeframes. The key insight: **the trend you trade on the entry timeframe must be
subordinate to and aligned with the structural trend on the higher timeframe**.

### 1.2 Swing High / Swing Low Detection

The foundation of all trend analysis is objective swing identification:

```
Swing High: candle[i].high > candle[i-1].high AND candle[i].high > candle[i+1].high
Swing Low:  candle[i].low  < candle[i-1].low  AND candle[i].low  < candle[i+1].low
```

**Improved version (N-bar lookback for noise reduction):**
```
Swing High (N=3): candle[i].high = max(candle[i-N .. i+N])
Swing Low  (N=3): candle[i].low  = min(candle[i-N .. i+N])
```

Larger N reduces false swings at the cost of lag. For 15M timeframe, N=2 or N=3 is appropriate.
For 4H structural analysis, N=3 to N=5 filters out micro-pullbacks.

### 1.3 Moving Averages for Trend Direction

Moving averages provide a smoothed approximation of trend direction. Key configurations:

| Use Case | Configuration | Signal |
|----------|---------------|--------|
| Short-term momentum | EMA 9 / EMA 21 | Bullish when 9 > 21 |
| Swing trading | EMA 20 / EMA 50 | Bullish when 20 > 50 |
| Long-term structure | SMA 50 / SMA 200 | Bullish when 50 > 200 (Golden Cross) |

**EMA vs SMA:** EMA responds faster to recent price — preferred for crypto's high volatility.
SMA provides cleaner macro structure signals on daily/weekly charts.

**Price vs MA position:** Price trading above EMA 200 = macro uptrend. Price below = macro downtrend.
This single filter significantly improves win rate in trend-following strategies.

**Critical limitation:** MAs are lagging indicators — by the time a crossover fires, 30-50% of
the initial move is typically complete. Use for bias confirmation, not precise entry timing.

### 1.4 ADX — Average Directional Index

Developed by J. Welles Wilder, ADX is the definitive tool for **trend strength measurement**
(not direction). It quantifies how strongly price is trending on a 0–100 scale.

**Components:**
- `+DI` (Positive Directional Indicator): measures upward movement strength
- `-DI` (Negative Directional Indicator): measures downward movement strength
- `ADX` = smoothed average of the absolute difference between +DI and -DI

**ADX Interpretation Scale:**
```
ADX 0–20:   No trend / ranging market — mean-reversion strategies preferred
ADX 20–25:  Weak trend forming — caution zone
ADX 25–40:  Moderate trend — trend-following strategies viable
ADX 40–60:  Strong trend — high-conviction trend trades
ADX 60+:    Extremely strong trend (rare) — often precedes exhaustion
```

**Directional signal (not just strength):**
- When +DI crosses above -DI while ADX > 25: bullish trend confirmation
- When -DI crosses above +DI while ADX > 25: bearish trend confirmation

**For our bot:** ADX(14) > 25 can serve as a **regime gate** — only allow trend-following
signals (BOS/OB entries) when ADX indicates a trending market. When ADX < 20, suppress
trend signals and optionally allow mean-reversion plays.

---

## 2. Wyckoff Method

### 2.1 Core Principles

Richard Wyckoff (1873–1934) developed a methodology based on tracking the behavior of large
institutional operators (the "Composite Operator") through price and volume analysis. His
three fundamental laws:

1. **Law of Supply and Demand:** Price rises when demand exceeds supply; falls when supply exceeds demand.
2. **Law of Cause and Effect:** The extent of price movement (effect) is proportional to the buildup period (cause). A long accumulation range predicts a larger markup move.
3. **Law of Effort vs Result:** Volume (effort) should confirm price movement (result). Divergence signals weakness.

### 2.2 Market Cycle — Four Phases

```
                    DISTRIBUTION
                   /             \
     MARKUP       /               \   MARKDOWN
    /             /                 \           \
   /             /                   \           \
ACCUMULATION                          ACCUMULATION (next cycle)
```

**Phase A — Stopping the Prior Trend:**
- Preliminary Support (PS): first significant buying after downtrend
- Selling Climax (SC): panic selling, high volume, wide spread — marks the low
- Automatic Rally (AR): sharp bounce as short-sellers cover
- Secondary Test (ST): price retests SC area on lower volume — demand absorbing supply

**Phase B — Building the Cause:**
- Price oscillates within the range established by SC and AR
- Large operators accumulate quietly; volume decreases on dips, increases on rallies
- Multiple Secondary Tests may occur; upthrusts test resistance

**Phase C — The Test (The Spring):**
- The **Spring** is the critical event: price breaks below SC support, triggering retail stop-losses
- This is a deliberate trap — institutions absorb the selling and reverse
- Low-quality spring: closes back above support but volume is high (absorption not clean)
- High-quality spring: closes back above support with low volume (no supply available)
- After spring: Look for **Sign of Strength (SOS)** — a decisive rally with expanding volume

**Phase D — Trend Beginning (Markup):**
- Last Point of Support (LPS): the final pullback before breakout
- **Back Up to the Edge of the Creek (BUEC)**: price rallies, breaks resistance, then retests
  — this is the optimal entry point
- Strong closes above range resistance confirm institutional intent

**Phase E — Full Markup:**
- Price advances freely above the range
- Smaller pullbacks hold at previous resistance (now support)
- Trend continues until new distribution begins

### 2.3 Distribution Schematic (Mirror of Accumulation)

Key events in distribution:
- **Preliminary Supply (PSY):** first resistance after uptrend
- **Buying Climax (BC):** euphoric high-volume spike — marks the top
- **Automatic Reaction (AR):** sharp drop from BC
- **Upthrust After Distribution (UTAD):** price breaks above BC high, traps longs, then collapses
  — the mirror image of the Spring
- **Last Point of Supply (LPSY):** weak rally attempt before final breakdown
- **Sign of Weakness (SOW):** decisive break below range support

### 2.4 Wyckoff in Crypto Context

Bitcoin has shown textbook Wyckoff patterns at major cycle lows (2018–2019, 2020, 2022). Key adaptations:

1. **Speed is compressed** — what took months in 1930s stocks can complete in days/weeks in crypto
2. **Retail participation distorts phases** — social media momentum can extend Phase C dramatically
3. **Volume interpretation** — use exchange-specific volume (Bybit perpetual volume) rather than
   spot; funding rate inversions often align with Spring/UTAD events
4. **Springs in crypto are often violent** — 5-15% wick below key support before recovery
5. **CME gap fills** often function as the equivalent of a "Back Up to Creek" retest

**Practical use for the bot:** Wyckoff phase detection on the 4H chart can serve as a macro
filter. During confirmed Accumulation Phase C→D: increase long signal sensitivity. During
confirmed Distribution Phase C→D: increase short signal sensitivity.

---

## 3. Market Structure — BOS/CHoCH Deep Dive

### 3.1 External vs Internal Structure

SMC (Smart Money Concepts) distinguishes two levels of market structure:

**External Structure (major swings):**
- The dominant sequence of HH/HL (uptrend) or LL/LH (downtrend)
- Visible on the current timeframe as the "big picture"
- BOS of external structure = trend continuation with strong conviction
- CHoCH of external structure = genuine trend reversal — high significance signal

**Internal Structure (minor swings within legs):**
- The sub-swings that form within each leg of external structure
- Internal CHoCH = only indicates a pause or pullback, NOT a reversal
- Common mistake: treating internal CHoCH as a full reversal, then getting stopped out

```
External Uptrend:     HH1 → HL1 → HH2 → HL2 → HH3
                                     ^
                               Internal CHoCH here (price dips back to HL2 area)
                               Does NOT invalidate the uptrend
                               Only a break below HL1 (external HL) signals reversal
```

### 3.2 BOS Rules (Improved Implementation)

Current bot implementation uses simple swing comparison. More robust rules:

**Rule 1 — Body Close Requirement:**
- A BOS is confirmed only when a **candle body closes** beyond the swing level
- A wick-only penetration is NOT a BOS — it's a liquidity sweep
- This prevents false breakout signals from long-wick candles

**Rule 2 — Momentum Confirmation:**
- The breaking candle should have above-average range (> 0.8× ATR)
- Low-range BOS candles often fail — they lack institutional commitment

**Rule 3 — Volume Confirmation (when available):**
- BOS on above-average volume = institutional confirmation
- BOS on low volume = suspect, may be a trap

**Implementation improvement for our bot:**
```typescript
function isBOS(candles: Candle[], swingHigh: number, atr: number): boolean {
  const breakCandle = candles[candles.length - 1];
  // Body close requirement
  const bodyClose = Math.max(breakCandle.open, breakCandle.close) > swingHigh;
  // Momentum requirement
  const range = breakCandle.high - breakCandle.low;
  const hasMomentum = range > atr * 0.8;
  return bodyClose && hasMomentum;
}
```

### 3.3 CHoCH — Distinguishing Real from False

A CHoCH signals a potential trend reversal, but **not all CHoCHs are equal:**

**Strong CHoCH (high probability):**
- Breaks the external structural swing (not just internal)
- Accompanied by strong momentum candle (> 1.5× ATR range)
- Preceded by a liquidity sweep (sweeps the equal highs/lows before reversing)
- Volume expands on the CHoCH candle

**Weak CHoCH (low probability, often fails):**
- Breaks only internal structure
- Low-momentum break (< 0.8× ATR)
- No prior liquidity sweep
- Volume absent or declining

**Scoring improvement:**
```
CHoCH on external structure + liquidity sweep + momentum: 25 pts (existing max)
CHoCH on internal structure only:                        10 pts (reduced)
BOS without volume/momentum confirmation:                12 pts (reduced from 20)
```

### 3.4 Inducement (IDM) — The Trap Before the Real Move

Inducement is a deliberate price movement that "tempts" retail traders into wrong positions
before the institutional move occurs.

**Pattern recognition:**
1. Price is in an uptrend (HH/HL sequence)
2. Creates an obvious low that looks like "support" — retail buyers load up
3. Price dips below this low (liquidity sweep / stop hunt) — this is IDM
4. After clearing retail stops, price rockets upward (the real BOS)

For our bot, IDM detection improves entry quality:
- Do NOT enter immediately on a BOS if the prior swing was "obvious" (equal lows, round numbers)
- Wait for the sweep-and-recover pattern before considering entry
- The OB that forms during the IDM sweep is often the highest-quality entry zone

### 3.5 Premium, Discount, and Equilibrium Zones (Refined)

Existing implementation uses 50-candle 4H swings. More precise implementation:

**Fibonacci-based PD zones:**
```
Range = major_swing_high - major_swing_low

Extreme Discount:   0% – 25%   (below 0.25 Fibonacci level)
Discount Zone:     25% – 50%   (between 0.25 and 0.5)
Equilibrium:       50%         (Fibonacci 0.5 — "fair value")
Premium Zone:      50% – 75%   (between 0.5 and 0.75)
Extreme Premium:   75% – 100%  (above 0.75 Fibonacci level)
```

**Entry bias:**
- Long entries: Extreme Discount preferred (0-25%), Discount acceptable (25-50%)
- Short entries: Extreme Premium preferred (75-100%), Premium acceptable (50-75%)
- Entering longs above 50% or shorts below 50% = low probability (going against institutional bias)

---

## 4. Regime Detection Algorithms

### 4.1 Why Regime Detection Matters

The most common cause of strategy failure in backtests vs live trading is regime mismatch.
A trend-following strategy (like our BOS/OB approach) performs well in trending markets but
loses consistently in ranging markets. Regime detection is the filter that prevents this.

**Three core regimes:**
1. **Trending:** Strong directional movement; trend-following strategies outperform
2. **Ranging:** Price oscillates; mean-reversion strategies outperform; trend strategies lose
3. **Volatile/Choppy:** High volatility without direction; most strategies struggle; reduce size or stop

### 4.2 Multi-Indicator Regime Scoring System

No single indicator reliably detects regime in all market conditions. The most robust approach
uses a scoring system across multiple independent indicators:

**Indicator 1 — ADX (14):**
```
ADX > 40:  +2 (strong trend)
ADX 25-40: +1 (moderate trend)
ADX 20-25:  0 (weak/ambiguous)
ADX < 20:  -1 (ranging)
```

**Indicator 2 — Bollinger Band Width Ratio:**
```
BBW = (Upper Band - Lower Band) / Middle Band
BBW_ratio = BBW / rolling_avg(BBW, 20)

BBW_ratio > 1.5:  +2 (volatility expansion, trend or volatile)
BBW_ratio 1.0-1.5: +1 (normal)
BBW_ratio < 0.8:  -1 (compression, range likely)
```

**Indicator 3 — ATR Percentile:**
```
ATR_pct = percentile_rank(ATR(14), lookback=100)

ATR_pct > 70%: +1 (elevated volatility)
ATR_pct 30-70%: 0 (normal)
ATR_pct < 30%: -1 (quiet market)
```

**Indicator 4 — EMA Separation:**
```
EMA_sep = abs(EMA20 - EMA50) / ATR(14)

EMA_sep > 2.0: +2 (EMAs well-separated = strong trend)
EMA_sep 1.0-2.0: +1
EMA_sep < 0.5:  -1 (EMAs tangled = range)
```

**Indicator 5 — Higher High / Higher Low Count (last 20 swings):**
```
If 70%+ swings are HH/HL: +2 (bullish trend structure)
If 70%+ swings are LL/LH: +2 (bearish trend structure, but still trending)
Mixed:                      0 (unclear)
```

**Regime Classification:**
```
Score ≥ 4:  TRENDING    — run trend signals at full sensitivity
Score 1-3:  WEAK TREND  — reduce position size by 30%, tighten entry criteria
Score -1-0: RANGING     — suppress BOS signals, wait for compression breakout
Score ≤ -2: AVOID       — stop trading, market is structurally unclear
```

### 4.3 Hurst Exponent — The Statistical Regime Measure

The Hurst Exponent (H) is a statistical measure derived from Rescaled Range (R/S) analysis:

```
H = 0.5:        Random walk (Brownian motion) — no edge in either direction
H > 0.5 (→1.0): Persistent series (trending) — past moves predict future direction
H < 0.5 (→0.0): Anti-persistent series (mean-reverting) — price tends to reverse
```

**Practical implementation (simplified R/S method on last 100 bars):**
```typescript
function hurstExponent(prices: number[]): number {
  const n = prices.length;
  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const mean = returns.reduce((a, b) => a + b) / n;
  const deviations = returns.map(r => r - mean);
  
  let cumulativeDeviation = 0;
  const cumulativeDeviations = deviations.map(d => {
    cumulativeDeviation += d;
    return cumulativeDeviation;
  });
  
  const R = Math.max(...cumulativeDeviations) - Math.min(...cumulativeDeviations);
  const S = Math.sqrt(deviations.reduce((sum, d) => sum + d * d, 0) / n);
  
  return Math.log(R / S) / Math.log(n);
}
```

**Usage:** When H > 0.55: high probability of trending regime → engage trend signals.
When H < 0.45: mean-reverting regime → suppress trend signals.
H between 0.45-0.55: ambiguous → use other indicators.

**Caveat:** Hurst is very sensitive to lookback period. Use 50–200 bars minimum for stability.
Compute on 1H or 4H closes, not 15M (too noisy).

### 4.4 Hidden Markov Models (HMM) — Advanced Regime Detection

For the more sophisticated implementation: HMMs treat market regime as a "hidden state" that
generates observable price/volume data. The model learns which statistical patterns (mean return,
variance) characterize each regime.

- 2-state HMM: Low-volatility (trending) vs High-volatility (crisis/ranging)
- 3-state HMM: Bullish trend, Bearish trend, Ranging

This is beyond the current bot scope but is the industry standard for institutional regime detection.
Reference: QuantStart's HMM implementation in QSTrader.

---

## 5. Trend Strength Quantification

### 5.1 ADX (Already Covered — Key Formula)

```
+DM = current_high - prior_high  (if positive, else 0)
-DM = prior_low - current_low    (if positive, else 0)

True Range (TR) = max(high - low, |high - prior_close|, |low - prior_close|)

+DI(14) = 100 × EMA(+DM, 14) / EMA(TR, 14)
-DI(14) = 100 × EMA(-DM, 14) / EMA(TR, 14)

DX = 100 × |+DI - -DI| / (+DI + -DI)
ADX(14) = EMA(DX, 14)
```

### 5.2 Linear Regression Slope

For quantifying trend strength as a rate of change:

```typescript
function trendSlope(prices: number[], period: number): number {
  // Returns normalized slope (price change per bar as % of current price)
  const x = Array.from({length: period}, (_, i) => i);
  const y = prices.slice(-period);
  const n = period;
  
  const sumX = x.reduce((a, b) => a + b);
  const sumY = y.reduce((a, b) => a + b);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope / y[y.length - 1] * 100; // Normalize as % per bar
}
```

Threshold interpretation:
- slope > +0.15%/bar: strong uptrend
- slope 0.05% to 0.15%: moderate uptrend
- slope -0.05% to 0.05%: ranging
- slope < -0.05%: downtrend (with mirrored thresholds)

### 5.3 Trend Consistency (% of Bars in Direction)

A simple but powerful measure: what percentage of the last N candles closed in the trend direction?

```typescript
function trendConsistency(candles: Candle[], period: number, direction: 'up' | 'down'): number {
  const slice = candles.slice(-period);
  const directional = direction === 'up'
    ? slice.filter(c => c.close > c.open).length
    : slice.filter(c => c.close < c.open).length;
  return directional / period; // Returns 0.0 to 1.0
}
```

Threshold: consistency > 0.65 in the BOS direction adds confidence to trend signal.

---

## 6. Trend Exhaustion Detection

### 6.1 RSI Divergence

**Regular (Classic) Bearish Divergence:**
- Price makes Higher High
- RSI makes Lower High
- Signals: trend momentum is weakening, but does NOT guarantee reversal
- More reliable when it occurs in overbought zone (RSI > 70) or at major resistance

**Regular Bullish Divergence:**
- Price makes Lower Low
- RSI makes Higher Low
- Signals: downside momentum weakening
- More reliable in oversold zone (RSI < 30) at major support

**Hidden Divergence (trend continuation):**
- Hidden Bullish: Price makes Higher Low, RSI makes Lower Low → trend continuation signal
- Hidden Bearish: Price makes Lower High, RSI makes Higher High → trend continuation signal

For our bot: divergence on the 15M chart at an OB/FVG zone significantly increases signal quality.
Consider adding divergence as a +5 point bonus to confluence score.

### 6.2 Volume Exhaustion

A trend is running on empty when:
1. Each successive HH is made on **decreasing volume** (buyers losing conviction)
2. The **last HH candle** has the smallest range of the entire move
3. Volume spikes on **counter-trend candles** (sellers becoming aggressive)

```typescript
function volumeExhaustion(candles: Candle[], swingHighIndexes: number[]): boolean {
  if (swingHighIndexes.length < 3) return false;
  const vols = swingHighIndexes.slice(-3).map(i => candles[i].volume);
  // Declining volume at each successive high
  return vols[2] < vols[1] && vols[1] < vols[0];
}
```

### 6.3 Momentum Divergence (MACD / Price)

MACD histogram divergence from price:
- Price continues higher but MACD histogram peaks are declining
- This precedes reversal by 2-5 bars on average on 15M timeframe

For crypto specifically: exhaustion often manifests as a **"blow-off top"** — one final parabolic
move with extreme volume, followed by sharp reversal. This is the equivalent of Wyckoff's BC
(Buying Climax) at a micro level.

### 6.4 ATR-Based Exhaustion

When a trend has been running for an extended period, measure how far price has moved
relative to historical ATR:

```
Trend Extension Ratio = total_trend_move / ATR(14)

Ratio > 20: Extended trend, 60% chance of correction within 5 bars (15M timeframe)
Ratio > 30: Highly extended, avoid new trend entries
```

This prevents entering trend trades at the very end of a move.

### 6.5 Equal Highs / Equal Lows as Exhaustion Signals

Three or more candles touching the same high level (within 0.05%) is a classic exhaustion
signal. Institutions cannot push price higher because supply overwhelms demand at that level.
In SMC terminology, this creates a **liquidity pool** — and the next move is typically a sweep
followed by reversal.

For the bot: when equal highs form within the last 10 bars, reduce long bias by 50%.

---

## 7. Elliott Wave Basics

### 7.1 The 5-3 Structure

Elliott Wave Theory (R.N. Elliott, 1938) proposes that markets move in predictable patterns
driven by crowd psychology:

**Motive Phase (5 waves, labeled 1-2-3-4-5):**
- Wave 1: Initial impulse (often not recognized until Wave 3)
- Wave 2: Correction (typically 50-61.8% retracement of Wave 1)
- Wave 3: Strongest wave — never the shortest; usually 161.8% of Wave 1
- Wave 4: Shallow correction (often 38.2% of Wave 3)
- Wave 5: Final impulse (often divergence with RSI at this stage)

**Corrective Phase (3 waves, labeled A-B-C):**
- Wave A: First leg down (often mistaken for a normal pullback)
- Wave B: Corrective bounce (traps bulls) — typically 38.2-61.8% of Wave A
- Wave C: Final leg down, usually equals Wave A in length

### 7.2 Three Cardinal Rules (Unbreakable)

1. **Wave 2 never retraces more than 100% of Wave 1** — if it does, the count is wrong
2. **Wave 3 is never the shortest impulse wave** — Wave 3 must be longer than Wave 1 or Wave 5
3. **Wave 4 cannot overlap Wave 1's price territory** (in standard impulses) — if it does, it may be a diagonal or the count is wrong

### 7.3 Fibonacci Connections

Elliott waves exhibit consistent Fibonacci relationships:
- Wave 2 corrects to 50% or 61.8% of Wave 1
- Wave 3 extends to 161.8%, 200%, or 261.8% of Wave 1
- Wave 4 corrects to 38.2% of Wave 3
- Wave 5 equals Wave 1 in length (when Wave 3 is extended) OR equals 61.8% of Waves 1-3

### 7.4 Practical Value for Our Bot

Elliott Wave is notoriously subjective — the same chart can support multiple valid counts.
However, two rules are actionable:

1. **Avoid entering at Wave 5 extremes** — high exhaustion probability (RSI divergence + volume declining + ATR extension)
2. **Wave 3 entries are the highest probability** — enter after Wave 2 correction, in the direction of the motive phase

The Wave 2 correction typically lands at the 50-61.8% Fibonacci retracement of Wave 1, which
also corresponds to premium/discount zone entry — a natural confluence point for our scoring system.

---

## 8. Fibonacci in Trend Trading

### 8.1 Key Retracement Levels

Fibonacci retracements measure how far a price has pulled back from a prior impulse:

| Level | Significance |
|-------|-------------|
| 23.6% | Shallow pullback — strong trend momentum |
| 38.2% | Standard pullback in strong trends |
| 50.0% | Equilibrium — "Golden Zone" begins |
| 61.8% | "Golden Ratio" — most reliable reversal zone |
| 78.6% | Deep pullback — last line before full reversal |

**The Golden Zone (50-61.8%):**
This range captures where the majority of healthy pullbacks terminate. At this zone:
- Unfilled institutional orders (OBs) often reside here
- Stop-loss runs complete (IDM sweep)
- Risk/Reward is most favorable (tight stop just below 61.8%, large target above)

**For our bot:** When an OB coincides with the 50-61.8% Fibonacci level of the prior impulse,
add +5 bonus points to the confluence score (OB quality enhancement).

### 8.2 Fibonacci Extensions for Take Profit

```
TP targets from Fibonacci extension of the prior impulse:
  100% extension = 1:1 risk/reward
  138.2% = conservative target
  161.8% = primary TP target (TP1 in our system)
  200% = extended target
  261.8% = impulse continuation target
```

Current bot TP1 at 1.5R can be refined: when the 161.8% extension aligns within 0.1% of 1.5R,
it creates a high-quality TP level with additional institutional significance.

### 8.3 Tramlines (John Burford Method)

John Burford's Tramline Trading (2014) combines parallel trend channels with Elliott Wave:

**What are Tramlines?**
Tramlines are parallel lines drawn along swing highs and swing lows that create a trend "channel":
- Upper tramline: connects two or more swing highs
- Lower tramline: parallel line anchored to a swing low between the two highs
- A valid tramline has at least 3 "touch points" to be reliable

**Key Trading Setups (Burford's 5 Best):**
1. **Tramline Break:** Price breaks outside the channel — trade the new direction
2. **Kiss and Scalded Cat Bounce:** Price breaks tramline, retests it ("kisses"), then accelerates away
3. **Third Wave Ride:** Enter Wave 3 after Wave 2 pullback to lower tramline touches
4. **A-B-C Setup:** Wait for full 3-wave correction to lower tramline, enter Wave 5 start
5. **62% Fibonacci Retrace to Tramline:** Highest probability confluence setup

**Tramline relevance to our bot:**
Tramline channels can replace or augment our current 50-candle swing range for premium/discount
calculation. The lower tramline = dynamic discount zone; upper tramline = dynamic premium zone.
Price touching the lower tramline in an uptrend = ideal OB entry zone.

---

## 9. Multi-Timeframe Trend Alignment

### 9.1 The Top-Down Framework

Our existing MTF approach (4H → 1H → 15M) is correct in principle. Improvements:

**Strict alignment rule:** Only trade when all three timeframes agree on direction.
If 4H = bullish, 1H = ranging, 15M = bullish → SKIP (no alignment)
If 4H = bullish, 1H = bullish, 15M = pulling back → WAIT (looking for entry)
If 4H = bullish, 1H = bullish, 15M = showing BOS up → ENTER

**Timeframe "distance" rule:** Entry timeframe should be 4-16× smaller than the structural
timeframe. 4H structural + 15M entry = 16:1 ratio. 4H structural + 5M entry = 48:1 ratio.
Ratios above 30:1 create noise; below 4:1 create lag.

### 9.2 Higher Timeframe Bias Strength

Not all HTF biases are equal. Weight the HTF signal:

```
HTF Bias Strength = STRONG:   4H BOS + 4H trend at least 5 bars old + ADX > 30
HTF Bias Strength = MODERATE: 4H BOS + ADX 20-30
HTF Bias Strength = WEAK:     4H CHoCH (reversal attempt, not confirmed trend) + ADX < 25

For STRONG bias: Allow LTF entries at reduced confluence (65 instead of 70)
For MODERATE: Standard 70 threshold
For WEAK: Raise threshold to 75 or skip
```

### 9.3 Conflicting Timeframes — Handling

When timeframes conflict (e.g., 4H bearish, 15M bullish):

1. **The higher timeframe ALWAYS wins for bias**
2. The lower timeframe setup is fighting the trend — even if it looks perfect, win rate drops significantly
3. Exception: If 4H is in confirmed range (not trend), then 15M trends within the range are valid
4. Document conflicting setups and review periodically — they often cluster around regime change points

---

## 10. Crypto-Specific Trend Analysis

### 10.1 The 24/7 Market — Key Differences

Crypto markets never close, which creates structural differences from traditional markets:

**No overnight gaps (mostly):** Price moves continuously; no Monday gap-opens caused by weekend events. However, **CME Bitcoin futures** (until May 2026 when 24/7 launches) create a "CME gap" phenomenon — approximately 77% of CME gaps eventually fill. Traders use these as predictive magnets.

**Weekend pattern:** Trading volume drops 20-25% on weekends. Reduced liquidity means:
- Bid-ask spreads widen
- Price impact of large orders increases
- Momentum trades can exaggerate in either direction
- Trend reversals initiated on weekends often lack conviction; confirm on Monday

**Recommendation:** Reduce position size to 75% on weekends (Saturday 00:00 UTC – Sunday 20:00 UTC). Full size after Monday open liquidity restoration.

### 10.2 Session-Based Trend Behavior

Despite 24/7 trading, institutional activity concentrates in three sessions:

| Session | Time (UTC) | Characteristics |
|---------|------------|-----------------|
| Asian | 00:00–08:00 | Low volume, tight ranges, range-bound behavior |
| London | 08:00–16:00 | Medium volume, often sets daily direction |
| New York | 13:00–21:00 | Highest volume, confirms or reverses London trend |

**Asian session false breaks:** Asian session frequently creates false breakouts (stop hunts) of the prior day's highs/lows, which are then reversed during London or NY. Our bot should treat Asian-session BOS signals with 15% reduced conviction unless confirmed by London open.

**London-NY overlap (13:00-16:00 UTC):** Highest probability for trend continuation signals. BOS signals during this overlap get a +3 bonus to confluence score.

### 10.3 Funding Rate as Trend Exhaustion Signal

Perpetual futures use funding rates to anchor price to spot. Extreme funding rates signal crowd positioning extremes:

```
Funding rate > 0.1% per 8h:  Excessive long positions → potential long squeeze
Funding rate < -0.1% per 8h: Excessive short positions → potential short squeeze
Normal range: -0.01% to +0.05%
```

High positive funding + price at ATH/resistance + RSI divergence = textbook trend exhaustion.
This is a crypto-unique exhaustion signal with no traditional markets equivalent.

**For our bot:** Existing filter (funding rate > |0.1%|) is correct. Consider making it directional:
- High positive funding → suppress LONG signals only (not shorts)
- High negative funding → suppress SHORT signals only (not longs)

### 10.4 Liquidation Cascades as Trend Accelerants

Crypto trends often exhibit "staircase" patterns due to liquidation cascades:
1. Price moves in trend direction
2. Leveraged counter-trend traders get liquidated
3. Liquidation orders push price further in trend direction
4. Next layer of counter-trend traders get liquidated

This is why crypto trends **overshoot** traditional technical targets. Elliott Wave 3 extensions
to 261.8% are common in crypto; 161.8% (the traditional target) often leaves money on the table.

**Implication for TP:** Consider setting TP2 at 2.5R or 200% extension instead of trailing immediately after TP1.

### 10.5 Correlation Regime with BTC

When BTC is trending strongly (ADX > 40 on 4H), altcoins typically follow with a 0-4 hour lag
but amplified magnitude (beta 1.2x-2.5x depending on the pair). This creates a signal:

- BTC completes a strong BOS → check altcoin pairs for lagged BOS setups
- BTC enters ranging regime → altcoin SMC signals become unreliable; reduce allocation

---

## 11. Actionable Improvements for Our Bot

### Priority 1 — Regime Detection Gate (High Impact)

Add a regime detection filter that blocks BOS signals during ranging markets.
Use a simplified 3-indicator score:

```typescript
interface RegimeScore {
  adx: number;         // ADX(14): <20=−1, 20-25=0, 25-40=+1, >40=+2
  emaSpread: number;   // |EMA20−EMA50|/ATR: <0.5=−1, 0.5-1=0, 1-2=+1, >2=+2
  bbWidth: number;     // BBWidth/Avg: <0.8=−1, 0.8-1.2=0, >1.2=+1
}

// Regime.TRENDING = adx+emaSpread+bbWidth >= 3
// Regime.WEAK     = score 1-2
// Regime.RANGING  = score <= 0
```

Expected improvement: WR +4-8%, DD reduction -15-20% in ranging periods.

### Priority 2 — BOS Quality Score (Medium Impact)

Replace binary BOS detection with a graded score:

```
BOS_score = base_points × quality_multiplier

quality_multiplier:
  + 0.3 if body_close (not just wick)
  + 0.2 if ATR_expansion (candle range > 1.2× ATR)
  + 0.2 if volume > 1.5× avg_volume
  + 0.15 if 4H BOS confirms same direction
  + 0.15 if prior liquidity sweep occurred

Maximum multiplier: 2.0 → max BOS score = 50 pts (with 25 base)
Minimum (wick-only, low volume): 0.3 multiplier → 7.5 pts
```

### Priority 3 — Fibonacci OB Confluence Bonus

When detecting Order Blocks:
1. Calculate Fibonacci retracement of the prior impulse leg
2. If OB midpoint is within ±0.2% of the 50% or 61.8% Fibonacci level: +5 bonus
3. If OB coincides with a tramline channel boundary: +3 bonus

### Priority 4 — Trend Exhaustion Veto

Before allowing a new entry, check exhaustion conditions:

```typescript
function isTrendExhausted(candles: Candle[], direction: Side): boolean {
  const atr = calcATR(candles, 14);
  const swingHighs = getSwingHighs(candles, 3);
  
  // Check 1: Volume declining at successive highs
  const volumeExhausted = volumeExhaustion(candles, swingHighs);
  
  // Check 2: ATR extension
  const trendMove = /* total move from last major low/high */;
  const atrExtended = trendMove / atr > 25;
  
  // Check 3: RSI divergence
  const rsiDivergent = detectRSIDivergence(candles, direction);
  
  // Veto if 2+ exhaustion signals
  const exhaustionCount = [volumeExhausted, atrExtended, rsiDivergent].filter(Boolean).length;
  return exhaustionCount >= 2;
}
```

### Priority 5 — Session Filter Enhancement

Current implementation has no session awareness.
Add a session quality multiplier to confluence score:

```
London/NY Overlap (13:00-16:00 UTC): × 1.1 (bonus 10%)
NY Session (16:00-21:00 UTC):        × 1.0 (standard)
London Open (08:00-13:00 UTC):       × 0.95
Asian Session (00:00-08:00 UTC):     × 0.85 (reduce sensitivity)
Weekend (Sat-Sun):                   × 0.80 (further reduction)
```

### Priority 6 — Internal vs External BOS Distinction

Current code does not distinguish internal from external structure BOS/CHoCH.
Implement:
1. Track the last 2 levels of swing highs/lows (internal and external)
2. Only award full BOS points for external structure breaks
3. Internal structure BOS: award 50% of points with "pending confirmation" flag
4. Require external BOS within 3 bars of internal BOS for full signal

### Summary Table — Implementation Priority

| Improvement | Expected WR Gain | Implementation Complexity | Priority |
|-------------|-----------------|---------------------------|----------|
| Regime Detection Gate | +5-8% | Medium | 1 |
| Internal vs External BOS | +3-5% | Medium | 2 |
| BOS Quality Scoring | +2-4% | Low | 3 |
| Trend Exhaustion Veto | +2-3% (fewer bad entries) | Medium | 4 |
| Fibonacci OB Confluence | +1-3% | Low | 5 |
| Session Filter | +1-2% | Low | 6 |

---

## Sources

- [MOMOH S.O — Market Trend Analysis (Amazon Kindle)](https://www.amazon.com/MARKET-TREND-ANALYSIS-Identifying-real-time-ebook/dp/B0DRZ3BW78)
- [Wyckoff Analytics — The Wyckoff Method](https://www.wyckoffanalytics.com/wyckoff-method/)
- [StockCharts — Wyckoff Method Tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial)
- [DailyPriceAction — SMC Market Structure BOS/CHoCH](https://dailypriceaction.com/blog/smc-market-structure/)
- [Fidelity — Average Directional Index (ADX)](https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX)
- [QuantStart — Market Regime Detection HMM](https://www.quantstart.com/articles/market-regime-detection-using-hidden-markov-models-in-qstrader/)
- [FractalCycles — Market Regime Detection](https://fractalcycles.com/guides/market-regime-detection)
- [Macrosynergy — Hurst Exponent](https://macrosynergy.com/research/detecting-trends-and-mean-reversion-with-the-hurst-exponent/)
- [Elliott Wave Forecast — Elliott Wave Theory](https://elliottwave-forecast.com/elliott-wave-theory/)
- [John Burford — Tramline Trading (Harriman House)](https://harriman.house/books/tramline-trading/)
- [QuantMonitor — Regime Identification by Trend and Volatility](https://quantmonitor.net/how-to-identify-market-regimes-and-filter-strategies-by-trend-and-volatility/)
- [Phemex — Wyckoff Accumulation](https://phemex.com/academy/wyckoff-accumulation)
- [Morpher — Hurst Exponent in Trading](https://www.morpher.com/blog/hurst-exponent-in-trading)
- [LiquidityFinder — Pullback Strategy Fibonacci + MA](https://liquidityfinder.com/news/pullback-trading-strategy-using-moving-averages-fibonacci-61797)
- [Phemex — CME Futures Gap](https://phemex.com/academy/cme-futures-gap)
- [MindMathMoney — Multi-Timeframe Analysis](https://www.mindmathmoney.com/articles/multi-timeframe-analysis-trading-strategy-the-complete-guide-to-trading-multiple-timeframes)

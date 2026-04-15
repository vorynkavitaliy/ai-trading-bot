# Volume Analysis Deep Dive

**Date:** 2026-04-06
**Purpose:** Comprehensive reference on volume methodology for algorithmic trading.
**Scope:** Classical theory (Wyckoff/Williams/Coulling/Murphy) + modern crypto-specific adaptations.
**Relevance:** Our bot currently assigns `volume` weight=15 in BTCUSDT config. This document
evaluates whether the current single `volumeRatio` metric is sufficient and what enhancements
would yield meaningful WR or false-signal-rejection improvements.

---

## 1. Volume Price Analysis (VPA) — Anna Coulling

Anna Coulling's VPA methodology, detailed in *A Complete Guide to Volume Price Analysis*,
extends Richard Wyckoff's foundational work into a candle-by-candle framework for identifying
institutional intent.

### Core Principle: Validation vs. Anomaly

Every candle falls into one of two categories:

**Validated moves (price and volume agree):**
- Wide-spread bullish candle + high volume → genuine institutional buying
- Wide-spread bearish candle + high volume → genuine institutional selling
- Narrow-spread candle + low volume → consolidation, no directional intent

**Anomalies (price and volume disagree — read as warnings):**
- Wide-spread up candle + low/average volume → "no demand" — move is unsupported, likely to fail
- Wide-spread down candle + low volume → "no supply" — selling pressure exhausted
- Narrow-spread candle + very high volume → absorption or stopping volume — professional counter-action

### The Four Quadrant Framework

| Spread | Volume | Interpretation |
|--------|--------|----------------|
| Wide up | High | Genuine bullish strength |
| Wide up | Low | No demand — warning, potential reversal |
| Wide down | High | Genuine bearish pressure |
| Wide down | Low | No supply — potential bottoming |
| Narrow | High | Absorption — professionals absorbing retail orders |
| Narrow | Low | Dry-up — equilibrium, wait for directional signal |

### VPA for Order Block Validation

In our SMC context, VPA adds a critical layer: an Order Block is only high-quality if the
impulse away from it was accompanied by **high volume** (genuine institutional participation).
An OB formed on low-volume impulse is suspect and should have its weight reduced or vetoed.

The bullish OB is the last bearish candle before a high-volume impulse up. If that impulse
had low volume, the "institutional" interpretation is invalidated — it may be a retail squeeze
rather than smart money accumulation.

---

## 2. Volume Spread Analysis (VSA) — Tom Williams

Tom Williams, a former syndicate trader, formalized Wyckoff's concepts into VSA in his 1985
book *The Undeclared Secrets That Drive the Stock Market*. VSA operates on the Law of
Effort vs. Result: volume is effort, price movement is result. When they diverge, the market
is sending a signal.

### Core VSA Laws

**Law of Supply and Demand:** Price rises when demand exceeds supply; falls when supply
exceeds demand. Volume measures the intensity of each force.

**Law of Effort vs. Result:** High effort (volume) should produce commensurate result
(price movement). When it does not, professionals are working against the move.

**Law of Cause and Effect:** The cause (accumulation/distribution) must be proportional
to the effect (subsequent move). Low-volume "causes" produce small effects.

### Key VSA Signals

**Stopping Volume (Bullish):** Ultra-high volume on a wide down-spread candle that closes
near its high. Professionals are absorbing all supply. Often occurs at the end of a downtrend.
Subsequent bars will typically show narrow spread — the market is "testing" whether supply
has been removed.

**Test (Bullish):** A low-volume, narrow-spread candle that pushes into a prior high-volume
area but closes near the high. Professionals are testing whether supply has been absorbed.
If volume is truly low, supply is gone — confirming bullish position.

**Upthrust (Bearish):** A candle that penetrates above resistance on high volume but closes
near the low. Classic trap for breakout buyers. Professionals are distributing into the
breakout enthusiasm.

**Spring (Bullish):** Mirror of upthrust. Penetrates below support on low volume, closes
near the high. Professionals spring the stops of sellers and immediately reverse.

**No Demand (Bearish):** Up candle on volume lower than the previous two bars. Professionals
are not participating in the rise — the move lacks institutional backing.

**No Supply (Bullish):** Down candle on very low volume. Selling pressure has dried up.
Market is positioned for professional buying to move price higher.

### VSA Bar-by-Bar Logic for BTCUSDT 15M

For every signal our analyzer generates, VSA suggests asking:
1. What was the volume on the signal candle vs. the 14-bar average?
2. What was the spread (high-low range) relative to ATR?
3. Where did the candle close relative to its range (upper half = buying pressure)?

A signal on a "No Demand" candle (up bar, narrow spread, low volume) should be penalized
or vetoed regardless of the SMC confluence score — it means professionals are not supporting
the projected direction.

---

## 3. On-Balance Volume (OBV) — Accumulation / Distribution Detection

Developed by Joseph Granville in 1963, OBV is a running cumulative sum: add full period
volume when price closes up, subtract full period volume when price closes down.

**Formula:**
```
OBV[i] = OBV[i-1] + volume[i]  (if close[i] > close[i-1])
OBV[i] = OBV[i-1] - volume[i]  (if close[i] < close[i-1])
OBV[i] = OBV[i-1]              (if close[i] == close[i-1])
```

### OBV Divergence as Early Warning

The most valuable use of OBV is divergence detection:

**Bearish divergence:** Price makes higher highs → OBV makes lower highs.
Interpretation: Despite rising price, net volume accumulation is declining. Smart money is
distributing into price strength. The rally is being sold.

**Bullish divergence:** Price makes lower lows → OBV makes higher lows.
Interpretation: Despite falling price, accumulation is increasing. Smart money is absorbing
sell pressure. The decline is being bought.

OBV divergences in crypto are particularly powerful because retail traders drive exaggerated
moves — the gap between OBV and price becomes visible days before the reversal occurs.

### OBV Slope as Trend Confirmation

Rising OBV slope = accumulation regime. Use as a filter: only take long entries when OBV
slope over the last 20 bars is positive. This confirms that the overall volume trend
supports the directional bias.

For our bot: OBV on 1H or 4H gives context for the 15M signal. A 15M long signal with
falling 4H OBV is a counter-trend setup against distribution — lower confidence.

### Chaikin Money Flow (CMF)

A related indicator: CMF measures money flow over N periods using position of close within
the bar's range. CMF > 0 confirms institutional buying; CMF < 0 confirms distribution.
More sensitive than OBV to intrabar price position.

---

## 4. Volume Profile — Value Area, POC, HVN/LVN

Volume Profile plots horizontal volume histograms at each price level, showing where the
most (and least) trading activity occurred over a specified period. Unlike time-based volume
(bars), Volume Profile reveals the **price levels** with highest institutional interest.

### Key Concepts

**Point of Control (POC):** The single price level with the highest volume. Represents
"fair value" — where buyers and sellers were most in agreement. Price tends to revisit POC
after deviations. In crypto, hourly/daily POC acts as a magnetic gravitational center.

**Value Area (VA):** The price range containing approximately 70% of total volume. Derived
from the normal distribution assumption (±1 standard deviation contains ~68% of cases).
- Value Area High (VAH): upper boundary
- Value Area Low (VAL): lower boundary

**High Volume Nodes (HVN):** Price levels where volume was concentrated. Function as strong
support/resistance because many participants entered positions there — they will defend those
levels or exit at breakeven.

**Low Volume Nodes (LVN):** Price levels where volume was sparse. When price enters an LVN,
it often moves rapidly through it (thin liquidity accelerates movement). LVNs are "speed
zones" between HVNs.

### Value Area Trading Rules

**Value Area Rule (from CME pit trading tradition):**
- If price opens outside the Value Area and moves back inside → high probability of full
  traverse to the opposite VA boundary. This is the "return to value" trade.
- If price opens inside VA and moves to a boundary → test for acceptance or rejection.
  Rejection confirms range; acceptance (close outside) confirms breakout.

**Practically for crypto (15M timeframe):**
- Use 24H Volume Profile to identify daily POC and VA
- A 15M signal near daily VAL in an uptrend carries higher conviction (institutional support)
- A 15M signal near daily VAH in a downtrend carries higher conviction (institutional resistance)

### Volume Profile in Relation to Order Blocks

Order Blocks and HVNs often coincide — both represent price zones where institutions
transacted heavily. When an OB aligns with an HVN from the Volume Profile, the confluence
is exceptionally high: the OB gives the directional reason (last candle before impulse) and
the HVN confirms the volume-based significance of that zone.

---

## 5. VWAP as Dynamic Support / Resistance and Trade Entry

Volume Weighted Average Price (VWAP) is the ratio of cumulative dollar volume traded to
cumulative total volume over a session (or any anchor period).

**Formula:**
```
VWAP = Σ(typical_price × volume) / Σ(volume)
typical_price = (high + low + close) / 3
```

### Why VWAP Matters Institutionally

Research analyzing institutional order flow shows price acts as support or resistance at
VWAP approximately 70-75% of the time during active trading hours. This is not a coincidence:
- Institutional traders are benchmarked against VWAP — buying below it is "good execution"
- VWAP algorithms automatically buy when price drops below VWAP
- This self-reinforcing behavior makes VWAP a genuine institutional reference level

### VWAP Standard Deviation Bands

Like Bollinger Bands around a moving average, VWAP bands use statistical standard deviations:
- ±1σ: normal range (roughly 68% of price action)
- ±2σ: statistically extended (mean reversion candidate)
- ±3σ: extreme deviation (climactic move territory)

**Trade entry framework:**
- Price at VWAP in uptrend → buy the pullback to fair value (institutional support zone)
- Price at -2σ band in uptrend → potential mean reversion long (oversold relative to VWAP)
- Price above +2σ → extended, reduce long exposure or fade if confluence supports

### Anchored VWAP

Standard VWAP resets each session. Anchored VWAP (AVWAP) starts from a user-defined pivot
(e.g., a major swing low, earnings gap, halving event). AVWAP from a major crypto market
structure pivot shows whether participants who entered at that event are currently in profit
(price above AVWAP) or underwater (price below). This provides a sentiment gauge.

For BTCUSDT: AVWAP from the last major swing low is a strong dynamic support — institutional
longs from that pivot will defend the AVWAP level.

### VWAP for Our Bot

On a 15M timeframe, daily VWAP provides context:
- Long signals below VWAP in a downtrend = counter-trend, require higher confluence
- Long signals near VWAP in an uptrend (pullback) = with-trend, lower confluence requirement
- Long signals far above VWAP = extended, risk of mean reversion working against the trade

---

## 6. Volume Divergence Detection

Volume divergence is one of the most reliable early warning signals available to algorithmic
systems. The principle: price and volume should trend together; when they separate, the trend
is built on weakening foundations.

### Types of Volume Divergence

**Classic Bearish Divergence:**
- Price: higher high
- Volume (raw) or OBV: lower high
- Meaning: fewer participants supporting the new high — distribution likely
- Action: reduce long confidence, increase SL tightness

**Classic Bullish Divergence:**
- Price: lower low
- Volume or OBV: higher low
- Meaning: fewer sellers at the new low — accumulation likely
- Action: increase long confidence, potential reversal trade

**Hidden Divergence (continuation signal):**
- Hidden bearish: price lower high, OBV higher high → continuation of downtrend
- Hidden bullish: price higher low, OBV lower low → continuation of uptrend
- Less commonly used but valid for trend-following strategies

### Detecting Divergence Algorithmically

For a 15M system, a practical divergence filter:
```
period = 20 bars
price_slope = linear_regression_slope(close, period)
volume_slope = linear_regression_slope(volume, period)
obv_slope = linear_regression_slope(OBV, period)

divergence_score = 0
if price_slope > 0 and obv_slope < 0: divergence_score = -1  // bearish div
if price_slope < 0 and obv_slope > 0: divergence_score = +1  // bullish div
```

A long signal with `divergence_score = -1` is a red flag. The system should either reduce
the signal score or require higher raw confluence before accepting the trade.

### Crypto-Specific: Divergence Before Liquidation Cascades

In perpetual futures (Bybit USDT Perp), volume divergence before high open-interest
unwinds can precede rapid liquidation cascades. When price makes new highs with
OBV declining and funding rate is elevated, the setup is classic pre-distribution:
leveraged longs are being distributed into by institutional sellers who will pull
bids and trigger the cascade.

---

## 7. Climactic Volume Identification

Climactic volume is an extreme spike — typically 3-5x the 20-bar average — at the end
of a sustained directional move. It signals exhaustion rather than acceleration.

### Blow-Off Top

**Pattern:**
1. Sustained uptrend over multiple periods
2. Parabolic final acceleration (price makes largest single-session move of the trend)
3. Volume spike: 3-5x average (final retail FOMO)
4. Candle closes in the upper range but spread is wide (distribution into the spike)
5. Next 1-3 candles: price cannot hold the high, reversal begins

In crypto, blow-off tops are common due to retail leverage and social media amplification.
The algorithmic signature: highest volume in N bars + largest up-candle in N bars +
subsequent failure to make a new high on the next bar.

**Detection rule:**
```
is_climactic = volume[i] > 3.0 × avg_volume(20)
              AND (high[i] - low[i]) > 2.0 × ATR(14)
              AND close[i] is in top 30% of bar range
```

A long signal arriving 1-3 bars after a blow-off top has extremely poor risk/reward.
The climactic bar should trigger a veto of long signals for the subsequent 3-5 bars.

### Selling Climax (Capitulation)

Mirror of blow-off top. Extreme volume + wide down candle + close in lower range.
Often marks the end of a decline. A long signal arriving in the 1-3 bars after a
selling climax has elevated conviction — institutions are absorbing panic sellers.

**Practical rule:** if the prior bar was a selling climax (volume > 3x avg, wide down bar,
close in lower range) AND the signal candle is an up bar, add +10 to confluence score as
a bonus (similar to existing OBV+FVG bonus in our scoring system).

### Exhaustion Volume on Breakouts

When a breakout occurs on lower volume than the buildup that preceded it, the breakout
lacks institutional participation. This is a "fake breakout" signature common in crypto.
Conversely, a breakout on volume > 2x the 20-bar average is "genuine" and continuation
probability is significantly higher.

---

## 8. Volume at Key S/R Levels — Confirmation Logic

The interaction of price with S/R levels tells different stories depending on accompanying volume:

**High-volume test of support → held:** Strong hands defending the level. Institutional buyers
absorbing all offers. High probability of bounce. This is the ideal OB test — volume confirms
the level's validity.

**Low-volume drift to support:** Weak test. Price drifted down on low interest.
Not enough participation to establish conviction. Can go either way.

**High-volume break through support → confirmed:** Genuine breakdown with institutional
participation. Not a fake-out. Price acceleration likely through any LVNs below.

**Low-volume pierce of support then recovery (Spring):** Classic VSA spring. Stop-hunt with
minimal real selling. Bullish setup — professionals used the pierce to accumulate.

### For Our OB Validation

The current OB detection looks for a specific candle pattern (last bearish before impulse).
Volume confirmation adds a second dimension:

- **OB quality tier A:** The impulse away from OB had volume > 1.5x average. The OB test
  (price returning to OB zone) occurs on low volume. High conviction long.
- **OB quality tier B:** The impulse had average volume. Test volume is average. Moderate confidence.
- **OB quality tier C:** The impulse had low volume (retail squeeze not institutional). The test
  has high volume (supply present). Low conviction — reduce weight or veto.

This tiering can be applied algorithmically and reflected in the `orderBlock` score component.

---

## 9. Delta Volume (CVD) — Buy vs. Sell Volume Analysis

Delta Volume measures the net difference between aggressive buy volume and aggressive sell
volume within a candle (or period).

**Calculation basis:**
- Trades at the ask → buyer-initiated (aggressive buy)
- Trades at the bid → seller-initiated (aggressive sell)
- Delta = aggressive_buys - aggressive_sells

On Bybit, trade data includes side. For candle-level delta, sum all trades within the candle:
- positive delta → net buying pressure
- negative delta → net selling pressure

**Cumulative Volume Delta (CVD):** Running sum of per-candle delta, analogous to OBV but
more precise (uses actual trade-side attribution rather than candle direction assumption).

### CVD Divergence (More Precise Than OBV)

**Bearish CVD divergence:**
Price makes new high → CVD makes lower high.
Means: despite the price rise, more sellers than buyers were active. Institutions are selling
into the price rise.

**Bullish CVD divergence:**
Price makes new low → CVD makes higher low.
Means: sellers are losing momentum despite lower prices. Smart money is absorbing.

CVD is more precise than OBV because it directly measures aggressive order flow (market orders),
whereas OBV approximates direction from candle color. For crypto perpetuals with available
trade tape, CVD should be preferred.

### Delta in Relation to Liquidations

In perpetual futures, large positive delta spikes often coincide with short liquidations
(stop-triggered market buys). These are not "organic" buying — they are forced. A price
spike on a delta spike caused by liquidations is often a false signal. The move exhausts
quickly once liquidation fuel runs out.

Identifying liquidation-driven delta vs. genuine accumulation delta requires tracking the
funding rate and open interest simultaneously. Genuine accumulation shows rising OI + positive
delta + stable or falling funding rate.

---

## 10. Crypto Volume — Unique Characteristics

### Scale and 24/7 Nature

Unlike equities (6.5h/day), crypto trades continuously. There is no clean session break,
no overnight gap from volume perspective. Volume rhythms follow UTC sessions but with
significant overlap. VWAP must be anchored meaningfully — daily midnight UTC is conventional
but the "real" institutional session (London+NY overlap, 13:00-17:00 UTC) is the highest-quality
volume period.

For BTCUSDT on Bybit, the highest-volume, lowest-noise periods are:
- **08:00-12:00 UTC:** London open + morning session
- **13:00-17:00 UTC:** New York open + peak overlap with London
- **00:00-02:00 UTC:** Asian session open (Tokyo/Singapore)

Our `sessionFilterUTC` in BTCUSDT.json already captures 07:00-22:00 UTC, which aligns
with London open through NY afternoon close. This is correct.

### Wash Trading and Fake Volume

**Scale of the problem (2024-2025 data):**
- CEX: Difficult to quantify precisely due to opaque matching engines. Some smaller Bybit
  altcoin pairs have had wash trading concerns historically.
- DEX: $704M-$1.87B in suspected wash trading on Ethereum/BSC/Base in 2024 alone.
- For BTCUSDT perpetuals on Bybit specifically: wash trading is less prevalent because
  funding rate mechanics make sustained artificial volume expensive to maintain.

**Detection heuristics for CEX data:**
1. **Volume clustering:** Wash trading generates round-number trades (e.g., exactly 0.5 BTC
   repeated). Legitimate order flow has natural variation.
2. **Autocorrelation:** Wash trading volume has higher time-series autocorrelation (bots
   repeat patterns). Genuine volume is more random.
3. **Volume-price correlation:** Wash volume does not move price (buyer = seller, net zero).
   Genuine volume should correlate with price movement. Low correlation between volume and
   absolute price change = suspect.
4. **Cross-exchange confirmation:** If Binance BTCUSDT shows a volume spike and Bybit does not
   (or vice versa), the Bybit spike may be artificial. Correlated exchange volume is more credible.

**Practical filter for our bot:** For BTCUSDT USDT Perp on Bybit, wash trading is not a
major concern (it is the highest-liquidity pair on a regulated-aspiring exchange). For altcoin
pairs (PEPE, SUI, etc.), apply a relative volume filter: only trust volume signals when the
24H volume exceeds a minimum threshold (e.g., $500M USD for smaller alts), and when the
pair's volume is cross-confirmed on Binance.

### Bot Activity and Volume Spikes

Algorithmic market makers, liquidation bots, and arbitrage bots create regular volume
patterns in crypto:
- **Funding rate arbitrage bots** generate volume near funding intervals (every 8h on Bybit:
  00:00, 08:00, 16:00 UTC). Volume at these times may not reflect directional intent.
- **Liquidation cascades** produce extreme volume spikes that look like climactic volume
  but are mechanically driven (forced sellers). Cannot be fully filtered without OI data.
- **Arbitrage bots** between spot and perp create volume that should not be interpreted as
  directional conviction.

---

## 11. Filtering Fake Volume in Crypto

### Relative Volume (RVOL) — The Baseline

Current implementation: `volumeRatio = volume[i] / avg_volume(20)`

This is a valid starting point, but the 20-bar lookback is a short-term anchor. The same
candle can appear as "high relative volume" during a quiet period and "normal" during an
active period. Better practice:

**Multi-lookback RVOL:**
```
rvol_short = volume[i] / avg_volume(20)   // immediate context
rvol_daily = volume[i] / avg_daily_volume  // daily context (from 96 bars for 15M)
```

Use the minimum of both to avoid false high-volume readings during low-activity baseline periods.

### Volume Quality Score

For each candle, compute:
```
quality_score = price_change_pct / (volume / avg_volume)
```
This is "price impact per unit of volume." High quality = small volume causes large price
move (genuine institutional intent). Low quality = large volume with tiny price move
(wash trading / absorption with no directional resolution).

### Bybit-Specific: Open Interest as Volume Validator

For futures (unlike spot), rising volume accompanied by rising OI confirms new position
opening — genuine directional commitment. Rising volume with *falling* OI suggests position
closing — less directional significance.

A volume spike on Bybit BTCUSDT perp is higher quality when simultaneously:
- Volume > 2x average
- OI increasing (new money entering)
- Funding rate not extreme (not a liquidation-forced move)

Bybit REST API provides OI data: `GET /v5/market/open-interest`. This can be polled
on a 5-minute interval and used as a context signal for our volume scoring.

---

## 12. Volume-Weighted Indicators for Crypto

### Money Flow Index (MFI)

MFI is a volume-weighted RSI. It incorporates both price momentum and volume, making it
more robust than plain RSI for detecting overbought/oversold conditions.

```
typical_price = (high + low + close) / 3
raw_money_flow = typical_price × volume
money_flow_ratio = sum(positive_MF, 14) / sum(negative_MF, 14)
MFI = 100 - (100 / (1 + money_flow_ratio))
```

**MFI thresholds:** > 80 = overbought (distribution), < 20 = oversold (accumulation).
These are tighter than RSI's 70/30 because volume confirmation makes extremes more significant.

**Advantage over RSI:** RSI can stay overbought during strong trends. MFI tends to diverge
sooner because it requires volume to sustain the extreme reading.

### Volume Oscillator

`VO = EMA(volume, short) - EMA(volume, long)` — the difference between short and long
volume EMAs. When VO turns positive, volume is accelerating. When VO is negative, volume
is decelerating. Useful for detecting when a move is running out of fuel.

### Accumulation/Distribution Line (ADL)

From Larry Williams, later refined by Marc Chaikin:
```
CLV = ((close - low) - (high - close)) / (high - low)
money_flow_volume = CLV × volume
ADL = cumulative_sum(money_flow_volume)
```

Unlike OBV, ADL accounts for the position of the close within the bar's range — a candle
that closes near its low, even if closing up from yesterday, contributes negatively to ADL.
This makes ADL a better measure of intrabar distribution.

ADL diverging from price is a strong distribution signal, as it means closing prints are
consistently near the low of the bar even on up days.

---

## 13. Actionable Insights for Our Bot

### Current State

Volume weight is 15 in BTCUSDT.json. The implementation uses a single metric:
```
volumeRatio = currentVolume / avg(volume, 20)
```
Scoring: >2.0 → 5 pts (max weight), 1.5-2.0 → 3 pts, <1.5 → 0 pts.

This is a single-dimension, backward-looking measure. It answers: "is this bar
busier than recent bars?" It does not answer:
- Is this volume confirming or opposing the direction? (VPA/VSA question)
- Is this volume part of accumulation or distribution? (OBV question)
- Has this volume been preceded by a divergence? (CVD question)
- Is this a climactic exhaustion move? (clipping question)

### Priority Improvements

**Priority 1 (Highest impact, low complexity): Directional Volume Ratio**

Replace raw volume ratio with directional confirmation:
```
bull_volume = sum(volume[i] × (close[i] > open[i] ? 1 : 0), lookback)
bear_volume = sum(volume[i] × (close[i] < open[i] ? 1 : 0), lookback)
directional_ratio = bull_volume / (bull_volume + bear_volume)  // 0..1
```
For a long signal: if `directional_ratio > 0.6` over the last 10 bars → strong volume
confirmation. If `directional_ratio < 0.4` → volume opposing the signal → penalty.

This single change makes volume directionally aware with minimal implementation cost.

**Priority 2 (Medium impact, medium complexity): OBV Slope Filter**

Compute OBV slope over 20 bars on the 15M chart. For long signals:
- OBV slope positive → volume confirms direction → keep current weight
- OBV slope flat → neutral → reduce weight by 30%
- OBV slope negative → divergence → veto the long signal (regardless of score)

OBV on 4H as a regime filter: only take 15M long signals when 4H OBV slope is positive.
This aligns the 15M entry with the larger accumulation regime.

**Priority 3 (Medium impact, medium complexity): Climactic Volume Veto**

Add a pre-signal check:
```
is_climactic_bar(i) = volume[i] > 3.0 × avg_volume(20, i)
                      AND abs(high[i] - low[i]) > 2.0 × ATR(14, i)
```
If any of the last 3 bars was climactic AND price is near the extreme of that bar:
- For long signal after climactic up bar → veto (blow-off top risk)
- For long signal after climactic down bar → bonus +5 (capitulation = buying opportunity)

**Priority 4 (Higher impact, higher complexity): Volume Spread Analysis Integration**

Add a `vsaQuality` function that evaluates each signal candle:
```
spread = high[i] - low[i]
close_position = (close[i] - low[i]) / spread  // 0..1

vsaQuality:
  "STRONG_BUYING"  : close_position > 0.7 AND volume[i] > 1.5 × avg_volume
  "NO_DEMAND"      : close_position > 0.5 AND volume[i] < 0.8 × avg_volume (up bar)
  "ABSORPTION"     : spread < 0.5 × ATR AND volume[i] > 2.0 × avg_volume
  "NORMAL"         : default
```

Map vsaQuality to score modifier:
- `STRONG_BUYING` → +5 bonus to volume score
- `NO_DEMAND` (on up signal candle) → volume score = 0, add "no_demand" warning
- `ABSORPTION` → neutral (professionals stepping in, direction unclear)

**Priority 5 (Future, higher complexity): CVD and MFI**

For a more complete implementation, replace `volumeRatio` with a compound score:
```
volume_score =
    directional_ratio_score (5 pts)  +
    obv_slope_score (5 pts)          +
    vsa_quality_score (5 pts)
    = max 15 pts (maintains current weight)
```

This expands the volume component from one dimension to three without changing the total
scoring range, preserving all existing calibration baselines.

### Implementation Order Recommendation

1. **Phase A (low risk):** Add OBV slope to the existing volume calculation. Gate: OBV slope
   negative on 4H → reduce 15M long confidence by 30%. This is a pure addition, no weight change.

2. **Phase B (calibration needed):** Introduce directional volume ratio. Adjust volume weights
   in backtest. Recalibrate on 3M data, verify on held-out 3M data.

3. **Phase C (longer term):** Add VSA quality flag and climactic volume veto. Both require
   careful threshold calibration per-pair (BTC vs. alts have different typical volume profiles).

### Crypto-Specific Caveats

1. **Volume ≠ spot volume for perps.** Bybit BTCUSDT perp volume includes funding-period
   activity and liquidation cascades. Cross-validate with OI changes before trusting raw volume.

2. **Wash trading on alts.** For pairs like PEPE, DOGE, SUI: require minimum 24H volume > $200M
   before considering volume signals valid. Below this threshold, the signal-to-noise ratio
   is too low.

3. **Asian session volume is structurally lower.** Our sessionFilterUTC already limits trading
   to 07:00-22:00 UTC. Within this window, 13:00-17:00 UTC produces the highest-quality volume
   (London/NY overlap). Consider weighting signals in this window more highly.

4. **Funding rate events (00:00, 08:00, 16:00 UTC):** Volume spikes at these times are often
   funding-rate-driven, not directional. The sessionFilter excludes 00:00 already. 08:00 and
   16:00 fall within our active window — add a 30-minute cooldown around funding intervals for
   volume-dependent signals.

5. **Open Interest divergence is more informative than volume alone.** Rising price + rising OI
   + rising volume = genuine trend. Rising price + falling OI + rising volume = short covering
   (weaker continuation probability). Bybit REST API provides OI data — integrating even a
   simple OI delta into the volume component would meaningfully improve signal quality.

---

## Sources

- [Volume Spread Analysis Methodology — VSA Resources (Tradeguider)](https://www.tradeguider.com/resource_center.asp)
- [VSA — Stock Gro Overview of Tom Williams' Method](https://www.stockgro.club/blogs/trading/volume-spread-analysis/)
- [Anna Coulling — VPA Programs and Core Principles](https://www.annacoulling.com/trader-education-2/volume-price-analysis-trading-what-why-and-how-our-complete-vpa-programs-will-transform-your-trading-forever/)
- [VPA Guide Summary — KriminilTrading](https://kriminiltrading.com/blogs/must-read-economic-market-books/a-complete-guide-to-volume-price-analysis-by-anna-coulling-book-summary-review)
- [Volume Profile Explained — OANDA](https://www.oanda.com/us-en/trade-tap-blog/trading-knowledge/volume-profile-explained/)
- [Volume Profile in Bitcoin — Technollogy](https://www.technollogy.com/2026/02/understanding-volume-profile-in-bitcoin.html)
- [Volume Profile Guide — GoodCrypto](https://goodcrypto.app/ultimate-guide-to-volume-profile-vpvr-vpsv-vpfr-explained/)
- [VWAP Institutional Trading — ChartMini](https://chartmini.com/blog/vwap-trading-strategy-how-to-trade-with-institutional-flow-2026)
- [VWAP Guide — TradingShastra](https://tradingshastra.com/vwap-institutional-indicator/)
- [VWAP in Crypto — HyroTrader Blog](https://www.hyrotrader.com/blog/vwap-trading-strategy/)
- [OBV Divergence in Crypto — AltFINS](https://altfins.com/knowledge-base/obv/)
- [OBV Explainer — Phemex Academy](https://phemex.com/academy/obv-indicator)
- [Cumulative Volume Delta (CVD) — Phemex Academy](https://phemex.com/academy/what-is-cumulative-delta-cvd-indicator)
- [CVD Trading Guide — Bookmap](https://bookmap.com/blog/how-cumulative-volume-delta-transform-your-trading-strategy)
- [Delta Volume — Order Flow Indicator (OSL)](https://www.osl.com/hk-en/academy/article/what-is-volume-delta-the-ultimate-order-flow-indicator)
- [Volume Divergence — Bearish Signals (Outlook India)](https://www.outlookindia.com/xhub/blockchain-insights/is-this-rally-real-how-volume-divergence-exposes-bull-traps)
- [Climactic Volume — Spotting Reversals (Medium)](https://medium.com/@osnielkisrq/spotting-market-reversals-using-climatic-volume-a-traders-guide-bce2dd440bc0)
- [Volume Climax Reversal Indicator — TradingView](https://www.tradingview.com/script/AxKt5f9c-Volume-Climax-Reversal-VCR-Catch-Exhaustion-Tops-Bottoms/)
- [Crypto Wash Trading 2025 — Chainalysis](https://www.chainalysis.com/blog/crypto-market-manipulation-wash-trading-pump-and-dump-2025/)
- [Wash Trading Detection — Empirica](https://empirica.io/blog/wash-trading-crypto-definition-detection-methods-and-the-impact-on-crypto-markets/)
- [Bybit Volume and Open Interest Data — CoinGlass](https://www.coinglass.com/exchanges/Bybit)
- [Crypto Volume Analysis Guide — HyroTrader Blog](https://www.hyrotrader.com/blog/crypto-volume-analysis/)
- [7 Volume Analysis Signs of Institutional Activity — Deepvue](https://deepvue.com/technical-analysis/volume-analysis-secrets/)

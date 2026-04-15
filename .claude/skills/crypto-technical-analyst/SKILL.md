---
name: crypto-technical-analyst
description: >
  Multi-timeframe technical analysis for crypto perpetual futures on Bybit.
  Use when analyzing a trading pair, evaluating chart setup, checking trend,
  identifying support/resistance, or assessing entry/exit timing.
  Triggers: "analyze", "chart", "technical analysis", "TA", "setup", "what does the chart say"
user_invocable: true
arguments:
  - name: pair
    description: "Trading pair symbol (e.g., BTCUSDT, ETHUSDT)"
    required: true
---

# Crypto Technical Analyst

Systematic 6-dimension technical analysis for crypto perpetual futures, producing probability-weighted scenarios with actionable trade levels.

## When to Use

- Evaluating a trading pair for potential entry
- Checking current market structure and trend
- Identifying key support/resistance levels
- Assessing momentum, volume, and volatility conditions
- Multi-timeframe alignment check before trade execution

## Research Foundation

This skill draws from these research documents (read as needed):
- `docs/research/technical-analysis-murphy.md` — Comprehensive TA reference
- `docs/research/rsi-advanced-strategies.md` — RSI divergence, failure swings, range rules
- `docs/research/volume-analysis-deep.md` — VPA, VSA, OBV, VWAP, CVD
- `docs/research/support-resistance-mastery.md` — S/R levels, institutional levels
- `docs/research/candlestick-charting-morris.md` — Pattern recognition
- `docs/research/demand-supply-dynamics.md` — Supply/demand zones, order blocks
- `docs/research/market-trend-analysis.md` — Structure, breakouts, trend identification
- `docs/research/volatility-analysis-natenberg.md` — ATR, volatility regimes
- `docs/research/cycle-analytics-ehlers.md` — Cycle analysis, dominant cycles
- `docs/research/momentum-trading-clenow.md` — Momentum anomalies

## Workflow

### Step 1: Gather Data

Fetch kline data for the pair across 3 timeframes using Bybit MCP or API:
- **4H** — Last 200 candles (bias/trend direction)
- **1H** — Last 200 candles (market structure)
- **15M** — Last 200 candles (entry timing)

Also fetch:
- Current orderbook (depth)
- 24h ticker (volume, price change)
- Open interest
- Funding rate

### Step 2: Trend Analysis (4H)

1. **EMA alignment**: Calculate EMA 20, 50, 200
   - Bullish: Price > EMA20 > EMA50 > EMA200
   - Bearish: Price < EMA20 < EMA50 < EMA200
   - Ranging: EMAs intertwined or flat
2. **Higher highs / Higher lows** — Identify structural trend
3. **ADX** — Trend strength (>25 = trending, <20 = ranging)
4. **Classify**: Strong Uptrend / Uptrend / Range / Downtrend / Strong Downtrend

### Step 3: Support & Resistance (1H)

1. Identify **key horizontal levels** from swing highs/lows
2. Map **demand zones** (Rally-Base-Rally, Drop-Base-Rally patterns)
3. Map **supply zones** (Rally-Base-Drop, Drop-Base-Drop patterns)
4. Score zone quality: freshness, departure strength, base duration, number of touches
5. Identify **EMA confluence** with horizontal levels
6. Mark **liquidity pools** — clusters of equal highs/lows (stop-hunting targets)

### Step 4: Momentum & Oscillators

1. **RSI(14)** on 1H:
   - Check for regular divergence (price vs RSI)
   - Check for hidden divergence (trend continuation)
   - Apply range rules: Bull market RSI 40-80, Bear market RSI 20-60
   - Failure swings (Wilder's preferred signal)
2. **MACD(12,26,9)** on 1H:
   - Histogram direction and acceleration
   - Signal line crossovers
   - Zero-line position
3. **Stochastic RSI** on 15M for timing

### Step 5: Volume Analysis

1. **OBV** — Trend confirmation/divergence
2. **Volume Profile** — High volume nodes (support/resistance), low volume nodes (fast moves)
3. **VWAP** — Institutional fair value reference
4. **Directional Volume Ratio** — Buy vs sell volume
5. **Climactic volume** — Exhaustion signals (volume > 3x average)

### Step 6: Volatility Assessment

1. **ATR(14)** — Current volatility level
2. **Bollinger Bands** — Squeeze (low vol → breakout incoming) vs expansion
3. **Volatility percentile** — Compare current ATR to 90-day range
4. **Funding rate** — Positive = longs paying, negative = shorts paying (crowding indicator)

### Step 7: Synthesis & Scenarios

Produce a structured analysis:

```
## Analysis: {PAIR} — {DATE}

### Bias: {BULLISH/BEARISH/NEUTRAL}
### Confidence: {HIGH/MEDIUM/LOW}

### Trend (4H)
- Direction: {trend}
- EMA alignment: {alignment}
- ADX: {value} ({interpretation})

### Key Levels (1H)
- Resistance: {R1}, {R2}, {R3}
- Support: {S1}, {S2}, {S3}
- Demand zones: {zones with quality scores}
- Supply zones: {zones with quality scores}
- Liquidity pools: {levels}

### Momentum
- RSI: {value} — {divergence status}
- MACD: {histogram direction, crossover status}
- Stoch RSI (15M): {overbought/oversold/neutral}

### Volume
- OBV trend: {confirming/diverging}
- VWAP: price {above/below}
- Volume profile: {key nodes}

### Volatility
- ATR: {value} ({percentile}th percentile)
- BB: {squeeze/normal/expansion}
- Funding: {rate} ({interpretation})

### Scenarios
**Base case ({probability}%):** {description}
**Bull case ({probability}%):** {description}
**Bear case ({probability}%):** {description}

### Actionable Levels
- Long entry zone: {price range}
- Short entry zone: {price range}
- Invalidation: {level}
```

## Key Principles

1. **Multi-timeframe confluence is mandatory** — never trade on a single timeframe
2. **Volume confirms price** — moves without volume are suspect
3. **Trend is your friend** — trade with the 4H trend, not against it
4. **Fresh zones are stronger** — first test of a demand/supply zone is highest probability
5. **Funding rate is a crowding indicator** — extreme funding = mean reversion setup
6. **Always identify where you're wrong** — invalidation level defines risk
7. **Probability-weighted scenarios** — never commit to one outcome

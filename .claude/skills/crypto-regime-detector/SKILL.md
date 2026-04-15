---
name: crypto-regime-detector
description: >
  Detect current market regime (Bull/Bear/Range/Transitional) for crypto markets.
  Use when assessing overall market conditions, deciding exposure level, or filtering trades.
  Triggers: "regime", "market state", "bull or bear", "market conditions", "exposure level"
user_invocable: true
---

# Crypto Regime Detector

Classify the current crypto market regime using multi-factor analysis adapted from Narang's quant methods and Carver's systematic approach.

## When to Use

- At the start of each trading session
- Every 30 minutes as part of the full report cycle
- Before making exposure decisions
- When macro conditions shift

## Research Foundation

- `docs/research/quant-fund-methods-narang.md` — Alpha model, regime classification
- `docs/research/systematic-trading-carver.md` — Forecasts, regime-based sizing
- `docs/research/efficient-markets-critique.md` — Behavioral anomalies by regime
- `docs/research/crypto-market-microstructure.md` — Funding rates, OI as regime signals
- `docs/research/volatility-analysis-natenberg.md` — Volatility regimes

## Regime Classification

| Regime | Description | Trading Approach |
|---|---|---|
| **Strong Bull** | Clear uptrend, rising OI, positive funding, BTC.D stable/falling | Full exposure, LONG bias, buy dips + SHORT on overextension |
| **Bull** | Uptrend but less conviction | Standard exposure, LONG preferred, selective SHORT on resistance |
| **Range** | Sideways, low ADX, mixed signals | Reduced exposure, BOTH directions, mean-reversion at extremes |
| **Bear** | Downtrend, falling OI, negative funding | Standard exposure, SHORT preferred, selective LONG on support |
| **Strong Bear** | Panic selling, high vol, liquidation cascades | Full exposure SHORT bias, SHORT breakdowns + LONG on capitulation |
| **Transitional** | Regime change in progress, conflicting signals | Minimal exposure, BOTH directions cautiously |

## Workflow

### Step 1: Crypto-Specific Indicators

1. **BTC Trend** (4H EMA 20/50/200 alignment) — BTC leads the market
2. **BTC Dominance (BTC.D)** trend — Rising = risk-off, falling = alt season
3. **Total Market Cap** trend — Macro trend
4. **Funding Rates** (BTC, ETH weighted average):
   - > 0.03% = overcrowded longs (mean reversion risk)
   - < -0.01% = overcrowded shorts (squeeze potential)
   - 0.005-0.02% = healthy bull
5. **Open Interest** change (24h, 7d) — Rising OI + rising price = strong trend
6. **Liquidation data** (if available) — Large liquidation cascades = regime shift

### Step 2: Volatility Regime

1. **ATR percentile** (current ATR vs 90-day range):
   - < 20th percentile = Low vol (squeeze incoming)
   - 20-80th = Normal
   - > 80th = High vol (caution, reduce size)
2. **Bollinger Band width** — Squeeze detection
3. **Realized vs implied vol** — Divergence = upcoming move

### Step 3: Cross-Market Context

1. **DXY (Dollar Index)** — Strong dollar = crypto weakness
2. **US 10Y yield** — Rising yields = risk-off
3. **S&P 500 correlation** — Is crypto correlating with risk assets?
4. **Gold** — Safe haven flows

### Step 4: Scoring

| Factor | Weight | Score (-2 to +2) |
|---|---|---|
| BTC Trend | 25% | |
| BTC.D Direction | 10% | |
| Total Mcap Trend | 15% | |
| Funding Rates | 15% | |
| Open Interest | 10% | |
| Volatility Regime | 10% | |
| Cross-Market | 15% | |

Weighted score: -2.0 to +2.0
- **> 1.0** = Strong Bull
- **0.5 to 1.0** = Bull
- **-0.5 to 0.5** = Range
- **-1.0 to -0.5** = Bear
- **< -1.0** = Strong Bear
- Rapid score change (> 0.5 in 24h) = Transitional

### Step 5: Output

```
## Market Regime: {REGIME} — {timestamp}

### Score: {weighted_score} / 2.0
### Confidence: {HIGH/MEDIUM/LOW}

### Factors
| Factor | Score | Reasoning |
|---|---|---|
| BTC Trend | {score} | {detail} |
| BTC.D | {score} | {detail} |
| Total Mcap | {score} | {detail} |
| Funding | {score} | {detail} |
| Open Interest | {score} | {detail} |
| Volatility | {score} | {detail} |
| Cross-Market | {score} | {detail} |

### Exposure Recommendation
- Max positions: {count}
- Risk per trade: {pct}%
- Bias: {LONG_ONLY / SHORT_ONLY / BOTH / NONE}

### Change from Last Assessment
- Previous: {regime} ({score})
- Delta: {change}
- Trend: {improving/deteriorating/stable}
```

## Regime-Based Risk Adjustment

| Regime | Max Positions | Risk/Trade | Strategy |
|---|---|---|---|
| Strong Bull | 4-5 | 1.5% | LONG trend-following + SHORT overextensions |
| Bull | 3-4 | 1.0% | LONG preferred, SHORT at key resistance |
| Range | 2-3 | 1.0% | LONG at support, SHORT at resistance (mean-reversion) |
| Bear | 3-4 | 1.0% | SHORT preferred, LONG at key support |
| Strong Bear | 4-5 | 1.5% | SHORT trend-following + LONG capitulation bounces |
| Transitional | 1-2 | 0.5% | Both directions, reduced size |

## Key Principles

1. **Regime determines exposure** — never fight the regime
2. **BTC leads** — if BTC is bearish, alts are worse
3. **Funding rates are a crowding indicator** — extreme = caution
4. **Regime changes take time** — don't flip on a single candle
5. **When uncertain, default to lower exposure** — preservation > profit

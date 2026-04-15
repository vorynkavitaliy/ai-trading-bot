---
name: crypto-signal-generator
description: >
  Generate confluence-based trading signals by combining technical analysis, market structure,
  volume, and macro context. The core decision engine that determines whether to trade.
  Triggers: "signal", "scan for trades", "any setups", "generate signal", "trade opportunity"
user_invocable: true
arguments:
  - name: pair
    description: "Trading pair to scan (e.g., BTCUSDT) or 'all' for watchlist"
    required: true
---

# Crypto Signal Generator

The central decision engine. Combines outputs from technical analysis, regime detection, news, and risk management into actionable trade signals with confluence scoring.

## When to Use

- Every 3 minutes as part of pair scanning protocol
- When manually looking for trade opportunities
- As the orchestrator that calls other skills

## Research Foundation

- `docs/research/quant-fund-methods-narang.md` — Multiple independent signal sources
- `docs/research/systematic-trading-carver.md` — Forecast combining, FDM
- `docs/research/demand-supply-dynamics.md` — SMC signals
- `docs/research/rsi-advanced-strategies.md` — Momentum signals
- `docs/research/volume-analysis-deep.md` — Volume confirmation

## Confluence Model

A valid signal requires **minimum 3 of 4** dimensions confirmed:

### Dimension 1: Market Structure (SMC)
- **Bullish**: Price at/near demand zone, bullish order block, CHoCH (Change of Character), BOS (Break of Structure) up
- **Bearish**: Price at/near supply zone, bearish order block, CHoCH down, BOS down
- **Score**: 1 if confirmed, 0 if not

### Dimension 2: Technical Indicators
- **Bullish**: RSI divergence/oversold bounce, EMA alignment bullish, MACD histogram rising/cross
- **Bearish**: RSI divergence/overbought rejection, EMA alignment bearish, MACD histogram falling/cross
- Requires at least 2 of 3 sub-indicators aligned
- **Score**: 1 if confirmed, 0 if not

### Dimension 3: Volume Confirmation
- **Bullish**: OBV rising, volume spike on green candles, price above VWAP, positive CVD
- **Bearish**: OBV falling, volume spike on red candles, price below VWAP, negative CVD
- Requires at least 2 of 4 sub-indicators aligned
- **Score**: 1 if confirmed, 0 if not

### Dimension 4: Multi-Timeframe Alignment
- **4H** trend direction matches trade direction
- **1H** structure supports the setup
- **15M** provides clean entry opportunity
- All 3 TFs must align
- **Score**: 1 if confirmed, 0 if not

## Additional Filters (must ALL pass)

1. **Regime filter**: Current regime allows the trade direction (see regime-detector)
2. **Risk filter**: Risk manager returns CLEAR status
3. **News filter**: No Tier 1 event within 30 minutes
4. **Funding rate filter**: Not entering against extreme funding (>0.05% or <-0.03%)
5. **Spread filter**: Bid-ask spread < 0.05% (liquidity check)
6. **Volatility filter**: ATR percentile between 10th and 90th (avoid dead or panic markets)

## Workflow

### Step 1: For each pair in scan

1. Run technical analysis (use crypto-technical-analyst logic)
2. Check market structure for SMC setups
3. Evaluate volume conditions
4. Check multi-TF alignment

### Step 2: Score confluence

```
confluence_score = structure + technical + volume + mtf_alignment
```

### Step 3: Apply filters

If confluence >= 3 AND all filters pass → **SIGNAL GENERATED**

### Step 4: Classify signal strength

| Score | Filters | Classification |
|---|---|---|
| 4/4 | All pass | **A+ Setup** — 1.5% risk |
| 3/4 | All pass | **Standard** — 1.0% risk |
| 3/4 | 1 filter marginal | **Weak** — 0.75% risk or skip |
| < 3 | Any | **No signal** |

### Step 5: Output

```
## SIGNAL: {PAIR} — {LONG/SHORT} — {timestamp}

### Confluence: {score}/4 — {A+/Standard/Weak/No Signal}

### Dimensions
| Dimension | Score | Detail |
|---|---|---|
| Structure (SMC) | {0/1} | {what was found} |
| Technical | {0/1} | {RSI, EMA, MACD status} |
| Volume | {0/1} | {OBV, VWAP, CVD status} |
| Multi-TF | {0/1} | {4H, 1H, 15M alignment} |

### Filters
- [x/fail] Regime: {regime} allows {direction}
- [x/fail] Risk: {CLEAR/WARNING}
- [x/fail] News: {no events / event pending}
- [x/fail] Funding: {rate}
- [x/fail] Spread: {spread_pct}%
- [x/fail] Volatility: ATR {percentile}th percentile

### Action
{EXECUTE / WATCHLIST / SKIP}

### If EXECUTE:
→ Proceed to crypto-trade-planner for full trade plan
```

## Signal Decay

- Signals are valid for **15 minutes** maximum
- If price moves > 0.5% from signal level before entry → signal expired
- Do not chase missed entries

## Key Principles

1. **Confluence is mandatory** — 3/4 minimum, no exceptions
2. **Filters are hard gates** — one failure = no trade
3. **Quality over quantity** — 1 good trade > 5 mediocre ones
4. **Signal decay is real** — don't chase
5. **Log every signal** — even skipped ones, for postmortem analysis
6. **No confirmation bias** — if the data says no trade, accept it

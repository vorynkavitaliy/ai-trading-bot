---
name: crypto-technical-analyst
description: >
  Multi-timeframe technical analysis for crypto perpetual futures on Bybit. Leading indicators
  (CVD, stoch_15m, RSI slope accel, funding/OI deltas) primary; MACD demoted to tiebreaker.
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

Multi-timeframe TA for crypto perps on Bybit, built around the Phase 1/3 leading indicators added in the refactor. Primary data source is **scan-summary output** — you do not recompute EMAs/RSI/ATR manually; the scanner already did.

## When to Use

- Evaluating a pair that passed the zone gate for a potential entry.
- Checking if an open position's thesis still holds.
- Multi-TF alignment check as part of Factor 4 in the 12-factor rubric.

## Research Foundation

- `docs/research/technical-analysis-murphy.md` — TA reference
- `docs/research/rsi-advanced-strategies.md` — RSI slope, divergence, failure swings
- `docs/research/volume-analysis-deep.md` — OBV, VWAP, **CVD** (now primary)
- `docs/research/support-resistance-mastery.md` — S/R levels
- `docs/research/demand-supply-dynamics.md` — supply/demand zones, order blocks
- `docs/research/market-trend-analysis.md` — structure, BOS, CHoCH
- `docs/research/volatility-analysis-natenberg.md` — ATR, volatility regimes
- `docs/research/momentum-trading-clenow.md` — momentum anomalies
- `docs/research/crypto-market-microstructure.md` — funding, OI, orderbook imbalance

## Data source

`npx tsx src/scan-summary.ts <pair>` — the scanner computes indicators. You read, you do not recompute.

Fields you consume (per pair):
- `klines{4h,1h,15m,3m}` — last N candles + ATR
- `indicators{rsi, ema, macd1h, adx1h, obv1h, rsi_div_1h, obv_div_1h, rsi_slope_1h, rsi_slope_accel_1h, stoch_15m}`
- `orderflow{cvd_1m, cvd_5m, obi_top5}` — **leading** (Phase 3)
- `orderbook{bid_depth_5pct_usd, ask_depth_5pct_usd, imbalance, spread_bps}`
- `market_structure{bos_1h, bos_15m, bos_3m, close_vs_swing_15m, sweep, key_levels}`
- `btc_context{hmm_regime, ...}` — for alts
- `funding_delta_1h`, `oi_delta_1h_pct` — Phase 1 leading

## Leading vs lagging hierarchy (post-refactor)

**Leading (primary):**
1. **CVD** (`cvd_1m`, `cvd_5m`) — confirms or invalidates BOS. A BOS without CVD alignment is NOT a valid structural break.
2. **Orderbook imbalance** (`obi_top5`) — directional pressure at top-5 levels.
3. **Stoch 15M K/D** — entry timing, cross from extreme.
4. **RSI slope + acceleration** (`rsi_slope_1h`, `rsi_slope_accel_1h`) — momentum turn ahead of price.
5. **Funding delta 1h** — positioning unwind signal.
6. **OI delta 1h** — fresh money in/out vs price.

**Confirming:**
- EMA21/55 alignment (trend context)
- RSI level (overbought/oversold context, not signal)
- OBV trend
- VWAP position
- ATR percentile

**Tiebreaker only:**
- **MACD.** Lagging; used only inside Factor 2 when RSI + EMA + stoch are split. Never a primary trigger.

## Workflow

### Step 1 — Trend (4H)
From scan output: EMA21/55/200 alignment, higher-highs/lows structure, ADX > 25 = trending. Classify: Strong Up / Up / Range / Down / Strong Down.

### Step 2 — Structure (1H)
Key levels from `market_structure.key_levels`. BOS direction (`bos_1h`). Sweep flag. Order blocks near price. Liquidity pools (equal highs/lows).

### Step 3 — Flow (primary entry gate)
- `cvd_5m` sign and magnitude vs BOS direction.
- `cvd_1m` for strong confirmation on sweep+reclaim+OB tap.
- `obi_top5` — if BOS direction matches OBI sign, flow supports it.

**Decision rule:** structural setup without CVD alignment = **downgrade to 0 on Factor 1**, no matter how clean the chart looks.

### Step 4 — Timing (15M)
`stoch_15m` K cross up from <20 (LONG) or down from >80 (SHORT). `rsi_slope_accel_1h > 0` with price at support = entry edge.

### Step 5 — Volatility
ATR percentile from scan. <10th → vol squeeze, breakout incoming. >85th → reduce size, widen SL buffer.

### Step 6 — Regime
Read `btc_context.hmm_regime` (state + confidence + transitioning). Do not recompute. For BTCUSDT itself, use self-trend from klines.

### Step 7 — Synthesis

```
## Analysis: {PAIR} — {timestamp}

### Bias: {BULLISH / BEARISH / NEUTRAL}
### Confidence: {HIGH / MED / LOW}

### Structure (1H)
- BOS: {bos_1h direction} {confirmed-by-cvd / unconfirmed}
- Key levels: R {R1, R2}; S {S1, S2}
- Sweep: {yes/no}; OB: {yes/no at level}

### Flow (LEADING)
- cvd_5m: {sign, magnitude}
- cvd_1m: {sign, magnitude}
- OBI top5: {value} ({bid-loaded / ask-loaded})

### Trend (4H)
- EMA alignment: {alignment}
- ADX: {value} ({trending / ranging})
- HMM regime: {state} @ {confidence} {transitioning?}

### Timing (15M)
- Stoch K/D: {values} ({cross-up / cross-down / neutral})
- RSI slope accel: {value}

### Momentum / Oscillators
- RSI 1H: {value}, slope {slope}, divergence {regular / hidden / none}
- MACD: {tiebreaker only — noted if it breaks a tie on Factor 2}

### Volume
- OBV trend: {confirming / diverging}
- VWAP: price {above / below}

### Volatility
- ATR: {value} ({percentile}th)
- Funding delta 1h: {value}
- OI delta 1h: {pct}

### Actionable levels
- Long entry zone: {range}
- Short entry zone: {range}
- Invalidation: {level}
```

## Key Principles

1. **Flow confirms structure.** BOS without CVD alignment is not a valid break.
2. **MACD is lagging.** Tiebreaker only; never a primary trigger.
3. **Multi-TF is mandatory** — Factor 4 requires alignment.
4. **Fresh zones > retested zones** — first test has highest fill probability.
5. **HMM regime, not EMA heuristics.** Read `btc_context.hmm_regime`.
6. **Stoch + rsi_slope_accel = timing edge** — leading indicators of momentum turn.
7. **Null data = neutral, not bearish** — LiqCl, funding with nulls score 0 neutrally.
8. **Invalidation before entry** — always know where you're wrong.

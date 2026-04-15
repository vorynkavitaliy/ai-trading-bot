# Research: Robert Carver — Systematic Trading & Leveraged Trading

**Date:** 2026-04-06
**Sources:**
- "Systematic Trading" (2015), Robert Carver, Harriman House
- "Leveraged Trading" (2019), Robert Carver, Harriman House
- pysystemtrade (GitHub): https://github.com/robcarver17/pysystemtrade
- Carver's blog "This Blog is Systematic": https://qoppac.blogspot.com
- 7 Circles summaries: https://the7circles.uk

---

## Background: Who is Robert Carver

Carver ran AHL (Man Group's flagship CTA fund) as Head of Futures and Options. AHL managed $20B+ using systematic trend following. He left to write books and run his own systematic account. His methodology is empirically tested on institutional data over decades. This is not retail folklore — it is production-grade quant practice.

Both books are directly applicable to our bot because:
1. **Systematic Trading** — framework for combining signals (forecasts) into positions
2. **Leveraged Trading** — simplified version for retail/prop traders with limited capital

---

## 1. The Core Framework: Forecasts, Not Signals

Carver's most important conceptual contribution is replacing the binary "in/out" signal with a **continuous forecast**.

### Binary Signal (retail approach — what we currently have)
```
score >= 70 → BUY
score < 70  → NO TRADE
```

### Carver's Continuous Forecast
```
forecast = scaled continuous value, typically range [-20, +20]
forecast = 0   → flat (no position)
forecast = 10  → "average" conviction long (normal position size)
forecast = 20  → maximum conviction long (2x normal size)
forecast = -10 → average conviction short
```

**Why this matters:** A binary threshold throws away information. If confluence score is 69 vs 95, both produce the same zero trade. With a continuous forecast, 69 produces a small long position, 95 produces a large one. Over thousands of trades, this is a significant edge.

Our current confluence score (0–100) IS a continuous signal. We are discarding most of its information by applying a hard threshold.

---

## 2. Forecast Scaling and Normalization

### The Problem
Different rules produce signals of different magnitudes. RSI oscillates 0–100. EMA crossover is a ratio. BOS is binary (0 or 1). These cannot simply be added.

### Carver's Solution: Forecast Scalar
Each raw signal is multiplied by a **forecast scalar** so that the resulting forecast has an average absolute value of **10**.

```
scaled_forecast = raw_signal × forecast_scalar

Target: E[|scaled_forecast|] = 10
```

**How to calculate the scalar:**
```
forecast_scalar = 10 / mean(abs(raw_signal_history))
```

Example: If RSI-based raw signal averages absolute value of 2.5 over history:
```
forecast_scalar = 10 / 2.5 = 4.0
scaled_forecast = raw_rsi_signal × 4.0
```

### The Cap
After scaling, forecasts are hard-capped at ±20:
```
capped_forecast = max(-20, min(20, scaled_forecast))
```

This prevents extreme outliers from dominating. The cap at 20 means maximum position = 2× "average" position. Uncapped forecasts could theoretically produce 10× positions during extreme moves — catastrophic with leverage.

### Application to Our System
Our confluence score currently ranges 0–100. To apply Carver's scaling:
1. Map score to directional forecast: `raw = score × direction` (direction = +1 long, -1 short)
2. Calculate scalar so average absolute value = 10
3. Apply scalar, then cap at ±20

This turns our 0–100 score into a position-sizing signal, not just a threshold.

---

## 3. Combining Forecasts — The Heart of Carver's Method

This is the most directly applicable section for our confluence scoring.

### Naive Weighted Average (Wrong)
```
combined = w1×f1 + w2×f2 + ... + wN×fN
where Σwi = 1
```

**The problem:** If signals are correlated, the combined forecast has lower volatility than individual forecasts. A combined forecast of two 90%-correlated signals has almost the same information as one signal, but looks "averaged down." The combined signal drifts away from the target average absolute value of 10.

### Carver's Solution: Forecast Diversification Multiplier (FDM)

```
combined_raw = Σ(wi × fi)

FDM = 1 / sqrt(W × H × W_transpose)

where:
  W = vector of forecast weights
  H = correlation matrix of individual forecasts

combined_forecast = combined_raw × FDM
final_forecast = cap(combined_forecast, ±20)
```

**Intuition:**
- If all signals are identical (correlation = 1.0): FDM = 1.0 (no boost — you have only 1 real signal)
- If all signals are uncorrelated (correlation = 0.0): FDM = sqrt(N) (e.g., 4 signals → FDM = 2.0)
- FDM is capped at 2.5 in practice

**Why this matters for us:** Our 8 confluence components are not independent. BOS and OB are highly correlated (both SMC, both trend-confirming). RSI and EMA are moderately correlated. We should apply FDM when combining — otherwise we are double-counting correlated signals.

### Practical FDM Values (our components)
| Signal Group | Expected Internal Correlation | FDM Range |
|---|---|---|
| BOS + OB + FVG (all SMC) | ~0.7 | 1.2–1.5 |
| Liquidity + PD Zone (positioning) | ~0.4 | 1.4–1.7 |
| RSI + EMA + Volume (classic) | ~0.3 | 1.6–1.9 |
| All 8 combined | varies | 1.3–2.0 |

---

## 4. How to Determine Forecast Weights

### Option A: Equal Weights (Carver Default for Small N)

When you have few signals and no strong prior on relative Sharpe ratios, use equal weights:
```
wi = 1/N for all i
```

Carver explicitly recommends this as the starting point. His research shows that with fewer than ~10–15 years of data, estimated weights from optimization are so uncertain that equal weights are statistically just as good — and more stable.

**Recommendation for our system:** Start with equal weights across the 8 components. The current unequal weights (BOS=25, OB=20, FVG=20...) are assumptions, not calibrated values.

### Option B: Handcrafting (Carver's Preferred Method)

**Step 1:** Group signals by type:
```
Group A (SMC trend): BOS, OB, FVG     → 3 signals
Group B (SMC position): Liquidity, PD → 2 signals
Group C (Classic): RSI, EMA, Volume   → 3 signals
```

**Step 2:** Allocate weight equally across groups:
```
Each group gets 1/3 = 33.3% of total weight
```

**Step 3:** Within each group, allocate equally:
```
Group A: BOS=11.1%, OB=11.1%, FVG=11.1%
Group B: Liquidity=16.7%, PD=16.7%
Group C: RSI=11.1%, EMA=11.1%, Volume=11.1%
```

**Step 4:** Calculate implied max scores:
```
BOS: 100 × 11.1% = 11.1 pts
OB: 100 × 11.1% = 11.1 pts
(vs current BOS=25, OB=20)
```

**Key insight:** Carver's grouping reveals that our current weights over-concentrate on SMC signals (25+20+20=65 pts out of 100) vs classic indicators (5+5+5=15 pts). The SMC group has high intra-group correlation, meaning those 65 points do not represent 65 independent units of evidence.

### Option C: Optimization (When to Use)

Carver uses optimization only when:
- You have 5+ years of out-of-sample data
- You use bootstrap resampling, not point estimates
- You apply shrinkage toward equal weights
- You verify stability of weights across time periods

His optimization formula weights each signal proportional to its **net Sharpe ratio** (after costs):
```
wi ∝ SR_net_i / Σ SR_net_j
```

But he warns: estimated SRs from backtests are noisy. A signal showing SR=0.4 in-sample may genuinely be SR=0.2 out-of-sample. Shrink toward equal weights using:
```
w_final = α × w_optimized + (1-α) × w_equal
α = min(1.0, years_of_data / 10)
```

With our current backtest data (1 year), α = 0.1 — we should use 10% optimized weights and 90% equal weights.

---

## 5. Position Sizing: Volatility Targeting

This is Carver's second major contribution. Instead of sizing positions by fixed percentage of capital, size them by **target volatility**.

### The Core Formula

```
N = (Capital × Vol_target × Forecast/10) / (Price × Vol_instrument_annual)

where:
  Capital          = account equity
  Vol_target       = desired annual portfolio vol (e.g., 0.25 = 25%)
  Forecast         = current combined forecast (-20 to +20)
  Price            = instrument current price
  Vol_instrument   = instrument annual price volatility (not %)
```

For crypto perpetuals, adapting the formula:
```
Position_USD = Capital × Vol_target × (Forecast/10) / Vol_pct_annual

where Vol_pct_annual = daily_ATR/price × sqrt(365)
```

### Example with Our Bot
```
Capital = $10,000
Vol_target = 0.25 (25% annual — appropriate for crypto prop trading)
Forecast = 15 (strong signal)
BTC price = $95,000
ATR_daily = $950 (1% of price)
Vol_pct_daily = 0.01
Vol_pct_annual = 0.01 × sqrt(365) = 0.191

Position_USD = 10,000 × 0.25 × (15/10) / 0.191 = $19,634

With 5× leverage:
Margin = $19,634 / 5 = $3,927 (39.3% of capital)
```

Compare to our current fixed approach: 22.5% of capital × 5× = $11,250 notional regardless of signal strength or volatility.

### The Key Difference

Our current system sizes positions identically for a score of 70 and a score of 99. Carver's system automatically:
- Reduces position size when volatility is high (wider ATR → smaller position)
- Increases position size for stronger forecasts
- These two adjustments together keep risk approximately constant in dollar terms

### Vol Target Calibration

Carver's guidance on choosing Vol_target:
```
Optimal Vol_target ≈ Expected Sharpe Ratio (Kelly criterion derived)

If system SR = 0.5:  Vol_target = 0.50 (50%) — full Kelly
If system SR = 0.5:  Vol_target = 0.25 (25%) — half Kelly (recommended)
If system SR = 0.5:  Vol_target = 0.125 (12.5%) — quarter Kelly (for negative skew)
```

**For crypto with prop firm constraints:**
- Expected SR for our strategy: 0.3–0.5 (backtested)
- Half-Kelly: 15–25% annual vol target
- Prop firm 5% daily DD limit implies max ~2–3% daily vol budget
- 3% daily × sqrt(252) = 47.6% annual — so vol target of 20–25% is conservative and appropriate

---

## 6. The Instrument Diversification Multiplier (IDM)

When trading multiple instruments (our multi-pair expansion), positions for each instrument are scaled by the IDM:

```
Position_i = Base_position_i × IDM × instrument_weight_i

IDM = 1 / sqrt(W_inst × C_inst × W_inst_transpose)

where:
  W_inst = vector of instrument weights
  C_inst = correlation matrix of instrument returns
```

### IDM Values (Reference Table from Carver)
| Number of Instruments | All Correlated | Mixed | Uncorrelated |
|---|---|---|---|
| 1 | 1.0 | 1.0 | 1.0 |
| 2 | 1.0 | 1.2 | 1.4 |
| 3 | 1.0 | 1.5 | 1.7 |
| 5 | 1.0 | 1.7 | 2.2 |
| 10 | 1.0 | 2.0 | 3.2 |
| Max cap | — | — | 2.5 |

### Application to Our 5-Pair Portfolio

With BTC, ETH, SOL, LINK, and one more pair — all crypto perpetuals:
- Expected cross-correlations: 0.5–0.8 (high, same asset class)
- IDM estimate: approximately 1.3–1.5

**Without IDM:** Each pair sized at 4% × 5× = 20% notional
**With IDM=1.4:** Each pair sized at 4% × 1.4 × 5× = 28% notional

The IDM allows you to deploy more capital per instrument precisely because diversification reduces total portfolio vol. Without IDM, you are systematically under-deployed. **Critical for prop firm profitability.**

IDM is capped at 2.5. In practice for crypto (highly correlated), expect 1.2–1.5.

---

## 7. Trading Costs — The Ignored Killer

Carver dedicates an entire chapter to why most backtests are lying to you.

### Types of Costs
1. **Spread cost**: Half-spread paid on entry and exit
2. **Slippage**: Price moves against you during order execution
3. **Commission**: Exchange fees
4. **Funding rate** (crypto perpetuals): ongoing carry cost

### Cost Impact on Sharpe Ratio

Carver's formula for total annual cost drag:
```
Annual_cost_pct = (Commission + Spread + Slippage) × Trades_per_year / Capital
```

For limit orders specifically (what we use):
```
- Commission: ~0.02% per side (maker) on Bybit
- Spread: ~0% (we set the price, not market orders)
- Slippage: ~0% for limit orders that get filled passively
```

Carver notes that limit order systems have a structural advantage in cost: the fill rate is imperfect (some orders are never filled), but those that fill have near-zero market impact cost. **This is a genuine edge of our approach.**

### SR Hurdle Rate for Signal Viability

For a signal to survive costs, its pre-cost SR must exceed:
```
SR_hurdle = 2 × annual_cost_pct / Vol_target

Example: 0.1% per trade, 24 trades/year, Vol_target=0.25
Annual_cost = 0.1% × 24 × 2 = 4.8% (in/out)
SR_hurdle = 2 × 0.048 / 0.25 = 0.38
```

Any confluence component with a stand-alone SR below 0.38 destroys value. Most individual SMC indicators likely fall in the 0.15–0.30 range standalone — they only work in combination. This validates our confluence approach but also means we should exclude signals that add cost without proportional signal value.

### How to Include Costs in Backtest

Carver's recommended adjustment:
```
Fill_rate = 0.7–0.9 for limit orders (not all fill)
Net_PnL_per_trade = Gross_PnL × Fill_rate - Spread - Commission - Funding
```

For our 15M system trading ~8–15 times per month per pair:
- Monthly cost: 12 trades × (0.02% + 0.02%) × $11,250 = ~$54
- Annual cost on $10k account: ~$648 = 6.5% drag
- This is significant. Vol target of 25% means costs eat ~26% of vol-adjusted returns.

---

## 8. Handcrafting vs Optimization — When to Use Each

### Carver's Clear Answer

**Use handcrafting when:**
- Less than 5–10 years of data
- Fewer than 20–30 instruments/signals
- You have structural priors about signal groups (e.g., "all SMC signals are correlated")
- You want stability over time

**Use optimization when:**
- 10+ years of independent data
- Bootstrap resampling is feasible
- You have a large signal universe (50+ signals)
- Weights are shrunk heavily toward equal

**His core finding:** In-sample optimal weights consistently underperform equal weights out-of-sample when the calibration window is short. The Sharpe ratio of estimated weights peaks at approximately 7–10 years of calibration data. With 1 year of backtest data, optimized weights are anti-predictive — they overfit noise.

### Why Our Current Approach Risks Overfitting

Our confluence weights (BOS=25, OB=20, FVG=20...) were set by intuition, which is a form of handcrafting. If we then optimize these weights on 1-year backtests, we risk curve-fitting. Carver's guidance: keep intuitive/equal weights, prove the system works, then introduce modest optimization after 2–3 years of live performance data.

### The Degrees of Freedom Problem

Carver's heuristic: to reliably estimate N parameters, you need at least N × 10 independent data points. With 8 weights:
- Need: 80 independent trades minimum
- Independent meaning: not from the same trend/regime
- In practice: 200–500 trades for stable weight estimates

Our 1-year backtest likely has 80–200 trades on BTC. This is borderline. For alts with fewer signals, optimization of individual component weights is premature.

---

## 9. Kelly Criterion and Half-Kelly in Practice

### Full Kelly Formula

```
Kelly_fraction = E[R] / Var[R] = SR / Vol_target

For SR=0.5, Vol=0.5: Kelly = 0.5/0.5 = 1.0 (invest 100% in the strategy)
```

### Why Full Kelly Is Dangerous

Carver's warning is empirically grounded: full Kelly assumes your edge estimate is exactly correct. A 20% overestimate of SR leads to overbetting. The utility function for log-wealth is extremely concave near the Kelly point — being 10% over Kelly is worse than being 50% under Kelly.

**Kelly fraction vs geometric mean tradeoff:**
- f = Kelly: maximum long-run growth, but 50% drawdowns are expected
- f = 0.5× Kelly: growth is only ~25% less, but drawdowns are ~50% smaller
- f = 0.25× Kelly: excellent for negative-skew strategies (like ours — trend following with hard stops)

### Practical Application

```
Our strategy characteristics:
  - Has hard SL (negative skew — many small losses, few large gains)
  - Prop firm daily DD constraint: 5%
  - Backtested SR: ~0.3–0.5

Recommended position sizing: Quarter Kelly
  Vol_target = 0.25 × SR_estimate = 0.25 × 0.4 = 0.10 (10% annual vol)

With 10% vol target:
  Position_USD = 10,000 × 0.10 / 0.191 = $5,236
  Margin at 5×: $1,047 (10.5% of capital per trade)
```

This is significantly more conservative than our current 22.5%. Carver would argue this is appropriate for a strategy with a hard stop loss (which creates negative skew) operating under prop firm daily DD rules.

---

## 10. Portfolio-Level Risk Management

### Endogenous vs Exogenous Risk Management

**Endogenous (built in):** Volatility targeting automatically reduces positions when vol rises. No manual intervention needed. If BTC goes into a volatile regime (ATR doubles), position size halves automatically.

**Exogenous (overlay layer):** Additional rules applied on top of the system:

```python
# Carver's Risk Overlay Logic
risk_multiplier = 1.0

# Component 1: Vol spike filter
if current_vol > 1.5 × historical_vol_99th_pct:
    risk_multiplier *= 0.5

# Component 2: Correlation shock filter
if max_correlation > 0.9:  # all assets moving together
    risk_multiplier *= 0.5

# Component 3: Drawdown reduction
if portfolio_dd > 0.15 * capital:
    risk_multiplier *= max(0, 1 - (dd - 0.15) / 0.10)

# Apply multiplier to all positions simultaneously
position_i *= risk_multiplier
```

**For our bot:** The endogenous layer is already partially implemented via our ATR filter (reject if ATR/price > 3%). The exogenous layer should be our circuit breaker — reduce all positions when portfolio DD exceeds threshold.

### Portfolio Heat Management (Carver's Concept)

Rather than per-trade position limits, manage **total portfolio vol**:

```
Portfolio_Vol = sqrt(Σ Σ w_i × w_j × σ_i × σ_j × ρ_ij)

where ρ is the correlation between pairs
```

When portfolio vol exceeds target, reduce all positions proportionally rather than arbitrary per-pair limits. This is more principled than our current "max 2 pairs active simultaneously" rule.

For 5 crypto pairs with average correlation of 0.6:
```
Solo vol: 25% each
Portfolio vol with 5 pairs: 25% × sqrt(0.6 + 0.4/5) ≈ 20.6%
IDM = 25/20.6 = 1.21
```

---

## 11. Static vs Dynamic Allocation

### Static Allocation (Carver's Recommendation for Most Traders)

Assign fixed instrument weights, fixed rule weights, and only adjust positions based on:
1. Forecast signal changes
2. Volatility changes (for position sizing)

Do NOT try to:
- Rotate between instruments based on momentum
- Adjust rule weights based on recent performance
- Time the market with macro overlays

**Why:** The meta-strategy of adjusting your strategy is itself a strategy that needs calibration. It typically destroys value because the signals for when to rotate are noisy and costly.

### Dynamic Allocation (When It Works)

Carver's conditions for dynamic allocation being justified:
1. Instrument universe is large (20+ instruments)
2. The "signal for the signal" has 10+ years of track record
3. Costs of rotation are explicitly modeled

**For our 5-pair system:** Static allocation is correct. Assign equal weights to all 5 pairs, size by vol targeting, and let the forecasts drive position changes.

---

## 12. Direct Application to Our Confluence System

### Current Architecture → Carver Framework Mapping

| Our System | Carver Equivalent | Gap |
|---|---|---|
| Confluence score 0–100 | Scaled forecast | Score not normalized |
| Hard threshold 70 | Forecast cap | Binary, loses information |
| Fixed weights (BOS=25) | Forecast weights | Not calibrated, high SMC concentration |
| Position size = 22.5% fixed | Position = vol-targeted | Ignores signal strength and volatility |
| No FDM | FDM not applied | Correlated signals double-counted |
| Per-trade SL | Volatility targeting | Both valid, but not integrated |
| No IDM for multi-pair | IDM not applied | Under-deployed capital |

### Recommended Migration Path

**Phase 1 (Immediate — no code changes to trading logic):**
- Map confluence score to continuous forecast: `forecast = (score - 50) / 2.5` → range [-20, +20]
- Apply score of 50 as the "flat" point (no position), not 0
- Positions below threshold (score < 70 = forecast < 8) still get reduced position, not zero

**Phase 2 (Backtest validation needed):**
- Replace fixed 22.5% position with vol-targeted sizing
- `Position_USD = Capital × 0.20 × (forecast/10) / Vol_pct_annual`
- This scales position by both signal strength and market volatility

**Phase 3 (After 1+ year live data):**
- Calculate empirical signal correlations → compute FDM
- Calculate cross-pair correlations → compute IDM
- Optionally handcraft group weights (SMC / positioning / classic)

### One Critical Warning from Carver

> "The biggest mistake traders make is optimizing their rule parameters and signal weights on the same data they used to develop the rules. The in-sample optimal set always looks better than it will perform. Always test on data your system never saw."

This applies directly to our current BTCUSDT calibration: if we designed the confluence weights while looking at BTC charts, and then validated on the same BTC data, we have in-sample contamination. The solution is walk-forward testing — develop weights on the first 70% of data, validate strictly on the last 30%.

---

## Summary: Key Numbers to Remember

| Parameter | Carver Value | Our Current | Recommended |
|---|---|---|---|
| Forecast range | -20 to +20 | 0–100 score | Map score → forecast |
| Target avg |abs(forecast)| = 10 | N/A | Normalize |
| Forecast cap | ±20 | Hard threshold at 70 | Soft scaling |
| Vol target (half-Kelly) | SR × 0.5 | Fixed 22.5% | 15–25% of capital |
| Position at avg forecast | 1× base | Always 1× | Scales with forecast |
| Max position (forecast=20) | 2× base | N/A | Cap 2× |
| Min data for optimization | 5–10 years | 1 year | Use equal/handcraft |
| FDM for 8 correlated signals | ~1.3 | Not applied | Apply in Phase 3 |
| IDM for 5 crypto pairs | ~1.2–1.4 | Not applied | Apply in Phase 2 |
| Kelly fraction (negative skew) | Quarter Kelly | N/A | 0.25× |

---

## Caveats and Gotchas

1. **Carver's system is trend-following (futures, longer timeframe).** Our system is mean-reverting on 15M. Forecast scaling concepts apply, but the sign of forecast may need inversion (we want to sell RSI>65, not buy it).

2. **Vol targeting requires real-time ATR updates.** If ATR spikes intraday, position should be reduced before next entry. Our current system recalculates ATR per candle — this is compatible.

3. **FDM can exceed position limits if signals all fire simultaneously.** Cap total position at 2× base regardless of FDM calculation.

4. **IDM assumes correlations are stable.** In crypto, correlations spike to 0.9+ during macro shocks (FED, crypto contagion). Build in a correlation shock filter as part of the risk overlay.

5. **Carver explicitly warns against strategies with positive skew (many small wins, occasional large losses)** as needing LESS leverage than Kelly suggests. Our strategy has negative skew (small wins, stopped out), which paradoxically allows more leverage — but the prop firm DD constraint overrides this.

6. **The "boring system" insight from Leveraged Trading:** Carver shows that a simple 2-rule system (trend + carry) on a single instrument, sized correctly, outperforms many complex systems with poor sizing. Rule: nail position sizing before adding signals.

Sources:
- [Systematic Trading 3 - Frameworks and Forecasts](https://the7circles.uk/systematic-trading-3-frameworks-and-forecasts/)
- [Systematic Trading 4 - Volatility Targeting and Position Sizing](https://the7circles.uk/systematic-trading-4-volatility-targeting-and-position-sizing/)
- [pysystemtrade GitHub](https://github.com/robcarver17/pysystemtrade)
- [This Blog is Systematic: Correlations, Weights, Multipliers](https://qoppac.blogspot.com/2016/01/correlations-weights-multipliers.html)
- [This Blog is Systematic: Forecast Scalars](https://qoppac.blogspot.com/2016/01/pysystemtrader-estimated-forecast.html)
- [This Blog is Systematic: Risk Overlay](https://qoppac.blogspot.com/2020/05/when-endogenous-risk-management-isnt.html)
- [This Blog is Systematic: Handcrafting Method](https://qoppac.blogspot.com/2018/12/portfolio-construction-through_7.html)
- [Rob Carver: Instrument Diversification](https://qoppac.blogspot.com/2023/03/i-got-more-than-99-instruments-in-my.html)
- [CXO Advisory Review](https://www.cxoadvisory.com/big-ideas/a-few-notes-on-systematic-trading/)
- [Leveraged Trading Book Page](https://harriman.house/books/leveraged-trading/)

# Advanced Backtesting Methodology

**Date:** 2026-04-06
**Author:** Learner Agent (research compilation)
**Sources:** Bailey & Lopez de Prado (2014, 2016), Zarattini (2025), academic literature

---

## Table of Contents

1. [Common Pitfalls & How to Avoid](#1-common-pitfalls--how-to-avoid)
2. [Walk-Forward Analysis](#2-walk-forward-analysis)
3. [Monte Carlo Simulation](#3-monte-carlo-simulation)
4. [Statistical Significance Testing](#4-statistical-significance-testing)
5. [Overfitting Detection](#5-overfitting-detection)
6. [Triple Barrier Method](#6-triple-barrier-method)
7. [Proper Train/Test Splits](#7-proper-traintest-splits)
8. [Combinatorial Purged Cross-Validation](#8-combinatorial-purged-cross-validation)
9. [Actionable Insights for Our Bot](#9-actionable-insights-for-our-bot)

---

## 1. Common Pitfalls & How to Avoid

### 1.1 Look-Ahead Bias — The Silent Killer

Look-ahead bias occurs when a strategy uses information that could not have been available at the moment the trading decision was made. In bar-by-bar backtests this is the most common and most dangerous bug.

**Classic examples in our context:**

- **Indicator on closing price of the current bar.** If your signal fires during candle formation using the not-yet-closed close price, you are consuming future information. Rule: all indicator calculations must use `candles[0..n-1]`, never the candle that just opened.
- **ATR calculated on the current candle.** The ATR period includes the bar currently being processed. This looks like a one-bar lookahead but compounds across the indicator window.
- **OB detection using the impulse candle itself.** If you detect a Bullish OB using the candle at index `i` and immediately allow an entry on the same candle, the fill is priced with knowledge of where that candle closed.
- **Volume ratio on the live bar.** A volume ratio of 2.5× sounds like confirmation, but it only reads 2.5× because the bar has already closed — you could not have known this in real-time before the bar closed.
- **Training a scaler/normalizer on the full dataset then running the backtest.** The mean and std used for normalization include future data.

**Detection method (practical):**

Introduce an artificial 1-bar delay to every signal. If the Sharpe ratio or win rate collapses by more than 30%, the original result was likely driven by look-ahead. A clean strategy should degrade gracefully with a 1-bar offset.

Additionally: any backtest with a Sharpe ratio above 2.0 on 15M crypto data, an equity curve that looks like a straight line, or annual returns above 50% on a low-parameter system should be treated as suspicious and immediately audited for look-ahead.

**Prevention checklist:**
- [ ] All indicator values computed on `close[1]` (previous closed bar), not `close[0]`
- [ ] OB, FVG, structure detection deferred by one bar after the qualifying pattern completes
- [ ] Walk-forward: fit all transforms (ATR normalization, etc.) on IS window only, apply frozen to OOS window
- [ ] Code review: each data access point annotated with "available at signal time: YES/NO"

### 1.2 Overfitting / Curve Fitting

Overfitting in trading backtests does not require a neural network. It happens any time you run N configurations and report the best one. With as few as 7 trials on the same dataset, random chance starts to dominate.

The key insight from Bailey & Lopez de Prado (2014): **with 200 parameter trials on the same data, the expected out-of-sample Sharpe ratio of the "best" in-sample strategy is approximately zero — regardless of how good the in-sample Sharpe was.**

A large-scale study of 888 Quantopian strategies found in-sample Sharpe had an R² of less than 0.025 in predicting out-of-sample Sharpe. This is indistinguishable from zero predictive power.

**Signs of overfitting:**
- Performance degrades sharply when any parameter changes by 10%
- Each optimization round finds a different "best" configuration
- WFA out-of-sample efficiency below 50%
- The equity curve is smooth but clustered around specific market conditions
- Strategy only works on one specific 6-month window

**The N-trials problem:** Every time you run a backtest and adjust a parameter based on the result, you have consumed one degree of freedom. Your effective sample for statistical inference shrinks with each trial. There is no reliable way to run 50 parameter combinations and then treat the best result as statistically valid on the same data. This is called "multiple testing inflation."

### 1.3 Data Snooping / Selection Bias

Data snooping is overfitting at the strategy level rather than the parameter level. If you discard 5 strategy variants because they "looked bad" in the backtest and report only the 6th, you have data-snooped your way to a false result.

This is particularly insidious in a team context where many strategy ideas are tested informally before a "final" backtest is run. The final backtest inherits all the degrees of freedom from the informal trials, even if those trials were never recorded.

**Rule:** Before running a backtest, write down the hypothesis. After the backtest, report the result whether it confirms or refutes the hypothesis. The hypothesis-first discipline eliminates the majority of snooping risk.

### 1.4 Survivorship Bias in Crypto

For multi-pair strategies, survivorship bias is a real risk. Crypto datasets typically include only coins that are currently listed on the exchange. Coins that were delisted, rugged, or collapsed to zero are absent from the historical data.

**Quantified impact (Ammann et al., SSRN 2022, data 2014–2021):**
- Value-weighted portfolio: annualized bias of 0.93%
- Equal-weighted portfolio: annualized bias of 62.19%
- Size effect premium overestimated by 50%

For our 5-8 pair strategy focused on BTC/ETH/SOL/established alts: the survivorship bias is minimal because all our target pairs are large-cap with long trading histories. It becomes relevant only if we expand to smaller pairs or run multi-coin rotation strategies.

**Practical rule for our bot:** Restrict backtesting to pairs that existed before 2021 and have continuous USDT Perpetual data on Bybit. Any pair added after 2023 must be flagged and its performance discounted by a survivorship factor.

### 1.5 Slippage and Commission Modeling

This is consistently the most underestimated factor. A system showing 20% annual returns might deliver 8% after realistic friction.

**Bybit USDT Perpetual specific costs:**

| Cost type | Realistic estimate |
|-----------|-------------------|
| Maker fee (limit entry) | 0.02% per side |
| Taker fee (market SL hit) | 0.055% per side |
| Funding rate (8h, held overnight) | ±0.01% per 8h period |
| Slippage on limit order | 0–0.02% (rarely fills at exact price) |
| Slippage on SL market order | 0.05–0.15% (wider in volatile moves) |

**Realistic round-trip cost estimate:**
- Limit entry + limit TP: 0.04% (maker both sides)
- Limit entry + market SL: 0.075%
- With moderate slippage: 0.08–0.12% round trip

For a strategy with 20 trades/month and 0.10% average round trip cost, monthly drag is 2.0%. This erases a large fraction of typical SMC strategy returns.

**Asymmetric slippage reality:** SL orders execute as market orders at the worst moment — during rapid directional moves when bid-ask spreads widen. A 0.1% SL slippage estimate is conservative; in a BTC flash crash or a liquidity sweep candle, slippage on a $100K notional position can reach 0.3–0.5%.

**Funding rate trap:** Holding a long BTC position during a bullish trend means funding is paid (not received). A 0.01% per 8h funding rate on a $11,250 notional position costs $1.13 every 8 hours = $3.38/day. Over a 5-day hold, that is $16.88 drag per trade.

**Recommendation:** In our backtester, model costs as:
```
roundTripCost = makerFee × 2 + slippageFixed + slippageVariable × ATR%
fundingDrag = holdingPeriodBars × (15/480) × fundingRate × notional
```

Always run both "zero slippage" and "realistic slippage" scenarios. If a strategy is only profitable at zero slippage, discard it.

---

## 2. Walk-Forward Analysis

### 2.1 What It Is and Why It Matters

Walk-Forward Analysis (WFA) is the accepted gold standard for strategy validation. It directly simulates the live trading workflow: optimize on past data, deploy on unseen future data, re-optimize periodically.

**Standard WFA process:**

```
Data: [Jan 2024 ─────────────────────── Dec 2024]

Step 1:  [IS: Jan–Jun]  →  Optimize  →  [OOS: Jul]  →  Record OOS result
Step 2:  [IS: Feb–Jul]  →  Optimize  →  [OOS: Aug]  →  Record OOS result
Step 3:  [IS: Mar–Aug]  →  Optimize  →  [OOS: Sep]  →  Record OOS result
...
Step 6:  [IS: Jun–Nov]  →  Optimize  →  [OOS: Dec]  →  Record OOS result

Concatenate all OOS periods → true WFA equity curve
```

The WFA equity curve uses only out-of-sample data, making it a near-realistic simulator of live performance.

### 2.2 Anchored vs Rolling Windows

| Type | Description | When to use |
|------|-------------|-------------|
| Rolling (fixed-length IS) | IS window moves forward; oldest data dropped | More regime-adaptive; prefer when markets change character over time |
| Anchored (expanding IS) | IS window always starts from day 1 | More data efficiency; prefer for strategies with small trade counts |

For BTC 1Y data with ~150–240 trades, **rolling windows are preferred** to avoid the oldest (2024 Q1) regime dominating the optimization when we reach Q4.

### 2.3 Walk-Forward Efficiency (WFE)

The key metric for interpreting WFA results:

```
WFE = Annualized_OOS_Return / Annualized_IS_Return × 100%
```

| WFE | Interpretation |
|-----|---------------|
| > 85% | Excellent — minimal performance decay |
| 50–85% | Acceptable — some overfitting, still tradeable |
| < 50% | Overfit — discard or radically simplify |
| < 0% | Severely broken — in-sample result is noise |

**Critical caveat from Unger Academy research:** Most traders misuse WFA by optimizing on the full IS window just once, not re-optimizing at each WFA step. If you optimize once on all data and then "walk forward", you have introduced look-ahead bias into the optimization itself.

### 2.4 What WFA Cannot Tell You

WFA detects parameter instability and regime sensitivity. It does NOT:
- Guarantee performance in unseen regimes (e.g., a regime not present in 2024)
- Eliminate execution slippage effects
- Account for crowded strategy degradation (when many algos find the same pattern)
- Validate strategy concepts that are fundamentally flawed

This is why WFA must be combined with Monte Carlo and held-out test periods.

---

## 3. Monte Carlo Simulation

### 3.1 Two Distinct Methods

**Method A: Trade Sequence Permutation (Robustness Test)**

Shuffle the order of trades from the backtest without replacement. Run 2,000–10,000 permutations. This answers: "How much of our performance depends on the specific sequence of trades (luck of timing) vs. the underlying edge?"

Outputs:
- Distribution of max drawdowns across all permutations
- 95th percentile drawdown (DD_95)
- Probability that real max drawdown exceeds X% given this trade distribution

**Method B: Bootstrap Resampling (Statistical Inference)**

Resample trades with replacement. Some trades appear multiple times; others are skipped. This tests: "What if our underlying win rate and R-multiple distribution sampled differently?"

Outputs:
- Confidence interval for Win Rate (e.g., true WR is 52%–61% at 95% confidence)
- Confidence interval for Profit Factor
- Probability of ruin given current position sizing

### 3.2 Practical Implementation for Our Bot

Minimum viable MC implementation:
```
1. Run backtest → collect trade_outcomes[] = array of P&L per trade
2. For i = 1..5000:
   a. Shuffle trade_outcomes (Method A) OR resample with replacement (Method B)
   b. Compute max drawdown, total return, Sharpe
3. Report percentile distribution: P10, P25, P50, P75, P90, P95, P99
```

**Interpretation rules:**
- DD_95 (95th percentile drawdown across 5,000 permutations) is your "realistic worst case"
- If DD_95 > HyroTrader's 10% max drawdown limit → position size too large
- Accept strategy only if P25 return > 0 (strategy is profitable in 75% of scenarios)

**Minimum trade count:** Monte Carlo requires at least 30–50 trades to produce meaningful distributions. Below 30 trades, the randomization does not generate enough scenario diversity. For institutional confidence: 200+ trades.

For our per-pair backtests generating 150–240 trades/year: MC is valid but confidence intervals will be wider than ideal. This is why we maintain a minimum 6-month IS window (~80–120 trades) for parameter decisions.

### 3.3 What Monte Carlo CANNOT Do

MC resamples historical trades. If those trades were all generated in a bull market, MC only shows you bull-market scenario distributions — it cannot invent bear-market scenarios. MC is a stress test of execution variance and statistical uncertainty, not a simulation of unseen market regimes.

To stress-test for unseen regimes: use scenario analysis (manually remove all Q1 trades, re-run backtest; remove all high-volatility trades, re-run; etc.).

---

## 4. Statistical Significance Testing

### 4.1 Minimum Trades Required

The Central Limit Theorem gives us the floor: n ≥ 30 trades to apply t-tests and compute confidence intervals. But "can compute" and "should trust" are different standards.

| Trade count | What you can conclude |
|-------------|----------------------|
| < 30 | Nothing statistically valid; descriptive only |
| 30–100 | Basic significance tests, wide confidence intervals |
| 100–200 | Sharpe of 1.0+ is significant at 95% confidence |
| 200+ | Institutional-grade, can test for strategy edge |
| 200+ across 2–3 market cycles | Regime-robust inference |

**Key asymmetry:** 500 trades in 6 months (single regime) is less reliable than 150 trades over 3 years spanning bull + bear + ranging.

For our BTCUSDT 1Y backtest with ~200 trades: we are at the minimum viable threshold for meaningful statistical inference. The confidence intervals on WR and PF are wide (~±5–8 percentage points at 95% CI). Do not over-interpret differences smaller than this margin.

### 4.2 Probabilistic Sharpe Ratio (PSR)

The standard Sharpe ratio is biased upward for non-normal return distributions (which ALL trading strategies have — fat tails, positive skew in good strategies). The PSR corrects for this.

**PSR formula intuition:**
```
PSR(SR*) = Φ[ (SR_observed - SR*) × sqrt(n-1) / sqrt(1 - skew×SR + (kurtosis-1)/4 × SR²) ]
```

Where SR* is a benchmark Sharpe (typically 0 for "is this better than random?" or 1.0 for "is this meaningfully good?").

PSR > 0.95 means: with 95% probability, the true underlying Sharpe is above SR*.

**Practical use:** After any backtest, compute PSR against SR* = 1.0. If PSR < 0.95, the strategy has not demonstrated a meaningful edge at the available sample size.

### 4.3 Deflated Sharpe Ratio (DSR)

The DSR extends PSR to account for multiple testing. Every time you tested an alternative configuration and discarded it, you inflated the probability that your final result is random. The DSR corrects for this inflation.

**DSR formula component:**
```
DSR(SR*) = PSR(SR*_adjusted)
where SR*_adjusted accounts for the number of trials performed
```

If you ran 20 parameter combinations: DSR internally raises the effective benchmark Sharpe to account for the 20 "draws" from the distribution of strategies. A strategy that looks like Sharpe 1.5 after 20 trials may have a DSR consistent with Sharpe 0.8 adjusted for selection.

**Rule for our bot:** When reporting calibration results, log the number of trials (parameter combinations tested). Require DSR > 0.95 before accepting a calibrated parameter set. This is not yet implemented in our pipeline.

### 4.4 Minimum Backtest Length Formula

Lopez de Prado's MinBTL (Minimum Backtest Length):

```
MinBTL = [(Z_α/2 / SR_annualized)²] × (1 - skew × SR + (kurtosis-1)/4 × SR²) years
```

For a strategy with Sharpe 1.0, normal returns, 95% confidence (Z = 1.96):
```
MinBTL ≈ 1.96² / 1.0² = 3.84 years
```

This means: to validate a Sharpe 1.0 strategy at 95% confidence with normal returns, you need nearly 4 years of data. With fat tails (kurtosis > 3), you need more.

**Implication for our 1Y backtest:** We cannot validate a strategy at 95% confidence from one year of data. We can achieve ~70% confidence. This is acceptable for deployment given our iterative approach, but all results should be treated as preliminary until multi-year validation is available.

---

## 5. Overfitting Detection

### 5.1 Parameter Sensitivity Heatmap

The most practical overfitting detection method for our use case. For any two parameters being optimized, generate a 2D grid of performance (WR, PF, or Sharpe) and plot as a heatmap.

**Robust parameter region:** The "island" of good performance should be wide and smooth — changing either parameter by 10–20% should produce only gradual degradation.

**Overfit signature:** A sharp peak surrounded by degraded regions. If parameter A=20 gives WR 62% but A=18 gives WR 48% and A=22 gives WR 50%, the "optimal" A=20 is almost certainly noise-fit.

**Rule:** Accept a parameter value only if ±10% change around it keeps performance within 80% of the peak value.

### 5.2 Probability of Backtest Overfitting (PBO)

Bailey, Borwein, Lopez de Prado, and Zhu (2014) formalized PBO using Combinatorially Symmetric Cross-Validation (CSCV):

```
Method:
1. Split backtest data into T equal sub-periods
2. Generate all C(T, T/2) ways to split into "training" and "test" halves
3. For each split: find best parameter in training half, evaluate it on test half
4. PBO = fraction of splits where the IS-best strategy underperforms the median OOS strategy
```

**Interpretation:**
- PBO < 10%: Very low overfitting risk
- PBO 10–30%: Moderate risk, proceed with caution
- PBO > 50%: Strategy is overfit to historical noise

For our ablation-based calibration (testing 8 configurations: baseline + 7 one-component-removed variants), PBO is naturally low because we have few trials. For a grid search over 50+ configurations, PBO becomes a mandatory check.

### 5.3 Stationarity of Parameters Over Time

A robust strategy should require similar parameter values in each WFA optimization window. If the optimal ATR multiplier is 1.5 in Q1, 2.8 in Q2, and 1.1 in Q3, the strategy does not have stable underlying physics — it is regime-adapting in ways that will not generalize.

**Check:** After completing WFA, plot the "optimal" parameter from each IS window over time. If variance is high (CV > 30%), the strategy's parameters are not stationary.

### 5.4 Complexity Penalty (Information Ratio Adjusted)

More complex strategies (more parameters) require higher OOS performance to justify their complexity. A heuristic from quantitative practice:

```
Adjusted_Sharpe = Sharpe × sqrt(1 - n_params / n_trades)
```

For a 200-trade backtest with 8 free parameters:
```
Adjusted_Sharpe = Sharpe × sqrt(1 - 8/200) = Sharpe × 0.98
```

For 200 trades with 30 parameters (full grid search result):
```
Adjusted_Sharpe = Sharpe × sqrt(1 - 30/200) = Sharpe × 0.87
```

This means that optimizing 30 parameters on 200 trades costs you 13% of your apparent Sharpe. At higher parameter counts relative to trades, the penalty becomes prohibitive.

**Rule for our bot:** We have 8 scoring weights + 3 multipliers (SL, TP, trailing) = 11 parameters. With 200 trades, penalty factor = sqrt(1 - 11/200) = 0.972. Acceptable. Any expansion beyond 15 free parameters requires expanding to 2Y data minimum.

---

## 6. Triple Barrier Method

### 6.1 What It Is

The Triple Barrier Method (Lopez de Prado, 2018, "Advances in Financial Machine Learning") is a framework for labeling trade outcomes that closely mirrors how actual trades are managed. It places three "barriers" around each entry:

- **Upper barrier (TP):** Fixed percentage or ATR multiple above entry — if hit first, label = +1 (profit)
- **Lower barrier (SL):** Fixed percentage or ATR multiple below entry — if hit first, label = -1 (loss)  
- **Vertical barrier (time):** Maximum holding period — if neither TP/SL hit, label = 0 (neutral/timeout)

### 6.2 Why It Matters for Our Strategy

Traditional backtesting labels trades by fixed-time horizon: "what was the price 5 bars later?" This approach has two critical flaws:

1. **Ignores our actual execution:** We have explicit SL and TP orders. The fixed-time approach cannot capture the asymmetric payoff structure.
2. **Heteroskedasticity blindness:** A 1% move means very different things during a BTC flash crash (normal volatility event) vs. a quiet consolidation period (unusual move). ATR-normalized barriers are more stationary.

The Triple Barrier approach directly models the TP1 + SL payoff structure we already use. This means our backtest results are natively Triple Barrier labeled — we are already doing this correctly at the trade execution level.

### 6.3 Meta-Labeling Extension

Lopez de Prado proposes a "meta-label" layer on top of primary signals: a secondary model that predicts "given this primary signal fired, should we actually trade it?"

**Application for our scorer:** The primary layer is the confluence score threshold (≥70 pts → signal). A meta-label layer would predict: given that the confluence score is between 70–79 points (borderline signal), what is the probability it becomes a winning trade?

The meta-label can use features not in the primary signal: day of week, session (Asian/London/NY), recent win streak, volatility regime, funding rate direction.

In our current single-phase system, this is equivalent to adding Phase 2 filters (session, DOW, regime). The meta-labeling framework gives formal justification for this architecture.

### 6.4 Time Stop Implementation

The vertical barrier (time stop) is a concept we currently under-utilize. Time stops:
- Prevent capital being stuck in "frozen" trades during ranging markets
- Reduce max holding period variance
- Improve capital turnover (more trade opportunities per unit time)

**Recommendation:** Implement an explicit `maxBarsInTrade` parameter. For our 15M strategy targeting 1-3% moves:
- Maximum reasonable hold: 48 bars = 12 hours (covers Asian + London sessions)
- Any trade still open after 48 bars: close at market regardless of TP/SL
- Backtest implication: label these trades separately (timeout vs. TP vs. SL) and analyze their separate distributions

---

## 7. Proper Train/Test Splits

### 7.1 The Three-Region Framework

For proper strategy validation, data must be split into three non-overlapping regions with strict temporal ordering:

```
[Training (60%)][Validation (20%)][Test (20%)]
     ↑                  ↑               ↑
  Optimize          Tune/select    Final verdict
  parameters        strategy        (once only)
  (WFA here)        variants
```

**Critical rule:** The test set is used exactly ONCE. If you look at test set performance and then go back to adjust anything in training or validation, you have invalidated the test set. It is now contaminated validation data.

### 7.2 Applied to Our 1Y BTC Dataset

For 12 months of 2024 data (~150–240 trades):

```
[Jan–Aug = 8 months IS][Sep–Oct = 2 months Val][Nov–Dec = 2 months Test]

IS portion:
  WFA splits: 6 rolling 3M windows
  Ablation study: run within IS only
  Weight calibration: run within IS only

Validation:
  Compare strategy variants calibrated on IS
  Select the best-performing variant (by WR + PF combined)
  This "selects" but does not further optimize

Test (held-out, untouched until final sign-off):
  Run selected configuration once
  Report result — this is the "true" OOS number
  If this fails, the strategy is not ready; do NOT re-optimize
```

**Current gap in our pipeline:** The test set (Nov–Dec 2024) must be physically protected — ideally stored in a separate file that scripts cannot access until the `--final-test` flag is explicitly passed. This prevents accidental contamination.

### 7.3 Rolling Window Anchor Points for WFA

Concrete WFA schedule for 8-month IS block (Jan–Aug 2024):

| WFA Round | IS period | OOS period |
|-----------|-----------|------------|
| 1 | Jan–Mar (3M) | Apr (1M) |
| 2 | Feb–Apr (3M) | May (1M) |
| 3 | Mar–May (3M) | Jun (1M) |
| 4 | Apr–Jun (3M) | Jul (1M) |
| 5 | May–Jul (3M) | Aug (1M) |

Concatenate all OOS months (Apr–Aug) for WFA equity curve = 5 months of OOS data.
This is the primary validation signal for calibration quality.

### 7.4 Multi-Pair Temporal Alignment

For multi-pair strategies, all pairs must use identical date splits. A common error: calibrate BTCUSDT on Jan–Jun, ETHUSDT on Mar–Sep, then compare their validation scores. The different time windows make comparison invalid. All pairs must be evaluated on the same calendar periods.

---

## 8. Combinatorial Purged Cross-Validation

### 8.1 The Problem With Standard WFA

Standard WFA produces only one OOS equity curve — the concatenated sequence of OOS windows. This gives a point estimate of performance but does not produce a distribution. You cannot compute a confidence interval from one trajectory.

CPCV (Lopez de Prado, 2018) solves this by generating multiple independent backtest paths from the same data.

### 8.2 How CPCV Works

```
Split data into N groups (e.g., N = 6 for 1Y monthly data)
For each combination of k groups as "test" (e.g., k = 2):
  Train on remaining N-k groups (with purging and embargo)
  Test on the k held-out groups
  Record equity curve fragment

Number of test paths = C(N, k)
For N=6, k=2: C(6,2) = 15 distinct paths
```

**Purging:** Any training observation whose "outcome window" overlaps with the test period is removed. For our strategy: if a trade opens in the last 3 bars of the IS window and its SL/TP could be hit in the first bar of the OOS window, that trade is "purged" from IS training.

**Embargo:** After the end of each test period, a fixed buffer of observations is also removed from training. This prevents serial correlation (market microstructure echoes) from leaking information.

### 8.3 What CPCV Enables That WFA Cannot

From 15 equity curve paths (N=6, k=2):
- Compute Sharpe ratio distribution → true confidence interval
- Compute Probability of Backtest Overfitting → PBO score
- Compute expected maximum drawdown distribution
- Test whether the strategy is significantly better than a benchmark across all paths

**CPCV in practice for our 1Y BTC backtest:**
- N = 12 (monthly), k = 2 → C(12,2) = 66 paths
- This is computationally feasible for our bar-by-bar backtester
- Result: 66 Sharpe estimates → take the median as point estimate, 5th/95th percentile as confidence interval

### 8.4 Implementation Priority

CPCV is more complex to implement than standard WFA. Suggested prioritization:

1. **Immediate (already done):** Standard rolling WFA
2. **Next:** Monte Carlo permutation on trade sequence
3. **Future:** Full CPCV implementation for strategy certification

CPCV is most valuable when deciding whether a strategy is ready for live trading with real capital, not during the iterative calibration phase.

---

## 9. Actionable Insights for Our Bot

This section focuses on what is currently MISSING or WEAK in our backtesting pipeline, based on the research above.

### 9.1 What We Have (Confirmed Strong)

- Bar-by-bar backtest simulator (correct temporal ordering)
- Walk-forward analysis with rolling windows
- Monte Carlo trade permutation (5,000 iterations)
- Realistic fee modeling (maker/taker)
- Held-out test period concept (Nov–Dec 2024)
- Ablation study for component importance
- ATR-normalized Triple Barrier execution (SL/TP as ATR multiples)

### 9.2 Critical Gap 1 — Slippage Is Undermodeled

**Current state:** Fixed 0.05% slippage or none.

**Problem:** SL orders execute as market orders in fast-moving candles. In BTC flash moves (the exact candles that trigger SL), bid-ask spreads widen to 0.1–0.3%. Our current model systematically underestimates the cost of losing trades.

**Fix:** Implement variable slippage model:
```typescript
const slippage = isMarketOrder
  ? baseSlippage + atrMultiplier × currentATR_pct  // SL executions
  : baseSlippage;  // limit entries
```
Where `atrMultiplier ≈ 0.15` and `currentATR_pct` is the ATR at signal time.

Re-run all calibrated backtests with this model. Expect WR to stay the same but net P&L to drop 5–15%.

### 9.3 Critical Gap 2 — Funding Rate Not Modeled

**Current state:** Funding rate not included in P&L calculation.

**Problem:** BTC USDT Perpetual funding averages +0.01% per 8h when market is bullish. A long position held for 24 hours pays 3 × 0.01% = 0.03% in funding. For a $11,250 notional: $3.38/day. A trade held 3 days: ~$10 drag.

At 20 trades/month with average 2-day hold: ~$13 per trade × 20 = $260/month funding drag on a $10K account = 2.6% monthly drag (before other costs). This is catastrophic for a strategy targeting 3–4%/month.

**Fix:** Add `fundingRateEstimate` to trade P&L calculation. Use historical funding rate data from Bybit (available via REST API: `GET /v5/market/funding/history`). Default to +0.01% per 8h for long positions when actual data unavailable.

### 9.4 Critical Gap 3 — No Time Stop Implementation

**Current state:** Trades held until SL or TP hit. No maximum duration limit.

**Problem:** In ranging/consolidating markets, trades can sit open for 48–96 hours, tying up capital and accumulating funding cost without directional conviction.

**Fix:** Add `maxBarsInTrade: 48` (12 hours on 15M) to strategy config. Trades exceeding this are closed at the midprice of the final bar. Track these separately in the reporter as "timeout" outcomes. Analyze their WR and average P&L independently — if timeouts are net-negative, the time stop is protecting capital.

### 9.5 Critical Gap 4 — Held-Out Test Set Not Enforced

**Current state:** The concept exists but no code enforces that scripts cannot access Nov–Dec 2024 data.

**Problem:** Any time a calibration script accidentally includes Nov–Dec data in optimization, the held-out test is contaminated. Once contaminated, the test is worthless.

**Fix:** Add a `--include-holdout` flag to the backtest engine. By default, all calibration scripts exclude the held-out period. The holdout is only run when explicitly passing `--include-holdout --final-verdict`. Log this invocation with a timestamp so we know exactly how many times it was used.

### 9.6 Critical Gap 5 — Deflated Sharpe Not Computed

**Current state:** We report raw Sharpe from the backtest result.

**Problem:** After running ablation study (8 configs), grid search (N configs), and multiple WFA rounds, the reported Sharpe is inflated by selection bias. How much it is inflated depends on the number of trials.

**Fix:** Add DSR calculation to the reporter. Input: number of trials run, IS Sharpe, trade count, skewness, kurtosis of trade returns.

```typescript
// Approximate DSR using PSR + multiple testing correction
const pbo_adjustment = Math.sqrt(Math.log(nTrials)) / Math.sqrt(nTrades);
const dsr = psr(sharpeRatio - pbo_adjustment, nTrades, skew, kurtosis);
```

Report both raw Sharpe and DSR. Require DSR > 0.95 for any parameter set to be accepted into `strategies/{SYMBOL}.json`.

### 9.7 Critical Gap 6 — No Regime Tagging in Trade Log

**Current state:** Trades are recorded as P&L without market regime context.

**Problem:** A strategy with 65% WR overall may have 75% WR in trending regimes and 45% WR in ranging regimes. Without regime tagging, we cannot detect this until the bot is deployed in a ranging market and performs poorly.

**Fix:** Add regime tag to each trade at entry: {TRENDING_UP, TRENDING_DOWN, RANGING, HIGH_VOLATILITY}. Simple proxy: use 4H ADX > 25 = trending, ADX < 20 = ranging, ATR/price > 2.0% = high volatility. Then break down all backtest metrics by regime. If any regime shows WR < 45%, add regime filter to strategy.

### 9.8 Recommended Workflow Changes

**Before any calibration run:**
1. Write down the specific hypothesis being tested (e.g., "OB weight 25→20 will improve WR on ranging months")
2. Specify the acceptance criterion (DSR > 0.95, WFE > 55%)
3. Commit the hypothesis to the board before running

**After calibration run:**
1. Report raw Sharpe, DSR, WFE, Monte Carlo DD_95
2. Check parameter sensitivity: ±10% of each changed parameter, confirm graceful degradation
3. Run with realistic slippage model, compare to zero-slippage result
4. Only if all criteria pass: submit for analyst review

**Before any strategy goes live:**
1. Run held-out test (Nov–Dec 2024) exactly once
2. Report held-out WR vs. IS WR — if delta > 15 percentage points, strategy is overfit
3. Run Monte Carlo on held-out trades alone (even if only 30–50 trades, the direction matters)
4. Document all trials and CPCV path distribution in `strategies/{SYMBOL}.json`

---

## References & Sources

- [AI & Algorithmic Trading: Common Pitfalls in Backtesting](https://medium.com/funny-ai-quant/ai-algorithmic-trading-common-pitfalls-in-backtesting-a-comprehensive-guide-for-algorithmic-ce97e1b1f7f7)
- [The Probability of Backtest Overfitting — Bailey, Lopez de Prado et al.](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253)
- [The Deflated Sharpe Ratio — Bailey & Lopez de Prado (2014)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)
- [Combinatorial Purged Cross-Validation — Towards AI](https://towardsai.net/p/l/the-combinatorial-purged-cross-validation-method)
- [Walk-Forward Analysis — AlgoTrading101](https://algotrading101.com/learn/walk-forward-optimization/)
- [How to Use Walk-Forward Analysis — Unger Academy](https://ungeracademy.com/posts/how-to-use-walk-forward-analysis-you-may-be-doing-it-wrong)
- [Monte Carlo Simulation for Algorithmic Trading — QuantProof](https://quantproof.io/blog/monte-carlo-simulations-trading-strategy-validation)
- [Triple Barrier Labeling — Quantreo Newsletter](https://www.newsletter.quantreo.com/p/the-triple-barrier-labeling-of-marco)
- [Robustness Tests Guide — Build Alpha](https://www.buildalpha.com/robustness-testing-guide/)
- [Backtesting Limitations: Slippage and Liquidity — LuxAlgo](https://www.luxalgo.com/blog/backtesting-limitations-slippage-and-liquidity-explained/)
- [Survivorship Bias in Crypto — SSRN Ammann et al.](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4287573)
- [Minimum Trades for Valid Backtest — BacktestBase](https://www.backtestbase.com/education/how-many-trades-for-backtest)
- [Probabilistic Sharpe Ratio — Portfolio Optimizer](https://portfoliooptimizer.io/blog/the-probabilistic-sharpe-ratio-bias-adjustment-confidence-intervals-hypothesis-testing-and-minimum-track-record-length/)
- [Parameter Sensitivity Analysis — Build Alpha](https://www.buildalpha.com/robustness-testing-guide/)
- [Look-Ahead Bias: The Invisible Killer — Quantreo Newsletter](https://www.newsletter.quantreo.com/p/look-ahead-bias-the-invisible-killer)
- [MOMOH S.O., "How to Back Test" — Amazon](https://www.amazon.com/HOW-BACK-TEST-ascertaining-investing/dp/B0GPRPHSRP)

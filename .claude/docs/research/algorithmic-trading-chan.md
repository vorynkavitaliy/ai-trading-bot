# Algorithmic Trading — Ernest P. Chan
## "Algorithmic Trading: Winning Strategies and Their Rationale" (Wiley, 2013)

**Research date:** 2026-04-06
**Relevance:** Core methodology reference for our backtesting framework, position sizing, and strategy validation.

---

## Overview

Ernest Chan's second book (after "Quantitative Trading") goes deeper into strategy mechanics and their mathematical rationale. The central thesis: successful algorithmic strategies fall into two camps — **mean reversion** and **momentum** — and a trader must understand *why* each works, not just *that* it works. Emphasis on simplicity over complexity as a direct antidote to overfitting. The book uses MATLAB code throughout but the concepts translate directly to any language.

Key principle: **prefer simple, linear strategies with few parameters**. Complexity is the enemy of robustness.

---

## Core Strategies

### Mean Reversion — When and Why It Works

Mean reversion exploits the tendency of prices (or price spreads) to return to a statistical mean. It is NOT a universal property of markets — it must be **proven statistically** before trading.

#### Statistical Tests for Mean Reversion

Chan presents three complementary tests. All three should ideally confirm before trading.

**1. Augmented Dickey-Fuller (ADF) Test**
- Null hypothesis: the series is a random walk (no mean reversion)
- If p-value < 0.05 → reject null → series is stationary → mean reversion exists
- Limitation: only tests for linear mean reversion; can miss nonlinear patterns
- Practical threshold: Chan recommends p < 0.05, but stricter (p < 0.01) for crypto given regime changes

**2. Hurst Exponent**
- H < 0.5 → mean-reverting series
- H = 0.5 → random walk (no edge)
- H > 0.5 → trending series (use momentum, not mean reversion)
- Interpretation: H = 0.3 means stronger mean reversion than H = 0.45
- The Hurst exponent and ADF test are complementary — use both

**3. Variance Ratio Test**
- Compares variance at different time scales
- If VR(q) < 1 → mean reverting at lag q
- Provides information about *at which time horizon* mean reversion operates

#### Ornstein-Uhlenbeck Process and Half-Life

The key practical tool from mean reversion theory is the **half-life of mean reversion**:

```
dX = θ(μ - X)dt + σdW

Half-life = ln(2) / θ
```

Where θ is the speed of mean reversion estimated by OLS regression of ΔX on X(t-1).

**Why the half-life matters for our bot:**
- It tells you the lookback window to use for the Bollinger Band
- It tells you the expected holding period
- If half-life > 20 bars → mean reversion is too slow to trade profitably
- If half-life < 1 bar → noise, not signal
- Optimal lookback period ≈ half-life in bars

#### Pairs Trading and Cointegration

Single-instrument mean reversion is rare. More commonly, a **portfolio** of instruments is stationary (cointegrated) even when individual instruments are not.

**Cointegration test (Engle-Granger method):**
1. Regress Y on X: Y = β·X + ε
2. Test ε (the spread) for stationarity using ADF
3. If spread is stationary → pair is cointegrated → trade the spread

**Hedge ratio β:** The ratio in which to hold the two instruments. Static β works short-term; for longer periods use the Kalman filter.

**Kalman Filter for Dynamic Hedge Ratio:**
Chan dedicates significant attention to this. The Kalman filter is an optimal linear algorithm that updates expected values of hidden variables (hedge ratio) based on observable variables (prices). Key advantage: **dynamic weights** that adapt to changing market conditions rather than fixed lookback windows.

The state equation: `β(t) = β(t-1) + ω` (hedge ratio evolves as random walk)
The observation equation: `y(t) = β(t)·x(t) + ε`

Result: a hedge ratio that slowly adapts without the sharp jumps of a rolling regression.

**ETFs preferred over single stocks** for mean reversion — single corporate events can permanently destroy cointegration. ETF pairs are more stable structurally.

#### Z-Score Trading Rule

The standard mean reversion entry rule Chan uses:

```
z = (spread - mean(spread, lookback)) / std(spread, lookback)

Entry long:  z < -1 (spread below mean by 1 std)
Entry short: z > +1 (spread above mean by 1 std)
Exit:        z crosses 0 (spread returns to mean)
Stop loss:   |z| > 3 or time stop = 2× half-life
```

Position size scales linearly with |z|: the further from mean, the larger the position.

---

### Momentum Strategies — Identification and Execution

Momentum is the opposite bet: recent winners continue winning, recent losers continue losing. Chan distinguishes two types:

#### Time-Series Momentum (Absolute Momentum)
- Ask: is this instrument going up or down?
- Long if recent return > 0, short if recent return < 0
- Uses only the instrument's own history
- Works because: trend-following institutional flows, anchoring bias, underreaction to news

#### Cross-Sectional Momentum (Relative Momentum)
- Ask: which instruments are doing better than others right now?
- Long the top decile performers, short the bottom decile
- Classic Jegadeesh-Titman 12-1 month lookback
- Works because: investor herding, momentum in earnings revisions

**Four drivers of momentum identified by Chan:**
1. Investor underreaction to news (slow information diffusion)
2. Herding behavior (trend-following funds amplify moves)
3. Anchoring bias (investors slow to update price targets)
4. Disposition effect (early profit-taking by retail creates further upside)

#### Implementation Key Points

**Lookback period:** Chan recommends 1-12 months for equities, shorter for futures/crypto. For crypto on 15M timeframe, relevant momentum is measured in hours to days, not months.

**Momentum signal decay:** Momentum works on medium horizons (weeks-months for equities) but mean-reverts at very short (intraday) and very long (3+ years) horizons. Short-term momentum = our 15M strategy territory.

**Volume confirmation:** High volume on a momentum move → more reliable signal. Low volume breakouts frequently fail. This directly validates our volume ratio component (>2.0 = strongest confirmation).

**Regime dependency:** Momentum works poorly in choppy, range-bound markets. Works best in trending regimes. **This is a critical insight for our bot** — we need a regime filter.

---

## Statistical Arbitrage Concepts

Statistical arbitrage (stat arb) combines mean reversion with systematic, quantitative position management:

1. **Universe selection** — find cointegrated pairs or baskets
2. **Signal generation** — compute z-score of spread
3. **Position sizing** — scale with z-score magnitude
4. **Risk management** — correlation-based portfolio risk, not just individual stops
5. **Continuous rebalancing** — hedge ratio updates via Kalman or rolling regression

**Key difference from discretionary pairs trading:** Everything is algorithmic, positions are taken based purely on statistical signal, holding period is determined by mean reversion speed (half-life), not discretionary judgment.

**Basket arbitrage (factor-neutral):** More sophisticated — regress returns against multiple factors (market beta, sector, style), trade the residuals. Removes systematic risk, isolates idiosyncratic mean reversion.

---

## Backtesting Methodology

This is the most critically important section for our implementation.

### The Three Cardinal Sins (Biases)

#### 1. Look-Ahead Bias
Using future information that would not have been available at decision time.

**Most common occurrences:**
- Using today's HIGH or LOW to trigger a signal at today's OPEN (you don't know the high until the bar closes)
- Fitting a regression over period T and then "trading" on signals within the same period T
- Using the closing price of bar N to enter on bar N (should enter bar N+1)
- Survivorship bias in universe selection (see below)

**Our specific risk:** When computing SMC signals on the 15M bar close, we must ensure the signal is computed AFTER the bar closes and the trade enters on the NEXT bar's open, not the current bar's close.

**Rule:** Every signal generated at time T can only be acted upon at time T+1 (next bar open). No exceptions.

#### 2. Survivorship Bias
Testing on today's asset universe, which excludes failed/delisted assets that existed in the test period.

**For crypto specifically:** Coins that existed in 2020 but are now delisted (LUNA, FTT, many others) would have been candidates. Excluding their catastrophic failures makes strategies look better than they were.

**Our mitigation:** We test only on major pairs (BTC, ETH, SOL) that have survived and have 3+ years of data. Survivorship bias is lower but not zero — even BTC had periods of 80%+ drawdown that would have triggered max DD rules.

#### 3. Data-Snooping Bias (Overfitting)
The most dangerous and insidious bias. It occurs when model parameters are optimized on the same data used to evaluate performance.

**How it manifests:**
- Running 100 parameter combinations, picking the best → the "best" is likely lucky, not skilled
- Adding more indicators until backtest looks good
- Adjusting parameters after seeing losing periods in backtest

**Chan's test for overfitting:** If removing one parameter from your model dramatically changes results, the model is overfit. Robust strategies should be relatively insensitive to small parameter changes.

**Minimum trades rule:** Chan states 100 trades minimum for statistical significance. Below 100 trades, backtest results are essentially meaningless noise.

**Statistical significance test:**
```
t-statistic = Sharpe_ratio × sqrt(N)

Where N = number of years of backtest data

If t > 2.32 → p < 0.01 (99% confidence the strategy has positive expected return)
Equivalently: SR × sqrt(N) > 2.32
```

For a 1-year backtest to be statistically significant at 99% confidence: SR > 2.32.
For a 3-year backtest: SR > 1.34.
**This means short backtests demand unrealistically high Sharpe ratios to be credible.**

### Parameter Sensitivity Analysis

Before trusting any backtest result, Chan recommends:

1. **Plot performance vs. each parameter individually** — look for smooth peaks, not sharp spikes
2. **Sharp peak at optimum** = overfit. A genuine edge shows broad, flat performance across a range of parameter values
3. **If moving a parameter by 20% causes >50% performance degradation** → likely overfit

**For our bot:** If changing ATR multiplier from 1.5 to 1.7 causes our backtest Sharpe to drop from 2.0 to 0.5, we don't have a real edge — we found a lucky parameter.

### Evaluating a Backtest Result

Chan's hierarchy for validating a backtest:

1. **Sharpe ratio > 1.0** minimum, preferably > 1.5 for a live strategy
2. **Maximum drawdown < 3×** annual volatility (otherwise risk of ruin too high)
3. **Profit factor > 1.5** (gross profit / gross loss)
4. **Win rate + risk:reward combination** must produce positive expectancy
5. **Monthly breakdown** — consistent across months, not driven by 1-2 outlier months
6. **Transaction costs included** — slippage + commission. If strategy profits disappear with realistic costs, it's a microstructure artifact

---

## Risk Management

### Drawdown Analysis

**Maximum drawdown** is the most important risk metric, more important than Sharpe ratio for prop firm compliance.

**Chan's rule:** If live drawdown exceeds the maximum drawdown seen in backtest, stop trading. The strategy may be regime-broken or overfitted.

```
Stop trading threshold = max_backtest_drawdown × 1.0
(i.e., halt at backtest max DD, do not wait for 2× or 3×)
```

This is extremely relevant to our HyroTrader compliance — the prop firm's 10% max DD limit must be embedded in the risk system, and the bot should self-halt before approaching this limit.

**Drawdown duration** matters as much as depth:
- A strategy in drawdown for 2× its typical drawdown duration → strong signal it's broken
- Brief deep drawdown may be recoverable; long shallow drawdown may indicate regime change

### Strategy Lifecycle: Dead or Just Drawdown?

From Chan's blog "The Life and Death of a Strategy" (2012):

**Indicators that a strategy is just in temporary drawdown:**
- Drawdown depth < maximum seen in backtest
- Drawdown duration < maximum duration seen in backtest
- Market regime has not fundamentally changed (same volatility, same correlations)
- Strategy continues generating signals (just losing ones)

**Indicators that a strategy is dead:**
- Drawdown duration > 2× maximum historical duration
- The fundamental reason the strategy worked no longer applies (e.g., an arbitrage opportunity was closed by market structure changes)
- Crowding: too many participants doing the same thing → alpha decays

**Chan's rule of thumb:** "It is always better to be safe than sorry once the drawdown duration approaches the max duration in backtest." Stop at historical max duration, not at 2×.

**For our implementation:** We should track:
1. Current drawdown depth vs. backtest max DD
2. Current drawdown duration (in bars or days) vs. backtest max DD duration
3. Alert when approaching 80% of either threshold

### Black Swan Protection (CPPI)

Chan discusses Constant Proportion Portfolio Insurance (CPPI) as a structured way to avoid ruin from tail events:

- Define a floor (minimum equity you will not go below)
- Investment = multiplier × (current equity - floor)
- As equity drops toward floor, position size shrinks automatically
- Natural Kelly-like self-protection without explicit Kelly math

**Application for our bot:** Our HyroTrader rules already implement a crude version of this — if daily DD reaches 5%, stop. If max DD reaches 10%, stop. The CPPI framework would make this more continuous (reduce position size as we approach the limit) rather than binary (trade full size until we hit the wall, then stop).

### Stop Loss Philosophy

Chan's nuanced view on stop losses is counterintuitive:

**For mean reversion strategies:** Traditional stop losses are harmful. Mean reversion strategies are *supposed* to go against you temporarily before reverting. A tight stop loss turns every normal mean reversion trade into a loss.

**For momentum strategies:** Stop losses are essential. A momentum trade that reverses is a signal that momentum has ended — cut it.

**Time stops work better for mean reversion:** Exit if the spread hasn't reverted within 2× the half-life period. This is cleaner than a price stop.

**Implication for our bot:** Our SMC strategy is predominantly trend/momentum-following (BOS, CHoCH confirm breakouts, OB confirmations of directional moves). Price-based stop losses are appropriate. The SL at OB boundary + ATR buffer is the correct approach.

---

## Position Sizing (Kelly Criterion)

### The Kelly Formula

The Kelly Criterion determines the **optimal fraction of capital to risk** to maximize long-term geometric growth rate.

**For a simple win/loss bet:**
```
f* = W/|L| - (1 - W)/W

Where:
  f* = fraction of capital to bet
  W  = win rate (probability of winning)
  L  = loss per losing trade (as fraction of capital)
```

**For continuous returns (more relevant for trading):**
```
f* = μ / σ²

Where:
  μ  = mean return per period
  σ² = variance of return per period
  f* = optimal leverage
```

### Kelly and Sharpe Ratio

**Critical insight from Chan:** The optimal Kelly leverage is directly proportional to the Sharpe ratio:

```
f* = SR / σ_annual

Where SR is the annualized Sharpe ratio and σ_annual is annualized volatility
```

A strategy with SR = 1.0 and annual volatility of 20% → optimal Kelly leverage = 5×.

**The fundamental connection:**
> "Maximization of the Sharpe ratio leads to the maximization of long-term growth rate if you adopt the optimal leverage."

This means: optimize for Sharpe ratio in backtesting, then apply Kelly to determine leverage. These are not competing objectives — they are complementary.

### Fractional Kelly (Half-Kelly)

Full Kelly is mathematically optimal but practically dangerous:
- Parameter estimates (mean, variance) contain error
- Kelly is extremely sensitive to estimation errors
- Full Kelly drawdowns can be catastrophic

**Chan's recommendation: use Half-Kelly (f* = 0.5 × full Kelly)**

Reasons:
1. Estimation error in μ and σ systematically overstates true edge
2. Half-Kelly gives 75% of the growth rate of full Kelly but ~50% of the drawdown
3. In the presence of negative skewness (which trading has), Half-Kelly is more appropriate

**Quarter-Kelly is even more conservative** and recommended for:
- New strategies not yet validated in live trading
- High-volatility assets (crypto)
- When backtest sample size is small

### Practical Kelly Calculation for Our Bot

Given our strategy parameters (approximate):
```
Annualized Sharpe (target): ~1.5
Annual volatility of strategy: ~15-20% (on per-pair basis)
Full Kelly leverage: 1.5 / 0.175 ≈ 8.6×
Half-Kelly leverage: ≈ 4.3×
Quarter-Kelly leverage: ≈ 2.15×
```

Our current 5× leverage on 22.5% of capital corresponds roughly to Full Kelly assuming SR ~1.0. With per-pair sizing at 4% (updated multi-pair model), the effective leverage is well within Half-Kelly territory for SR ≥ 1.0.

**Key takeaway:** Our position sizing is mathematically sound if we maintain SR ≥ 1.0. Below SR = 0.5, even our conservative sizing becomes too aggressive by Kelly standards.

### Kelly for Multiple Simultaneous Strategies

When running multiple strategies simultaneously, full Kelly on each individually is wrong — it ignores correlation. The correct approach:

```
f* = Σ^(-1) · μ_vector

Where:
  Σ   = covariance matrix of strategy returns
  μ   = vector of expected returns per strategy
```

In practice: strategies with high positive correlation should share their Kelly allocation. BTC and ETH strategies will be correlated → their combined Kelly allocation should not simply be the sum of individual Kellys.

**Practical approximation for 5 pairs:** If pairs have 0.5 average correlation, reduce each pair's Kelly by ~30% from the uncorrelated estimate.

---

## Walk-Forward Analysis

### Why In-Sample / Out-of-Sample Split Is Insufficient

A single train/test split still allows implicit overfitting — you may iterate on the model until the test set also looks good. Walk-forward analysis prevents this by using multiple test windows, each evaluated independently.

### Walk-Forward Methodology

```
Full data: [========================= T =========================]

Window 1: [Train: 6m][Test: 1m]
Window 2:       [Train: 6m][Test: 1m]
Window 3:             [Train: 6m][Test: 1m]
Window 4:                   [Train: 6m][Test: 1m]
...
Final: [Train: 6m][Test: 1m] (anchored walk-forward)

OR (rolling walk-forward):
Window 1: [Train: 6m][Test: 1m]
Window 2:  [Train: 6m][Test: 1m] (drops oldest month, adds new)
Window 3:   [Train: 6m][Test: 1m]
```

**Anchored vs. rolling walk-forward:**
- **Anchored:** Training window grows over time. Better when regime is stable. More data = more accurate parameter estimates.
- **Rolling:** Fixed training window. Better when regime changes over time. Old data may be misleading.

For crypto (frequent regime changes): **rolling walk-forward is preferred.**

### Walk-Forward Efficiency Ratio

A useful metric for evaluating whether walk-forward optimization adds value:

```
WFE = Out-of-sample Sharpe / In-sample Sharpe

WFE > 0.5 → strategy generalizes well
WFE < 0.3 → likely overfit, parameters don't transfer
WFE > 1.0 → suspiciously good (check for data errors or look-ahead bias)
```

### Optimal Window Sizes (Chan's Guidance)

- Training window: long enough to contain 50-100+ trades (more is better)
- Test window: typically 1/6 to 1/4 of training window
- Total out-of-sample period: should cover multiple market regimes (trending + ranging + volatile)

**For our 15M BTCUSDT strategy:**
- 15M bars in 6 months: ~17,280 bars
- Expected trade frequency: ~2-4 trades per week → ~48-96 trades per 6 months
- 6-month training / 1-month test windows are reasonable
- Walk-forward over 12-18 months of data provides adequate out-of-sample coverage

### Degredation Test (Chan's Day Zero Rule)

When you discover or read about a strategy: **timestamp that moment as Day Zero**. Only pay attention to performance after Day Zero. Prior performance was visible during strategy selection, creating implicit look-ahead bias in strategy selection itself.

For our calibration process:
- The backtest results we optimize on = in-sample
- Any new 30-day period after calibration = first true out-of-sample test
- Only after 30 days of live/paper results with consistent performance should we increase position size

---

## Actionable Insights for Our Bot

### 1. Backtest Validity Checklist

Before trusting any calibrated strategy config:

- [ ] Minimum 100 trades in backtest period
- [ ] t-statistic = SR × sqrt(years) > 2.0 (95% confidence)
- [ ] Parameter sensitivity: changing weights ±20% doesn't collapse performance
- [ ] Transaction costs (0.055% round-trip for Bybit taker) included
- [ ] Entry at next bar open, not current bar close
- [ ] No parameters tuned on the entire dataset (use walk-forward)
- [ ] Monthly P&L breakdown available — no single month > 40% of total profit

### 2. Kelly-Based Position Sizing Review

Our multi-pair 4% per pair × 5× leverage = 20% notional per pair.

Kelly check by pair:
```
If SR_pair < 0.5 → reduce to 2% allocation (quarter-Kelly territory)
If SR_pair 0.5-1.0 → 3% allocation
If SR_pair 1.0-1.5 → 4% allocation (current default)
If SR_pair > 1.5 → consider up to 5% allocation
```

Never exceed the allocation implied by Half-Kelly regardless of how good backtest looks.

### 3. Regime Filter Implementation

Chan's momentum vs. mean reversion framework implies we need a **regime detector**:

```
Trending regime (momentum works):
  - Hurst exponent on 4H price > 0.55
  - ADX > 25
  - EMA200 slope > threshold
  → Use BOS/CHoCH momentum signals (our primary signals)
  → Normal confluence threshold (70)

Choppy regime (mean reversion works, momentum fails):
  - Hurst exponent < 0.45
  - ADX < 20
  - Price oscillating around EMA200
  → Reduce confluence threshold or skip momentum signals
  → Consider raising threshold to 80 to avoid noise entries
```

### 4. Strategy Health Monitoring

Implement these checks in the live bot:

```typescript
interface StrategyHealth {
  currentDD: number;           // Current drawdown %
  maxBacktestDD: number;       // From calibration results
  ddDuration: number;          // Bars in current drawdown
  maxBacktestDDDuration: number; // From calibration results
  recentSR: number;            // Rolling 30-day Sharpe

  // Alert thresholds
  ddWarning: number;           // = maxBacktestDD × 0.8
  ddHalt: number;              // = maxBacktestDD × 1.0 (Chan's rule)
  durationWarning: number;     // = maxBacktestDDDuration × 1.0
  durationHalt: number;        // = maxBacktestDDDuration × 2.0
}
```

### 5. Walk-Forward Schedule for Our Calibration

Recommended schedule post-launch:

- **Monthly:** Run 1-month out-of-sample evaluation. Compare live SR vs. backtest SR.
- **Quarterly:** Full walk-forward re-calibration. If WFE < 0.4, revisit strategy logic.
- **After 100 live trades:** Statistical significance test. If t-stat < 1.65 (90% confidence), pause and diagnose.

### 6. Avoiding Data-Snooping in Our Multi-Pair Expansion

The biggest risk in calibrating 5+ pairs: each pair looks good in backtest partly due to random luck. Aggregate statistics improve but individual pair estimates are noisy.

**Chan's mitigation:** Fix strategy logic (SMC confluence framework) across all pairs. Only tune pair-specific parameters (ATR filter range, weight adjustments). The more parameters shared across pairs, the less snooping risk.

**Our approach is correct:** Shared confluence framework, per-pair weight calibration only. This minimizes degrees of freedom and reduces overfitting risk substantially.

### 7. Transaction Cost Reality Check

Chan consistently emphasizes that many strategies appear profitable before costs but disappear after.

For Bybit USDT Perpetual:
```
Maker fee:  0.02%
Taker fee:  0.055%
Funding:    ~0.01-0.03% per 8h (variable)

Round-trip estimate (limit entry + stop exit):
  Optimistic (both fills as maker): 0.04%
  Realistic (maker entry, taker SL): 0.075%
  Conservative (both taker): 0.11%

For a 1% target move: realistic cost = 7.5% of gross profit
For a 0.5% target move: realistic cost = 15% of gross profit
```

Our 15M strategy with ~1.5R minimum should be robust to these costs, but they must be explicitly included in every backtest.

---

## Key Formulas Reference

```
Kelly leverage:        f* = μ / σ²  =  SR / σ_annual
Half-Kelly:            f_half = f* / 2
Backtest t-statistic:  t = SR × sqrt(T_years)  [need t > 2.0 for 95% confidence]
Z-score:               z = (x - mean) / std
Half-life:             HL = ln(2) / θ  [θ from OLS regression ΔX = θ·X + ε]
Walk-forward eff.:     WFE = SR_oos / SR_is  [target > 0.5]
Hurst exponent:        H < 0.5 = mean revert; H > 0.5 = trend; H = 0.5 = random
Min trades:            N ≥ 100 for meaningful backtest statistics
```

---

## Sources

- [Amazon: Algorithmic Trading: Winning Strategies and Their Rationale](https://www.amazon.com/Algorithmic-Trading-Winning-Strategies-Rationale/dp/1118460146)
- [Wiley Online Library: Book TOC and Abstract](https://onlinelibrary.wiley.com/doi/book/10.1002/9781118676998)
- [QuantConnect: Mean Reversion Pairs Trading (Chan implementation)](https://www.quantconnect.com/forum/discussion/11974/mean-reversion-pairs-trading-from-ernest-chan-039-s-algorithmic-trading-book/)
- [EP Chan Blog: How Much Leverage Should You Use? (Kelly)](http://epchan.blogspot.com/2006/10/how-much-leverage-should-you-use.html)
- [EP Chan Blog: Kelly Formula Revisited](http://epchan.blogspot.com/2009/02/kelly-formula-revisited.html)
- [EP Chan Blog: Kelly vs. Markowitz Portfolio Optimization](http://epchan.blogspot.com/2014/08/kelly-vs-markowitz-portfolio.html)
- [EP Chan Blog: The Life and Death of a Strategy](http://epchan.blogspot.com/2012/04/life-and-death-of-strategy.html)
- [EP Chan Blog: Mean Reversion, Momentum, and Volatility Term Structure](http://epchan.blogspot.com/2016/04/mean-reversion-momentum-and-volatility.html)
- [EP Chan Blog: Optimizing Trading Strategies Without Overfitting](http://epchan.blogspot.com/2017/11/optimizing-trading-strategies-without.html)
- [QuantStart: Kelly Criterion Money Management](https://www.quantstart.com/articles/Money-Management-via-the-Kelly-Criterion/)
- [QuantStart: Basics of Statistical Mean Reversion Testing](https://www.quantstart.com/articles/Basics-of-Statistical-Mean-Reversion-Testing/)
- [ArbitrageLab: Kalman Filter Documentation](https://hudson-and-thames-arbitragelab.readthedocs-hosted.com/en/latest/other_approaches/kalman_filter.html)
- [ArbitrageLab: Half-Life of Mean Reversion](https://hudson-and-thames-arbitragelab.readthedocs-hosted.com/en/latest/cointegration_approach/half_life.html)
- [Macrosynergy: Detecting Trends and Mean Reversion with Hurst Exponent](https://macrosynergy.com/research/detecting-trends-and-mean-reversion-with-the-hurst-exponent/)
- [Quantopian Archive: Optimizing Without Overfitting by Chan](https://quantopian-archive.netlify.app/forum/threads/optimizing-trading-strategies-without-overfitting-by-dr-ernest-chan.html)
- [SSRN: Conditional Parameter Optimization (Chan et al.)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3880643)
- [Medium: Summary of Quantitative Trading by Chan](https://medium.com/@lee.christian64/summary-quantitative-trading-ernest-p-chan-d4df707aa015)
- [Manish13 Blog: Algorithmic Trading Ernest Chan Summary](https://manish13.blogspot.com/2015/08/algorithmic-trading-ernest-chan.html)

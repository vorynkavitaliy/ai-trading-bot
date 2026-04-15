# Building Winning Algorithmic Trading Systems: Key Principles from Davey & Chan

**Date:** 2026-04-06
**Sources:**
- Kevin J. Davey — *Building Winning Algorithmic Trading Systems* (Wiley, 2014)
- Ernest P. Chan — *Quantitative Trading: How to Build Your Own Algorithmic Trading Business* (Wiley, 2008)
- Kevin Davey — kjtradingsystems.com (articles on walk-forward, system retirement)
- Ernest Chan — epchan.blogspot.com (life and death of a strategy, regime detection)

---

## 1. Davey's Complete System Development Process

Kevin Davey is a three-time World Cup Trading Championship finalist (148%, 107%, 112% annual returns in consecutive years), and his book is not about trading theory — it is about *process*. His central argument is that most retail traders fail not because their ideas are wrong but because their development process is undisciplined. The process is everything.

### The Strategy Factory: 8-Step Process

Davey's methodology follows a structured pipeline. Each stage acts as a filter: most ideas never make it through.

**Step 1: Goals and Objectives**
Before writing a single line of code, define exactly what you want from the system. Specific numbers: target annual return, maximum acceptable drawdown, trade frequency, holding period. Without this, you cannot objectively judge whether a system is "good" — you'll keep tweaking until it looks impressive on paper, which is the first step toward overfitting.

**Step 2: Market and Timeframe Selection**
Different markets have fundamentally different statistical properties. Trend-following works in markets with persistent autocorrelation. Mean reversion works in markets with high negative autocorrelation. You need to match strategy type to market character, not force one approach onto every instrument.

**Step 3: Idea Generation**
The raw idea — the trading hypothesis. Can come from price action observation, seasonality, market microstructure, academic papers, or pattern recognition. Davey notes that the source is less important than what happens next: the idea must survive rigorous testing.

**Step 4: Coding and Initial Testing**
Translate idea to code. At this stage Davey recommends a quick, rough backtest — not fine-tuned, not optimized. The goal is to determine whether there is *any* edge at all. Most ideas fail here. This is efficient: discard fast, move on fast.

**Step 5: Walk-Forward Optimization**
If the idea shows promise, move to proper testing methodology (covered in depth in Section 2).

**Step 6: Monte Carlo Simulation**
After walk-forward testing, stress-test the equity curve using Monte Carlo methods. This gives you a realistic range of outcomes — not the single backtest line, but a distribution of what can happen when you randomly shuffle the order of trades. Key outputs: worst-case drawdown at the 95th percentile, probability of ruin, confidence interval on returns.

**Step 7: Incubation Period**
Paper-trade the strategy for 6–12 months before going live (covered in Section 5). This is Davey's "ultimate robustness check."

**Step 8: Live Trading + Ongoing Monitoring**
Going live is not the finish line. It is the beginning of monitoring, performance review, and eventually the decision of when to retire the system (covered in Section 4).

### The One-Shot Rule
A critical discipline in Davey's process: once you run the walk-forward test, you cannot go back and adjust parameters based on what you saw in the out-of-sample results. Doing so converts your out-of-sample data into *de facto* in-sample data. The test is invalid the moment you look at results and adjust accordingly. This is the most commonly violated rule in system development, and Davey is uncompromising about it.

---

## 2. Walk-Forward Optimization: Davey's Specific Methodology

### The Core Concept

Simple backtesting optimizes parameters over all available historical data, then evaluates the system on the same data it was optimized on. This is circular reasoning. Walk-forward testing breaks this circularity.

The process:
1. Divide the historical data into sequential windows
2. For each window, optimize on the first portion (in-sample, IS)
3. Test the resulting best parameters on the next unseen portion (out-of-sample, OOS)
4. Advance the window forward and repeat
5. Assemble all OOS periods into a continuous simulated performance record

The assembled OOS record is the only metric that matters. The IS results are irrelevant for evaluation.

### In-Sample / Out-of-Sample Ratio

Davey typically uses a 70-80% IS to 20-30% OOS ratio per window. The IS period needs to be long enough for meaningful optimization (enough trades to be statistically significant), while the OOS period needs to be long enough to evaluate whether the optimized parameters actually hold up.

Common configurations:
- IS: 18 months, OOS: 6 months (rolling)
- IS: 12 months, OOS: 3 months (rolling)

Shorter OOS periods produce more windows and more data points for evaluation, but each individual window holds less statistical weight.

### Anchored vs Rolling Walk-Forward

**Rolling (sliding window):** Both the IS and OOS windows move forward together. This is better for markets where conditions change, because you don't weight old data equally with recent data.

**Anchored (expanding IS):** The IS start date is fixed; it grows with each step. OOS window still moves. This can improve stability for strategies that benefit from more data, but may anchor too strongly to regime conditions from years ago.

For crypto (high regime variability), rolling walk-forward is generally preferable.

### Walk-Forward Efficiency (WFE)

Davey uses Walk-Forward Efficiency as a summary metric to evaluate how well the OOS performance compares to the IS performance:

```
WFE = (OOS Annualized Return) / (IS Annualized Return)
```

Target: WFE >= 0.5 (OOS captures at least 50% of the IS performance). A WFE below 0.3 signals that the strategy is exploiting historical data artifacts, not a real edge. A WFE above 1.0 is suspicious and may indicate the IS period was too short or the OOS period happened to contain favorable conditions.

Davey also monitors whether the OOS results are consistently positive across all windows or only positive in aggregate because a few windows dominated. Consistent mediocre performance across many windows is more reliable than one spectacular window and five losing windows.

---

## 3. Avoiding Curve Fitting: Degrees of Freedom and Parameter Sensitivity

### The Degrees of Freedom Problem

Every parameter you add to a trading system consumes a degree of freedom. With enough parameters, you can perfectly fit any historical dataset — but the resulting system is not a trading strategy, it is a historical data compressor. It has zero predictive power.

Davey's practical rule: the number of trades in your backtest must significantly exceed the number of free parameters. A minimum ratio he cites is approximately 30 trades per parameter. If you have 4 parameters (e.g., entry period, exit period, filter period, threshold), you need at least 120 trades in the IS period to have any confidence in the optimization.

### Parameter Sensitivity Analysis

After finding optimal parameters, run a sensitivity test: vary each parameter by ±20% from optimal and observe what happens to performance. A robust system should degrade *gracefully* — performance drops somewhat, but the strategy remains profitable across a range of nearby values.

Red flags in sensitivity testing:
- Performance cliff: parameter value of 14 works, but 13 and 15 lose money
- Single-parameter dependency: the entire strategy depends on one value being near-exact
- Interaction sensitivity: the strategy only works when two parameters are simultaneously near their optima

If sensitivity testing reveals a single narrow peak in the parameter landscape, the strategy is curve-fitted, regardless of how good the in-sample performance looks.

### The "Robustness Rule" for Multiple Markets

Davey recommends testing a strategy across multiple markets without re-optimizing. If a trend-following strategy works on one futures market, it should show at least modest edge on several other trending markets. If it only works on the exact market it was developed on with the exact parameters, the edge is likely spurious.

For our bot: if an SMC strategy is calibrated on BTCUSDT, validate the signal logic on ETHUSDT and SOLUSDT *before* recalibrating. If the raw signal (unoptimized) shows zero edge on related instruments, question whether the BTCUSDT edge is real.

### Minimum Data Requirement

Davey insists on at least 200–300 trades in the backtest to have statistical confidence in the results. A system with 30 trades over 1 year looks great but has enormous confidence intervals. The win rate of 65% on 30 trades means your actual long-run win rate could be anywhere from 45% to 80% at 95% confidence.

For our system operating at 15M timeframe: expect 2–5 signals per week at a high quality filter. Over 1 year, that is 100–260 trades — acceptable, but on the lower end. This argues for not over-parameterizing the strategy.

---

## 4. System Health Monitoring: When to Turn Off a Strategy

This is the most practically important section — and the most neglected by retail traders. Davey dedicates significant attention to what happens after you go live. Chan reinforces this from a statistical perspective.

### The Core Problem: Normal Drawdown vs Strategy Death

Every strategy will go through losing periods. The critical question: is this a normal drawdown within the strategy's historical range, or is the strategy fundamentally broken (regime change, edge arbitraged away, implementation error)?

You cannot distinguish these in real-time with certainty. The goal is not certainty but a decision framework that minimizes expected loss.

### Davey's System Retirement Criteria

Davey explicitly recommends writing down retirement criteria *before* the strategy goes live, and committing to them unconditionally. This removes emotion from the decision. The exact threshold matters less than having a threshold at all.

Possible criteria (Davey's recommendations, choose and commit to before go-live):

**1. Maximum Drawdown Threshold**
The most common professional standard: if the live drawdown exceeds 1.5x the maximum historical drawdown from backtests, stop the system.

```
Backtest max DD = 8%
Retirement threshold = 8% × 1.5 = 12%
```

This gives the system room to breathe through normal bad periods while catching genuine failure before catastrophic loss.

**2. Consecutive Losing Trades**
Set a number before go-live, e.g., 10 consecutive losing trades. If you hit it, pause the system for review. This is not the same as permanent retirement — it is a circuit breaker that forces a structured reassessment.

**3. Time-Based Drawdown**
If the strategy has been live for 24 months without achieving a new equity high (i.e., maximum drawdown duration exceeds 24 months), retire or significantly overhaul it.

**4. Rolling Monthly Performance**
Track 3-month rolling returns. If rolling 3-month return drops below -2x the historical average 3-month drawdown, trigger a review.

**5. Equity Curve Slope**
Fit a linear regression to the live equity curve. If the slope of the regression line goes negative over a 90-day window, pause and review.

**One money management firm standard cited by Davey:** 1.5× maximum drawdown threshold, with a mandatory 24-month commitment period before that threshold is applied (to avoid overreaction to early volatility).

### Chan's Statistical Approach to System Health

Chan's approach is more quantitative. He recommends tracking the strategy's Sharpe ratio on a rolling window (e.g., rolling 6-month Sharpe). If the rolling Sharpe drops below zero for a sustained period (2–3 months), the strategy is likely in regime failure rather than normal variance.

**Chan's regime detection via half-life:**
For mean reversion strategies, if the spread fails to mean-revert within 3–4 half-lives, assume the regime has changed. The strategy's fundamental assumption no longer holds.

**Chan's key insight:** A strategy that stops working does not usually "recover" by itself in the short term. If the edge depended on market conditions that have changed (e.g., a liquidity regime, correlation structure, volatility regime), waiting it out typically does not help. However, backtesting the same strategy 6–12 months after it failed sometimes shows it was a temporary regime change, and the strategy eventually becomes relevant again.

### Specific Metrics to Monitor Continuously

The following should be tracked from the first live trade:

| Metric | Definition | Action Threshold |
|---|---|---|
| Live max DD | Peak-to-trough from equity high | Alert at 1.25x backtest DD, retire at 1.5x |
| Rolling Sharpe (90d) | Annualized Sharpe on last 90 days | Review if < 0 for 30d, retire if < 0 for 60d |
| Win rate (rolling 30 trades) | Wins / total trades | Alert if drops 10pp below backtest WR |
| Profit factor (rolling 30 trades) | Gross profit / gross loss | Review if < 1.0 for 20 consecutive trades |
| MAE exceedance | Trades where loss exceeds historical avg MAE | Alert if > 30% of trades exceed 2x avg MAE |
| Consecutive losses | Current streak | Review at 7, retire trigger at 12 |

### Practical Implementation: The Trading Journal

Both Davey and Chan emphasize systematic record-keeping. Every trade should log:
- Entry reason (which indicators fired, confluence score)
- Actual fill vs expected (slippage measurement)
- Exit reason (SL, TP, trailing stop, manual)
- Post-trade notes (was the signal consistent with the strategy rules?)

Over time, this journal reveals whether strategy degradation is gradual (parameters drifting out of validity) or sudden (regime change).

---

## 5. Incubation Period: Testing Before Going Live

Davey surveyed his students and found that 85–90% credited the incubation period with either confirming a good strategy or preventing them from going live with a bad one.

### What Incubation Tests

Paper trading (live market, no real money) for 6–12 months after completing walk-forward and Monte Carlo testing provides:

**Real-time execution dynamics:** Slippage, partial fills, order rejection rates, and API latency cannot be fully modeled in backtests. Incubation reveals the true execution cost.

**Live regime exposure:** The incubation period will almost certainly span at least one different market regime than the development period. This tests strategy robustness in ways no backtest can.

**Psychological preparation:** You get to see the strategy lose money (in simulated P&L) without panic. You verify your retirement criteria are realistic before you have real money at stake.

**Process verification:** For an automated bot specifically, incubation also verifies the infrastructure — API handling, error recovery, position monitoring — before risking real capital.

### How Long Is Long Enough?

Davey's recommendation: at minimum, the incubation period should span 100 trades. For strategies with low signal frequency, this may require longer than 6 months.

For our system: if the bot generates ~4 signals per week on BTCUSDT at high confluence threshold, 100 trades takes roughly 25 weeks (6 months). This aligns exactly with Davey's minimum.

### Incubation Success Criteria

The incubation period is not automatically successful just because it was profitable. Davey recommends specific pass criteria:

- OOS performance is within 50–150% of the expected range from Monte Carlo simulations
- No catastrophic drawdown (no single event that would have triggered the retirement threshold)
- Strategy behavior is explainable — signals generate at expected rate, losses occur for understandable reasons
- Sharpe ratio is positive over the full incubation period

If incubation is profitable but the Sharpe is near zero, the strategy is not generating consistent risk-adjusted return — it may have gotten lucky with a few large winners.

---

## 6. Portfolio of Systems: Diversification of Strategies

### Davey's Portfolio Approach

Davey maintains a library of 200+ strategies and deploys approximately 20 simultaneously. The portfolio is structured for:

**Diversification across instruments:** ~40–50 futures symbols, equally distributed across 7 sectors (grains, energies, metals, currencies, equity indices, bonds, softs). Equal risk allocation per sector prevents concentration.

**Diversification across strategy type:** Some trend-following, some mean reversion, some seasonality. These different logics will not fail simultaneously in most market environments.

**Monthly rebalancing:** Each month, Davey removes the worst-performing strategies from the live portfolio and rotates in better-performing ones from his library. This is not unlimited flexibility — the rotation happens from a pre-built validated library, not from new development.

### Correlation Is the Enemy of Diversification

Adding more strategies only helps if they are not correlated. If five strategies all go short when BTC drops, they are essentially one leveraged short strategy — not five independent systems.

Chan's principle: the Sharpe ratio of a portfolio of strategies scales as the square root of the number of independent strategies. Two uncorrelated systems with Sharpe 1.0 each combine to Sharpe 1.41. But two systems with correlation 0.8 combine to Sharpe only 1.05 — almost no benefit.

Practical test for our multi-pair bot: measure the correlation of daily P&L between BTCUSDT and ETHUSDT strategies. If correlation > 0.7, they are not diversifying — we are just trading the same regime twice with extra fees.

### Position Sizing Across the Portfolio

When running multiple strategies simultaneously, the position sizing framework must account for portfolio heat:

```
Total portfolio risk = sum of (position size × SL distance) for all open positions
Target: total portfolio risk <= 2% of account equity
```

This means individual strategies may need to scale down when other strategies also have open positions. A full portfolio of 5 concurrent positions each targeting 0.5% max loss gives 2.5% total heat — acceptable. Five positions each targeting 1% loss = 5% simultaneous heat, which is likely too much for a prop firm context.

---

## 7. Chan's Practical Tips for Retail Algo Traders

### Infrastructure Minimalism

Chan's base case for retail infrastructure is surprisingly minimal: a laptop, reliable internet, and an uninterruptible power supply. Monthly costs can be under $50 for data and execution. For daily to weekly strategies (our 15M SMC approach), colocation and ultra-low latency are not required.

What does matter:
- **Data quality:** Missing candles, incorrect OHLCV values, or timestamp errors will corrupt backtests. Verify your data source systematically. For Bybit specifically, check for candles with zero volume (exchange downtime) and reject them.
- **API reliability:** Bybit has maintenance windows. Handle reconnection gracefully. Missing a 15M candle close during live trading should trigger a safe state, not a broken execution.
- **Order fill simulation accuracy:** The most common backtest error Chan identifies is assuming fills at the close of the signal candle. In practice, limit orders may not fill at all, or may fill with significant slippage. Model this explicitly.

### Strategy Selection Criteria (Chan's Checklist)

Before committing capital to a strategy, Chan requires:
- Sharpe ratio > 1.0 in backtest (with realistic costs)
- Sharpe ratio > 1.5 if it is the only strategy being traded
- Maximum drawdown duration < 12 months in backtest
- At least 250 trades in the backtest period
- Strategy logic is explainable with a credible market hypothesis (not just pattern-matching)
- Strategy tested across multiple sub-periods and shows positive performance in at least 70% of them

Chan explicitly warns against optimizing for Sharpe — instead, fix reasonable parameters and measure resulting Sharpe. Strategies found by maximizing Sharpe over a search space are virtually always overfitted.

### The Minimum Capital Reality

Chan's analysis on minimum capital addresses execution costs as a percentage of capital. Very small accounts are disproportionately penalized by transaction costs:

- At $10,000 account with 5% position sizing per trade, a 0.1% transaction cost consumes 2% of equity per trade
- This requires a strategy with significant positive expectancy just to break even on costs
- Chan's practical minimum for a strategy that trades daily is approximately $20,000–50,000 in equity
- For less frequent strategies (weekly signals), minimum is lower: $5,000–10,000

For our USDT Perpetual approach at $10,000 account with Bybit fees (~0.055% taker, 0.02% maker): each trade costs approximately $2–6 in fees on our $11,250 notional size. This is 0.02–0.05% per trade. At 4 trades per week over 52 weeks, annual fee drag is approximately $400–1,000 (4–10% of account). This is non-trivial and must be explicitly modeled in backtests.

---

## 8. Strategy Degradation: How to Detect When a Strategy Stops Working

### The Life and Death of a Strategy (Chan)

Chan identifies a predictable lifecycle:

**Phase 1 — Discovery:** A researcher identifies an anomaly or inefficiency. Edge is large because it is unknown. Returns are often exceptional in the early period.

**Phase 2 — Exploitation:** More traders discover the same edge. Competition increases. Returns compress but remain positive. Execution costs become more important.

**Phase 3 — Saturation:** Enough capital is exploiting the edge that it becomes self-defeating. Mean reversion strategies get front-run. Trend signals get crowded. Returns approach zero or go negative.

**Phase 4 — Obsolescence:** Market microstructure changes (exchange rule changes, new participants, volatility regime shift) permanently alter the edge. The strategy never recovers.

Retail traders typically discover strategies in Phase 2 or Phase 3. The backtest, which includes Phase 1 data, looks spectacular. The live performance, which starts in Phase 3 or 4, disappoints.

### Statistical Tests for Degradation

**Cumulative Sum (CUSUM) Test:** Tracks the running deviation of actual returns from the expected mean. If the CUSUM statistic crosses a control limit, it signals a structural break in performance. This is the most sensitive early-warning test.

**Rolling Z-Score of Returns:** Compute the z-score of the last N trades' returns relative to the full backtest distribution. If z-score < -2 sustained over 20+ trades, performance has statistically separated from historical norms.

**Sharpe Ratio Comparison:** Compare the rolling 90-day live Sharpe to the backtest Sharpe. Chan's rule: if live Sharpe drops below 50% of the backtest Sharpe for more than 60 days, the strategy may have entered Phase 3 or 4.

**Monte Carlo Comparison:** After 100 live trades, compare the actual equity curve to the Monte Carlo distribution from pre-launch testing. If the actual curve falls below the 5th percentile of simulated outcomes, you are in territory that Monte Carlo considered nearly impossible — either bad luck or strategy failure.

### Distinguishing Bad Luck from Strategy Death

This is the hardest problem in live trading. Davey's practical heuristic:

- If current drawdown < 1.5x historical max drawdown: likely bad luck, stay the course
- If current drawdown > 1.5x historical max drawdown: pause and investigate
- If current drawdown > 2x historical max drawdown: retire the strategy

Chan adds the market regime lens: before retiring a strategy, check whether the current market regime is fundamentally incompatible with the strategy's assumptions. An SMC trend-following strategy will underperform in a choppy low-volatility regime. If ATR has dropped to historical lows and structure breaks are generating false signals, the appropriate response may be to pause (regime filter) rather than retire.

This is exactly why ATR filters exist in our system — not just to avoid bad trades, but to detect when the strategy's regime assumptions have been violated.

---

## 9. Realistic Expectations: What Is Actually Achievable

### Davey's Track Record in Context

Davey's 148%, 107%, and 112% annual returns in competition were achieved under highly controlled conditions (specific competition periods, focused capital, no withdrawal pressure) and using a diversified portfolio of 20+ systems. These are not representative of typical single-strategy retail returns.

His realistic guidance for well-designed systems, outside of competition conditions:
- Well-optimized system: 30–60% annualized return, with 15–25% max drawdown
- Return-to-maxDD ratio of at least 2:1 (requirement before going live)
- Win rate 45–60% (trend systems) or 55–70% (mean reversion systems)
- Profit factor 1.3–1.8 (reliable range; > 2.0 is usually overfitting)

### Chan's Reality Check for Retail Traders

Chan's book is unusually honest about the difficulty of profitable retail algo trading. Key points:

**Most strategies discovered through data mining do not survive out-of-sample.** Chan estimates that fewer than 20% of strategies that look good in backtest produce positive returns in live trading over the next 12 months.

**Transaction costs dominate short-term strategies.** A strategy trading 10 times per day faces annual fee drag of 5–15% of capital. Only a Sharpe > 2 strategy can survive this cost structure.

**For strategies trading 1–5 times per week** (our frequency), transaction costs are manageable and 1+ Sharpe strategies can survive long-term.

**Realistic 1-year expectations for a solid 1-strategy system:**
- Best case: 2–3x the strategy's backtest Sharpe in absolute terms as annual return
- Typical case: 50–80% of backtest returns due to slippage, regime drift, and execution gaps
- Worst case (but not yet a failed strategy): flat to slightly negative year

### Application to Our Bot

For a USDT Perpetual bot running 1–2 strategies simultaneously on 3–5 pairs:
- Target Sharpe: 1.0–1.5 (annualized, after fees)
- Target annual return: 20–50% on position equity (not account equity)
- Maximum acceptable drawdown: 10% of account (hard floor from HyroTrader compliance)
- Expected live performance vs backtest: 50–70% degradation factor in Year 1

If the backtest shows 80% annual return, the realistic live expectation is 40–56% before adjusting for regime drift. If the backtest shows 25%, live expectation may be 12–17%. This degradation factor should be applied when evaluating whether to go live.

---

## 10. Summary: The 10 Principles That Matter Most

Drawing across both Davey and Chan, these are the principles most relevant to our specific implementation:

**1. Process over results.** A bad system can have good results for a year through luck. A good process catches bad systems before they drain capital.

**2. Walk-forward over backtesting.** The only honest performance metric is out-of-sample. Any metric computed on in-sample data is marketing.

**3. Write retirement criteria before going live.** Decide the threshold in advance. The 1.5x max drawdown rule is a reasonable default. Once live, commit to the criteria regardless of conviction in the strategy.

**4. Incubate for 100 trades minimum.** 6 months of paper trading is not optional if you have the time. Prop firm challenges make this harder — consider whether capital constraints require accepting higher risk of live deployment.

**5. Limit parameters, maximize trades.** Fewer parameters = more robust system. At least 30 trades per parameter in the IS period.

**6. Sensitivity test everything.** A strategy that only works at exact parameter values is not a strategy. Parameter neighborhoods should degrade gracefully.

**7. Monitor rolling metrics, not cumulative.** Cumulative P&L hides regime decay. Rolling 90-day Sharpe, rolling 30-trade profit factor — these catch degradation early.

**8. Diversify strategies, not just instruments.** Adding a second instrument with 0.9 correlation to the first provides almost no benefit. Adding an uncorrelated strategy type (e.g., a mean reversion strategy alongside a trend strategy) provides substantial risk reduction.

**9. Adjust expectations for live vs backtest.** Apply a 50–70% discount to backtest Sharpe and returns when projecting live performance. If the discounted projection doesn't meet minimum viability criteria, the strategy isn't ready.

**10. Strategy death is normal.** Every strategy eventually stops working. The professional approach is not to prevent this but to detect it early, minimize losses during the terminal phase, and have replacement systems ready in the library before the current one fails.

---

## Relevance to Our Bot

| Principle | Implementation |
|---|---|
| Walk-forward | Current backtest architecture supports IS/OOS splits — should be standard for all pair calibrations |
| Retirement criteria | Define per-pair DD threshold (1.5x backtest max DD) in strategy config before going live |
| Incubation | Paper trade each new pair for minimum 8 weeks / 50 signals before real allocation |
| Parameter limits | Each pair strategy should have max 5–6 optimizable parameters to avoid overfitting |
| Rolling monitoring | Add rolling 30-trade win rate and profit factor tracking to position monitor |
| Portfolio correlation | Before adding ETHUSDT or SOLUSDT, measure P&L correlation to BTCUSDT |
| Realistic expectations | Target 2–4% per month per pair gross; 1.5–3% net after fees and live degradation |
| System circuit breaker | ATR filter already in place — extend to portfolio heat circuit breaker |

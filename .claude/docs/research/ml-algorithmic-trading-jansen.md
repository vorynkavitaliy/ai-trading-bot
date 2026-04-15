# ML for Algorithmic Trading — Research Summary
## Based on: "Machine Learning for Algorithmic Trading" by Stefan Jansen (2nd Ed., 820 pages)

**Date:** 2026-04-06
**Researcher:** Learner Agent
**Audience:** Small algo trading team (TypeScript/Node.js, Bybit USDT Perpetual, SMC strategy)

---

## Executive Summary

Jansen's book is the most comprehensive practical reference for applying ML to trading. It covers the full pipeline from data sourcing through feature engineering, model selection, backtesting, and portfolio construction. This summary focuses on **what a small team can actually implement** — filtering out the academic theory that is impractical without a quant research team and institutional data budgets.

The core thesis of the book: alpha decays fast, models need constant retraining, and the biggest source of failure is **lookahead bias and overfitting** — not model complexity.

---

## 1. Alternative Data Sources for Alpha Generation

### What Jansen Covers
Jansen dedicates three full chapters to alternative data: satellite imagery, credit card transaction data, web scraping, social sentiment, and earnings call transcripts. These are the primary sources used by hedge funds.

### Practical Reality for Retail/Small Teams

**Accessible alternative data (free or cheap):**
- **Funding rates** (Bybit API) — systematic signal: extreme positive funding = shorts overloaded
- **Open Interest** (Bybit API) — OI rising + price rising = trend confirmation; OI falling + price rising = distribution
- **Liquidation data** (Bybit WebSocket: `liquidation`) — large liquidations create order flow imbalances
- **CVD (Cumulative Volume Delta)** — buy volume minus sell volume, detects institutional accumulation
- **Order book imbalance** — bid/ask size ratio at top 5 levels is a short-term predictive feature
- **Fear & Greed Index** (alternative.me API, free) — 30-day MA as regime filter
- **Google Trends** (pytrends) — search volume for "bitcoin buy" correlates with retail entry

**What to skip at retail scale:**
- Satellite imagery (requires $50K+/year data contracts)
- Credit card transaction data (same cost tier)
- Earnings call NLP (irrelevant for crypto perps)

### Actionable Recommendation
For this project, the two most implementable alternative data signals are:
1. **Funding rate + OI** as regime filters (already partially in our strategy)
2. **Liquidation heatmaps** as liquidity zone confirmation

---

## 2. Feature Engineering for Financial Time Series

### Jansen's Framework
This is arguably the most valuable chapter in the book. Jansen distinguishes between raw features and information coefficients (IC) — a feature's correlation with forward returns. Features with IC > 0.05 are meaningful; IC < 0.02 is noise.

### Key Feature Categories

**Price-derived features:**
```
Returns: r_t = log(P_t / P_{t-1})
Rolling returns: 1, 5, 15, 60, 240 bars (multi-period momentum)
Volatility: std(r_t, window=20)
Normalized price: (P - MA50) / ATR14  ← position within range
```

**Microstructure features (high value, often ignored):**
```
Amihud illiquidity: |return| / volume  ← measures price impact per unit volume
Bid-ask spread proxy: (high - low) / close
Volume-weighted ATR: ATR scaled by relative volume
Trade imbalance: (close - low) / (high - low)  ← where did price settle in bar?
```

**Lag features (crucial for time series ML):**
- Use 1, 3, 5, 10, 20, 60 bar lags for each feature
- This creates the temporal context the model needs
- Warning: always create lags BEFORE train/test split to avoid lookahead

**Interaction features:**
- RSI × Volume ratio (overbought on high volume = stronger signal)
- ATR × OI change (volatility expanding with OI = breakout confirmation)
- Funding rate × price deviation from EMA (mean reversion pressure)

### The IC Test: Before Adding Any Feature

Jansen's workflow before adding a feature to a model:
1. Calculate IC (Spearman rank correlation with next-bar return) over the full dataset
2. If IC_mean < 0.02 → discard
3. If IC_mean > 0.02 but IC_std > 0.1 → feature is unstable, use carefully
4. If IC_IR (mean/std) > 0.25 → strong feature, worth including

This prevents the "more features = better" trap that kills backtests.

---

## 3. Linear Models for Factor Investing

### What Jansen Covers
Ridge regression, Lasso, ElasticNet, factor models (Fama-French style), PCA for factor extraction.

### Practical Value
Linear models are **underrated** for crypto. They are:
- Fast to train (milliseconds, not hours)
- Interpretable (you know why a signal fired)
- Robust to small datasets (fewer parameters than tree models)
- Easy to retrain daily

### Lasso as Feature Selector
The primary use case for Lasso in this context is **automatic feature selection**:
```python
from sklearn.linear_model import LassoCV

# Lasso shrinks weak features to zero
# Surviving features are the genuine predictors
model = LassoCV(cv=TimeSeriesSplit(n_splits=5))
model.fit(X_train, y_train)
selected_features = X.columns[model.coef_ != 0]
```

This is practical as a preprocessing step before any model.

### Ridge as Baseline
Always establish a Ridge regression baseline before trying complex models. If XGBoost only beats Ridge by 0.2% accuracy, the complexity cost isn't worth it.

### Relevance to This Project
Linear models could serve as **confluence score calibrators**: instead of hand-tuned weights (bosChoch: 25, fvg: 20, etc.), fit a Ridge regression on historical signals to learn optimal weights from data. This is exactly what the Calibrator agent's IC-based approach does — linear models formalize it.

---

## 4. Decision Trees and Random Forests

### Jansen's Coverage
Full chapter on ensemble methods, feature importance, partial dependence plots. Practical implementations with sklearn.

### Where Random Forests Work in Trading

**Regime classification (high value):**
Random forests excel at binary classification: "is this a trending regime or ranging regime?" Input features: ADX, ATR ratio, rolling autocorrelation, Hurst exponent. Output: regime label. This is more reliable than threshold-based regime detection.

**Entry quality scoring:**
Instead of a hand-coded confluence score (0-100), a random forest can learn the nonlinear interactions between indicators that precede profitable trades. Train on historical signals with binary labels (1 = trade hit TP, 0 = trade hit SL).

### Critical Warnings from Jansen

1. **Feature importance is misleading** in the presence of correlated features — all correlated features get shared importance, so individually they look weak
2. **Out-of-bag error is NOT a substitute** for proper walk-forward validation on financial data
3. **Minimum sample sizes**: Random forests need 500+ examples per class for stable results. If you have 200 trades over 2 years, a random forest will overfit badly
4. **Temporal leakage**: scikit-learn's cross_val_score shuffles data by default — always use TimeSeriesSplit

### Practical Sample Size Reality for This Project
BTCUSDT 15M, 1 year of backtests: ~300-400 trades at our signal frequency.
- This is **borderline** for random forests (minimum is ~500 per class)
- On 3 years of data: ~900-1200 trades — workable
- On multiple pairs combined: potentially 1500-2000 — solid

### Implementation Complexity: Medium
Random forests require Python (sklearn), not Node.js. Practical path: train offline in Python, export model as JSON, load in Node.js for inference using ONNX runtime or a simple lookup table for the most important feature thresholds.

---

## 5. Gradient Boosting for Signal Prediction

### Jansen's Coverage
XGBoost, LightGBM, CatBoost — all three. Heavy emphasis on hyperparameter tuning, early stopping, and validation.

### Why Gradient Boosting Dominates Structured Data

XGBoost and LightGBM consistently outperform other methods on tabular financial data in Jansen's experiments. The key reason: they handle the **nonlinear threshold effects** that define trading signals.

Example: RSI at 30 means little. RSI at 30 AND volume 3x average AND price at OB low is a strong signal. Tree models capture these joint conditions naturally; linear models cannot without explicit interaction terms.

### LightGBM as Practical Choice
For small teams, LightGBM is preferred over XGBoost because:
- 3-10x faster training
- Lower memory usage
- Built-in categorical feature handling
- Handles missing values natively

### Hyperparameter Protocol (Jansen's Recommendation)
```python
# Start with conservative settings to prevent overfitting
params = {
    'n_estimators': 200,        # number of trees
    'max_depth': 3,              # SHALLOW trees — avoid overfitting
    'learning_rate': 0.05,       # slow learning
    'min_child_samples': 50,     # each leaf needs 50+ samples
    'subsample': 0.7,            # row subsampling
    'colsample_bytree': 0.7,     # feature subsampling
    'reg_alpha': 0.1,            # L1 regularization
    'reg_lambda': 1.0,           # L2 regularization
}
```

The most important anti-overfitting setting: `min_child_samples`. Set it to at least 1% of training samples.

### Gradient Boosting for Trade Classification

Concrete use case: train LightGBM on features at signal time, binary label = trade outcome. Use this as a **signal quality filter** on top of existing confluence score:

```
Signal generated (score >= 70)
  → Extract feature vector at signal time
  → LightGBM predicts P(win) = 0.67
  → If P(win) >= 0.55: EXECUTE
  → If P(win) < 0.55: SKIP
```

This is the most actionable ML application for this project.

---

## 6. NLP for Sentiment Analysis

### Jansen's Coverage
Four chapters: bag of words, TF-IDF, word embeddings (Word2Vec, GloVe), transformer models (BERT). Applied to earnings calls, news articles, SEC filings, social media.

### Practical Value for Crypto Trading

**What works:**
- **News sentiment** from CryptoPanic API (free tier) or Santiment — aggregate daily sentiment score
- **Reddit/Twitter volume spike** detection — unusual social volume precedes volatility
- **FUD/FOMO regime classifier** — classify market mood as extreme fear or euphoria using Fear & Greed Index

**What doesn't work at retail scale:**
- Building your own BERT fine-tuned on crypto news requires labeled training data (expensive to create) and GPU infrastructure
- Real-time news NLP has latency issues — by the time you parse and act on news, price has moved

### Simple Implementable Approach
Rather than NLP from scratch, use existing sentiment APIs as pre-computed features:
```
LunarCrush sentiment score (free tier) → daily feature
CryptoPanic bullish/bearish ratio → daily feature
Alternative.me Fear & Greed Index → daily regime filter
```

These can be fetched daily, stored in Redis, and used as regime overlay filters — no NLP model required.

---

## 7. Deep Learning for Time Series (LSTM, CNN, Transformers)

### Jansen's Coverage
Two full chapters: LSTM/GRU for sequence modeling, CNN for pattern recognition in time series, Temporal Convolutional Networks (TCN), and attention mechanisms.

### Honest Assessment from Jansen

Jansen is unusually candid here: **deep learning rarely outperforms gradient boosting on financial tabular data** in out-of-sample testing. The main reasons:

1. Financial time series are **not stationary** — patterns learned on 2020-2022 data may not hold in 2024-2026
2. Deep learning requires **much more data** (10,000+ samples minimum for LSTM to generalize)
3. Overfitting is harder to detect — validation loss looks fine but walk-forward performance collapses
4. Training time and infrastructure cost are significant

### Where Deep Learning Does Add Value

**CNN for pattern recognition:**
CNNs can learn chart patterns (head-and-shoulders, double bottom, etc.) from raw OHLCV data formatted as 2D images. This is genuinely novel — traditional indicators cannot do this. But the labeled training data problem remains: you need thousands of manually labeled pattern examples.

**LSTM for multi-step forecasting:**
If you need to predict volatility 5 bars ahead (for option pricing or trailing stop sizing), LSTM can capture temporal dependencies better than ARIMA. But for binary trade classification (win/lose), LSTM rarely beats LightGBM on crypto data.

**Transformers (attention):**
The latest academic papers (2023-2025) show Temporal Fusion Transformers (TFT) outperforming LSTMs on multi-horizon forecasting. But these require significant engineering effort and GPU training.

### Verdict for This Project
**Skip deep learning for now.** The sample size problem (300-400 trades per pair per year) makes LSTM and CNN unreliable. Return to this after accumulating 3+ years of live trading data and 2000+ labeled trade outcomes.

---

## 8. Reinforcement Learning for Trade Execution

### Jansen's Coverage
Full chapter: MDP formulation, Q-learning, Deep Q-Networks (DQN), Policy Gradient methods. Applied to optimal execution (TWAP/VWAP alternatives) and portfolio management.

### The Promise and Reality of RL in Trading

**The promise:** RL can learn optimal execution strategies that minimize market impact and maximize fill quality. An RL agent can learn: "when order book is thin, break order into smaller chunks" without explicit programming.

**The reality from Jansen's experiments:**
- RL is extremely sensitive to the reward function definition
- Small changes in reward → completely different (and often worse) behavior
- Non-stationarity kills RL models — the environment (market) changes faster than the agent can adapt
- DQN on financial data typically needs 1-5 million environment interactions to converge

### Practical RL Applications at Small Scale

The only RL application that is both practical and non-trivial:

**Limit order placement optimization:**
State: current spread, order book imbalance, time since signal, recent fill rate
Action: place at midpoint / place at bid+1tick / place at bid+2ticks / market order
Reward: (fill_speed bonus) - (adverse_selection penalty)

This is tractable because the action space is small (4-5 discrete actions) and training can be done in simulation on historical order book data.

### Verdict for This Project
RL is **not practical** for a small team without dedicated quant researchers. The tuning burden is enormous. The one exception: if limit order fill rates become a major issue, a simple tabular Q-learning agent (not DQN) trained on historical fill data could help optimize entry placement. This is a Phase 3+ consideration.

---

## 9. Backtesting with ML — Avoiding Overfitting

### This is the Most Critical Section of the Book

Jansen devotes 60+ pages to backtesting methodology because **ML makes overfitting exponentially easier** than traditional backtesting. Every additional feature, every hyperparameter search, every model selection decision is an implicit test that must be accounted for.

### The Four Types of Lookahead Bias

1. **Point-in-time data** — using data that wasn't available at signal time (e.g., end-of-day close when you trade intraday)
2. **Feature calculation leakage** — computing normalization statistics (mean, std) on the full dataset before splitting
3. **Survivorship bias** — training on assets that exist today, ignoring delisted coins
4. **Label leakage** — target variable computed with future data (most common in ML pipelines)

### Jansen's Walk-Forward Protocol

```
Timeline: |---Train---|---Val---|---Test---|---Live---|

Combinatorial Purged Cross-Validation (CPCV):
1. Split into K folds
2. Purge embargo period between folds (removes overlapping return windows)
3. Backtest only on fold combinations that maintain temporal order
4. Report both mean and std of out-of-fold performance

Embargo period = max prediction horizon (e.g., 15 bars for 15M candles)
```

### The Multiple Testing Problem

Every parameter combination tested increases the probability of finding spurious results. Jansen cites:
- If you test 20 parameter combinations, probability of at least one false positive at p=0.05 is 64%
- If you test 100 combinations, probability rises to 99.4%

**Bonferroni correction** is too conservative for trading. Instead use:
- **Deflated Sharpe Ratio** (Bailey & Lopez de Prado) — adjusts for number of trials
- **Walk-forward testing** — out-of-sample is the only real test
- **Hold out a full year** as "never touched" test set — evaluate once, never look back

### Anti-Overfitting Checklist (Jansen + this team's additions)

- [ ] Features are lag-corrected (no future data in feature calculation)
- [ ] Train/test split is temporal, never random shuffle
- [ ] Hyperparameters tuned on validation set, performance evaluated on held-out test
- [ ] Model selected before seeing test results
- [ ] Final backtest period: last 12 months never used during tuning
- [ ] Number of trials logged — apply Deflated Sharpe if >20 combinations tested
- [ ] Walk-forward: retrain monthly or quarterly on expanding window
- [ ] Out-of-sample Sharpe > 0.5 × in-sample Sharpe (otherwise overfit)

---

## 10. Portfolio Optimization with ML

### Jansen's Coverage
Mean-variance optimization, Black-Litterman, hierarchical risk parity (HRP), Kelly criterion, ML-based portfolio construction.

### Hierarchical Risk Parity (HRP) — Most Practical Innovation

HRP (Lopez de Prado, 2016) uses hierarchical clustering to group correlated assets and allocates risk to clusters, not individual assets. It is:
- More stable than mean-variance (no matrix inversion needed)
- Robust to estimation error
- Works with as few as 5-10 assets

For our 5-8 pair expansion, HRP is directly applicable:

```
Step 1: Calculate correlation matrix of pair returns
Step 2: Hierarchical clustering (Ward linkage)
Step 3: Allocate equal risk to each cluster
Step 4: Within clusters, allocate inversely proportional to variance

Example output (hypothetical):
  Cluster 1 (BTC, ETH): 40% of portfolio
    BTC: 22%, ETH: 18%
  Cluster 2 (SOL, PEPE, SUI): 35% of portfolio
    SOL: 15%, PEPE: 10%, SUI: 10%
  Cluster 3 (LINK, DOT, ATOM): 25% of portfolio
    LINK: 10%, DOT: 8%, ATOM: 7%
```

This is implementable in Python (sklearn.cluster + scipy) and results can be stored as static weights recalculated weekly.

### Kelly Criterion Caution
Jansen explicitly warns against full Kelly in trading: it maximizes long-run growth but produces 50%+ drawdowns in the short run. Fractional Kelly (25-50% of full Kelly) is safer. Our current 22.5% position size is effectively a fractional Kelly approximation — consistent with Jansen's recommendation.

---

## 11. Practical Implementation Considerations

### Python vs. TypeScript for ML

Jansen's entire book uses Python. The ML ecosystem (sklearn, LightGBM, pandas, numpy) is Python-native. For a TypeScript trading bot, the practical architecture is:

```
Offline (Python):
  - Data collection and feature engineering
  - Model training and validation
  - Model export to ONNX or JSON format

Online (TypeScript/Node.js):
  - Feature extraction at signal time
  - Model inference using:
    * onnxruntime-node (npm) for ONNX models
    * Simple lookup tables for linear models
    * Pre-computed thresholds from trained trees

Training cadence: Weekly or monthly, not real-time
```

### Data Pipeline Requirements

Minimum infrastructure for ML:
- Historical OHLCV: PostgreSQL (already in project)
- Feature store: Redis or PostgreSQL (add `features` table)
- Trade outcome labels: PostgreSQL `backtest_trades` table
- Training environment: Python 3.11 + pandas + sklearn + lightgbm (local or VPS)

### Model Deployment Strategy

The safest deployment pattern for a small team:

1. **Start with rules** (current SMC strategy)
2. **Collect labeled outcomes** (2-3 months of backtests or live paper trading)
3. **Train offline** LightGBM on labeled data
4. **A/B test**: run rule-based and ML filter in parallel (paper), compare performance
5. **Deploy ML filter** as additional gate on top of existing strategy
6. **Never replace** the rules-based system entirely — ML filter augments it

This "ML as filter" approach is lower risk than full ML replacement and easier to debug when something goes wrong.

---

## 12. Which ML Techniques Are PRACTICAL for Retail Algo Traders

### Tier 1 — Implement in Next 3-6 Months

**Feature IC calculation**
- Language: Python (pandas, scipy)
- Value: Validates that our existing confluence indicators actually predict returns
- Effort: 1-2 days
- Risk: Low — read-only analysis

**LightGBM trade quality filter**
- Language: Python (lightgbm, sklearn)
- Value: Reduces false positive signals, improves WR by ~5-10%
- Effort: 1-2 weeks (data prep + model training + Node.js inference integration)
- Risk: Medium — need robust backtesting to avoid lookahead bias
- Minimum data: 500+ labeled trades (3 years backtests across multiple pairs)

**Regime classifier (Random Forest: trending vs. ranging)**
- Language: Python (sklearn)
- Value: Activates different strategy parameters per regime
- Effort: 1 week
- Risk: Low-medium — used as filter, not primary signal

### Tier 2 — Implement After 6 Months of Live Data

**HRP portfolio weight optimization**
- Language: Python (scipy, sklearn)
- Value: Optimal risk allocation across 5-8 pairs
- Effort: 3-5 days
- Risk: Low — replaces static weights with data-driven weights

**Sentiment overlay (external API)**
- Language: TypeScript (HTTP fetch from CryptoPanic or LunarCrush)
- Value: Regime filter using market sentiment
- Effort: 2-3 days
- Risk: Low — additive filter

### Tier 3 — Skip Until Scale Justifies It

- LSTM/deep learning models (need 10,000+ samples)
- Reinforcement learning for execution (need dedicated quant researcher)
- Custom NLP on news (need labeled training data + GPU)
- Satellite / alternative data (need institutional budget)
- Transformer models (need GPU training infrastructure)
- Full mean-variance portfolio optimization (too sensitive to estimation error)

---

## Summary: Key Jansen Insights Applicable to This Project

| Insight | Application |
|---------|-------------|
| IC > 0.05 threshold for features | Validate existing SMC indicators before adding new ones |
| Walk-forward validation is mandatory | Our calibration splits are already correct; keep embargo periods |
| LightGBM beats LSTM on tabular data | Use LightGBM as trade filter, not LSTM |
| Shallow trees (depth 3-4) > deep trees | Anti-overfitting for small datasets |
| Fractional Kelly = ~20-25% per trade | Our 22.5% position size is theoretically justified |
| HRP > mean-variance for small portfolios | Use HRP for 5-8 pair weight allocation |
| ML as filter, not replacement | Add ML gate on top of SMC rules, don't replace them |
| Multiple testing problem is severe | Log all calibration runs, apply Deflated Sharpe |
| Regime detection improves all strategies | Trending vs. ranging classifier is high-ROI first ML project |
| Out-of-sample Sharpe should be > 0.5× in-sample | Flag any backtest where this ratio drops below 0.5× |

---

## Next Steps for This Team

**Immediate (0-30 days):**
1. Calculate IC for all current confluence indicators on historical BTCUSDT data
2. Identify which indicators have IC > 0.05 (keep) vs. IC < 0.02 (consider removing)
3. Add `liquidation_volume` and `oi_change` as candidate features

**Short-term (1-3 months):**
4. Accumulate labeled trade outcomes from backtests (target: 500+ trades)
5. Implement Python training pipeline for LightGBM signal quality filter
6. Deploy ONNX model in Node.js using onnxruntime-node

**Medium-term (3-6 months):**
7. Implement HRP for multi-pair weight allocation
8. Build regime classifier, test against static ATR-based regime detection
9. Add sentiment overlay from CryptoPanic/LunarCrush API

---

*Sources: Stefan Jansen, "Machine Learning for Algorithmic Trading" (2nd Ed., Packt Publishing, 2020). Supplemented by Lopez de Prado, "Advances in Financial Machine Learning" (2018) for CPCV methodology, and the author's public GitHub repository (stefan-jansen/machine-learning-for-trading).*

# Fundamental Analysis for Crypto — Graham, Lynch & On-Chain Metrics

**Date:** 2026-04-06
**Author:** Learner Agent
**Scope:** How fundamental analysis can improve pair selection and macro regime timing
**For:** Algorithmic Trading Bot team (BTCUSDT + alt pairs)

---

## 1. Why Fundamental Analysis Matters for an Algo Trader

The bot is a technical system: SMC + confluence score + limit orders. So why study fundamentals?

Three concrete reasons:

1. **Pair selection filter.** Of 500+ USDT perpetual pairs on Bybit, which 5-8 deserve backtest effort? Fundamentals narrow the universe to projects with real usage, organic demand, and non-manipulated supply dynamics.

2. **Macro regime detection.** The same technical setup produces dramatically different outcomes during a liquidity expansion vs. a tightening cycle. On-chain and macro indicators let us answer: "Is now a favorable environment to be running the strategy at full capacity?"

3. **Veto conditions.** A token with hyperinflationary supply schedule, no real revenue, or collapsing active addresses provides weak long setups regardless of how clean the SMC structure looks on the 15M chart.

---

## 2. Graham's Margin of Safety — Applied to Crypto Entry

Benjamin Graham's central principle from *Security Analysis* (1934, rev. 1951): **buy at a significant discount to intrinsic value, creating a buffer against error and adverse price moves.**

In equities, intrinsic value comes from earnings capacity. In crypto, the concept translates but requires different inputs.

### 2.1 The Core Idea

Graham insisted: the margin of safety is not a forecast, it is **protection against being wrong.** Even if you correctly identify a quality asset, paying too much destroys the safety margin and increases drawdown risk.

For our bot, this principle maps directly onto entry timing:
- Do NOT enter long when on-chain metrics (MVRV, NVT) signal the asset is trading at a significant premium to historical norms.
- DO enter long when the asset is in confirmed discount territory AND the technical setup is present.
- The confluence score already filters signal quality — fundamental context adds a macro layer on top.

### 2.2 Where Intrinsic Value is Definable

| Asset Type | Measurable "Value Anchor" | Graham Analog |
|---|---|---|
| BTC | Realized Price, Stock-to-Flow band, Cost of Production | Book value / tangible assets |
| ETH / L1s | Protocol revenue, staking yield, TVL | Earnings yield |
| DeFi protocols | Annualized fees, P/S ratio, TVL/mcap | Price-to-Sales |
| Infrastructure (LINK, etc.) | Active usage, data feeds, partner count | Revenue + moat |
| Memecoins (PEPE, DOGE) | None measurable | Speculative premium only — Graham would pass |

### 2.3 Practical Implementation

A simplified Graham-inspired entry filter for alts:

```
ENTRY ALLOWED if:
  - MVRV Z-Score < 2.0  (not in euphoria zone)
  - Protocol P/S Ratio < sector median
  - TVL not declining > 20% in 30 days
  - Active addresses trend: flat or growing

ENTRY RESTRICTED if:
  - MVRV > 3.0 (historically precedes cycle top)
  - TVL down > 30% while price flat/up (divergence = distribution)
  - Supply inflation > 15% annualized AND no burn mechanism
```

Graham would also insist on **diversification as a substitute for certainty.** Running 5-8 pairs independently is exactly this: no single pair failure breaks the system.

---

## 3. Intrinsic Value Estimation in Crypto — What Works and What Doesn't

### 3.1 The Challenge

Traditional DCF (Discounted Cash Flow) requires stable, predictable cash flows. Crypto has:
- Volatile, cycle-dependent revenue
- No legal claim on protocol revenues for most token holders
- Supply schedules that can change via governance
- Network effects that are non-linear and hard to discount

This means DCF should be used as a **sanity check range**, not a precise number.

### 3.2 Models That Have Empirical Support

**Bitcoin Realized Price**
The average price at which all BTC last moved on-chain. When spot price < Realized Price, the market is below cost basis for the average holder — historically a strong accumulation zone. When spot >> Realized, profit-taking pressure increases.

**MVRV Ratio (Market Value / Realized Value)**
- Below 1.0: capitulation, historically the best accumulation zone
- 1.0-2.4: recovery and growth phase, favorable for longs
- 2.4-3.2: elevated, reduce position sizing
- Above 3.2: cycle peak territory, do not initiate new longs

In 2024-2025, MVRV reliably flagged the late-2024 rally peak when it exceeded 3.0, and the correction bottom in early 2025 when it dropped toward 1.8.

**Price-to-Sales (P/S) Ratio for DeFi**
Token Market Cap / Annualized Protocol Revenue. Data available at Token Terminal and DefiLlama.

Benchmark comparisons (2025):
- Aave: ~42B TVL, ~$96M/30d fees → P/S under 40x = reasonable for category leader
- High-growth protocols often trade 100-200x P/S — use same-category comparison
- A protocol at 500x P/S with declining revenue deserves a veto

**Metcalfe's Law Valuation**
Fair Value ≈ k × (Daily Active Addresses)²

Research shows BTC price tracks this relationship with R² > 0.80 over medium-to-long timeframes. The coefficient k must be calibrated from 2-3 year historical data (~0.0001 for BTC in 2024-2025). Useful as a "sanity check" for whether current price is 2x or 0.5x fair Metcalfe value.

### 3.3 What Doesn't Work Reliably

- Stock-to-Flow: empirically broken after 2022; useful only as a narrative tool
- Simple circulating supply / total supply comparisons: ignores emission schedules
- "Number of wallets" without filtering for dust and bots

---

## 4. Quantitative vs. Qualitative Analysis

Graham distinguished sharply between these. For crypto, the split looks like this:

### Quantitative (Objective, Automatable)
- MVRV, NVT, NVT Signal
- Active addresses (30d trend)
- Exchange net flows (outflows = accumulation signal)
- Protocol revenue (30d, annualized)
- TVL trend (30d, 90d)
- Token inflation rate (annualized new supply / circulating)
- Staking ratio (% of supply staked — reduces effective float)
- Token burn volume (net supply reduction)

These can be pulled from Glassnode, CryptoQuant, DefiLlama, Token Terminal, Artemis Analytics.

### Qualitative (Judgment Required)
- Team track record and credibility
- Protocol moat (is it replaceable by a fork?)
- Governance quality (token holders vs. VC-controlled)
- Regulatory risk (e.g., Ripple/SEC situation affected XRP technicals)
- Ecosystem growth narrative vs. reality

For a trading bot, qualitative factors inform the **initial pair whitelist** (pre-backtest), not the live signal. You assess them once per quarter, not in real-time.

---

## 5. Peter Lynch's Six Categories — Mapped to Crypto

Lynch's framework from *One Up on Wall Street* was designed to set appropriate **expectations and holding period** before you deploy capital. The same lens applied to crypto:

| Lynch Category | Stock Characteristics | Crypto Analog | Examples | Trading Approach |
|---|---|---|---|---|
| **Slow Growers** | Large, mature, low growth | Bitcoin as digital gold | BTC | Lower ATR, longer structure holds |
| **Stalwarts** | 10-12% growth, solid but not explosive | Large L1s with established ecosystems | ETH, SOL | Standard strategy, trend-following |
| **Fast Growers** | 25%+ annual growth, expanding market share | Emerging L2s, new DeFi sectors | ARB, OP, SUI | Higher ATR, wider SL, higher volatility |
| **Cyclicals** | Revenue tied to economic cycles | BTC/ETH — follow macro liquidity cycles | BTC, ETH | Heavy macro regime dependency |
| **Turnarounds** | Recovering from near-death | Dead projects with new catalysts | (situational) | One-time narratives, not for algo |
| **Asset Plays** | Hidden balance sheet value | Tokens with treasury backing, RWA protocols | (niche) | Not applicable to our system |

**Key insight from Lynch:** Never apply the same valuation multiple or the same exit criteria to different categories. A "fast grower" crypto at 100x P/S is valued differently than a "stalwart" at the same multiple — because the growth rate justifies the premium.

For pair selection, we should acknowledge:
- BTC and ETH behave as **cyclicals + stalwarts** — macro regime matters most
- SOL, SUI, ARB are **fast growers** — require higher ATR tolerance and potentially wider SL
- LINK, DOT are **stalwarts** — established but slow; lower expected ATR, lower variance

Lynch also warned about "diworsification" — spreading into too many categories at once. Running 5-8 pairs is acceptable; running 20 would dilute focus without proportional return increase.

---

## 6. On-Chain Growth Metrics

Analogous to Lynch's "find a company with growing earnings per share," crypto has its own growth indicators:

### 6.1 Active Addresses

The most fundamental network health metric. Raw daily/monthly unique addresses interacting with the chain.

**How to use:**
- Declining active addresses over 60+ days while price is flat/up = bearish divergence
- Growing active addresses during price consolidation = bullish accumulation signal
- Sudden spike in active addresses without price move = potential front-running by smart money

**Caveat:** Ethereum's L2 ecosystem splits activity across chains — use L1 + L2 aggregate for ETH.

### 6.2 Transaction Volume (On-Chain)

Total value transferred on-chain in USD. Feeds directly into NVT calculation.

For BTC, meaningful transactions exclude exchanges moving cold storage internally. Use "adjusted transaction volume" from Glassnode (strips inter-exchange moves).

### 6.3 Revenue / Protocol Fees

Most relevant for DeFi, L2s, and smart contract platforms. From DefiLlama and Token Terminal:

- **Total fees paid** = demand for block space / protocol services
- **Protocol revenue** = fees retained by treasury/token holders (fees minus liquidity provider rewards)
- **P/F ratio** (Price-to-Fees) = market cap / annualized total fees

Jupiter (Solana aggregator): $101M in 30-day fees in 2025 made it the top fee-earner in DeFi — that is "Lynch earnings growth" in crypto form.

### 6.4 Stablecoin Inflows by Chain

Rising stablecoin supply on a chain = dry powder looking for yield/opportunities = bullish for ecosystem tokens. Declining stablecoin supply = capital flight.

This is particularly useful for ETH and SOL ecosystem tokens.

---

## 7. Network Value Metrics

### 7.1 NVT Ratio (Network Value to Transactions)

Created by Willy Woo as the "P/E ratio of crypto."

```
NVT = Market Cap / 30-day On-Chain Transaction Volume (USD)
```

**Interpretation:**
- High NVT (rising): price growing faster than on-chain usage → overvalued signal
- Low NVT (falling): on-chain usage growing faster than price → undervalued signal
- NVT Signal (NVTS) uses 90-day MA of volume to reduce noise

**Historical benchmarks for BTC:**
- NVT < 50: historically cheap / accumulation zone
- NVT 50-100: fair value range
- NVT > 150: expensive, bubble risk

**Limitation:** Works best for BTC and ETH where on-chain settlement is primary use case. For DeFi tokens where activity happens in smart contracts (not base-layer transfers), use protocol fee metrics instead.

### 7.2 MVRV Ratio (Market Value to Realized Value)

Already covered in Section 3.2. The most battle-tested on-chain valuation metric for BTC.

For ETH specifically:
- Staking withdrawals create a natural "sell pressure" floor at realized price
- Post-merge, ETH burn makes supply dynamics more complex — use MVRV alongside supply-adjusted metrics

### 7.3 Metcalfe's Law — NVM Ratio

The NVM Ratio (Network Value to Metcalfe Value) compares actual market cap to Metcalfe-derived fair value:

```
Metcalfe Value = k × (Daily Active Addresses)²
NVM = Market Cap / Metcalfe Value
```

- NVM > 1.5: price is significantly above network effect justification
- NVM ~1.0: fairly valued by network usage
- NVM < 0.7: price below network effect value — accumulation opportunity

Research shows R² > 0.80 for BTC over medium timeframes, making this a robust cross-check.

---

## 8. Token Economics — Supply Dynamics

Graham's value investing required understanding a company's liabilities. In crypto, supply-side economics are the "liabilities" — they dilute value.

### 8.1 The Key Supply Metrics

**Inflation Rate (annualized)**
New tokens entering circulation per year as % of current supply.

- BTC: ~0.9% post-2024 halving (lowest in crypto — deflationary relative to gold)
- ETH: ~0.5% net after burns (can go negative in high-activity periods)
- New L1s / DeFi: often 20-80% in year 1 as staking rewards unlock — **massive headwind for longs**

Any token with >15% annual inflation that lacks a burn mechanism to offset it has **structural selling pressure** baked in. Every long trade is fighting against dilution.

**Vesting Schedules**
Team, investor, and advisor tokens vesting create predictable supply unlocks. These are cliff-and-linear schedules. A 20% supply unlock event in 30 days is a known headwind — avoid initiating new long positions 2 weeks before major unlocks.

Tools: TokenUnlocks.app, Vesting.gg, Messari token data.

**Burn Mechanisms**
- EIP-1559 burns ETH base fees — net issuance can go negative during congestion
- BNB quarterly burns reduce supply based on exchange revenue
- PEPE has no utility-driven burn — supply burns are marketing events only

**Staking / Lock-up Ratio**
% of circulating supply locked in staking or governance reduces effective float. Higher lock-up = tighter supply = less sell pressure per dollar of demand.

SOL staking ratio ~65-70% in 2025 — significantly reduces liquid float.

### 8.2 Supply Scoring Framework for Pair Vetting

Before adding a pair to the backtest candidate list:

```
Score each factor 1-3 (3 = favorable for longs):

Inflation:
  < 2% annual → 3 pts
  2-10% annual → 2 pts
  > 10% annual → 1 pt

Burn Mechanism:
  Utility-driven (fee burn) → 3 pts
  Governance burn → 2 pts
  None → 1 pt

Upcoming Unlocks (30d):
  < 1% supply → 3 pts
  1-3% supply → 2 pts
  > 3% supply → 1 pt

Staking Ratio:
  > 50% → 3 pts
  20-50% → 2 pts
  < 20% → 1 pt

Supply Score: sum / 12 × 100
Threshold: > 60 = acceptable for long strategy
```

---

## 9. DeFi Fundamental Analysis

For pairs like LINK, ARB, OP, NEAR, SUI — protocol-level metrics matter.

### 9.1 Revenue and Fees

From DefiLlama `/protocol/{name}`:
- **Monthly fees** = gross demand (user-paid)
- **Monthly revenue** = treasury retention (fees minus LP rewards)
- **Revenue/TVL ratio** = capital efficiency

A protocol with $1B TVL generating $5M/month revenue (0.5% monthly yield on TVL) is more capital-efficient than one with $5B TVL generating the same fees.

### 9.2 TVL as a Quality Filter

Total Value Locked measures capital that "trusts" the protocol. However:

- TVL in dollar terms is partly a price reflection — ETH price up 30% raises ETH-denominated TVL 30%
- Use TVL denominated in native asset (ETH TVL for Ethereum protocols) to strip price effect
- TVL trend (30-day change) matters more than absolute level

**Healthy:** TVL in native asset terms growing or stable + active users growing = organic adoption
**Warning:** TVL in native asset declining + price rising = "ghost protocol" — capital leaving as speculators buy

### 9.3 P/S Ratio Benchmarks (2025 Context)

From Token Terminal data:
- Uniswap: ~15-25x P/S (established AMM, revenue proven)
- Aave: ~30-50x P/S (lending leader, defensive moat)
- Newer protocols: 100-500x P/S (growth premium)

For our pair selection, prefer protocols where P/S < 100x AND revenue is growing year-over-year. Avoid protocols where P/S > 300x with flat/declining revenue — these carry excessive narrative premium.

### 9.4 User Growth Metrics

DAU (Daily Active Users) and MAU (Monthly Active Users) from Artemis Analytics or Dune Analytics:

- Consistent DAU growth > 5% month-over-month = healthy adoption
- DAU declining while TVL/price holds = capital concentration + user attrition = fragile
- DAU spikes that don't persist = airdrop farming, not organic usage

---

## 10. Using Fundamentals to Filter Trading Pairs

The practical workflow for expanding the bot's pair universe:

### Phase 1: Universe Screening (Quarterly, Manual)

Start with all Bybit USDT Perpetual pairs with > $500M daily volume.

**Hard filters (any one fails = excluded):**
- Annual inflation > 20% with no meaningful burn → exclude
- Major vesting unlock > 5% supply in next 60 days → exclude temporarily
- Active addresses declining > 30% over 90 days → exclude
- No measurable on-chain utility (pure memecoin) → exclude for long-biased strategy

**Soft filters (score-based, threshold > 60/100):**
- Supply score (Section 8.2)
- MVRV percentile (where is current cycle positioning?)
- TVL trend (for DeFi-adjacent tokens)
- Correlation to BTC < 0.8 (avoid pure BTC proxies that add no diversification)

### Phase 2: Backtest Candidate List

After Phase 1 filtering, ~10-20 candidates remain. Order by:
1. Liquidity (volume/OI ratio)
2. SMC clarity (subjective — does price respect structure or is it noise?)
3. Correlation diversity (prefer low inter-pair correlation)

Run 6-month backtest on top 5-8. Pairs that pass WR > 50%, DD < 2% per pair proceed to calibration.

### Phase 3: Regime Gates (Live, Automated)

Once a pair is in the active set, apply macro gates before each trading day:

```
IF MVRV > 3.2 (crypto-wide euphoria):
  → Reduce position sizes by 50%
  → Require confluence score >= 80 (vs normal 70)

IF MVRV < 1.0 (capitulation):
  → Normal or increased sizes
  → Require confluence score >= 65

IF Global M2 90-day trend is declining:
  → Tighten SL multipliers
  → Require stronger volume confirmation
```

---

## 11. Macro Analysis for Crypto

### 11.1 The Key Relationships

**Global M2 Money Supply (90-day leading indicator)**

Research shows BTC price has ~0.78 correlation with global M2 with approximately 90-110 day lag. When global M2 expands, liquidity flows into risk assets including crypto. When M2 contracts, crypto typically leads the decline.

Monitor: Global M2 (USD equivalent, includes Fed + ECB + PBOC + BoJ balance sheets).

Practical signal:
- M2 growing: risk-on environment, full position sizes appropriate
- M2 declining: risk-off, reduce sizes 25-50%, tighten SL

**DXY (US Dollar Index)**

Inverse relationship with crypto, particularly BTC. Strong USD typically = crypto headwind.

- DXY trending up + BTC holding: crypto strength (BTC decoupling from dollar)
- DXY trending up + BTC falling: normal inverse correlation, risk-off
- DXY declining: historically one of strongest tailwinds for crypto bull runs

In 2025, research indicates DXY has become the more immediate predictor vs. M2, particularly on 30-60 day horizons. Use both.

**S&P 500 / NASDAQ Correlation**

BTC-NASDAQ correlation reached 0.52 in 2025, up from 0.23 in 2024. This means:
- Equity bear markets now reliably drag crypto down
- Equity bull markets provide tailwind but crypto beta is 3-5x
- Monitor VIX as a risk-on/risk-off gate

**Federal Reserve Policy**

Rate cuts (or rate cut expectations) are crypto-bullish by increasing the present value of future cashflows and reducing the risk-free rate hurdle. Rate hikes are bearish.

But the mechanism is indirect: rate cuts → DXY weakens → global M2 expands → crypto benefits with lag.

### 11.2 Regime Classification Framework

Define four macro regimes based on DXY trend + M2 trend:

| Regime | DXY | Global M2 | Crypto Environment | Bot Behavior |
|---|---|---|---|---|
| **Expansion** | Falling | Rising | Strongly bullish | Full sizes, aggressive TP |
| **Neutral/Transition** | Flat | Rising | Mildly bullish | Normal parameters |
| **Compression** | Rising | Flat | Sideways/uncertain | Reduce sizes 25% |
| **Contraction** | Rising | Falling | Bearish | Reduce sizes 50%, long-only bias removed |

Check regime weekly. Do not adjust intra-week unless a major macro shock occurs.

### 11.3 Halving Cycle Positioning

BTC halvings (next: ~2028) reduce new supply by 50%. Historical pattern:
- 12-18 months post-halving: strongest bull phase
- 24-30 months post-halving: cycle peak and correction

2024 halving occurred April 2024 → peak window: April 2025 - October 2025 → we are currently in the late bull / distribution phase according to this framework (April 2026).

This means:
- Long setups still valid but margin of safety requirements should be higher
- Short setups deserve equal weight in strategy design
- Drawdown budgets should be more conservative (tighten HyroTrader compliance buffer)

---

## 12. Combining Fundamental + Technical Analysis

The recommended framework for our bot:

### Layer 1: Macro Regime (Weekly Assessment)
- M2 trend, DXY trend → regime classification
- Halving cycle phase
- MVRV zone (all crypto)

**Output:** Risk multiplier (0.5x / 0.75x / 1.0x / 1.25x) applied to position sizes

### Layer 2: Pair Qualification (Quarterly Review)
- Supply score (Section 8.2)
- P/S ratio vs. sector median
- Active address trend
- TVL trend (if DeFi)
- Upcoming unlock schedule

**Output:** Whitelist / blacklist / conditional (allowed only in certain regimes)

### Layer 3: Pre-Trade On-Chain Check (Daily, Automated)
- Is the specific asset's MVRV above 3.0? → Require higher confluence score
- Was there an unusual exchange inflow spike in last 24h? → Distribution signal, skip longs
- Did stablecoin supply on the relevant chain drop significantly? → Capital flight signal, skip

**Output:** Per-trade gate — pass / skip

### Layer 4: Technical Entry (Real-Time, Current System)
- SMC confluence score >= 70 (or adjusted threshold from Layer 1-3)
- ATR filter
- Limit order entry
- SL/TP per HyroTrader rules

The key insight: **technical analysis decides WHERE and WHEN to enter; fundamental analysis decides WHETHER to be in long mode, short mode, or flat.** Combining both reduces the false positives that technical-only systems generate during macro headwinds.

---

## 13. Practical Data Sources

| Metric | Primary Source | Secondary Source |
|---|---|---|
| MVRV, NVT, Active Addresses | Glassnode | CryptoQuant |
| Protocol Revenue, TVL, P/S | Token Terminal | DefiLlama |
| Active Users, DAU | Artemis Analytics | Dune Analytics |
| Global M2 | MacroMicro | TradingView (FRED data) |
| DXY, S&P correlation | TradingView | Bloomberg |
| Vesting Schedules | TokenUnlocks.app | Messari |
| Exchange Flows | CryptoQuant | Glassnode |
| On-chain Transaction Volume | Blockchain.com | Glassnode |

**Automation note:** Most of these sources have free API tiers. For the bot's daily regime check, Glassnode free tier provides MVRV and active addresses with 24-hour delay — sufficient for a daily pre-market assessment.

---

## 14. Key Takeaways for Implementation

1. **Graham's margin of safety in crypto = MVRV < 2.4 for initiating long campaigns.** Above 3.0, the probability of adverse excursion increases significantly.

2. **Lynch's categorization matters for backtest expectations.** Fast-grower alts (SUI, ARB) will have higher ATR, more false signals, and need wider SL — don't penalize them against BTC benchmarks.

3. **NVT and MVRV are the most reliable on-chain valuation tools.** NVT for cycle timing, MVRV for regime classification.

4. **Supply inflation > 15% without burn = structural headwind for longs.** Filter these out in pair selection.

5. **Global M2 + DXY define the macro envelope.** Run strategy at full capacity only during Expansion regime. Halve sizes during Contraction.

6. **Protocol revenue (P/S ratio) separates real projects from narrative plays.** For non-BTC pairs, require P/S < 150x for new entries.

7. **Exchange outflows (Glassnode) are the most actionable on-chain signal for daily trading.** Net outflows = accumulation = bullish. Net inflows (coins moving TO exchanges) = selling pressure = reduce long bias.

8. **Metcalfe's Law provides a fair-value anchor for BTC** when price diverges significantly from (Active Addresses)² × k. Divergence > 50% from fair value historically precedes corrections.

9. **Vesting unlocks are scheduled risks.** Avoid entering new longs in a token within 2 weeks of a >3% supply unlock event. These are in public schedules — they can be automated.

10. **Fundamental analysis is a filter, not an entry trigger.** It should never override a clean technical setup — it should prevent setups from firing in adverse macro/fundamental conditions.

---

## Sources

- [Benjamin Graham — Margin of Safety (blockchain.news)](https://blockchain.news/flashnews/benjamin-graham-margin-of-safety-chapter-20-key-takeaways-for-traders-and-risk-management)
- [Peter Lynch's Six Stock Categories — Medium](https://medium.com/@sachin.prabhu.ram/peter-lynchs-one-up-on-wall-street-the-six-categories-of-stocks-eb018ba9a2ae)
- [NVT Ratio — Glassnode Academy](https://academy.glassnode.com/indicators/nvt/nvt-ratio)
- [NVT Ratio — CryptoQuant User Guide](https://userguide.cryptoquant.com/cryptoquant-metrics/network/nvt-ratio)
- [MVRV Ratio — Glassnode Insights](https://insights.glassnode.com/mastering-the-mvrv-ratio/)
- [Bitcoin Cycle Predictions With MVRV — CCN](https://www.ccn.com/analysis/crypto/bitcoin-cycle-predictions-with-mvrv-insights-from-market-and-realized-caps/)
- [Metcalfe's Law in Bitcoin — QuantPedia](https://quantpedia.com/metcalfes-law-in-bitcoin/)
- [NVM Ratio — CryptoQuant Data Guide](https://dataguide.cryptoquant.com/network-indicators/nvm-ratio)
- [DeFi State 2025 — DL News](https://www.dlnews.com/research/internal/state-of-defi-2025/)
- [Top DeFi Protocols 2025 — Medium / Lampros Tech](https://medium.com/@lamprostech/top-defi-protocols-2025-adoption-tvl-and-yield-insights-6dd7ff36c133)
- [P/S Ratio — Token Terminal](https://tokenterminal.com/explorer/metrics/ps-fully-diluted)
- [Crypto Intrinsic Value — TradingView / CoinTelegraph](https://www.tradingview.com/news/cointelegraph:a6e40aa89094b:0-intrinsic-value-of-crypto-what-is-it-and-how-to-calculate-it/)
- [Bitcoin Macro Analysis 2025-2026 — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5232018)
- [Bitcoin Liquidity and Macro Crossroads — Coinbase Institutional](https://www.coinbase.com/institutional/research-insights/research/market-intelligence/bitcoin-liquidity-and-macro-crossroads)
- [DXY as Bitcoin Macro Indicator — BeInCrypto](https://beincrypto.com/dxy-bitcoin-macro-indicator-willy-woo/)
- [Tokenomics: Distribution, Inflation, Burns — Gate Wiki](https://dex.gate.com/crypto-wiki/article/what-is-tokenomics-token-distribution-inflation-mechanisms-and-burn-strategies-explained-20251226)
- [On-Chain Analysis Tools 2026 — BingX](https://bingx.com/en/learn/article/what-are-the-top-on-chain-analysis-tools-for-crypto-traders)
- [Fundamental vs Technical Analysis — Smart Crypto Signals](https://smart-crypto-signals.com/guides/fundamental-technical-analysis)
- [DefiLlama — TVL Analytics](https://defillama.com/)
- [Artemis Analytics — Crypto Investing Terminal](https://www.artemisanalytics.com/)

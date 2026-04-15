# Crypto Market Microstructure

**Date:** 2026-04-06
**Scope:** Deep analysis of how crypto markets actually work at the microstructural level, with focus on Bybit perpetual futures and actionable signals for the trading bot.

---

## Order Book Dynamics

### How Limit Orders Fill on Bybit

The order book is a continuous double auction. Every resting limit order is a public commitment to transact at a specific price; market (or IOC) orders consume that liquidity. On Bybit USDT perpetuals, the matching engine is price-time priority: at the same price level, older orders fill first.

**Practical fill mechanics for BTCUSDT:**
- Bid-ask spread is typically 0.5–1 tick ($0.50 on BTCUSDT where tick = $0.10). During low-volatility Asian hours spread widens to 2–4 ticks.
- The top 5 levels of the book hold the bulk of resting liquidity. For BTCUSDT at $90,000 price levels, a single level routinely carries $1–5M notional in quiet markets.
- A limit buy at best bid will fill when a market sell hits it, or when the price drifts down to meet it. There is **no guarantee of fill** — the order can expire unfilled if the market moves away.

**For the bot (limit entry only):**
A limit order placed at the top of book (best bid/ask) has high fill probability in a trending market but can sit indefinitely in choppy conditions. Placement strategy matters: entering 1–2 ticks inside the spread increases fill probability but worsens average entry slightly. The bot's current design (limit at OB zone) is correct but must account for potential partial fills or non-fills.

### Iceberg Orders and Hidden Liquidity

Bybit natively supports iceberg orders: a large order is split into visible slices (display quantity), with the next slice only appearing after the previous one fills. The full size is never visible in the public order book depth feed.

**How to detect an iceberg:**
- A price level that repeatedly replenishes immediately after partial fills — the quantity at that level seems to "not go down" even as trades print through it.
- CoinGlass and Bookmap tools visualize this via cumulative volume at price. The pattern looks like a wall that slowly erodes rather than a single block that disappears instantly.

**Implication for the bot:** A large iceberg bid below current price (visible as a stubborn support level in the order book feed) is a strong signal that a well-capitalized participant is accumulating. This aligns with SMC order block logic — the OB is often where icebergs are placed.

### Order Book Imbalance

Research (Wang et al., 2025; Easley et al., 2024) confirms that order book imbalance — the ratio of bid volume to ask volume across N levels — is one of the strongest short-term price predictors in crypto:

```
Imbalance = (BidVolume_N - AskVolume_N) / (BidVolume_N + AskVolume_N)
Range: -1 (all asks) to +1 (all bids)
```

A reading above +0.4 over 3–5 consecutive 15M closes suggests sustained buying pressure. Below -0.4: selling pressure. This is available via Bybit API v5 `GET /v5/market/orderbook` with `limit=50`.

---

## Funding Rate Analysis

### How Funding Works on Bybit

Bybit perpetuals use an 8-hour funding cycle with payments at 00:00, 08:00, and 16:00 UTC. The formula:

```
Premium Index (P) = [Max(0, Impact Bid - Index) - Max(0, Index - Impact Ask)] / Index
Funding Rate (F) = P + clamp(0.01% - P, 0.05%, -0.05%)
Funding Fee = Position Value × Funding Rate
```

The `clamp` function caps the funding rate at ±0.05% per cycle. At 0.01% baseline (interest component), this translates to roughly 10.95% annualized carry cost for perpetually long positions in neutral conditions — far from free.

**Key insight:** The funding mechanism is the anchor that keeps perp prices near spot. When perps trade at a significant premium (positive funding), longs pay shorts every 8 hours. This incentivizes arbitrageurs to short perps and buy spot, compressing the premium. The process works in reverse with negative funding.

### Funding Rate as a Trading Signal

Funding rate carries rich information about market positioning:

| Funding Rate | Interpretation | Signal |
|---|---|---|
| > +0.10% per 8h | Extreme longs overcrowded | Potential reversal or squeeze short |
| +0.03% to +0.10% | Bull market, normal leverage | Trend continuation likely |
| +0.005% to +0.03% | Neutral/healthy | No signal |
| -0.005% to -0.01% | Mild bearish, potential accumulation | Cautious long |
| < -0.03% | Extreme shorts overcrowded | Potential short squeeze |

**Historical data points:**
- January 2025 BTC ATH at $109,450: funding reached extreme positive levels — the overcrowded long trade peaked and reversed.
- November 2022 FTX collapse: funding went deeply negative at $15,500 — a capitulation signal. Recovery followed.
- Q3 2025: positive funding over 92% of the period — sustained bull market condition.

**Contrarian signal:** When funding exceeds ±0.10% per cycle, treat it as a crowding warning. A long SMC signal with extreme positive funding (+0.10%+) should be scored down or filtered. An SMC short signal with extreme negative funding similarly warrants caution.

**Practical threshold for the bot:**
- If funding > +0.07%: reduce confluence score by 10 points for long signals
- If funding < -0.07%: reduce confluence score by 10 points for short signals
- If funding in [-0.03%, +0.03%]: no adjustment (normal conditions)

The Bybit API endpoint `GET /v5/market/funding/history` provides historical data. Real-time current rate: `GET /v5/market/tickers` (field: `fundingRate`).

---

## Open Interest as Trading Signal

### What OI Measures

Open interest is the total notional value of all outstanding contracts that have not been settled. Unlike volume (which counts every trade), OI tells you how many positions are currently alive and at risk.

- **OI rising + price rising:** New money entering long side. Trend has conviction. Continuation likely.
- **OI rising + price falling:** New short positions being opened into the decline. Bearish confirmation.
- **OI falling + price rising:** Short covering rally. Weaker signal — not new longs, just shorts exiting.
- **OI falling + price falling:** Long capitulation. Trend losing steam — potential bottom forming.

### OI Divergence: The Most Actionable Signal

When price makes a new high but OI is declining (or flat), bullish conviction is evaporating. This is a classic pre-reversal setup: the move was powered by short covering, not genuine new longs. The divergence suggests the trend is exhausted.

Conversely, price making a new low with OI declining often marks a bottom — the final sellers are leaving, not new shorts entering.

**The OI + Funding Rate Matrix (most reliable):**

| OI | Funding | Market State | Bias |
|---|---|---|---|
| Rising | High positive | Crowded longs, fragile | Near reversal |
| Rising | Neutral | Healthy trend | Continue |
| Falling | High positive | Short squeeze unwinding | Caution long |
| Rising | High negative | Crowded shorts | Squeeze candidate |
| Falling | High negative | Capitulation | Potential bottom |

### Bybit API for OI

`GET /v5/market/open-interest` with `intervalTime=1h` gives hourly OI snapshots. The WebSocket does not push OI directly — must poll REST at intervals (every candle close).

For the bot: compare OI at the current 15M close vs 4 periods ago (1H change). If OI is declining while price approaches a signal zone, downweight the signal.

---

## Liquidation Cascades

### Mechanics

When a position's margin falls below the maintenance margin level, the exchange's liquidation engine closes it at market. On Bybit with isolated margin, liquidation is triggered when:

```
Mark Price ≤ Liquidation Price (long)
Mark Price ≥ Liquidation Price (short)
```

Note: Bybit uses **Mark Price** (not Last Traded Price) to trigger liquidation. Mark Price is computed as the median of: (Index × [1 + funding rate × time remaining]), a 5-minute TWAP of the basis, and Last Traded Price. This prevents flash crash liquidations from single-exchange manipulation — but not from genuine broad sell-offs.

**The cascade mechanism:**
1. A large seller (or just thin liquidity) moves price 2-3%.
2. This hits Mark Price triggers for highly leveraged positions at nearby levels.
3. Liquidations are closed as market orders, pushing price further.
4. The moved price hits the next cluster of liquidations.
5. This repeats until all clustered positions are wiped out or a large buyer absorbs.

During the October 2025 cascade event: $1.7–2.0B liquidated in 24 hours, 396,000 traders liquidated. The feedback loop consumed bid-side liquidity that turned out to be the leveraged longs themselves — when they were liquidated, their own bids disappeared.

### Liquidation Clusters as Price Targets (SMC Alignment)

Liquidation heatmaps (CoinGlass) show estimated price levels where clusters of positions would be wiped. These clusters function as liquidity pools — they attract price, because smart money and market makers know where the forced selling/buying will occur.

This maps directly onto SMC "liquidity hunt" logic: equal highs/lows are stop-loss clusters. Institutional players move price into these zones to trigger stops (and liquidations), collect the liquidity, then reverse.

**Practical implication:**
- Dense liquidation cluster above price = magnetic target for a short-term run-up
- Dense liquidation cluster below price = magnetic target for a short-term dip
- After a major liquidation cascade clears a zone, it often reverses sharply (no more forced sellers/buyers)

**For the bot:** A trade setup where price is moving toward a known liquidation cluster (visible in CoinGlass heatmap) is a higher-confidence setup. Entry into an OB that sits just below a large liquidation cluster above = strong confluence for long.

The Bybit WebSocket `allLiquidation` channel pushes real-time liquidation events. Monitoring large liquidations (>$500K single event) during an active trade can signal cascade risk.

---

## Market Maker Behavior

### Role and Incentives

Market makers on Bybit continuously post both bid and ask offers, earning the bid-ask spread while managing inventory risk. Bybit incentivizes this via maker rebates (negative fees for limit orders on high-volume tiers).

Professional market makers run sophisticated models:
- **Avellaneda-Stoikov model:** adjusts quotes based on current inventory and volatility. Wide spreads when volatility is high; tight spreads when flat.
- **Adverse selection avoidance:** MMs widen spreads or pull quotes when they detect informed order flow (large directional orders from algorithmic traders).

**The implication:** When you see spreads suddenly widening in real-time (from 1 tick to 5+ ticks), market makers are pulling back from providing liquidity. This usually means:
1. Major news incoming (economic data, whale movement)
2. Large directional flow detected
3. Mark price diverging from Index Price

Spread widening is a risk-off signal — avoid entering during periods of abnormal spread.

### Quote Stuffing and Order Flow Toxicity

The SEC 2024 enforcement actions revealed that market making firms generate "quadrillions of transactions" algorithmically. Some of this is legitimate liquidity provision; some crosses into manipulation territory (wash trading, spoofing).

**Spoofing pattern:** Large orders placed to create false impression of support/resistance, then cancelled before execution. Detectable by monitoring order book changes — a large bid that appears and disappears within 1-2 seconds without any trades is likely a spoof.

For BTC perpetuals on Bybit, spoofing in the top 3-5 levels of the book is rare (regulatory scrutiny, large order required), but more common at natural support/resistance levels where stop clusters exist.

### Wash Trading Reality

Chainalysis 2025 data: approximately $2.57B in suspected wash trading identified across crypto markets. This is concentrated in low-cap tokens. For BTCUSDT on Bybit, volume is genuine (too large to fake economically), but volume spikes in small altcoin pairs warrant skepticism.

---

## Perpetual Futures Mechanics

### Perp vs Spot: Key Differences for Trading

| Feature | Spot | Perpetual Futures |
|---|---|---|
| Settlement | Immediate | No expiry |
| Price anchor | Direct ownership | Funding rate mechanism |
| Leverage | 1:1 (or margin) | Up to 100:1 |
| Cost of holding | Opportunity cost | Funding payments |
| Liquidation risk | None (can't go below 0) | Yes, at maintenance margin |
| Price discovery | Primary | Secondary (3x daily BTC volume) |

Despite perps having 3x the daily volume of spot BTC, **spot markets lead price discovery**. The causal flow is:
1. Spot price changes first (large OTC block trades, ETF flows)
2. Perp mark price follows via arbitrage within milliseconds
3. Retail perpetual traders react to mark price movement

### The Basis and Funding Equilibrium

The basis = Perp Price - Spot Price. In equilibrium, this should be near zero. When basis is significantly positive (perp > spot), arbitrageurs enter the funding rate trade: long spot + short perp, earning funding payments until convergence.

When these arb positions are large (Ethena's delta-neutral strategy holds billions in this trade), they act as a natural cap on how extreme funding can become. Funding above ~0.15% per cycle is rarely sustainable because arb capital steps in.

### Mark Price vs Last Traded Price

A critical Bybit-specific detail: **P&L and liquidation are calculated on Mark Price, not Last Traded Price**. Your candle charts show Last Traded Price. The difference can be up to 0.5% during volatile periods.

Scenario: BTCUSDT Last Traded Price shows $90,000 on your chart, but Mark Price is $89,550 due to basis compression. A long position liquidated at $89,600 might show as "liquidated well above the candle wick" to the trader — but it was correct per Mark Price.

**For SL placement:** The bot places SL based on candle prices. The actual trigger is Mark Price. In practice, during normal conditions this difference is <0.1%. During cascades, it can be 0.5%+. Consider adding a small buffer (0.1-0.15%) to SL calculations to account for Mark/Last divergence.

### Auto-Deleveraging (ADL)

If Bybit's insurance fund is depleted and a liquidated position cannot be closed at a better price than bankrupt price, the system triggers Auto-Deleveraging — the most profitable positions on the opposite side are closed at the bankrupt price. ADL is rare but destroys unexpected winning trades. The ADL indicator on Bybit (colored arrows) shows current ADL risk ranking.

---

## Bybit-Specific Considerations

### Rate Limits (API v5)

| Tier | Limit | Endpoints |
|---|---|---|
| Market data REST | 120 req/sec | orderbook, kline, tickers |
| Order placement | 10 req/sec (non-VIP) | placeOrder, amendOrder |
| Private REST | 600 req/min | getPositions, getOrders |
| WebSocket | No rate limit | All WS channels |

WebSocket is the correct choice for all real-time data (klines, tickers, order fills). REST polling for OI and funding rate should be limited to once per candle close.

### Relevant WebSocket Channels

```
Public:
  kline.15.BTCUSDT         — 15-min candles (closes confirmed via confirm=true field)
  tickers.BTCUSDT          — real-time bid/ask, last price, funding rate, OI
  orderbook.50.BTCUSDT     — 50-level order book depth
  liquidation.BTCUSDT      — real-time liquidation events (new in 2024 update)

Private:
  order                    — order status changes
  position                 — position updates (mark price, unrealized PnL)
  execution                — fill confirmations
```

The `tickers` channel is particularly valuable — it pushes `fundingRate`, `openInterestValue`, `bid1Price`, `ask1Price`, `bid1Size`, `ask1Size` in real-time. This single subscription provides funding rate monitoring without any REST polling.

### Bybit Insurance Fund

Bybit maintains a BTC and USDT insurance fund (visible on their transparency page). When a liquidation generates a surplus (filled at better than liquidation price), it goes into the fund. Deficits are covered by the fund. ADL only triggers when the fund is exhausted.

A shrinking insurance fund during a volatile period indicates the exchange is absorbing losses — a sign that cascade risk is elevated.

### Fee Structure Impact on Strategy

| Role | Fee | Impact |
|---|---|---|
| Maker (limit order) | -0.01% (rebate) | Positive: earn $0.10 per $1,000 notional |
| Taker (market order) | +0.055% | Cost: $0.55 per $1,000 notional |

For a $11,250 notional position (our 22.5% of $10K @ 5x):
- Limit entry + limit exit: rebate of ~$2.25 total (actually earn)
- Market entry + market exit: cost of ~$12.38 total

This confirms the bot's limit-order-only design is correct not just for HyroTrader compliance but for economic efficiency.

---

## Stablecoin Flows and USDT

### USDT Mint/Burn as Leading Indicator (Weakening Signal)

Historical data shows USDT minting correlates with Bitcoin bull runs: large mints ($1B+) often precede or coincide with BTC price acceleration. The mechanism: institutions purchasing USDT to buy crypto increase demand, and Tether mints more to meet it.

However, this signal is **weakening over time**. USDT now has widespread non-crypto use cases (cross-border payments, emerging market savings). Recent research (Eberhardt) shows the mint/burn correlation has degraded significantly since 2024 as USDT adoption broadens beyond crypto trading.

**Practical stance:** Not worth building into the bot as a primary signal. Monitor for extreme events only — a single $3B+ USDT mint in a 24-hour window alongside strong on-chain data could be noted. For normal operations, ignore.

### MiCA Impact

EU's MiCA framework has caused USDT delistings on some EU exchanges (Coinbase EU, Kraken EU). USDC is gaining institutional ground. This fragmentation affects liquidity on EU-facing venues but Bybit (offshore, Asian user base) maintains USDT perpetuals as primary product — no operational impact for our bot.

---

## Cross-Exchange Arbitrage and Price Discovery

### The CEX Hierarchy

Price discovery research confirms: centralized exchanges dominate with 61% higher integration than DEX. Information flows CEX → DEX (zero reverse causality confirmed empirically). Within CEX, Binance leads price discovery for BTC, followed by OKX and Bybit.

**Practical implication:** When Binance BTCUSDT moves sharply, Bybit BTCUSDT follows within milliseconds via cross-exchange arbitrage bots. A price move that appears on Binance but not yet on Bybit is transient — it will close within 100-500ms. This means:

1. Bybit's price is always close to fair value — no persistent "stale price" arbitrage for retail.
2. Our limit orders are always priced in a fairly efficient market.
3. SL placement on Bybit should assume price can gap to match Binance during fast moves.

### Funding Rate Arbitrage and Its Effect

Large arbitrage desks (Ethena, GSR, etc.) run delta-neutral funding rate trades: long spot BTC + short perp BTC = earn funding rate risk-free. These desks hold aggregate positions in the billions.

**Effect on the market:**
- Acts as natural cap on funding rate extremes (above ~0.15%, arb capital floods in)
- Creates persistent selling pressure on perp prices (short from arb desks)
- Keeps basis tight, making perp prices highly correlated with spot

**For our bot:** This arbitrage activity is a background condition that stabilizes the market most of the time. It creates the rare but meaningful exception: when arb desks are forced to unwind (market panic, counterparty risk), perp prices can gap hard relative to spot, triggering unexpected liquidations.

---

## Actionable Insights for Our Bot

### Signals to Add

The following signals are available via Bybit API v5 and WebSocket and can be integrated into the confluence scoring system.

#### 1. Funding Rate Filter (High Priority)

```typescript
// Available via: tickers.BTCUSDT WebSocket, field: fundingRate
// Current funding rate (updates every minute)

function fundingRateAdjustment(fundingRate: number, side: 'long' | 'short'): number {
  const rate = Math.abs(fundingRate);
  // fundingRate is per 8h, e.g. 0.0001 = 0.01%
  
  if (side === 'long' && fundingRate > 0.0007) return -15;  // Extreme long crowding
  if (side === 'long' && fundingRate > 0.0004) return -8;   // High long crowding
  if (side === 'short' && fundingRate < -0.0003) return -10; // Extreme short crowding
  if (side === 'short' && fundingRate < -0.0007) return -15; // Extreme short crowding
  
  return 0;  // Neutral: no adjustment
}
```

This is a **penalty modifier**, not a standalone signal. Apply after calculating base confluence score. A 70-point setup with extreme opposing funding becomes 55-62 — below threshold, filtered out.

#### 2. Open Interest Trend (Medium Priority)

```typescript
// Available via: GET /v5/market/open-interest (poll once per 15M close)
// Compare current OI vs 1h ago (4 candles back)

function oiTrendSignal(oiCurrent: number, oiPrev1h: number, side: 'long' | 'short'): number {
  const oiChange = (oiCurrent - oiPrev1h) / oiPrev1h;
  
  if (side === 'long') {
    if (oiChange > 0.03) return +5;   // Rising OI confirms long conviction
    if (oiChange < -0.03) return -5;  // Falling OI weakens long (covering, not new longs)
  }
  if (side === 'short') {
    if (oiChange > 0.03 && /* price falling */) return +5;   // Rising OI confirms short
    if (oiChange < -0.03) return -5;  // Falling OI weakens short
  }
  
  return 0;
}
```

Add as a new confluence component with max ±5 points.

#### 3. Bid-Ask Spread Filter (Safety Filter)

```typescript
// Available via: tickers.BTCUSDT WebSocket, fields: bid1Price, ask1Price
// Do not enter if spread is abnormally wide (MM pulling back = danger)

function spreadFilter(bid: number, ask: number, midPrice: number): boolean {
  const spreadPct = (ask - bid) / midPrice;
  const normalSpread = 0.00002;  // 0.002% = ~$1.80 on BTCUSDT at $90,000
  
  if (spreadPct > normalSpread * 5) return false;  // Spread 5x normal: danger
  return true;
}
```

This is a **pre-filter** applied before confluence scoring begins. If spread is abnormal, skip the candle entirely.

#### 4. Liquidation Event Monitoring (Position Management)

```typescript
// Available via: WebSocket liquidation.BTCUSDT
// Monitor during active positions only

function onLiquidationEvent(event: LiquidationEvent, position: Position) {
  // Large liquidation in same direction as position = cascade risk
  if (event.side === position.side && event.size > 500_000) {
    // USDT notional > $500K liquidation in our direction
    // Consider tightening SL or reducing position
    alertPositionMonitor('Large cascade liquidation detected');
  }
}
```

#### 5. Mark Price vs Last Price Divergence

```typescript
// Available via: private WebSocket position channel (markPrice field)
// Cross-check against Last Traded Price

function markPriceDivergenceAlert(markPrice: number, lastPrice: number) {
  const divergence = Math.abs(markPrice - lastPrice) / lastPrice;
  if (divergence > 0.003) {  // 0.3% divergence
    // Mark price significantly different from chart price
    // Liquidation triggers may fire even if chart SL not hit
    logger.warn({ markPrice, lastPrice, divergence }, 'Mark/Last price divergence elevated');
  }
}
```

### Signals NOT to Add (After Research)

| Signal | Reason to Skip |
|---|---|
| USDT mint/burn tracking | Weakening correlation, too slow (hours/days lag), not available via API |
| Cross-exchange price gaps | Close within 100-500ms, not exploitable at our execution speed |
| Wash trading detection | Not relevant for BTCUSDT (too liquid to fake), complex to implement |
| Iceberg order detection | Requires Level 2 order flow tooling beyond Bybit standard API |
| ADL risk tracking | Rare event, no API for insurance fund real-time |

### Priority Implementation Order

1. **Funding rate modifier** — single API field already in `tickers` WebSocket. Low complexity, direct impact on signal quality. Implement first.
2. **Spread filter** — same WebSocket data, pure safety mechanism. Implement alongside funding.
3. **OI trend** — requires one REST call per 15M close. Medium effort. Adds conviction filter.
4. **Liquidation monitor** — WebSocket subscription to `liquidation.BTCUSDT`. Useful for active position management in cascade scenarios.

### Configuration Additions for BTCUSDT.json

```json
{
  "microstructure": {
    "fundingRateHighThreshold": 0.0007,
    "fundingRateExtremeThreshold": 0.0004,
    "fundingRatePenaltyHigh": -8,
    "fundingRatePenaltyExtreme": -15,
    "oiTrendChangeThreshold": 0.03,
    "oiTrendBonus": 5,
    "oiTrendPenalty": -5,
    "spreadMaxMultiplier": 5,
    "markLastDivergenceAlertThreshold": 0.003,
    "liquidationCascadeAlertSize": 500000
  }
}
```

---

## Summary

Crypto market microstructure differs from traditional markets in several important ways relevant to algorithmic trading:

1. **Perpetual futures dominate volume** (3x spot for BTC) but spot leads price discovery. Our bot's signal analysis on perp data is correct, but the "real" price comes from spot/OTC.

2. **Funding rate is the primary market positioning signal** — more actionable than sentiment indices. Extreme funding reliably signals crowded trades and precedes reversals. This should be the first microstructure signal integrated into the bot.

3. **Liquidation cascades are structurally inevitable** given concentrated leveraged positioning. They create the volatile moves that generate our SMC setups (sweeps, CHoCH), but also the risk of adverse fills. The key insight: the liquidity pools SMC targets are often literally where leveraged position stop-clusters sit.

4. **Bybit's Mark Price mechanism** protects against pure manipulation liquidations but means SL prices calculated from chart prices can be slightly off. Add 0.1-0.15% buffer to SL calculations.

5. **OI + Funding Rate matrix** is the most reliable framework for assessing trade conviction. Rising OI with neutral funding = healthy trend. High positive funding + OI rising = crowded and fragile.

6. **Market makers pull liquidity** (widen spreads) before large moves — a real-time early warning system available through the `tickers` WebSocket channel at no additional cost.

---

*Sources:*
- [Easley, O'Hara et al. — Microstructure and Market Dynamics in Crypto Markets](https://stoye.economics.cornell.edu/docs/Easley_ssrn-4814346.pdf)
- [Wang et al. — Exploring Microstructural Dynamics in Cryptocurrency Limit Order Books (2025)](https://arxiv.org/html/2506.05764v2)
- [Bybit — Introduction to Funding Rate](https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate)
- [Bybit — Mark Price Calculation](https://www.bybit.com/en/help-center/article/Mark-Price-Calculation-Perpetual-Expiry-Contracts)
- [Bybit API v5 — Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest)
- [Bybit API v5 — Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate)
- [Bybit API v5 — All Liquidation WebSocket](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation)
- [Coinbase — Understanding Funding Rates in Perpetual Futures](https://www.coinbase.com/learn/perpetual-futures/understanding-funding-rates-in-perpetual-futures)
- [CoinGlass — Liquidation Heatmap](https://www.coinglass.com/pro/futures/LiquidationHeatMap)
- [QuantJourney — Funding Rates: The Hidden Cost, Sentiment Signal, and Strategy Trigger](https://quantjourney.substack.com/p/funding-rates-in-crypto-the-hidden)
- [CoinTelegraph — How USDT Mints and Burns Move with Bitcoin Price Cycles](https://cointelegraph.com/news/usdt-mints-bitcoin-price)
- [Chainalysis — Crypto Market Manipulation 2025](https://www.chainalysis.com/blog/crypto-market-manipulation-wash-trading-pump-and-dump-2025/)
- [MDPI — Order Book Liquidity on Crypto Exchanges](https://www.mdpi.com/1911-8074/18/3/124)
- [Gate.io — How Derivatives Signals Predict Crypto Market Trends](https://web3.gate.com/crypto-wiki/article/how-do-futures-open-interest-funding-rates-and-liquidation-data-signal-derivatives-market-trends-20260109)
- [ResearchGate — Anatomy of the Oct 10–11 2025 Crypto Liquidation Cascade](https://www.researchgate.net/publication/396645981_Anatomy_of_the_Oct_10-11_2025_Crypto_Liquidation_Cascade_Macroeconomic_Triggers_Market_Microstructure_and_Systemic_Risk_Lessons)
- [Bookmap — How to Read and Trade Iceberg Orders](https://bookmap.com/blog/how-to-read-and-trade-iceberg-orders-hidden-liquidity-in-plain-sight)

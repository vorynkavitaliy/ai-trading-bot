# Practical Algorithmic Trading Implementation Patterns

**Date:** 2026-04-06
**Sources:**
- Yves Hilpisch — *Python for Algorithmic Trading* (O'Reilly, 2020)
- Jason Strimpel — *Python for Algorithmic Trading Cookbook* (Packt, 2024)
- Michael Halls-Moore / QuantStart — Event-Driven Backtesting series
- NautilusTrader open-source engine (nautechsystems/nautilus_trader)
- FIA — *Best Practices for Automated Trading Risk Controls* (2024)
- Walk-Forward Optimization: arxiv 2602.10785, quantconnect docs
- TimescaleDB / trading database design: timescale docs, quant nomad

**Scope:** Architecture patterns and design decisions applicable to our TypeScript bot.
No Python code — design concepts only.

---

## 1. Event-Driven Backtesting Architecture

### 1.1 Vectorized vs. Event-Driven — The Core Trade-Off

Hilpisch distinguishes two backtesting paradigms:

**Vectorized backtesting** operates on the full dataset at once. It is fast and easy to implement, but has a critical flaw: because all data is in memory simultaneously, it is easy to accidentally introduce look-ahead bias — referencing future candle data when computing indicators for past bars. It also cannot model sequential logic like "place order on this bar, check fill on the next bar, then set SL."

**Event-driven backtesting** processes one bar at a time, in chronological order. The simulator sees only candles up to and including the current bar. This eliminates look-ahead bias by construction. It also allows realistic modeling of order-fill sequencing: entry placed → fill simulated on the following bar → SL/TP evaluated on subsequent bars.

Our current `simulator.ts` follows the event-driven model correctly — bar-by-bar replay, `candles[0..currentIndex]` access only. This is the right choice for a strategy that uses limit orders with delayed fills.

### 1.2 The Four-Event Queue Pattern (QuantStart / Hilpisch)

The canonical event-driven architecture uses a queue with four event types:

```
MarketEvent → DataHandler → SignalEvent → Strategy → OrderEvent → Portfolio → FillEvent → ExecutionHandler
                                                              ↑                                    |
                                                              └────────────────────────────────────┘
```

- **MarketEvent** — emitted when a new bar closes. Contains no data itself; signals that new market data is available.
- **SignalEvent** — emitted by the Strategy when indicators fire. Contains direction, symbol, timestamp, confidence.
- **OrderEvent** — emitted by the Portfolio after risk/position-size checks. Contains concrete trade parameters.
- **FillEvent** — emitted by the ExecutionHandler to confirm fill price, quantity, and commission.

The key insight is that **backtest and live trading share identical interfaces**. The only component that differs is the ExecutionHandler: in backtest mode it simulates fills from candle high/low; in live mode it submits orders to the exchange and receives fill confirmations via WebSocket. Every other component — Strategy, Portfolio, RiskManager — runs the same code in both contexts.

**Relevance to our TypeScript bot:** Our current architecture partially implements this pattern:
- `analyzer.ts` plays the role of Strategy (emits signals)
- `risk.ts` plays the role of Portfolio (position sizing, SL/TP calc)
- `executor.ts` plays the role of ExecutionHandler (live only)
- `simulator.ts` plays the role of a combined ExecutionHandler + Portfolio (backtest)

The gap is that the backtest simulator is separate code from the live execution path. A future improvement would be extracting a shared `StrategyCore` interface that runs identically in both `simulator.ts` and `bot.ts`, reducing the risk of live/backtest divergence.

### 1.3 The Critical Rule: Check SL Before TP on the Same Bar

Strimpel and QuantStart both document this as a common source of unrealistic backtest results. If the same bar triggers both SL and TP levels (the bar's range crosses both), the conservative assumption is that SL was hit first. This prevents inflated win rates. Our backtest rules document already mandates this correctly.

---

## 2. Real-Time Data Handling Patterns

### 2.1 WebSocket Architecture for Candle Data

Hilpisch's approach to real-time data pipelines centers on three concerns: connection reliability, data completeness, and timestamp alignment.

**Heartbeat monitoring:** A WebSocket that goes silent is not the same as a disconnected WebSocket. Production systems must implement application-layer heartbeat checks independent of the transport layer. The pattern is: if no message received within N seconds, consider the connection stale and initiate reconnect. For Bybit specifically, kline messages arrive on every price update — a 30-second silence on a liquid pair like BTCUSDT is a strong signal of a stale connection.

**Exponential backoff reconnect:** On disconnect, wait 1s → 2s → 4s → 8s (cap at 30s). Reset the counter only after a stable connection of at least 60 seconds. Our trading-logic rules already mandate this pattern.

**Bar alignment problem:** WebSocket kline data arrives as in-progress bars that are continuously updated. The bar only becomes "closed" when the `confirm` or `closed` field is true. A common bug is processing the bar on the first update (open of the bar) rather than waiting for close confirmation. This introduces look-ahead bias in live trading because indicators computed at bar-open use incomplete data. **Always wait for the bar-close confirmation flag before feeding a candle to the analysis engine.**

**Gap detection on reconnect:** After a reconnect, the system must check whether any bars were missed during the downtime. If the last stored candle timestamp is more than one bar interval behind, backfill via REST API before resuming WebSocket processing. This prevents false signals from indicators computed on a candle buffer with gaps.

### 2.2 The "Hot Path" Principle

Strimpel emphasizes keeping the signal generation path as short as possible. Every millisecond between bar-close and order submission is opportunity cost (for aggressive strategies) or slippage risk (for limit order strategies). The recommended architecture:

1. WebSocket callback receives bar-close event
2. Immediately push to a queue (non-blocking)
3. Separate consumer thread/async task picks from queue and runs analysis
4. Result: WebSocket callback returns in microseconds, analysis runs in background

In Node.js terms: the WebSocket `onmessage` handler should do nothing more than push to an internal event emitter or queue. The heavy indicator computation runs in the `setImmediate` / Promise chain that follows.

### 2.3 Redis as Candle Buffer

Our architecture uses Redis lists for the real-time candle buffer, which is a standard pattern. Strimpel's cookbook documents the key gotcha: **Redis lists are not timestamped.** If the process crashes and restarts, you need a way to verify that the in-Redis buffer is consistent with the exchange data. The recommended recovery pattern:

1. On startup, check the last N timestamps in the Redis buffer
2. Query Bybit REST for the same range
3. If they match: buffer is valid, proceed to subscribe WebSocket
4. If they diverge: flush the Redis buffer, reload from REST, then subscribe WebSocket

---

## 3. Signal Generation Pipeline Design

### 3.1 The Indicator Dependency Graph

Hilpisch structures indicator computation as a directed acyclic graph (DAG) where each indicator explicitly declares its dependencies. This prevents redundant computation (e.g., ATR computed 4 times by 4 different indicators) and makes the pipeline testable in isolation.

In our system, the pipeline already implements a similar concept via `src/indicators/pipeline/`. The key principle: **each indicator function is pure** — given the same candle array, it always returns the same result. No side effects, no state mutation. State lives in the calling context (simulator or live bot), not inside indicators.

### 3.2 Separation of "Did Conditions Form?" from "Should We Trade?"

A subtle but important distinction from both books:

- **Setup detection** = did the market structure meet the pattern criteria? (structural question, looks backward)
- **Entry decision** = given the setup, should we enter now? (forward-looking decision, involves risk checks)

Mixing these two concerns in one function is a common source of bugs. If `detectOrderBlock()` returns an order block AND decides whether to enter, then changing the entry conditions requires touching indicator code. The cleaner pattern is:

```
detectOrderBlock(candles) → OrderBlock | null      // pure pattern detection
generateSignal(orderBlock, context) → Signal | null  // entry decision
```

Our pipeline structure (`setup-detection.ts` → `entry-precision.ts`) already follows this separation.

### 3.3 Time-of-Day and Session Filtering

Strimpel's cookbook dedicates a chapter to session-aware strategy filters. The key finding for crypto perpetuals: volatility and signal quality are not uniform across the 24-hour clock. European and US session overlaps (13:00–17:00 UTC) generate higher-quality SMC setups because institutional order flow is active. Dead hours (02:00–07:00 UTC Sunday) produce noisy, low-follow-through signals.

This implies that a confluence threshold of 70 may be appropriate during active hours but insufficient during dead hours. A simple implementation: add a `sessionFilter` that raises the minimum score to 80 during identified low-quality windows. Our calibration research already flags this as a potential improvement.

---

## 4. Order Management System (OMS) Design

### 4.1 The Three Layers of an OMS

Strimpel and Scarpino both describe OMS design in three layers:

**Layer 1 — Order Lifecycle State Machine**

Every order has a lifecycle: `PENDING → SUBMITTED → ACKNOWLEDGED → PARTIALLY_FILLED → FILLED | CANCELLED | REJECTED`. The OMS tracks each order as a state machine. Transitions are triggered by exchange events (fill confirmations, rejection messages) received via WebSocket. The key invariant: **the local state machine never assumes success** — it always waits for exchange confirmation before advancing state.

The practical implication for our bot: when `executor.ts` calls `placeOrder()`, it should not immediately assume the position is open. It should track the order as `PENDING` until Bybit sends back an acknowledgment. The private WebSocket handler (`ws-private.ts`) should then advance the state to `FILLED` when the fill event arrives.

**Layer 2 — Position Ledger**

Separate from order tracking, the OMS maintains a position ledger: what is currently open, at what average price, with what quantity. This ledger is updated on fills, not on order placement. The position ledger is the authoritative source of truth for risk calculations.

In our architecture, `state.ts` in Redis plays this role. The key design rule from Strimpel: **the position ledger must be durable across restarts.** Using only in-memory state means a crash between order fill and position update causes the bot to start up unaware of an open position.

**Layer 3 — Broker Abstraction (Exchange Adapter)**

The OMS should speak to a generic exchange interface, not to Bybit-specific API calls. This means our `client.ts` should implement a `IExchangeClient` interface with methods like `placeOrder()`, `cancelOrder()`, `getPositions()`. The interface contract does not change when Bybit updates their API. This also makes the OMS testable with a mock exchange adapter.

The NautilusTrader engine formalizes this as the "ports and adapters" pattern: strategies plug into ports, adapters implement the ports for specific exchanges. This is worth adopting for our multi-pair expansion.

### 4.2 Idempotent Order Submission

A critical pattern from Strimpel: order submission must be idempotent. If the network fails after sending the order but before receiving the acknowledgment, the bot cannot tell whether the order was received. Resubmitting blindly creates duplicate orders.

The solution: assign a **client order ID** (UUID or deterministic hash) to every order before submission. On the retry, submit with the same client order ID. The exchange rejects duplicate client IDs, so the worst case is one duplicate rejection rather than two open positions.

Bybit's `orderLinkId` parameter serves exactly this purpose. Our `executor.ts` should always set `orderLinkId` to a deterministic, collision-resistant ID derived from symbol + signal timestamp.

### 4.3 The SL Submission Race Condition

Both books flag the SL submission timing as the single most critical OMS concern for prop-firm trading. The scenario:

1. Entry limit order placed at T=0
2. Market moves fast, entry fills at T=2s
3. SL submission attempted at T=2s
4. Network hiccup delays SL submission to T=4m55s
5. Market reverses, hits would-be SL at T=4m30s — no SL is on the server

Our rules already mandate forced position close if SL is not confirmed within 4 minutes. The OMS pattern that prevents this: **maintain a SL watchdog timer** that starts the moment an entry fill is confirmed. If the SL fill confirmation is not received before the timer expires, escalate to forced market-order close with retries on 30s intervals.

---

## 5. Risk Management System Design

### 5.1 Three-Layer Risk Architecture

Hilpisch structures risk management in three layers that run at different frequencies:

**Pre-trade checks (every signal):**
- Is the proposed SL within the 3% maximum loss rule?
- Is daily drawdown already at 80%+ of the 5% limit? (reduce position size or skip)
- Is portfolio heat below maximum? (for multi-pair: is combined exposure within limits?)
- Does this trade correlate heavily with an existing open position?

**Intra-trade monitoring (every bar):**
- Is the open position approaching the max drawdown threshold?
- Should trailing stop be tightened given new ATR?
- Is the position expired (entered N hours ago with no progress)?

**Post-trade reconciliation (end of session / restart):**
- Does local position state match exchange state?
- Are all SLs confirmed as live on the exchange?
- Is the daily realized P&L consistent with trade records?

Our `daily-risk.ts` and `portfolio-risk.ts` implement the pre-trade layer. The reconciliation layer is currently absent — this is the highest-priority risk gap.

### 5.2 Circuit Breaker Pattern

Strimpel dedicates a chapter to circuit breakers — automatic system-level stops that activate when aggregate risk thresholds are breached. The pattern:

```
NORMAL → DEGRADED (one threshold) → HALTED (second threshold)
```

- **DEGRADED:** Daily loss > 3%. Action: reduce position size to 50% of normal, skip any new signals with score < 80.
- **HALTED:** Daily loss > 4.5% (near the 5% limit). Action: stop all new entries, keep existing positions with SLs active, alert Telegram immediately.
- **Reset:** Daily circuit breaker resets at UTC midnight. Max drawdown circuit breaker requires manual reset via Telegram command.

The key insight: the circuit breaker fires **before** the hard limit is hit, giving a buffer for unrealized losses that might push through the limit before the next bar.

### 5.3 Portfolio Heat as a Risk Signal

For multi-pair expansion (our next phase), Hilpisch introduces "portfolio heat" as a composite risk measure: the sum of maximum possible losses across all open positions, expressed as a percentage of account equity. If portfolio heat exceeds 6%, reject new entries regardless of confluence score.

This is particularly relevant because our 5-pair expansion plan allocates 4% position size per pair × 5x leverage = 20% notional per pair. With 3 simultaneous positions, portfolio heat can approach 3–4% before SLs are breached — leaving very little room before the 5% daily limit.

---

## 6. Database Design for Trade Storage

### 6.1 Separation of Hot and Cold Data

Strimpel's cookbook distinguishes three data tiers:

- **Hot data** (sub-second access): current candle buffer, open positions, pending orders — Redis
- **Warm data** (sub-second to minute): recent trades, today's P&L, recent signals — PostgreSQL with index on `opened_at`
- **Cold data** (minutes acceptable): historical candles for backtesting, full trade archive — PostgreSQL with compression or TimescaleDB hypertables

Our current schema already places candle history in PostgreSQL. The key improvement: add a **TimescaleDB hypertable** partition for `historical_candles` on the `time` column. This converts a full-table-scan query (load 1 year of 15M candles for BTCUSDT) into a time-range partition scan — roughly 10x faster for date-bounded queries.

### 6.2 The Trades Schema — What's Missing

Our current `trades` table captures the basics. What Strimpel's approach adds that we are missing:

**Execution quality fields:**
```
slippage_bps        -- (entry_price - signal_price) / signal_price * 10000
fill_latency_ms     -- time between order submission and fill confirmation
order_link_id       -- idempotency key used for submission
```

**Risk snapshot at entry:**
```
daily_loss_at_entry    -- daily drawdown at the moment of entry
portfolio_heat_at_entry -- combined exposure at entry
atr_at_entry           -- ATR used for SL/TP calculation
confluence_score       -- already present in score_breakdown (good)
```

**Reconciliation fields:**
```
exchange_order_id   -- Bybit's orderId
sl_order_id         -- Bybit's SL order ID
sl_confirmed_at     -- timestamp when SL was confirmed on exchange
reconciled_at       -- last time this trade was reconciled vs exchange state
```

The slippage and fill latency fields are particularly valuable for the live/backtest reconciliation exercise described in section 12.

### 6.3 Signal Storage

Our schema includes a `signals` table. The recommendation from Strimpel: store **every** signal, not just those that resulted in trades. Storing rejected signals (vetoed, below threshold, skippedBusy) gives you the ability to retroactively analyze whether your filters are working. A signal that was vetoed by the daily drawdown filter but would have been profitable is valuable feedback about the filter's false-positive rate.

---

## 7. Performance Monitoring and Alerting

### 7.1 The Three Monitoring Levels

Hilpisch distinguishes operational monitoring (is the system working?) from trading performance monitoring (is the strategy working?):

**Operational health metrics (check every 60 seconds):**
- WebSocket connection status (public + private)
- Last candle received timestamp (staleness check)
- Redis ping latency
- PostgreSQL connection pool status
- Rate limiter queue depth (P0/P1/P2)
- Pending SL confirmations count

**Trading performance metrics (check at bar-close):**
- Current daily P&L vs. 5% limit (as percentage consumed, e.g., "2.3% of 5% daily limit used")
- Open position unrealized P&L
- Signals generated today vs. signals entered (entry rate)
- Confluence score distribution of today's signals

**Strategy health metrics (weekly):**
- Rolling 4-week win rate vs. backtest expectation
- Rolling profit factor
- Average confluence score of winners vs. losers
- Slippage: actual fill prices vs. signal prices

### 7.2 Degradation Alerts vs. Failure Alerts

Strimpel makes a critical distinction: not all anomalies require immediate action.

**Failure alerts** (immediate Telegram notification, high urgency):
- WebSocket disconnected and reconnect failed after 3 attempts
- SL not confirmed within 4 minutes of fill
- Exchange API returning repeated 5xx errors
- Daily drawdown > 4% (approaching 5% limit)

**Degradation alerts** (next-morning Telegram summary):
- Win rate below 40% over last 20 trades (vs. backtest expectation ~50%)
- Average slippage > 3 bps (indicates market impact or timing drift)
- Signal rate dropped > 50% vs. 4-week average (may indicate broken indicator)
- Confluence score distribution shifted (mean dropped > 5 points vs. baseline)

Mixing these two categories creates alert fatigue. Degradation should be logged and summarized, not paged.

### 7.3 Prometheus + Grafana Integration Pattern

For production monitoring, Strimpel and the trading infrastructure community recommend exposing metrics on a `/metrics` HTTP endpoint (Prometheus format). Key counters and gauges:

```
trading_signals_total{symbol, side, outcome}   -- counter: total signals by outcome
trading_daily_pnl_pct{account}                 -- gauge: current daily P&L %
trading_ws_reconnects_total{channel}           -- counter: WebSocket reconnects
trading_sl_confirmation_latency_ms             -- histogram: SL confirmation time
trading_order_fill_latency_ms                  -- histogram: order fill latency
trading_portfolio_heat_pct                     -- gauge: current portfolio heat
```

This enables dashboards showing live strategy health without requiring Telegram polling. For our Node.js stack, `prom-client` is the standard library.

---

## 8. Strategy Parameter Optimization

### 8.1 Walk-Forward Optimization (WFO) Protocol

Hilpisch's book and recent academic work (arxiv 2602.10785, 2025) converge on walk-forward optimization as the gold standard for parameter selection. The protocol:

1. **Divide data** into windows: 70% in-sample, 30% out-of-sample, slide forward
2. **Optimize parameters** on in-sample data only (grid search or genetic algorithm)
3. **Evaluate** the optimized parameters on the out-of-sample window
4. **Slide forward** by the out-of-sample period and repeat
5. **Aggregate** all out-of-sample results to estimate live performance

The WFO efficiency ratio = (OOS Sharpe) / (IS Sharpe) measures how much of the in-sample performance survived the forward test. A ratio above 0.6 indicates robust parameters; below 0.4 suggests overfitting.

Our calibration research already documents this approach. The key addition from Hilpisch: **never optimize more than 4-5 parameters simultaneously**. Each additional free parameter exponentially increases the risk of curve-fitting. For our SMC strategy with 8 weighted indicators, prefer fixing the structural weights (BOS, OB, FVG, Liquidity) and optimizing only the classical indicator weights (RSI, EMA, Volume) plus the SL/TP multipliers.

### 8.2 Parameter Stability as a Quality Filter

A parameter is "stable" if small perturbations produce similar performance. Strimpel's test: after finding optimal parameters, run the strategy with each parameter ±20%. If performance degrades sharply at ±20%, the parameter is fragile and likely overfit.

A stable, robust parameter set shows gradual performance degradation across the ±20% range, not a spike at one exact value.

### 8.3 Monte Carlo Simulation for Confidence Intervals

Both books recommend Monte Carlo simulation after finding good parameters. The approach: shuffle the order of the trades from the backtest (random draw with replacement), run the equity curve 1000 times. The resulting distribution of outcomes gives:

- P5 worst-case drawdown (if you were unlucky)
- P95 best-case return (if you were lucky)
- P50 median expected return

If the P5 drawdown exceeds our 10% maximum drawdown rule, the strategy is too risky even with good average performance. Our Van Tharp research memory already covers this.

---

## 9. Live Trading Deployment Best Practices

### 9.1 The Graduated Rollout Protocol

Hilpisch and Strimpel both document a staged deployment protocol that every algo trader should follow:

**Stage 1 — Paper Trading (2-4 weeks):**
The bot runs in production with real market data, generates real signals, but submits no actual orders. All intended orders are logged as if they were filled at the signal price. This validates that the live signal generation matches backtest signal generation.

**Stage 2 — Micro Live (2-4 weeks):**
Deploy with 10-20% of intended position size. This catches execution issues (fill rates, slippage, SL behavior) without significant financial risk. If live metrics match paper trading metrics within 20%, proceed.

**Stage 3 — Full Size:**
Only after Stage 2 metrics are validated. Monitor slippage and fill rates closely for the first month.

The key metric at each stage: **does the signal frequency match the backtest?** A live bot generating 50% fewer signals than the backtest indicates a divergence in the data feed or indicator computation.

### 9.2 Configuration Management

Strimpel's cookbook emphasizes strict separation of strategy configuration from infrastructure configuration. Our `src/config/strategies/{SYMBOL}.json` already follows this pattern. The key addition: **version the config files**. Each deployed config should have a `deployedAt` timestamp, and the bot should log the exact config hash at startup. This enables precise attribution of live performance to specific parameter versions.

### 9.3 Startup State Recovery

Hilpisch documents the startup sequence for a live bot:

1. Load strategy config and validate against schema
2. Fetch current open positions from exchange REST API
3. Reconcile against local PostgreSQL/Redis state
4. For each discrepancy: log warning, prefer exchange state as ground truth
5. Verify all open positions have active SLs on exchange
6. For positions missing SL: submit SL immediately (treat as emergency)
7. Only after reconciliation passes: subscribe to WebSocket feeds and enable new entries

Step 4 is critical: the exchange is always the source of truth. The local state may be stale due to crash, network partition, or clock skew.

---

## 10. Monitoring and Debugging Live Strategies

### 10.1 Structured Logging for Post-Mortem Analysis

Strimpel advocates for structured JSON logging where every log line includes a fixed set of contextual fields:

```json
{
  "level": "info",
  "time": "2026-04-06T14:23:01.123Z",
  "symbol": "BTCUSDT",
  "side": "Buy",
  "confluenceScore": 78,
  "phase": "signal_generated",
  "accountLabel": "Account 10K",
  "dailyPnlPct": -0.8,
  "portfolioHeat": 3.2
}
```

This enables log queries like "show me all signals where confluenceScore > 75 AND portfolio heat was below 4%" — invaluable for debugging why the bot missed a profitable setup.

Our pino setup already produces JSON logs. The missing piece: ensure the `symbol`, `account`, and `phase` fields are consistently present across all log lines in the trading path.

### 10.2 The "Shadow Mode" Debugging Technique

When live performance diverges from backtest expectation, Hilpisch recommends running the backtest engine in "shadow mode" alongside the live bot: both receive the same real-time data, but only the live bot places orders. Comparing the shadow mode's signal log to the live bot's signal log reveals discrepancies in indicator computation, data handling, or timing.

In our TypeScript architecture, this means the `Analyzer` class should be instantiable in a read-only mode where it emits signals but the executor ignores them. The signal logs from both instances can then be compared.

### 10.3 Debugging Performance Decay

Strimpel documents a systematic approach to diagnosing live performance decay:

1. **Check signal rate first.** Is the bot generating signals at the expected frequency? If signal rate dropped, the issue is in data or indicators, not in order execution.

2. **Check score distribution.** Are confluence scores systematically lower? If mean score dropped from 75 to 65, one indicator component is likely broken or the market regime changed.

3. **Check win rate separately from P&L.** Win rate declining but P&L stable → losers got bigger (SL issue or market volatility increase). P&L declining but win rate stable → winners got smaller (TP hit too early, trending less).

4. **Segment by time of day and market regime.** Poor performance may be concentrated in one session or one volatility regime, indicating a filter should be applied.

---

## 11. Data Quality Checks and Cleaning

### 11.1 The Five Data Quality Dimensions

Strimpel's cookbook identifies five dimensions of candle data quality:

1. **Completeness** — no gaps in the timestamp sequence. A missing bar is not zero volume; it means no trades occurred OR the feed dropped. These are different scenarios with different handling.

2. **Accuracy** — OHLCV values are consistent. High >= Low, Close is between High and Low, Open is within the daily range. A bar where High < Low is data corruption.

3. **Timeliness** — data arrives within expected latency. Candle data arriving 5 minutes after bar-close is useless for 15M strategies.

4. **Consistency** — same data across different sources/timeframes. A 1H candle's High should equal max(15M candles within that hour). When they diverge, one source has an error.

5. **Uniqueness** — no duplicate candle timestamps. Our schema enforces this with a unique constraint on `(symbol, timeframe, time)`.

### 11.2 Runtime Validation Checks

Hilpisch recommends validating every candle before inserting it into the analysis buffer:

```
validate(candle):
  assert candle.high >= candle.low
  assert candle.open >= candle.low && candle.open <= candle.high
  assert candle.close >= candle.low && candle.close <= candle.high
  assert candle.volume >= 0
  assert candle.time > previousCandle.time
  assert (candle.time - previousCandle.time) == expectedInterval ± tolerance
  assert abs(candle.close - previousCandle.close) / previousCandle.close < 0.15  // 15% spike filter
```

The 15% spike filter catches "fat finger" data errors that would otherwise generate strong (false) BOS signals. For BTCUSDT, even a 5% single-bar move is rare — a 15% bar is almost certainly bad data.

### 11.3 Gap Handling Strategies

When a gap is detected (missing bars between `previousCandle.time` and `candle.time`), there are three strategies:

**Ignore and continue:** Appropriate when the gap is 1-2 bars and the strategy's lookback window is much longer (50+ bars). The impact on indicators is minimal.

**Backfill via REST:** Fetch the missing bars from exchange REST API and insert them. Appropriate for gaps up to a few hours. This is the correct approach for our system.

**Reset indicator state:** For long gaps (hours to days), the indicator state built on pre-gap data may be invalid. Better to rebuild the indicator buffer from scratch using the REST data. This applies particularly to order block detection, which depends on swing structure.

---

## 12. Reconciliation: Backtest vs. Live Trading

### 12.1 The Sources of Divergence

Hilpisch dedicates significant attention to the systematic gap between backtest P&L and live P&L. The major sources:

**Slippage:** In backtest, limit orders fill at the signal price. In live trading, the order may not fill at all (market moved away) or may fill at a slightly different price due to queue position. For 15M strategies with limit entry, the miss rate can be 20-30% of all signaled entries.

**Commission modeling:** Our backtest uses a flat fee rate. In live trading, the actual fee depends on maker/taker status, and taker fills (when the limit order becomes a market order due to aggressive price movement) cost more.

**Bar timing:** In backtest, we assume exact bar-close timing. In live trading, the bar-close event may arrive 100-500ms late. For 15M candles, this is negligible. For 1M or tick strategies, it matters significantly.

**Indicator divergence:** The same indicator computed on slightly different data (e.g., due to a data correction on the exchange's end) can produce different signals. Bybit occasionally revises historical kline data to correct exchange errors.

### 12.2 The Calibration-by-Paper-Trading Method

Strimpel recommends a 30-60 day paper-trading period specifically to calibrate the slippage model. The process:

1. Run paper trading mode: log every intended entry with signal price and timestamp
2. For each intended entry, check whether the price would have been reached within the next N bars
3. Calculate the distribution of actual fill prices vs. signal prices
4. Use this empirical distribution to update the simulator's fill model

For a limit-order strategy like ours, the key statistic is **entry miss rate**: what percentage of signals resulted in no fill because the price never returned to the limit level. If the live miss rate is 25% but the backtest assumes 0% misses, the backtest is 33% more optimistic than reality.

The corrected simulator should randomly skip 25% of entries (or model a fill probability curve based on distance to market). After this correction, if the paper-trading Sharpe approximately matches the corrected backtest Sharpe, the models are reconciled.

### 12.3 The Reconciliation Dashboard

Strimpel describes a reconciliation dashboard as a weekly ritual for live algo traders. The key comparisons:

| Metric | Backtest (same period) | Live Trading | Acceptable Delta |
|--------|----------------------|--------------|-----------------|
| Signal frequency | X signals/week | Y signals/week | ±20% |
| Entry rate (% signals filled) | ~90% (backtest) | 65-75% (live, limit orders) | expected gap |
| Win rate | 52% | 48-56% | ±5pp |
| Average win % | 0.9% | 0.7-1.1% | ±20% |
| Average loss % | -0.4% | -0.4-0.5% | ±20% |
| Max single-trade drawdown | -1.2% | -1.2-1.5% | ±25% |

If any metric falls outside the acceptable delta for 3+ consecutive weeks, initiate a root-cause analysis before continuing live trading.

### 12.4 Accounting for Regime Change

Both Hilpisch and the 2025 arxiv paper on walk-forward optimization make the same point: **a strategy that was profitable last year may not be profitable this year.** Market regimes change (trending → ranging, high volatility → low volatility). The appropriate response is not to over-optimize for the new regime, but to:

1. Maintain a rolling performance monitor (4-week window)
2. Define regime detection criteria (e.g., ADX < 20 = ranging, ADX > 30 = trending)
3. Scale down or pause the strategy when entering an unfamiliar regime
4. Revalidate parameters with a fresh walk-forward optimization annually

Our market-regime indicator (`src/indicators/classic/market-regime.ts`) is a foundation for this. The live bot should query the current regime and adjust position size or minimum confluence threshold accordingly, rather than running at full throttle in all conditions.

---

## Summary: High-Priority Gaps in Our Current Implementation

Based on the above research, the most impactful gaps relative to production best practices:

**Critical (affects correctness or safety):**
1. **Startup reconciliation** — bot must verify open positions against exchange on every restart; currently absent
2. **SL watchdog timer** — independent timer that forces close if SL not confirmed within 4 minutes; partially in rules but not in code
3. **idempotent order submission** via `orderLinkId` — prevents duplicate orders on retry

**High impact (affects performance measurement):**
4. **Entry miss rate tracking** — log every signal + whether it was filled; necessary for live/backtest reconciliation
5. **Slippage tracking** — record `signal_price` separately from `fill_price` in trades table
6. **Execution quality metrics** — fill latency, confirmation latency, per-account slippage distribution

**Medium impact (improves robustness):**
7. **Bar-close validation** — validate OHLCV constraints + 15% spike filter before pushing to indicator buffer
8. **Gap detection on WebSocket reconnect** — backfill missing bars via REST before resuming
9. **Circuit breaker pattern** — DEGRADED at 3% daily loss, HALTED at 4.5%
10. **Shadow mode** for debugging — run analyzer in read-only mode alongside live bot

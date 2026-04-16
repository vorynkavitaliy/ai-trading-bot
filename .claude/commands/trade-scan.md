---
description: "Autonomous trading cycle. Scans one or all pairs, generates signals (LONG and SHORT), executes trades, monitors positions. Run via /loop for continuous operation."
argument-hint: "<PAIR|all> (e.g., BTCUSDT or all)"
---

# Trade Scan Cycle

Supports two modes:
- **Single pair**: `/loop 3m /trade-scan BTCUSDT` — focused on one pair
- **All pairs**: `/loop 3m /trade-scan all` — scans all 8 watchlist pairs sequentially in one cycle

**REQUIRED:** `$ARGUMENTS` must specify a trading pair (e.g., BTCUSDT) or `all` for full watchlist. If empty, ask the user.

## Execution

The full cycle is implemented in TypeScript at `src/scan.ts`. Run via:

```
npm run scan -- $ARGUMENTS --report
```

Supports multiple arguments:
```
npm run scan -- all --report          # all 8 pairs
npm run scan -- BTCUSDT ETHUSDT       # specific pairs
npm run scan -- SOLUSDT               # single pair
```

Each scan takes ~5-10s per pair, so all 8 complete within ~2 minutes per cycle.

This single command performs everything documented below: risk check → regime detection → session check → news → multi-TF analysis → confluence scoring (LONG + SHORT) → slot management → trade execution across all accounts → position management → Telegram report.

## Architecture

**Option A: One terminal, all pairs (recommended)**
```
Terminal: /loop 3m /trade-scan all
```

**Option B: Multiple terminals, one pair each**
```
Terminal 1: /loop 3m /trade-scan BTCUSDT
Terminal 2: /loop 3m /trade-scan ETHUSDT
...
```

All terminals share state via Redis (positions, heat, locks, kill switch).

Each scan cycle independently:
- Analyzes assigned pair(s) in both directions (LONG and SHORT)
- Executes trades on ALL accounts from `accounts.json`
- Manages its own positions
- Shares risk state (portfolio heat, DD, position registry) via Redis

## Pre-Flight

1. Read `CLAUDE.md` for inviolable rules and protocol
2. Read `accounts.json` to identify all active accounts and sub-accounts
3. Parse `$ARGUMENTS` to get the assigned pair (e.g., BTCUSDT)
4. Initialize cycle counter (for news/report intervals)

## Execution Sequence

### 1. Risk Check (ALWAYS FIRST — NO EXCEPTIONS)

For each account volume in `accounts.json`:
- Fetch wallet balance and equity via Bybit MCP (`get_wallet_balance`)
- Fetch ALL open positions across ALL pairs (`get_positions`) — not just this pair
- Calculate daily drawdown: `(peak_equity_today - current_equity) / peak_equity_today`
- Calculate total drawdown: `(initial_balance - current_equity) / initial_balance`
- Calculate total margin usage and notional exposure
- Calculate portfolio heat (sum of all position risks, including other pairs from other terminals)

**Kill Switch:**
- Daily DD > 4% OR Total DD > 8% → **CLOSE ALL POSITIONS ON ALL PAIRS**, alert, HALT
- Daily DD > 3% OR Total DD > 6% → WARNING mode, no new entries, reduce to 1 position

If CRITICAL → close everything and stop. Do NOT continue the cycle.

### 2. Regime Detection (every cycle)

- Fetch BTC/USDT 4H klines (200 candles) via Bybit MCP (`get_klines`)
- Calculate EMA 20/50/200 alignment for BTC
- Fetch BTC funding rate (`get_tickers` includes funding)
- Fetch open interest if available
- Classify regime: Strong Bull / Bull / Range / Bear / Strong Bear / Transitional
- **Determine allowed directions for this regime:**
  - Strong Bull: LONG preferred, SHORT on overextension
  - Bull: LONG preferred, selective SHORT
  - Range: BOTH directions (mean-reversion)
  - Bear: SHORT preferred, selective LONG
  - Strong Bear: SHORT preferred, LONG on capitulation
  - Transitional: BOTH cautiously, reduced size

### 3. News & Macro Context (every 5th cycle = ~15 minutes)

- Web search: "{pair_base_asset} news today", "crypto macro news"
- Check for Tier 1 events: Fed, CPI, BlackRock, major regulatory
- Assess geopolitical risk level
- If Tier 1 event within 30 minutes → NO NEW ENTRIES
- Store context for trade decision

On non-news cycles: use last known context.

### 4. Deep Pair Analysis — BOTH DIRECTIONS

This is where single-pair focus shines. Analyze `$ARGUMENTS` pair thoroughly:

**a. Fetch all data:**
- Klines: 4H (200), 1H (200), 15M (200) via `get_klines`
- Orderbook: `get_orderbook` (depth 25+)
- Ticker: `get_24hr_ticker` (volume, price, change)
- Funding rate from ticker data

**b. Technical analysis (4H → 1H → 15M):**
- EMA 20/50/200 — trend direction and alignment
- RSI(14) — divergence (regular + hidden), overbought/oversold, failure swings
- MACD(12,26,9) — histogram direction, crossovers, zero-line
- ATR(14) — volatility level and percentile
- Bollinger Bands — squeeze detection
- Support/Resistance levels from swing highs/lows
- Demand zones (Rally-Base-Rally, Drop-Base-Rally) and Supply zones (Rally-Base-Drop, Drop-Base-Drop)
- Liquidity pools — equal highs/lows where stops cluster

**c. Volume analysis:**
- OBV — trend confirmation/divergence
- VWAP — institutional fair value
- Volume spikes — climactic volume (>3x avg)
- Directional volume — buy vs sell pressure

**d. Market structure (SMC):**
- Change of Character (CHoCH) — trend reversal signals
- Break of Structure (BOS) — trend continuation
- Order blocks — institutional entry zones
- Liquidity sweeps — stop-hunting completed = entry opportunity

### 5. Signal Generation — CHECK BOTH LONG AND SHORT

**Evaluate LONG setup:**
| Dimension | Condition |
|---|---|
| Structure | Price at demand zone / bullish OB / CHoCH up / BOS up |
| Technical | RSI oversold/divergence + EMA bullish + MACD rising (2/3 min) |
| Volume | OBV rising + above VWAP + positive CVD (2/4 min) |
| Multi-TF | 4H bullish + 1H structure supports + 15M entry clean |

**Evaluate SHORT setup:**
| Dimension | Condition |
|---|---|
| Structure | Price at supply zone / bearish OB / CHoCH down / BOS down |
| Technical | RSI overbought/divergence + EMA bearish + MACD falling (2/3 min) |
| Volume | OBV falling + below VWAP + negative CVD (2/4 min) |
| Multi-TF | 4H bearish + 1H structure supports + 15M entry clean |

**Score each direction independently:** 0-4 confluence score.

**Apply filters to qualifying signals (score >= 3):**
- Regime allows this direction?
- Risk manager CLEAR?
- No Tier 1 news event within 30 min?
- Funding rate not extreme against direction? (>0.05% for LONG, <-0.03% for SHORT)
- Spread < 0.05%?
- ATR percentile between 10th-90th?

**If both LONG and SHORT qualify** → pick the higher confluence score. If tied, pick the direction matching regime bias.

### 5b. Session & News Filters

Before execution, apply additional filters:
- **Dead zone (22:00-00:00 UTC)**: no new entries
- **Funding window (±10 min of 00:00/08:00/16:00 UTC)**: no new entries
- **High-impact news (2+ triggers in 30 min)**: block all entries
- **Session quality**: Asian session signals are lower confidence (×0.85)

### 5c. Slot Management — Position Replacement

If all position slots are occupied:
1. Get weakest open position (lowest confluence) from shared Redis registry
2. Compare with new signal's confluence score
3. If new signal > weakest position → close weakest, free slot, proceed
4. If new signal ≤ weakest → skip ("all slots full")
5. If slots are NOT full → skip this step entirely

This ensures the portfolio always holds the strongest available setups.

### 6. Trade Execution

If a signal passes (score >= 3, all filters pass):

**a. Plan the trade:**
- Entry: market order at current 3M candle close
- SL: beyond liquidity pool, 1.5x ATR distance from entry (3-way: ATR/swing/micro-3M)
- TP: **2:1 R:R** (realistic intraday target)
- Trailing stop: activates at 1.5R, trails at 1x ATR
- Size: 0.2% risk (standard) or 0.6% (A+ = 4/4 confluence)

**b. Validate against portfolio:**
- Total heat after entry < 5%?
- Margin after entry < 25%?
- Notional after entry < 2x?
- Not duplicating direction with correlated pair in another terminal?

**c. Execute on ALL accounts:**
For each volume in `accounts.json`, for each apiKey/apiSecret pair:
- Place limit order via Bybit MCP (`place_order`) or API
- Immediately set SL/TP as server-side orders (`set_trading_stop` or conditional orders)
- **SL MUST be set within 5 minutes — this is inviolable**
- Scale position size to each account's balance
- Log trade details

If order fails → retry after 5 seconds, max 3 attempts. If all fail → skip, alert.

### 7. Position Management (every cycle)

For this pair's open positions on all accounts:
- Fetch position data via Bybit MCP (`get_positions`)
- Current PnL (unrealized)
- Check SL/TP orders still active — if SL missing, EMERGENCY re-place or close
- **At 1R profit** → move SL to breakeven (entry price)
- **At 1.5R profit** → activate trailing stop (1x ATR distance)
- **At TP1 (2:1 R:R)** → close 50% of position
- **At TP2 (3:1 R:R)** → close 30% of position
- **TP3** → let remaining 20% run with trailing stop
- If structure invalidates (e.g., CHoCH against position) → tighten SL

### 8. Cycle Report

Every cycle, output a concise status:
```
[{PAIR}] {timestamp UTC}
Regime: {regime} | Cycle: #{n}
Equity: ${equity} | DD: {daily}%/{total}%
Position: {LONG/SHORT/FLAT} @ {entry} | PnL: {pnl}
Signal: {LONG score}/{SHORT score} | Action: {EXECUTED/MONITORING/FLAT}
Next news scan: {cycles_remaining}
```

Every 10th cycle (~30 min), output a full report:
```
=== FULL REPORT: {PAIR} ===
Time: {UTC}
Regime: {regime} (score: {score}/2.0)

--- ACCOUNTS ---
| Account | Balance | PnL Today | DD Daily | DD Total | Status |
|---|---|---|---|---|---|
| 200k #1 | ${bal} | ${pnl} | {dd}% | {dd}% | {status} |
| 50k #1 | ${bal} | ${pnl} | {dd}% | {dd}% | {status} |

--- POSITION: {PAIR} ---
Side: {LONG/SHORT/FLAT}
Entry: {price} | Current: {price} | PnL: ${pnl} ({pct}%)
SL: {price} | TP1: {price} | TP2: {price}
R achieved: {R_multiple} | Duration: {time}

--- ANALYSIS ---
4H Trend: {direction} (EMA: {alignment})
1H Structure: {description}
RSI: {value} | MACD: {status} | ATR: {value} ({percentile}p)
Funding: {rate} | OI change: {pct}%

--- LONG Signal: {score}/4 ---
{dimension details}

--- SHORT Signal: {score}/4 ---
{dimension details}

--- NEWS CONTEXT ---
{latest macro/geopolitical context}
{upcoming events}

=========================
```

## Error Handling

- API error → retry 5s, max 3 attempts
- All retries fail → log, skip operation, continue cycle
- Missing SL → EMERGENCY: close position or re-place SL immediately
- WebSocket disconnect → bybit-api auto-reconnects
- If this pair's position was closed by another system → acknowledge and reset state

## Cross-Terminal Awareness (via Redis)

Each terminal is independent but shares state via Redis:
- **Shared position registry** (`positions:open`): all terminals register their positions with symbol, direction, confluence score, entry price
- **Portfolio heat map** (`heat:{account}`): cross-terminal risk tracking per symbol
- **Position count**: before opening, check total open positions across ALL terminals
- **Position replacement**: when slots are full (3 base / 5 for A+), compare new signal vs weakest existing — replace if stronger
- Always check ALL open positions (not just this pair) when calculating DD and heat
- If another terminal has positions that push total heat near limit → this terminal reduces or skips
- Never open opposing positions on the same pair across accounts (cross-account hedging ban)

## Intraday Trading Focus

- **Prefer intraday exits** — target 2:1 R:R which is achievable within one session
- **Max hold time: 72 hours** — positions older than 3 days are force-closed at market
- **No unrealistic TPs** — don't set take-profits that require multi-day moves
- Trailing stop at 1.5R locks in profit and lets runners continue without holding indefinitely

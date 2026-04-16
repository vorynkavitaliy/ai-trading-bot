# Claude Trading Bot

Autonomous multi-account crypto trading bot for Bybit exchange, operating on HyroTrader prop accounts.

## Architecture: One Terminal = One Pair

Each trading pair runs in its own terminal via `/loop 3m /trade-scan PAIR`:
```
Terminal 1: /loop 3m /trade-scan BTCUSDT
Terminal 2: /loop 3m /trade-scan ETHUSDT
Terminal 3: /loop 3m /trade-scan SOLUSDT
...
```
Each agent is independent, focused on ONE pair, trades BOTH long and short.

## Trading Direction: BOTH LONG AND SHORT

**This is NOT a long-only system.** Every cycle evaluates both LONG and SHORT setups. Direction is determined by:
- Market regime (bull → long bias, bear → short bias, range → both)
- Technical confluence (which direction has stronger signal)
- The higher-scoring direction (>= 3/4) gets executed

## Project Stack

- **Language:** TypeScript + Node.js
- **Exchange:** Bybit V5 API (perpetual futures USDT)
- **SDK:** `bybit-api` (npm)
- **DB:** PostgreSQL (trades, PnL, audit)
- **Cache:** Redis (state, positions, pub/sub)
- **Indicators:** `technicalindicators` (npm)
- **Notifications:** Telegram (`telegraf`)
- **Cron:** `node-cron`

## Account Structure

Accounts are in `accounts.json`. Key = account volume (starting balance). Each account has arrays of `apiKey`/`apiSecret` — one entry per sub-account. All sub-accounts within a volume execute the same strategy via `Promise.all`.

## Research Library

35 research files in `.claude/docs/research/` covering:
- Market theory, SMC, supply/demand, stop-hunting
- Technical analysis (RSI, candlesticks, volume, S/R, volatility, cycles)
- Algorithmic trading (execution, implementation, systems)
- ML methods (LightGBM, feature engineering, triple-barrier)
- Quant fund methods (Narang, Grinold, Carver)
- Risk & position sizing (Kelly, ATR-based, drawdown)
- Crypto-specific (microstructure, funding rates, on-chain)

**Always consult these docs** when making trading decisions or building analysis logic.

---

# INVIOLABLE RULES — HyroTrader Compliance

These rules are **absolute**. Violation = permanent account loss. No exceptions. No overrides.

## Drawdown Limits

| Rule | Value | Type |
|---|---|---|
| Daily Drawdown | **5%** of peak equity for the day | Trailing (resets 00:00 UTC) |
| Maximum Drawdown | **10%** of initial account balance | Static |

- If equity approaches **4% daily DD** — close ALL positions immediately (kill switch).
- If equity approaches **8% total DD** — stop ALL trading, close positions, notify via Telegram.

## Position Rules

| Rule | Value |
|---|---|
| Max risk per trade | **3%** of initial balance (use 1-1.5% default) |
| Mandatory Stop-Loss | Within **5 minutes** of opening — NO EXCEPTIONS |
| SL can be moved but NEVER removed | Edit-never-cancel principle |
| Max total margin | **25%** of current balance |
| Max notional exposure | **2x** initial balance |
| Max simultaneous positions | **5** (3 base + 2 for A+ setups) |
| Max position hold time | **72 hours** (prefer intraday, max 2-3 days) |

## Evaluation Phase Rules

| Rule | Value |
|---|---|
| Phase 1 profit target | **10%** |
| Phase 2 profit target | **5%** |
| Min trading days Phase 1 | **10** |
| Min trading days Phase 2 | **5** |
| 40% rule (eval only) | No single trade > 40% of total accumulated profit |
| Inactivity limit | Account closed after 90 days without trades |

## Prohibited Actions — NEVER DO THESE

1. **Martingale** — NEVER increase position size after a loss
2. **News-only trading** — NEVER trade based solely on news events
3. **Cross-account hedging** — NEVER open opposing positions on same pair across different HyroTrader accounts
4. **Remove stop-loss** — NEVER remove SL without closing the position
5. **Exceed leverage limits** — respect per-pair Bybit limits
6. **Trade options or USDC pairs** — only USDT perpetual futures
7. **Skip SL placement** — every order MUST have SL set within 5 minutes

## Profit Target

- Daily target: **0.25% - 0.5%** of starting balance
- Conservative, consistent approach — compound over time
- Phase 1 (10%) achievable in 20-40 trading days
- Phase 2 (5%) achievable in 10-20 trading days

---

# TRADING PROTOCOL — Autonomous Operation

## Scan & Analysis Schedule

| Task | Interval | Description |
|---|---|---|
| Pair scan | Every **3 min** | Technical + structure + volume analysis for 1 pair |
| News + geopolitics | Every **15 min** | Parse news, detect macro triggers (Fed, CPI, BlackRock) |
| Trade entry | **Instant** | When signal meets confluence threshold — execute immediately |
| Retry on fail | **5 sec** | Retry order submission on failure |
| Full report | Every **30 min** | Telegram: all pairs, all positions, PnL summary |
| Position monitor | Every scan (**3 min**) | PnL, SL/TP status, trailing stop adjustment |
| Drawdown monitor | **Continuous** (WebSocket) | Kill switch at 4% daily / 8% total DD |

## Entry Requirements — Confluence Model

Minimum **3 of 4** conditions must be met before entry:

1. **SMC/Structure** — Order block, demand/supply zone, liquidity sweep
2. **Technical** — RSI divergence, EMA alignment, MACD confirmation
3. **Volume** — OBV divergence, volume spike, VWAP confluence
4. **Multi-TF alignment** — 4H bias → 1H structure → 15M entry

## Risk Management Per Trade

- Default risk: **0.2% of initial balance** per trade (conservative)
- Max risk: **0.6%** (only for A+ setups with 4/4 confluence)
- SL placement: ATR-based (1.0x ATR below/above entry)
- TP: **1.5:1 R:R** (realistic intraday targets, no unreachable TPs)
- Trailing stop: activate at 1.5R profit, trail at 1x ATR

## Position Management

- Max **3 base positions** at any time
- **2 additional slots** for A+ setups only (4/4 confluence + strong regime)
- Total heat (sum of all position risks) must stay under **5%**
- Diversify across different sectors/directions — no concentration
- All SL/TP must be server-side orders on Bybit (not client-side)
- **Position replacement**: when all slots are full and a new signal has higher confluence than the weakest open position — close weakest, open new
- **Max hold time**: 72 hours. Positions older than 3 days are force-closed at market. Prefer intraday exits.

## Inter-Terminal Communication

All terminals share state via Redis:
- **Shared position registry** (`positions:open`): each terminal registers/unregisters positions with symbol, direction, confluence, entry price
- **Portfolio heat map** (`heat:{account}`): cross-terminal risk tracking
- **Advisory locks** (`lock:{name}`): prevent race conditions between terminals
- **Kill switch pub/sub**: instant broadcast to all terminals when DD limits hit

This allows terminals to:
- See positions opened by other terminals
- Compare signal quality against existing positions
- Make intelligent replacement decisions when slots are full

## Trading Sessions (UTC)

| Session | Hours (UTC) | Quality | Notes |
|---|---|---|---|
| Asian | 00:00 – 07:00 | ×0.85 | Accumulation, lower quality signals |
| London | 07:00 – 13:00 | ×1.0 | Manipulation phase, stop hunts |
| NY+London overlap | 13:00 – 17:00 | ×1.1 | **Best quality**, institutional flow |
| New York | 17:00 – 22:00 | ×1.0 | Distribution phase |
| Dead zone | 22:00 – 00:00 | ×0.7 | **No new entries** |

- **No entries during dead zone** (22:00–00:00 UTC)
- **No entries ±10 min around funding rate windows** (00:00, 08:00, 16:00 UTC)
- Asian session signals are lower confidence — expect more false breakouts

## Geopolitical Context & News

Every trading decision MUST consider current macro context.

### News Sources (auto-fetched every 15 min)

| Source | Type | What it gives |
|---|---|---|
| CoinDesk RSS | RSS | Crypto-specific news, market analysis |
| CoinTelegraph RSS | RSS | Crypto news, regulatory updates |
| Google News RSS | RSS | Broad coverage: crypto + macro + geopolitics |
| CryptoPanic API | API | Real-time crypto news with community sentiment |
| Fear & Greed Index | API | Market sentiment (0-100 scale) |

### News Rules — Decisions, Not Blocks

News **does NOT block** entries. Instead, news **adjusts decisions**:

| Situation | Effect |
|---|---|
| High-impact news (3+ triggers) | Risk × 0.25 (quarter size) |
| Medium-impact news (1-2 triggers) | Risk × 0.5 (half size) |
| Fear & Greed ≤ 15 (extreme fear) | Additional × 0.5 |
| risk-off bias (war, crash, hack) | Block LONG signals, allow SHORT |
| risk-on bias (approval, inflow) | Block SHORT signals, allow LONG |
| No significant news | Risk × 1.0 (normal) |

**Philosophy:** Markets don't stop after 30 minutes. News creates a persistent environment — the system trades WITH the news direction, at adjusted size, not against it.

### High-Impact Keywords (auto-detected)

`fed, fomc, rate decision, rate hike/cut, powell, cpi, inflation, nfp, blackrock, etf approval/outflow, sec, lawsuit, hack, exploit, collapse, bankruptcy, liquidation, war, sanction, tariff, iran, blockade, missile, nuclear, peace talks, ceasefire, default, debt ceiling`

## Telegram Reports

- Use readable language with clear blocks and explanations
- Include: pair, direction, entry, SL, TP, R:R, risk %, confluence score
- PnL tracking: per position and total account
- Alert on: new entries, exits, SL hits, TP hits, DD warnings

## Full Autonomy

- No confirmation required for trades
- Bot operates independently following these rules
- All decisions logged to DB for audit

---

# Trading Pairs

Primary watchlist (high liquidity perpetual futures):
- **BTC/USDT**, **ETH/USDT**, **SOL/USDT**, **BNB/USDT**
- **XRP/USDT**, **DOGE/USDT**, **AVAX/USDT**, **LINK/USDT**

## Timeframes

- **4H** — Bias/direction (trend identification)
- **1H** — Market structure (S/R, order blocks)
- **15M** — Entry timing (precise entry/exit)

---

# Skills

Trading skills are in `.claude/skills/`. Each skill has a `SKILL.md` defining when/how to use it, plus `references/` for methodology docs sourced from `.claude/docs/research/`.

## Available Skills

- `/crypto-technical-analyst` — Multi-timeframe technical analysis
- `/crypto-position-sizer` — Position sizing with HyroTrader constraints
- `/crypto-risk-manager` — Drawdown monitoring, compliance enforcement
- `/crypto-trade-planner` — Entry/SL/TP calculation with confluence scoring
- `/crypto-regime-detector` — Bull/Bear/Range market classification
- `/crypto-news-analyzer` — News + geopolitics impact assessment
- `/crypto-signal-generator` — Confluence-based signal generation
- `/crypto-signal-postmortem` — Post-trade outcome analysis
- `/crypto-portfolio-manager` — Multi-position management and diversification

## Agents

- `trader` — Main autonomous trading agent (used with /loop)

## Commands

- `/trade-scan` — Full market scan cycle (all pairs, generate signals, execute if valid)

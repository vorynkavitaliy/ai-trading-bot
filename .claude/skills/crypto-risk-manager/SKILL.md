---
name: crypto-risk-manager
description: >
  Monitor and enforce HyroTrader risk limits. Check drawdown status, portfolio heat,
  margin usage, and compliance. Use when checking risk status, before any trade,
  or when monitoring open positions.
  Triggers: "risk check", "drawdown", "am I safe", "margin check", "portfolio heat", "compliance"
user_invocable: true
arguments:
  - name: account_volume
    description: "Account volume key (e.g., 200000, 50000)"
    required: true
---

# Crypto Risk Manager

Real-time risk monitoring and HyroTrader compliance enforcement. This is the gatekeeper — no trade executes without passing risk checks.

## When to Use

- Before every trade execution (mandatory pre-trade check)
- Continuous monitoring of open positions
- When drawdown alerts are triggered
- Daily risk assessment and reporting

## Research Foundation

- `docs/research/position-sizing-advanced.md` — Drawdown analysis
- `docs/research/math-money-management-timeseries.md` — Risk of ruin calculations
- `docs/research/systematic-trading-carver.md` — Portfolio heat management

## KILL SWITCH LEVELS

| Level | Threshold | Action |
|---|---|---|
| WARNING | Daily DD > 3% OR Total DD > 6% | Telegram alert, reduce to 1 position max |
| CRITICAL | Daily DD > 4% OR Total DD > 8% | **CLOSE ALL POSITIONS IMMEDIATELY** |
| FATAL | Daily DD >= 5% OR Total DD >= 10% | Stop all trading, this should NEVER happen |

## Workflow

### Step 1: Fetch Account State

From Bybit API for all sub-accounts in the volume:
- Current equity (wallet balance + unrealized PnL)
- Initial balance (from accounts.json key)
- Today's starting equity (recorded at 00:00 UTC)
- Peak equity today (highest point since 00:00 UTC)
- All open positions with unrealized PnL

### Step 2: Calculate Drawdown Metrics

```
daily_dd_pct = (peak_equity_today - current_equity) / peak_equity_today * 100
total_dd_pct = (initial_balance - current_equity) / initial_balance * 100
```

### Step 3: Calculate Exposure Metrics

```
total_margin = sum(position.margin for all open positions)
margin_usage_pct = total_margin / current_balance * 100

total_notional = sum(position.notional for all open positions)
notional_ratio = total_notional / initial_balance

portfolio_heat = sum(position.risk_pct for all open positions)
```

### Step 4: Compliance Check

```
## Risk Status: Account {volume} — {timestamp}

### Drawdown
- Daily DD: {daily_dd_pct}% / 5% max [{status_emoji}]
- Total DD: {total_dd_pct}% / 10% max [{status_emoji}]
- Daily DD headroom: {5 - daily_dd_pct}%
- Total DD headroom: {10 - total_dd_pct}%

### Exposure
- Margin usage: {margin_usage_pct}% / 25% max [{status}]
- Notional ratio: {notional_ratio}x / 2.0x max [{status}]
- Portfolio heat: {portfolio_heat}% / 5% target [{status}]
- Open positions: {count} / {max} max

### Position Details
| Pair | Side | Size | Entry | Current | PnL | PnL% | Risk% |
|---|---|---|---|---|---|---|---|
| {pair} | {long/short} | {size} | {entry} | {current} | {pnl} | {pnl_pct} | {risk_pct} |

### 40% Rule Check (Evaluation Phase)
- Total accumulated profit: ${total_profit}
- Largest single trade profit: ${max_single} ({pct}%)
- Status: {PASS/WARNING/FAIL}

### Verdict: {CLEAR / WARNING / CRITICAL / HALT}
{Action required if not CLEAR}
```

### Step 5: Enforce Actions

- **CLEAR**: Trading allowed, all limits within bounds
- **WARNING**: Reduce position count to 1, no new entries unless A+ setup, alert Telegram
- **CRITICAL**: Close all positions via market orders, halt trading, alert Telegram
- **HALT**: No trading allowed, manual intervention required

## Key Principles

1. **Risk manager has veto power** — overrides ALL other signals
2. **When in doubt, reduce exposure** — capital preservation > profit
3. **Daily DD is trailing** — it can only get worse within the day, never resets mid-day
4. **Log every risk check** — full audit trail in DB
5. **40% rule in eval only** — drop this check once funded
6. **Buffer from limits** — treat 4%/8% as hard limits, not 5%/10%

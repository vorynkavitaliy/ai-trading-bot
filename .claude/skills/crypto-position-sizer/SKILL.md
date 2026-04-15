---
name: crypto-position-sizer
description: >
  Calculate optimal position size for crypto trades with HyroTrader compliance.
  Use when determining how much to risk, how many contracts to open, or sizing a trade.
  Triggers: "position size", "how much to risk", "lot size", "sizing", "how many contracts"
user_invocable: true
arguments:
  - name: pair
    description: "Trading pair (e.g., BTCUSDT)"
    required: true
  - name: entry
    description: "Entry price"
    required: true
  - name: stop_loss
    description: "Stop-loss price"
    required: true
  - name: account_balance
    description: "Current account balance in USDT"
    required: true
---

# Crypto Position Sizer

Calculate position size respecting HyroTrader risk limits, using ATR-based and fixed-fractional methods.

## When to Use

- Before every trade entry
- When adjusting position size for different setups
- When checking if a trade fits within portfolio heat limits

## Research Foundation

- `docs/research/position-sizing-advanced.md` — Kelly, fractional, ATR-based methods
- `docs/research/math-money-management-timeseries.md` — Mathematical foundations
- `docs/research/systematic-trading-carver.md` — Vol-targeting, FDM, IDM

## HyroTrader Constraints (INVIOLABLE)

- Max risk per trade: **3%** of initial balance
- Default risk: **1%** (standard setup), **1.5%** (A+ setup with 4/4 confluence)
- Max total margin: **25%** of current balance
- Max notional exposure: **2x** initial balance
- Total portfolio heat (sum of all position risks): **< 5%**

## Workflow

### Step 1: Determine Risk Percentage

| Setup Quality | Confluence Score | Risk % |
|---|---|---|
| Standard | 3/4 | 1.0% |
| A+ Setup | 4/4 | 1.5% |
| Weak/Uncertain | 2/4 or less | **NO TRADE** |

### Step 2: Calculate Dollar Risk

```
dollar_risk = initial_balance * risk_percentage
```

### Step 3: Calculate Position Size

```
stop_distance = abs(entry_price - stop_loss_price)
stop_distance_pct = stop_distance / entry_price
position_size_usdt = dollar_risk / stop_distance_pct
contracts = position_size_usdt / entry_price
```

### Step 4: Validate Against Constraints

1. **Margin check**: `position_margin = position_size_usdt / leverage`
   - Current total margin + new margin must be < 25% of current balance
2. **Notional check**: Current total notional + new position notional < 2x initial balance
3. **Portfolio heat check**: Sum of all position risk_% < 5%
4. If ANY check fails → **reduce position size** to fit or **reject trade**

### Step 5: Round Down

Always round position size DOWN to nearest valid lot size for the pair. Never round up.

### Step 6: Output

```
## Position Size: {PAIR}

- Risk: {risk_pct}% = ${dollar_risk}
- Entry: {entry_price}
- Stop-Loss: {sl_price} ({sl_distance_pct}%)
- Position Size: {size} contracts (${notional_value})
- Margin Required: ${margin} ({margin_pct}% of balance)
- R:R at TP: {ratio}

### Constraint Check
- [x] Risk per trade: {pct}% <= 3% max
- [x] Margin: {current + new}% <= 25% max
- [x] Notional: ${total} <= ${2x_initial} max
- [x] Portfolio heat: {total_heat}% <= 5% max
```

## Key Principles

1. **Never exceed HyroTrader limits** — account loss is permanent
2. **Default to 1%, upgrade to 1.5% only for A+** — consistency beats aggression
3. **Round DOWN always** — never round up on position size
4. **Check all 4 constraints** — any single breach = no trade
5. **Half-Kelly philosophy** — optimal growth with reduced risk of ruin

---
name: crypto-trade-planner
description: >
  Plan a complete trade with entry, stop-loss, take-profit, position size, and risk assessment.
  Use when you have a signal and need to build a full trade plan before execution.
  Triggers: "trade plan", "plan entry", "setup trade", "where to enter", "SL/TP"
user_invocable: true
arguments:
  - name: pair
    description: "Trading pair (e.g., BTCUSDT)"
    required: true
  - name: direction
    description: "LONG or SHORT"
    required: true
---

# Crypto Trade Planner

Converts analysis signals into executable trade plans with precise levels, sizing, and risk management.

## When to Use

- After technical analysis identifies a setup
- When signal generator produces a confluence signal
- Before any trade execution

## Research Foundation

- `docs/research/swing-trading-methodology.md` — Entry/exit mechanics
- `docs/research/execution-algorithms-johnson.md` — Limit order placement, OBI
- `docs/research/stop-hunting-market-traps.md` — SL placement to avoid hunting
- `docs/research/demand-supply-dynamics.md` — Zone-based entry
- `docs/research/support-resistance-mastery.md` — Level-based TP

## Workflow

### Step 1: Validate Setup

Before planning, confirm:
1. Confluence score >= 3/4 (from signal generator or manual analysis)
2. Risk manager returns CLEAR status
3. 4H trend aligns with trade direction
4. No major macro event within 30 minutes

If any check fails → **NO TRADE**

### Step 2: Determine Entry

**Preferred: Limit order** (maker fee 0.02% vs taker 0.055%)

Entry placement strategy:
- **LONG**: Place limit at demand zone upper boundary or nearest support + 0.1% buffer
- **SHORT**: Place limit at supply zone lower boundary or nearest resistance - 0.1% buffer
- **Aggressive**: If momentum is strong and price is pulling back, enter at current price - 0.5x ATR

Order expiry: Cancel unfilled limit orders after **15 minutes**

### Step 3: Determine Stop-Loss

**SL must be placed WITHIN 5 MINUTES of entry — this is inviolable.**

SL placement rules:
- **LONG**: Below the demand zone / support level minus 1.5x ATR(14) on 15M
- **SHORT**: Above the supply zone / resistance level plus 1.5x ATR(14) on 15M
- Place SL **beyond liquidity pools** (below equal lows for longs, above equal highs for shorts) to avoid stop-hunting
- Minimum SL distance: 0.5x ATR (avoid getting stopped by noise)
- Maximum SL distance: 3% of entry price (HyroTrader max risk constraint)

### Step 4: Determine Take-Profit

Multi-target approach:
- **TP1** (50% of position): **2:1 R:R** — nearest significant resistance/support
- **TP2** (30% of position): **3:1 R:R** — next major level
- **TP3** (20% of position): **trailing stop** — 1x ATR trail after 3:1 is hit

Minimum R:R for any trade: **2:1** — if TP1 doesn't reach 2:1, reject the trade.

### Step 5: Calculate Position Size

Use crypto-position-sizer skill logic:
- Determine risk % (1% standard, 1.5% A+)
- Calculate from SL distance
- Validate all HyroTrader constraints

### Step 6: Trailing Stop Rules

- Activate trailing at **1.5R** profit
- Trail distance: **1x ATR(14)** on the entry timeframe (15M)
- Move to breakeven at **1R** profit (move SL to entry price)

### Step 7: Output Trade Plan

```
## TRADE PLAN: {PAIR} {LONG/SHORT}
### Date: {timestamp}

### Signal
- Confluence: {score}/4 — {conditions met}
- 4H Trend: {direction}
- Regime: {bull/bear/range}

### Levels
- Entry: {price} (limit order)
- Stop-Loss: {price} ({distance_pct}%, ${dollar_risk})
- TP1 (50%): {price} ({rr}:1 R:R)
- TP2 (30%): {price} ({rr}:1 R:R)
- TP3 (20%): Trailing at {trail_distance}

### Sizing
- Risk: {risk_pct}% = ${dollar_risk}
- Position: {contracts} contracts (${notional})
- Leverage: {leverage}x
- Margin: ${margin}

### Risk Check
- Daily DD after max loss: {projected}% / 5%
- Total DD after max loss: {projected}% / 10%
- Portfolio heat after entry: {projected}% / 5%

### Validity
- Order expires: {timestamp + 15min}
- Cancel if: {invalidation_condition}

### Rationale
{Brief explanation of why this trade, what confluence exists, what macro context}
```

## Key Principles

1. **No plan, no trade** — every trade must have a complete plan before execution
2. **SL within 5 minutes** — absolute HyroTrader requirement
3. **Minimum 2:1 R:R** — never accept less
4. **Limit orders preferred** — save on fees, better fills
5. **Beyond liquidity pools** — SL placement avoids stop-hunting
6. **Multi-target exit** — lock profits progressively

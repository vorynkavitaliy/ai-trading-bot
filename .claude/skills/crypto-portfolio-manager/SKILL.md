---
name: crypto-portfolio-manager
description: >
  Manage multi-position portfolio across accounts. Handle diversification, correlation,
  total exposure, and account-level allocation. Use when managing multiple open positions
  or planning portfolio-level decisions.
  Triggers: "portfolio", "positions", "diversification", "correlation", "account allocation"
user_invocable: true
---

# Crypto Portfolio Manager

Portfolio-level management ensuring diversification, correlation control, and optimal capital deployment across multiple HyroTrader accounts.

## When to Use

- When 2+ positions are open
- Before opening a new position (check portfolio fit)
- For the 30-minute full report
- When assessing cross-account status

## Research Foundation

- `docs/research/portfolio-management-grinold.md` — Information Ratio, diversification
- `docs/research/quant-fund-methods-narang.md` — Portfolio construction, IDM
- `docs/research/systematic-trading-carver.md` — IDM, FDM, portfolio heat

## Multi-Account Architecture

From `accounts.json`:
- Each volume key (200000, 50000) = one strategy tier
- Each apiKey entry within a volume = one sub-account
- All sub-accounts in same volume get IDENTICAL trades (via Promise.all)
- Different volumes may get different position sizes (scaled to balance)

**NEVER hedge across accounts** — HyroTrader prohibits cross-account hedging.

## Diversification Rules

### Sector Diversification
Crypto sectors for diversification:
- **L1 chains**: BTC, ETH, SOL, AVAX
- **DeFi**: LINK, UNI, AAVE
- **Meme/Speculative**: DOGE, SHIB, PEPE
- **Infrastructure**: MATIC, ARB, OP
- **Exchange tokens**: BNB, FTT

Rule: Max **2 positions** in the same sector.

### Correlation Control
- BTC and ETH are **highly correlated** (>0.8) — treat as same exposure direction
- If long BTC, a long ETH counts as correlated exposure
- Max **60% of portfolio heat** in correlated positions
- Instrument Diversification Multiplier (IDM) for 2-4 crypto pairs: **1.2-1.4**

### Direction Diversification
- Prefer a mix of long and short when regime allows
- All-long or all-short is acceptable in strong trend regimes

## Workflow

### Step 1: Current Portfolio State

```
## Portfolio Status — {timestamp}

### Account: {volume}k
| # | Pair | Side | Entry | Current | PnL | PnL% | Risk% | Sector |
|---|---|---|---|---|---|---|---|---|
| 1 | {pair} | {L/S} | {price} | {price} | ${pnl} | {%} | {%} | {sector} |

### Aggregates
- Open positions: {count} / {max}
- Total PnL: ${amount} ({pct}%)
- Portfolio heat: {heat}% / 5% max
- Margin usage: {pct}% / 25% max
- Notional ratio: {ratio}x / 2.0x max
- Long exposure: {pct}%
- Short exposure: {pct}%
- Correlated cluster: {pairs} = {pct}% of heat
```

### Step 2: New Position Fit Check

Before adding any position:
1. **Slot available?** — Count < max for current regime
2. **Sector diverse?** — Not > 2 in same sector
3. **Correlation check** — Not > 60% heat in correlated cluster
4. **Direction balance** — Acceptable for current regime
5. **All HyroTrader limits** — margin, notional, heat

### Step 3: Cross-Account Report

```
### All Accounts Summary
| Account | Balance | PnL Today | DD Today | DD Total | Positions | Status |
|---|---|---|---|---|---|---|
| 200k #1 | ${bal} | ${pnl} | {dd}% | {dd}% | {count} | {CLEAR/WARN} |
| 50k #1 | ${bal} | ${pnl} | {dd}% | {dd}% | {count} | {CLEAR/WARN} |
```

### Step 4: Rebalancing Recommendations

If portfolio is suboptimal:
- Which positions to close (furthest from plan, lowest R:R remaining)
- Where to add (sectors/directions underrepresented)
- Size adjustments needed

## Key Principles

1. **Diversification reduces ruin risk** — don't concentrate
2. **Correlation is the hidden risk** — 3 correlated longs = 1 big long
3. **Same trades across sub-accounts** — consistency within a volume tier
4. **Never cross-account hedge** — HyroTrader prohibition
5. **Portfolio heat is the master constraint** — individual trades must fit the whole

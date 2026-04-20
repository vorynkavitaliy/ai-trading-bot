---
name: crypto-signal-postmortem
description: >
  Analyze completed trades and signals to improve strategy. Review wins, losses, 
  false positives, and missed opportunities. Use after trade closure or for periodic review.
  Triggers: "postmortem", "trade review", "what went wrong", "analyze my trades", "performance"
user_invocable: true
arguments:
  - name: period
    description: "Review period: 'last_trade', 'today', 'week', 'month'"
    required: false
---

# Crypto Signal Postmortem

Systematic post-trade analysis to identify patterns in wins/losses and improve signal quality over time.

## When to Use

- After every trade closure (automated)
- Daily end-of-session review
- Weekly performance review
- When strategy seems to be underperforming

## Research Foundation

- `docs/research/backtesting-methodology.md` — Performance metrics, validation
- `docs/research/trading-in-the-zone.md` — Psychological patterns
- `docs/research/trading-habits-burns.md` — Habit formation, discipline review
- `docs/research/advances-financial-ml-prado.md` — Triple-barrier labeling, feature importance

## Outcome Classification

| Outcome | Definition |
|---|---|
| **True Positive** | Signal fired, trade taken, profit target hit |
| **Partial Win** | Signal correct but exited early (SL moved to BE, trailing) |
| **False Positive** | Signal fired, trade taken, SL hit |
| **Missed Opportunity** | Signal was close (7-8/12 confluence, just under threshold) but setup worked anyway |
| **Regime Mismatch** | Signal valid technically but regime was wrong |
| **Filter Save** | Signal rejected by filter, would have been a loss |

## Workflow

### Step 1: Gather Trade Data

From DB, collect for the review period:
- All executed trades: entry, exit, PnL, duration, confluence score
- All generated signals (including skipped)
- Market conditions at signal time
- Actual price path after signal

### Step 2: Per-Trade Analysis

For each completed trade:
```
## Trade #{id}: {PAIR} {LONG/SHORT}

### Result: {WIN/LOSS/BREAKEVEN}
- Entry: {price} at {time}
- Exit: {price} at {time} ({reason: TP1/TP2/TP3/SL/trailing/manual})
- PnL: ${amount} ({pct}%)
- Duration: {hours}h {minutes}m
- R achieved: {R_multiple}

### Signal Quality
- Confluence at entry: {score}/12
- Factor-by-factor breakdown at entry: { #1 SMC+Flow, #2 Tech, #3 Vol, #4 MTF, #5 BTC, #6 Regime, #7 News, #8 Mom, #9 Vol, #10 LiqCl, #11 Funding/OI, #12 Session }
- **Which factors actually predicted the outcome** (leading): {list — usually #1 flow, #8 momentum, #11 funding deltas}
- **Which factors lagged / gave false confirmation** (lagging): {list — often #2 MACD, #7 stale news}
- HMM regime at entry: {state, confidence, transitioning}
- Zone anchor: {from zones.md or ad-hoc}
- News context: {catalysts.md active events, 2-cycle status}

### What Worked
{analysis of positive factors}

### What Didn't Work
{analysis of negative factors}

### Lesson
{one actionable takeaway}
```

### Step 3: Aggregate Statistics

```
## Performance Report — {period}

### Summary
- Total trades: {count}
- Win rate: {pct}%
- Average R:R achieved: {ratio}
- Profit factor: {gross_profit / gross_loss}
- Max drawdown in period: {pct}%
- Total PnL: ${amount} ({pct}% of initial)

### By Confluence Score
| Score | Trades | Win Rate | Avg R |
|---|---|---|---|
| 12/12 | {n} | {pct}% | {R} |
| 10-11/12 | {n} | {pct}% | {R} |
| 9/12 | {n} | {pct}% | {R} |
| 8/12 (structural) | {n} | {pct}% | {R} |

### Factor Predictive Power
| Factor | Hit rate when present | Hit rate when absent | Delta |
|---|---|---|---|
| 1. SMC+Flow STRONG (2) | {pct}% | {pct}% | {delta} |
| 1. SMC+Flow (1) | {pct}% | {pct}% | {delta} |
| 8. Momentum | {pct}% | {pct}% | {delta} |
| 11. Funding/OI deltas | {pct}% | {pct}% | {delta} |
| ... other factors ... | | | |

**Use this table to tune which factors deserve more weight.** If Factor 2 MACD contributes near-zero delta → confirm MACD stays tiebreaker only.

### By Pair
| Pair | Trades | Win Rate | PnL |
|---|---|---|---|
| {pair} | {n} | {pct}% | ${pnl} |

### By Direction
| Direction | Trades | Win Rate | PnL |
|---|---|---|---|
| Long | {n} | {pct}% | ${pnl} |
| Short | {n} | {pct}% | ${pnl} |

### By Regime
| Regime | Trades | Win Rate | PnL |
|---|---|---|---|
| {regime} | {n} | {pct}% | ${pnl} |

### Signal Analysis
- Signals generated: {total}
- Signals executed: {count} ({pct}%)
- True positives: {count} ({pct}%)
- False positives: {count} ({pct}%)
- Filter saves: {count}
- Missed opportunities: {count}

### Recommendations
{data-driven suggestions for parameter adjustment}
```

## Key Principles

1. **Every trade teaches** — losses are expensive lessons, don't waste them
2. **Minimum sample size 20** — don't draw conclusions from 3 trades
3. **Honest attribution** — don't blame the market, analyze the signal
4. **Data over feelings** — use numbers, not impressions
5. **Feed back into strategy** — adjust signal weights based on postmortem data
6. **40% rule tracking** — ensure no single trade dominates profit (eval phase)

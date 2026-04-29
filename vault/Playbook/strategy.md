# Strategy v3 — placeholder

This file will hold the **codified, OOS-validated** strategy after Stage 3.5 Claude Walk completes and Stage 4 finalization is approved.

## Status

🚫 **Not yet populated.** Do NOT open positions until this section is filled.

## Why empty

Stage 3 backtest of legacy v2-style hypotheses (range fade, trend pullback, donchian breakout, extreme RSI) on 1y BTC+ETH 1H data failed every gate (PF ≥ 1.4, MaxDD ≤ 4%, expectancy ≥ 0.3R). Cleanest result was `trend-pullback ETH 3R/6R`: PF 0.70, MaxDD 2.5%, but only 15 trades — statistically thin and still negative expectancy.

Conclusion: **mechanical 1H indicator rules on BTC+ETH in this market regime do not generate edge.** The path forward is Claude Walk on candidate moments to discover what *I as a trader* would have done differently, then codify those rules with statistical backing.

## What goes here when populated

```markdown
## Active playbooks

### Range fade — Playbook A
- Regime gate: ADX(1H) < threshold (set during calibration).
- Entry LONG (all required): close ≤ BB(20, 2.0).lower, RSI(14, 1H) < N, volume ≥ k × SMA20(volume),
  cross-exchange context (e.g. funding or L/S confirms).
- Entry SHORT mirror.
- SL: BB edge ± m × ATR(1H), min stop M × ATR.
- TP1: SMA20 — 50% size, then SL → breakeven.
- TP2: opposite BB band — 50% size.
- Abort: ADX ≥ N before TP1.

### Trend pullback — Playbook B
- Regime gate: ADX ≥ N AND EMA stack aligned.
- Entry: pullback to EMA-N ± k%, close back through, +DI/-DI agree.
- SL: swing ± m × ATR.
- TP1: x R partial.
- Trailing: Chandelier on remainder.

## Sizing
- Risk per trade: 0.6% base.
- Volatility scalar 0.7×–1.2× depending on ATR percentile.
- Cap 1.0% per trade.

## Skips (always)
- Funding window ±10 min around 00/08/16 UTC.
- Dead zone 22-00 UTC.
- Daily P&L ≤ −2.5% (soft kill).
- 2 SL on same pair within UTC day.
- High-impact news ±30 min (per `Watchlist/catalysts.md`).
```

## Gate to populate this file

Before any rule lands here:

1. Stage 3.5 Claude Walk completes (≥ 200 candidate decisions reviewed across 90 days).
2. Resolved outcomes show PF ≥ 1.3 on aggregate.
3. At least one rule pattern shows **statistical** edge (not just one good trade).
4. Operator approves the rule set.

## Where lessons go

Until this file is populated, ad-hoc observations from Claude Walk and live `/trade-scan` cycles go to `lessons-learned.md`. They become candidate inputs for codification but are NOT executable rules until they appear here.

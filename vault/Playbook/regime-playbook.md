---
name: Regime Playbook
description: How I trade in Bull, Bear, Range, and Transitional regimes. The market state dictates the strategy.
type: playbook
priority: 3
last_revised: 2026-04-17
---

# Regime Playbook

> **The single biggest edge in systematic trading is playing the right game for the current regime. The same setup that prints in a trending market gets chopped in a range. I identify regime first, then select the appropriate playbook.**

---

## Regime Classification

I classify regime on the **4H timeframe** for strategic bias, and re-check each cycle. The classifier combines:

1. **Trend direction** — 4H EMA 20 vs. EMA 50 alignment
2. **Trend strength** — ADX on 4H
3. **Volatility regime** — ATR percentile (trailing 30 days)
4. **Price action** — higher highs/higher lows vs. lower highs/lower lows vs. sideways

| Regime | Signals |
|---|---|
| **Bull** | EMA20 > EMA50, ADX > 20, HH/HL, ATR normal |
| **Bear** | EMA20 < EMA50, ADX > 20, LH/LL, ATR normal |
| **Range** | EMAs flat/intertwined, ADX < 18, equal highs/lows, ATR low-to-normal |
| **Transitional** | ADX rising from < 20, EMAs crossing, ATR expanding sharply — regime is changing |

*(ref: `crypto-regime-detector` skill, `market-trend-analysis.md`, `cycle-analytics-ehlers.md`)*

---

## BULL REGIME — Join The Trend

### Default posture
**Long-biased.** Most trades are long. Shorts require 6/8 confluence (counter-trend premium).

### What works in Bull
- **Pullback-to-support longs** — price retraces to 1H/4H OB or key MA, longs at structural tap with tight SL
- **Breakout longs** — BOS above previous swing high with volume confirmation, enter on retest
- **BTC leads, alts follow** — BTC breaks → alts break ~30-60 min later. Pre-position in alts when BTC signals.
- **Momentum continuation** — ADX rising, DI separating, RSI 55-70 (not overbought — trending). Long on dips to 20 EMA.

### What fails in Bull
- **Shorting into uptrends.** Don't do it unless 6/8 and clear distribution pattern (double top + bearish div + volume divergence + structure break).
- **"This is too high."** Bull markets climb walls of worry. "Extended" is not a short signal.
- **Mean-reversion plays.** Save them for range.

### Sizing in Bull
Normal 0.5% default, 1.0% for A+ longs. Shorts max 0.5% even if A+ — counter-trend is lower edge.

---

## BEAR REGIME — Sell Rallies

### Default posture
**Short-biased.** Most trades are short. Longs require 6/8 confluence (counter-trend) AND strong BTC hold.

### What works in Bear
- **Rally-to-resistance shorts** — price bounces to 1H/4H supply zone or key MA from below, short the rejection
- **Breakdown shorts** — BOS below previous swing low with volume, enter on retest
- **Cascade shorts** — BTC breaks major support, alts over-extend down; short alt bounces
- **Bearish divergence + distribution** — RSI bear div on rally into resistance = high-prob short

### What fails in Bear
- **Bottom-picking longs.** "It's so low it has to bounce." No — it goes lower. Longs in bear need confirmed reversal structure, not just "oversold."
- **Holding losers through bear capitulations.** Stops get run. Respect the stops.
- **Breakout longs.** False breakouts dominate in bear.

### Sizing in Bear
Normal 0.5% default for shorts, 1.0% for A+ shorts. Longs max 0.5% counter-trend.

### BTC Bear for altcoins
**Alt longs are BLOCKED** when BTC 4H is bear. Regime factor = 0. Don't argue with the lead asset.

---

## RANGE REGIME — Fade The Edges

### Default posture
**Symmetric.** Long support, short resistance, exit at mid.

### What works in Range
- **Fade the range boundaries** — longs at support with wick rejection, shorts at resistance with rejection. Exit at range mid.
- **Equal highs/lows + sweep** — the classic SMC range setup. Liquidity sits above equal highs / below equal lows. When swept and reclaimed → reverse setup.
- **Low ATR + compression → breakout prep** — range near the end often compresses before breakout. Don't fade aggressively near the end; wait for breakout direction.

### What fails in Range
- **Trend-following.** Every "breakout" gets sucked back in. Wait for confirmed breakout (close beyond boundary + retest + follow-through).
- **Wide TPs.** Demand 1.5R max; don't expect 3R in a 5% range. *(ref: `feedback_tp_sizing.md` — TP in range markets near S/R)*
- **Holding too long.** Range trades are fast. If it hasn't worked in 4-8 hours, it's not working.

### Sizing in Range
Normal 0.5%, reduce to 0.3% if range is tight (< 2% width). A+ sizing rarely justified in range.

---

## TRANSITIONAL REGIME — Stand Aside Or Reduce Size

### Default posture
**Cautious.** This is where most losses happen — regime is changing and old rules break.

### What works in Transitional
- **Waiting.** The best trade is often no trade. Let the new regime confirm.
- **Very-clean A+ setups only** — 7-8/8 confluence with aligned multi-TF. The noise is high; only take the trades where the signal dominates.
- **Small size** — half-risk (0.25%) until regime confirms.

### What fails in Transitional
- **Following the old regime** — "BTC has been bullish, so I long" — but EMAs are crossing down and ADX is rising on a new trend.
- **Big positions** — the whipsaw is maximal.
- **News-driven entries** — transitional regimes are often news-driven; trading them is gambling on headline reactions.

### Sizing in Transitional
Half-risk. Tighter SLs. Prefer shorter holds.

---

## Regime Transitions — The Most Profitable (and Dangerous) Moments

Regime transitions are when institutional positions rotate. They produce the biggest moves — and the biggest traps.

### Signals a regime is about to flip

- ADX compressing (from high to low) → trend exhausting
- ADX expanding (from low to high) → new trend starting
- EMAs crossing after long separation
- Volume divergence on new highs/lows
- Failure of a key structural level (4H support/resistance) after multiple tests
- Macro catalyst (Fed decision, ETF flow reversal, major geopolitical event)

### How I behave around transitions

1. **Reduce existing exposure.** Close weakest positions in the old regime.
2. **Stop adding.** No new positions in the old direction.
3. **Wait for confirmation.** One signal is not enough. I need 2-3 confirming signals (structure + momentum + volume) before flipping bias.
4. **Size up GRADUALLY** in the new regime — 0.25% on the first trade, 0.5% after the first wins, 1.0% only after regime is clearly established.

---

## Cross-Regime Rules

- **The Playbook is not the map; the market is the map.** If my classification says "Range" but price is making HH/HL with strong volume, I update my classification. Data over labels.
- **Regime on higher timeframe dominates.** Daily bull + 4H range = still a bull market. The daily trend is the tide; the 4H range is the wave. I trade with the tide.
- **Regime is per-pair, not global.** BTC can be range while SOL is trending. Classify each pair separately (but check BTC dependency for alts).

---

## Key Research References

- `market-trend-analysis.md` — regime classification
- `cycle-analytics-ehlers.md` — trend vs. cycle detection
- `momentum-trading-clenow.md` — trend-following
- `systematic-trading-carver.md` — regime-dependent strategy
- `volatility-analysis-natenberg.md` — ATR percentile
- `crypto-market-microstructure.md` — crypto regime specifics

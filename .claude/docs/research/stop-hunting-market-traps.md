# Stop Hunting & Market Traps
**Date:** 2026-04-06
**Sources:** MOMOH S.O "Stop Hunting & Market Traps" (ISBN 9798860727540), MOMOH S.O "Accumulation & Distribution Set Up", ICT Power of 3 / AMD framework, community SMC research 2024–2025.

---

## 1. How Institutions Hunt Stops

### The Core Mechanic

Institutional players (banks, hedge funds, crypto whales, market makers) cannot enter or exit large positions in a single transaction without causing extreme slippage. To fill a $100M BTC long, a whale needs a flood of sell orders on the other side. The most reliable source of those sell orders is retail stop losses.

The mechanism works in four steps:

1. **Identify the pool.** Price repeatedly tests a level — equal lows, a swing low, a double bottom. Every retail trader who bought the bounce placed their stop just below that level. The more obvious and tested the level, the larger the stop cluster.

2. **Engineer the move.** The institution pushes price through the level with enough force to trigger automated stops. These triggered stops convert to market sell orders, flooding the book with liquidity exactly when the institution wants to buy.

3. **Absorb and reverse.** The institution absorbs the stop-triggered sell flow with its own buy orders. Once the retail stops are cleared, the sell pressure evaporates. Price snaps back.

4. **Run to the real target.** With the position filled at ideal prices (below the swing low that everyone defended), the institution now moves price to its actual target — upward in a long scenario.

MOMOH S.O frames this as "the untold secret 95% of traders don't know": the very stop loss that is supposed to protect you becomes the instrument of your liquidation and simultaneously funds institutional entry. The market does not move through levels by accident. It moves through them because that is where the orders are.

### Crypto-Specific Mechanics

Crypto amplifies this phenomenon in three ways absent from traditional markets:

**Liquidation cascades.** In perpetual futures, leveraged longs have an automatic liquidation price. When price drops through a cluster of liquidation prices, the resulting forced market sells push price further down, triggering the next cluster. Whales front-run these zones by opening short positions just above the cascade threshold. The November 2025 event — $2.0B liquidated in 24h — is a structural example: once the first tier cracked, the cascade fed itself.

**Funding rate signals.** When perpetual funding rates run persistently positive (longs paying shorts), it signals crowded long positioning. Whales short the asset, collect funding, and simultaneously push price down through long liquidation levels. The funding rate both signals the target and monetizes the move. Warning: funding rate manipulation by protocols (like Ethena's basis positions in 2024) can suppress this signal, making it unreliable in isolation.

**Liquidation heatmaps as institutional intelligence.** CoinGlass and similar tools publish heatmaps showing exactly where leveraged positions will be force-closed. This information is public. Institutions read the same heatmap retail traders do. Dense heatmap zones (typically round numbers, recent swing extremes) are priority hunting grounds.

### The Role of Market Makers

Exchanges and market makers have a structural incentive to widen spreads during low-liquidity periods (Asian session overnight) and to allow price to probe obvious levels where stop clusters exist. This is not malicious — it is how liquidity is sourced. However, the effect is identical to deliberate stop hunting from a retail trader's perspective.

---

## 2. Identifying Stop Hunt Patterns — Algorithmic Detection

### Pattern 1: Liquidity Sweep Candle

The canonical stop hunt on a single candle:
- Candle wick extends beyond a significant level (equal highs, swing high/low, round number)
- Candle body closes back inside the level
- Next 1–3 candles show momentum in the opposite direction

**Detection signature:**
```
bullishSweep:
  candle.low < level.price          // wick pierces below
  candle.close > level.price        // body closes above (back inside)
  candle.close > candle.open        // candle is bullish (optional, confirms reversal intent)

bearishSweep:
  candle.high > level.price         // wick pierces above
  candle.close < level.price        // body closes below
  candle.close < candle.open        // candle is bearish
```

The wick-to-body ratio matters: a wick that is 2–3x the body size is a stronger sweep signal than a small wick. Large wicks indicate aggressive institutional rejection after stop absorption.

### Pattern 2: Delayed Close-Back (Multi-Candle Sweep)

When stop hunts occur on higher timeframes, price may spend 2–4 candles beyond the level before returning. Our current implementation in `liquidity.ts` already handles this with a 4-candle lookahead — this is correct behavior. The risk is false positives: a breakout that looks like a delayed close-back in the first 4 candles but then continues. The confirmation differentiator is the momentum candle in the opposite direction after close-back.

### Pattern 3: High-Probability Sweep Locations

Not all levels carry equal stop clusters. Priority order:

1. **Equal Highs / Equal Lows (EQH/EQL):** Two or more swing highs/lows within 0.05% of each other. Every double-top buyer placed a stop below. Every double-bottom seller placed a stop above. The more touches, the bigger the pool.

2. **Previous Day / Previous Week High/Low (PDH/PDL/PWH/PWL):** Institutional algorithms systematically probe these because every strategy that uses "previous day high" as a reference automatically clusters stops there.

3. **Round numbers:** $80,000, $85,000, $90,000 BTC. Retail concentration is extreme at round numbers. Stop hunts through round numbers are among the most violent and reliable in BTC.

4. **Swing highs/lows from 1H and 4H:** These are the OB-adjacent levels that our current strategy already tracks.

5. **Congestion zones / consolidation boundaries:** When price ranges for 10+ candles, stops accumulate at both edges.

### Pattern 4: Time-Based Identification (AMD Framework)

Per the ICT Power of 3 / AMD framework (aligned with MOMOH's Accumulation/Distribution Setup):

- **Asian session (19:00–01:00 EST):** Accumulation phase. Price moves in a tight range. Institutions build positions quietly. Low volatility, low volume.
- **London open (02:00–07:00 EST):** Manipulation phase. Price sweeps Asian session highs or lows to collect stops, then reverses. This is the highest-probability stop hunt window in a 24-hour cycle.
- **New York session (08:00–13:00 EST):** Distribution phase. Price runs in the institutional direction. True trend move.

**Weekly AMD:**
- Monday: Accumulation (range)
- Tuesday: Manipulation / stop hunt (most active sweep day)
- Wednesday: Potential reversal
- Thursday–Friday: Distribution trend move

This time-based framework gives our algorithm a prior probability boost: a liquidity sweep detected during London open (02:00–07:00 EST) is structurally more reliable than one detected during Friday afternoon New York session.

---

## 3. Liquidity Pool Detection

### What Makes a Valid Pool

Our current implementation requires 3 touches within 0.05% tolerance on a 50-candle window. This is correct per indicator rules. However, quality scoring is missing. A pool touched 5 times is not equal to one touched 3 times.

**Enhanced pool scoring:**
```
poolStrength = touchCount * ageWeight * levelTypeWeight

ageWeight:
  touches in last 10 candles → weight 1.5
  touches in 10–30 candles → weight 1.0
  touches in 30–50 candles → weight 0.7

levelTypeWeight:
  EQL/EQH → 1.5 (most reliable)
  Round number within 0.1% → 1.3
  Previous session high/low → 1.2
  Generic swing → 1.0
```

Pools with `poolStrength >= 4.0` are high-priority targets for stop hunting; flag them for enhanced monitoring.

### Stop Pool Identification vs. Breakout Level Identification

A common algorithmic error: treating every level breach as either a breakout or a sweep, with no intermediate state. In practice:

- **Sweep:** Wick through level, close back inside. Followed by momentum reversal.
- **Breakout:** Close through level on strong volume. Followed by continuation.
- **Failed breakout (fakeout):** Close through level on weak volume, then reversal over 2–5 candles. Rarer, but more dangerous — looks like a breakout entry, turns into a sweep.

The key discriminator is volume: a genuine breakout requires 50%+ above average volume during and after the breach. A sweep typically shows a volume spike at the wick extreme followed by immediate volume collapse on the reversal candle.

---

## 4. Fake Breakouts vs. Real Breakouts

### The Structural Difference

**Real breakout characteristics:**
- Close beyond the level (not just a wick)
- Volume at least 1.5x average during the breakout candle
- Next 2–3 candles continue in the breakout direction without re-entering the prior range
- Breakout candle body is >= 60% of candle range (minimal wicks)
- Multi-timeframe alignment: 1H and 4H both show structure supporting the direction

**Fakeout / stop hunt characteristics:**
- Wick beyond level with close back inside (classic), OR
- Close beyond level but weak volume (< 1.2x average), followed by reversal within 3 candles
- Breakout candle has large wick on the breakout side (showing rejection)
- No 4H structural support for the breakout direction
- Occurs during low-volume session (Asian, late NY)
- FVG left immediately after the "breakout" candle (gap that needs filling back toward the breached level)

### Volume Profile Signal

During a stop hunt, volume behaves distinctly:
1. Volume spikes on the wick candle (stops being triggered = order flow)
2. Volume collapses on the first reversal candle (stop orders exhausted, no continuation selling/buying)
3. Volume increases again as price moves away from the swept level in the true direction

During a real breakout:
1. Volume rises steadily into the breach
2. Volume remains elevated on the first 2–3 post-breakout candles
3. Volume does not collapse on the first pullback

Our volume ratio indicator (current: > 2.0 = strong) is relevant here, but the pattern of volume across 3 candles matters more than a single-candle ratio. Enhancement: track `volumeRatio` on the sweep candle AND the 2 candles following, and flag the pattern.

### Quantitative Rejection Signals

After a stop hunt wick, the reversal candle quality matters:
- Engulfing the wick candle body → strong confirmation
- Closing above/below 50% of the wick candle → moderate confirmation
- Failing to close above/below the wick candle's open → weak, wait for next candle

---

## 5. Optimal SL Placement to Avoid Hunts

### Why Retail Stops Are Obvious

Retail stop placement follows predictable rules taught in every trading course:
- "Place stop below the swing low"
- "Stop below support"
- "Stop below the order block"
- "Stop 1% below entry"

These rules cluster stops at identical price levels across thousands of accounts. Institutions know this. The solution is not to abandon stops — it is to place them where they are NOT obvious.

### The Anti-Hunt SL Framework

**Rule 1: Stop beyond the sweep, not at the level.**

If a swing low exists at $83,000, retail stops cluster at $82,950. A stop hunt will probe to $82,800–$82,900. The correct SL for a long entered near $83,000 is not $82,950 — it is $82,700 or below the liquidity pool's full sweep extent.

Formula from current `trading-logic.md`:
```
SL = OB.low - buffer
buffer = max(ATR × 0.5, 0.2% of price)
```

This is correct but the ATR multiplier should scale with pool strength. For a high-priority pool (poolStrength >= 4.0), extend the buffer to ATR × 0.75 to survive a deeper sweep.

**Rule 2: Never cluster your stop with the obvious level.**

If your OB.low is sitting exactly on a 4H equal low (EQL), the stop hunt will probe further than ATR × 0.5. Add an additional 0.1–0.15% to the buffer whenever the OB low aligns within 0.05% of a detected liquidity pool.

**Rule 3: Use structure, not price distance.**

The most hunt-resistant stop placement is beyond the structure that, if invalidated, means the trade thesis is wrong — not a fixed ATR multiple from entry. For a long: SL goes below the swing low that created the higher low confirming the uptrend. If price takes that low, the uptrend thesis is structurally broken regardless of the hunt.

**Rule 4: Widen during manipulation window.**

During the London session manipulation window (02:00–07:00 EST), temporarily widen SL by 0.05% on any open positions. The sweep range is larger during this window by design. After the manipulation phase completes (confirmed by directional displacement), normal buffer resumes.

**Rule 5: Avoid round-number stops.**

Do not place SL at $80,000, $85,000, $90,000, or any number ending in 00 or 000. These are the highest-priority hunt targets in BTC. If your SL calculation lands within 0.1% of a round number, shift it 0.15% beyond the round number.

---

## 6. Trading After Stop Hunts

### The Entry Model

The optimal entry after a confirmed stop hunt follows this sequence:

1. **Identify the swept level** — high-strength liquidity pool that price has just pierced with a wick
2. **Wait for close-back** — wick candle closes back inside the level (confirmed sweep)
3. **Look for the CHoCH / BOS on the lower timeframe** — on 5M, a change of character confirms the institutional reversal
4. **Identify the OB or FVG that initiated the CHoCH** — this becomes the entry zone
5. **Enter at the OB/FVG on a limit order** — not at market, let price come back to the zone
6. **SL below the sweep extreme + buffer** — not below the swept level, but below the actual wick low (the full extent of the hunt)
7. **TP toward the next liquidity pool in the opposite direction** — the institutional target

This is the "triple confirmation model": OB + FVG + Liquidity Sweep, which our current strategy partially implements. The key addition is the sweep confirmation as a prerequisite for the entry signal, not just a contributor to score.

### Entry Timing After Sweep

Not all sweeps produce immediate reversals. Quality filters:

- **Institutional OB present at sweep level:** The sweep happened at an OB zone (unmitigated, clean, high body ratio). This means institutions had pre-positioned orders there. Strong entry signal.
- **FVG immediately below the sweep level:** After the wick, a FVG formed between the pre-sweep candle and the post-sweep candle. Price will fill this gap during the true move.
- **Volume confirms:** Volume spike on the wick, collapse on close-back. Volume signature confirms stop absorption, not continuation selling.
- **Multi-timeframe alignment:** 4H trend aligns with the reversal direction. Trading against the 4H trend after a sweep is lower probability even with sweep confirmation.

### Scoring Enhancement for Post-Sweep Entries

Current scoring gives up to 15 pts for a confirmed liquidity sweep. For post-sweep entries, this component should be elevated because the sweep itself is the setup trigger, not merely a confirmation:

Proposed scoring adjustment for confirmed-sweep entries:
- Sweep confirmed on current candle (immediate close-back): +15 pts (current)
- Sweep confirmed AND sweep candle engulfs prior structure: +20 pts (enhanced)
- Sweep confirmed AND sweep is at institutional OB level: bonus +5 pts (stacked with OB score)

This reflects the empirical reality that clean sweep + OB confluence produces a measurably higher win rate than either component alone.

---

## 7. Accumulation & Distribution Setup (MOMOH's Framework)

Per MOMOH's companion book and the ICT AMD framework, the full institutional cycle is:

### Phase 1: Accumulation
Price enters a consolidation range after a prior downtrend. Characteristics:
- Range-bound price action, 10–30+ candles
- Each probe of the range low is met with strong buying (long lower wicks)
- Volume is declining overall but spikes on dips (buy-side absorption)
- Funding rates neutral to slightly negative (longs not crowded yet)

**Bot behavior during accumulation:** No entries. ATR/price ratio is below the 0.1% filter threshold. The tight range causes the ATR filter to block trades automatically.

### Phase 2: Manipulation (Stop Hunt)
Price sweeps below the accumulation range low. This is the stop hunt moment:
- All traders who bought the range have stops below the range low
- Price dips below, triggers stops, then violently reverses
- The reversal candle is often the largest bullish candle in the prior 20+ bars

**Bot behavior during manipulation:** This is the entry trigger. Swept low + OB at sweep level + CHoCH on 15M = maximum confluence entry signal.

### Phase 3: Distribution
Price trends from the manipulation point to the institutional target — typically the next major liquidity zone (previous high, equal highs above consolidation). Volume increases steadily during distribution.

**Bot behavior during distribution:** Entry is already open. Trailing stop follows the trend. The AMD framework predicts the distribution will run until the next major liquidity pool is swept on the upside — this becomes the TP region.

---

## 8. Actionable Insights for Our Bot

### Immediate Enhancements to `liquidity.ts`

**1. Pool strength scoring (missing from current implementation):**

Add a `strength` field to `LiquidityZone`. Calculate it as:
```
strength = touchCount * ageWeight * levelTypeWeight
```
Where `levelTypeWeight` = 1.5 for equal highs/lows detected within 0.05% tolerance (current logic), 1.2 for previous-session high/low, 1.0 otherwise.

**2. Sweep quality score (missing):**

When a sweep is detected, calculate a `sweepQuality` value:
```
sweepQuality:
  sweepCandleClosedBack immediately → 1.0 (confirmed)
  delayedCloseBack (candles 1–2) → 0.8
  delayedCloseBack (candles 3–4) → 0.6
  wickRatio (wick / body > 2.0) → +0.2 bonus
```
Pass `sweepQuality` to the scorer so the liquidity score component scales from 0–15 based on quality, not just a binary swept/not-swept flag.

**3. Volume confirmation on sweep (missing):**

Import volume data into sweep detection. A sweep with volume ratio > 1.5 on the wick candle and < 0.8 on the first reversal candle is high-quality (stop absorption pattern). Without volume confirmation, downgrade `sweepQuality` by 0.2.

**4. Session-time filter:**

Weight liquidity sweeps detected during London manipulation window (02:00–07:00 EST, equivalently 07:00–12:00 UTC) with a 1.2 multiplier on the base sweep score. Sweeps during Asian session (19:00–01:00 EST) are weaker — apply 0.8 multiplier.

### SL Placement Improvements

**Clash detection:** Before finalizing SL price, check whether SL lands within 0.2% of any detected liquidity pool. If it does, push SL beyond the pool by an additional ATR × 0.25. This prevents placing our SL exactly where institutional algorithms target.

**Round number avoidance:** If computed SL is within 0.1% of a round number (divisible by 1000 in BTC dollar terms), extend SL past the round number by 0.15%.

### Confluence Score Adjustment for Post-Sweep Entries

Add a new scoring path: "sweep entry mode" activated when a confirmed sweep (sweepQuality >= 0.8) is the most recent liquidity event. In sweep entry mode:
- Liquidity sweep component: up to 20 pts (vs. current 15)
- Minimum required score for entry: 65 pts (vs. 70) — the sweep itself already validates institutional intent

### AMD Phase Detection (New Filter)

Implement a simple AMD phase classifier as a pre-filter to scoring:

```
amdPhase:
  ACCUMULATION: ATR/price < 0.15%, range < 0.5%, 10+ candles
  MANIPULATION: confirmed sweep of accumulation boundary
  DISTRIBUTION: post-sweep with BOS on 1H in institutional direction
  UNKNOWN: default
```

- During ACCUMULATION: suppress entries (ATR filter already does this, but explicit phase tag improves logging)
- During MANIPULATION: boost confluence score by +5 pts if trade is in the reversal direction
- During DISTRIBUTION: allow trailing entries in trend direction (lower-confluence threshold)

### What NOT to Change

The current equal-highs-lows detection logic (3 touches, 0.05% tolerance, 50-candle window) is algorithmically sound per indicator rules and consistent with community SMC best practices. The close-back sweep detection with 4-candle lookahead is also correct. The primary gaps are:
- Pool strength scoring
- Sweep quality scoring
- Volume integration into sweep confirmation
- Session-time weighting
- SL clash detection with detected pools

These are additive enhancements, not replacements.

---

## Summary Table

| Concept | Current Implementation | Enhancement |
|---|---|---|
| Equal H/L detection | 3 touches, 0.05%, 50 bars | Add strength score |
| Sweep detection | Wick + close-back, 4-bar lookahead | Add sweepQuality (0–1.2) |
| Volume in sweep | Not used | Volume spike + collapse pattern |
| Session timing | Not used | London window multiplier 1.2x |
| SL placement | OB.low - ATR×0.5 | Pool clash check + round-number avoidance |
| Post-sweep entry | Same threshold as normal entries | Lower threshold to 65, boost sweep score to 20 pts |
| AMD phase | Not implemented | Pre-filter classifier |

---

**Sources:**
- [MOMOH S.O "Stop Hunting & Market Traps" — Amazon](https://www.amazon.com/STOP-HUNTING-MARKET-TRAPS-ULTIMATE/dp/B0CHLC9R6C)
- [MOMOH S.O "Accumulation & Distribution Set Up" — Barnes & Noble](https://www.barnesandnoble.com/w/accumulation-distribution-set-up-momoh-s-o/1144127666)
- [Stop Hunting 101: Swing Highs and Lows as Liquidity Traps — ACY](https://acy.com/en/market-news/education/market-education-stop-hunting-trading-swing-highs-lows-liquidity-j-o-20250822-095643/)
- [Liquidity Sweep Reversals 15-Minute Strategy — Daily Price Action](https://dailypriceaction.com/blog/liquidity-sweep-reversals/)
- [The Confirmation Model: OB + FVG + Liquidity Sweep — ACY](https://acy.com/en/market-news/education/confirmation-model-ob-fvg-liquidity-sweep-j-o-20251112-094218/)
- [High vs Low Probability Liquidity Sweeps — International Trading Institute](https://internationaltradinginstitute.com/blog/high-vs-low-probability-liquidity-sweeps-avoid-traps/)
- [ICT Power of 3: Accumulation Manipulation Distribution — Inner Circle Trader](https://innercircletrader.net/tutorials/ict-power-of-3/)
- [Crypto Market Manipulation: Liquidation Cascades — CoinChange](https://www.coinchange.io/blog/bitcoins-2-billion-reckoning-how-novembers-liquidations-cascade-exposed-cryptos-structural-fragilities/)
- [Breakouts vs False Breakouts — LuxAlgo](https://www.luxalgo.com/blog/breakouts-vs-false-breakouts-key-differences/)
- [Stop Hunt Detection Guide — PriceActionNinja](https://priceactionninja.com/stop-hunt-detection-guide-how-institutions-trap-traders/)
- [SMC Tips: Lessen Stop Hunts — ACY](https://acy.com/en/market-news/education/lessen-stop-hunts-trading-j-o-20250917-102136/)
- [Liquidation Heatmap Analysis — CoinGlass](https://www.coinglass.com/pro/futures/LiquidationHeatMap)

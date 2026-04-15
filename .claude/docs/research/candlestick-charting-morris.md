# Candlestick Charting Explained — Gregory L. Morris
## Research Summary for Algorithmic Trading Bot

**Date:** 2026-04-06
**Sources:** Morris, G.L. "Candlestick Charting Explained" (3rd ed., McGraw-Hill, 2006);
TA-Lib CDL functions source; IEEE/MDPI academic research 2021–2024;
QuantifiedStrategies.com backtest dataset (75 patterns, S&P 500 data)

---

## Overview

Gregory Morris analyzed 89 candlestick patterns against 13 years of data (1991–2004)
covering 7,275 NYSE/Nasdaq/Amex stocks. His key finding: candlestick signals have
predictive power for roughly 1–7 trading days, after which the edge degrades. Beyond
7 days, candlestick patterns alone are no better than random.

Morris ranked patterns by their **reliability score** — defined as how frequently
price moved in the predicted direction within 7 bars of the signal. He also introduced
the concept of **candle filtering**: combining candlestick signals with complementary
technical indicators (RSI, MACD, Bollinger %B) to sharply reduce false signals.

Critical finding from his Chapter 7 (Reliability of Pattern Recognition): no pattern
works reliably in isolation. Context (trend, volume, support/resistance) is the primary
determinant of outcome. The pattern is the trigger — not the edge itself.

---

## Single Candle Patterns

### 1. Doji

**Meaning:** Market indecision. Bulls and bears fought to a draw. Often signals
exhaustion at trend extremes.

**Structural definition:**
- Open and close are equal or nearly equal
- Upper and lower wicks can vary (defines sub-type)

**Algorithmic detection thresholds:**
```
body_size  = abs(close - open)
total_range = high - low

Doji condition: body_size / total_range <= 0.05
(body is at most 5% of the total candle range)

Minimum range filter: total_range > 0.0005 * close
(avoids flat/zero-range candles in illiquid periods)
```

**Sub-types and their wick profiles:**

| Type | Upper wick | Lower wick | Bias |
|------|------------|------------|------|
| Standard Doji | Moderate | Moderate | Neutral |
| Long-legged Doji | Long | Long | Strong indecision |
| Gravestone Doji | Long (>2x body) | Near zero | Bearish at tops |
| Dragonfly Doji | Near zero | Long (>2x body) | Bullish at bottoms |
| Four-Price Doji | Zero | Zero | Extreme illiquidity (ignore) |

```
// Gravestone Doji
upper_wick = high - max(open, close)
lower_wick = min(open, close) - low
gravestone: upper_wick >= 2 * total_range * 0.6 AND lower_wick <= total_range * 0.1

// Dragonfly Doji
dragonfly: lower_wick >= 2 * total_range * 0.6 AND upper_wick <= total_range * 0.1
```

**Morris reliability:** Medium-Low for standard doji in trending markets. High for
Gravestone/Dragonfly at identifiable swing extremes with volume confirmation.

**Context requirement:** Doji on its own has ~50% reliability. Must appear:
- After 3+ candles in the same direction (exhaustion context)
- At a known support/resistance level
- With above-average volume (1.5x+ of 20-bar average)

---

### 2. Hammer and Hanging Man

**Meaning:** Same structure, opposite context.
- **Hammer** = appears in downtrend → bullish reversal signal
- **Hanging Man** = appears in uptrend → bearish reversal signal (requires bearish confirmation next candle)

**Structural definition:**
- Small real body in upper portion of candle
- Lower wick at least 2x the body length
- Upper wick minimal (ideally absent)

**Algorithmic detection:**
```
body_size   = abs(close - open)
lower_wick  = min(open, close) - low
upper_wick  = high - max(open, close)
total_range = high - low

hammer_conditions:
  lower_wick >= 2.0 * body_size          // lower wick at least 2x body
  upper_wick <= 0.1 * total_range        // upper wick <= 10% of range
  body_size  <= 0.35 * total_range       // body in top third of candle

// Candle color does not matter for basic hammer
// Bullish hammer (white/green body) is slightly more reliable
hammer_bullish_bonus: close > open
```

**Morris reliability:** Hammer = 60–65% bullish next-bar follow-through when:
1. In established downtrend (at least 5 declining candles)
2. Lower wick touches or pierces key support
3. Volume is elevated (>1.5x average)
4. Confirmed by next candle closing above hammer body

**Hanging Man:** Requires bearish next-candle confirmation. Without confirmation,
reliability drops below 50% — Morris explicitly cautions against acting on hanging
man without next-bar confirmation.

---

### 3. Shooting Star and Inverted Hammer

Same structure (small body at bottom, long upper wick), opposite context.
- **Inverted Hammer** = appears in downtrend → potential bullish reversal (needs confirmation)
- **Shooting Star** = appears in uptrend → bearish reversal signal

**Algorithmic detection:**
```
upper_wick  = high - max(open, close)
lower_wick  = min(open, close) - low
body_size   = abs(close - open)
total_range = high - low

shooting_star_conditions:
  upper_wick >= 2.0 * body_size          // long upper wick
  lower_wick <= 0.1 * total_range        // minimal lower wick
  body_size  <= 0.35 * total_range       // small body at bottom of range

// Bearish shooting star: body is bearish (red candle preferred)
shooting_star_strong: close < open       // adds reliability
```

**Morris reliability:** Shooting Star = 60–68% bearish follow-through when:
- In uptrend of 5+ candles
- At resistance zone
- Upper wick significantly exceeds previous candle's range
- Volume spike on the shooting star candle

**Inverted Hammer reliability:** Lower than shooting star. Requires strong bullish
confirmation next candle. Often acts as an OB-entry signal in SMC context.

---

### 4. Marubozu

**Meaning:** "Shaved head/body" — no wicks or minimal wicks. Maximum conviction candle.
Shows one side dominated the entire session.

**Types:**
- White Marubozu (bullish): open = low, close = high
- Black Marubozu (bearish): open = high, close = low
- Closing White Marubozu: close = high (wick at open end only)
- Opening White Marubozu: open = low (wick at close end only)

**Algorithmic detection:**
```
upper_wick  = high - max(open, close)
lower_wick  = min(open, close) - low
total_range = high - low

// Full Marubozu
full_marubozu:
  upper_wick <= 0.03 * total_range AND lower_wick <= 0.03 * total_range

// Closing Marubozu (the most reliable sub-type)
closing_white_marubozu:
  upper_wick <= 0.03 * total_range AND close > open

closing_black_marubozu:
  lower_wick <= 0.03 * total_range AND close < open
```

**Morris reliability:** High. Marubozu is a trend-continuation signal, not reversal.
A white marubozu in an uptrend signals continued buying pressure. Used as:
- First candle of Three White Soldiers pattern
- Impulse candle that creates Order Blocks (SMC integration point)
- Volume confirmation: marubozu with 2x+ volume = institutional participation

**Crypto relevance:** Marubozu is very common in crypto due to momentum/FOMO cycles.
Must distinguish between genuine institutional moves vs. retail stop-hunts that close
strong but reverse quickly.

---

### 5. Spinning Top

**Meaning:** Indecision candle with small body but wicks on both sides. Similar to
doji but body is non-trivial.

**Algorithmic detection:**
```
body_size   = abs(close - open)
total_range = high - low
upper_wick  = high - max(open, close)
lower_wick  = min(open, close) - low

spinning_top:
  body_size / total_range <= 0.35        // small body (35% or less of range)
  body_size / total_range > 0.05         // but not a doji
  upper_wick >= 0.2 * total_range        // wicks on both sides
  lower_wick >= 0.2 * total_range
```

**Morris reliability:** Low in isolation. Meaningful only as part of multi-candle
patterns or at inflection points. Morris treats spinning top as a "pause candle" —
the market is reconsidering its direction.

---

## Two-Candle Patterns

### 6. Bullish and Bearish Engulfing

**Most reliable two-candle pattern according to Morris.**

**Structural definition:**
Bullish Engulfing:
- Candle 1: bearish (red), part of existing downtrend
- Candle 2: bullish (green), opens below C1 close, closes above C1 open
- C2 body completely engulfs C1 body

Bearish Engulfing: mirror image at uptrend tops.

**Algorithmic detection:**
```
// Bullish Engulfing
bullish_engulfing:
  C1.close < C1.open                     // C1 is bearish
  C2.close > C2.open                     // C2 is bullish
  C2.open <= C1.close                    // C2 opens at or below C1 close
  C2.close >= C1.open                    // C2 closes at or above C1 open

// Strong Bullish Engulfing (higher reliability)
strong_bullish_engulfing:
  C2.open < C1.close                     // gap down open (more dramatic reversal)
  C2.close > C1.open                     // full engulf
  (C2.close - C2.open) > (C1.open - C1.close) * 1.5  // C2 body 1.5x C1 body

// Volume confirmation
volume_confirmed:
  C2.volume > C1.volume * 1.5            // volume expansion on reversal candle
```

**Morris reliability:** 63–72% directional accuracy for next 1–3 bars. This rises to
75%+ when:
1. Preceded by 3+ trend candles in same direction (exhaustion context)
2. Volume on C2 is at least 1.5x volume on C1
3. Pattern occurs at support/resistance level
4. C2 body engulfs not just C1 body but also C1 upper wick (full engulf)

**Critical caution (Morris):** Engulfing patterns without volume confirmation fail at a
rate of 40–45%. Volume is non-optional for this pattern.

**IEEE crypto research finding (2021):** Engulfing patterns in BTC/ETH/LTC showed
mixed results. Bullish engulfing on daily timeframe had ~58% success rate. On 15M
timeframe, dropped to near-random without trend/volume filters. This is consistent with
our SMC-filtered approach: engulfing at an OB on 15M is a different signal than
engulfing in the middle of a trend.

---

### 7. Harami and Harami Cross

**Meaning:** "Pregnant" in Japanese. Inside candle after large candle = uncertainty
after conviction.

**Structural definition:**
- Candle 1: large body (marubozu-like)
- Candle 2: small body (or doji) contained entirely within C1's body

**Algorithmic detection:**
```
// Bullish Harami (after downtrend)
bullish_harami:
  C1.close < C1.open                     // C1 bearish
  C2.close > C2.open                     // C2 bullish (not required for basic harami)
  C2.open >= C1.close                    // C2 body inside C1 body
  C2.close <= C1.open
  C1_body = C1.open - C1.close
  C2_body = C2.close - C2.open
  C2_body <= C1_body * 0.5               // C2 body max 50% of C1 body

// Harami Cross: C2 is a doji
harami_cross:
  bullish_harami conditions met
  C2_body / (C2.high - C2.low) <= 0.05  // C2 is effectively a doji
```

**Morris reliability:** Harami = 55–62%. Harami Cross = 58–65% (doji C2 adds
indecision weight). Both patterns require confirmation next candle — do not enter
on the harami candle itself.

---

### 8. Piercing Line and Dark Cloud Cover

**Meaning:** Piercing Line = bullish reversal. Dark Cloud Cover = bearish reversal.
Mid-point penetration is the key criterion.

**Structural definition:**
Piercing Line:
- Candle 1: bearish, strong body
- Candle 2: opens below C1 low (gap), closes above the midpoint of C1 body

Dark Cloud Cover: mirror image.

**Algorithmic detection:**
```
// Piercing Line
C1_midpoint = (C1.open + C1.close) / 2

piercing_line:
  C1.close < C1.open                     // C1 bearish
  C2.close > C2.open                     // C2 bullish
  C2.open < C1.low                       // gap down open (or at least below C1 close)
  C2.close > C1_midpoint                 // closes above C1 midpoint (50%+ penetration)
  C2.close < C1.open                     // but does NOT fully engulf (else it's engulfing)

// Penetration ratio
penetration = (C2.close - C1.close) / (C1.open - C1.close)
strong_piercing: penetration >= 0.6     // closes into top 40% of C1 body

// Dark Cloud Cover
dark_cloud:
  C1.close > C1.open                     // C1 bullish
  C2.close < C2.open                     // C2 bearish
  C2.open > C1.high                      // gap up open
  C2.close < C1_midpoint                 // closes below C1 midpoint
  C2.close > C1.open                     // doesn't fully engulf
```

**Morris reliability:** Piercing Line = 61–67%. Dark Cloud Cover = 62–68%. Both are
less reliable than engulfing because they don't complete the reversal. The deeper
the penetration past 50%, the more reliable. At 70%+ penetration approaching full
engulf, reliability approaches engulfing pattern levels.

**Key distinction from engulfing:** Engulfing = reversal confirmed. Piercing/Dark Cloud
= reversal potential, confirmation still needed.

---

### 9. Tweezer Tops and Bottoms

**Meaning:** Two candles with matching highs (tops) or matching lows (bottoms).
Resistance/support rejection signal.

**Algorithmic detection:**
```
// Tweezer Top
tweezer_top:
  C1.close > C1.open                     // C1 bullish
  C2.close < C2.open                     // C2 bearish
  abs(C1.high - C2.high) <= 0.001 * C1.high  // matching highs (0.1% tolerance)

// Tweezer Bottom
tweezer_bottom:
  C1.close < C1.open                     // C1 bearish
  C2.close > C2.open                     // C2 bullish
  abs(C1.low - C2.low) <= 0.001 * C1.low    // matching lows (0.1% tolerance)

// Enhanced reliability: wicks at matching level exceed bodies
tweezer_top_strong:
  (C1.high - max(C1.open, C1.close)) >= 0.3 * (C1.high - C1.low)  // rejection wick
  (C2.high - max(C2.open, C2.close)) >= 0.3 * (C2.high - C2.low)
```

**Morris reliability:** 55–60% — lowest of the major two-candle patterns. Most
useful as a secondary confirmation signal rather than primary entry trigger.

---

## Three-Candle Patterns

### 10. Morning Star (Bullish) and Evening Star (Bearish)

**Most reliable three-candle reversal pattern.**

**Structural definition (Morning Star):**
- Candle 1: large bearish body (trend candle)
- Candle 2: small body or doji, gaps below C1 close (star)
- Candle 3: large bullish body, closes above midpoint of C1 body

**Algorithmic detection:**
```
C1_midpoint = (C1.open + C1.close) / 2

morning_star:
  // C1: bearish trend candle
  C1.close < C1.open
  (C1.open - C1.close) >= atr_14 * 0.7  // substantial body (at least 70% of ATR)

  // C2: star candle (indecision at bottom)
  C2_body = abs(C2.close - C2.open)
  C2_body <= (C1.open - C1.close) * 0.4  // small body relative to C1
  max(C2.open, C2.close) <= C1.close     // C2 body below C1 body (gap preferred)

  // C3: bullish recovery candle
  C3.close > C3.open                     // C3 bullish
  C3.close >= C1_midpoint                // closes above C1 midpoint (key criterion)
  C3.volume > C1.volume * 0.9            // C3 volume should approach or exceed C1

// Morning Star Doji (stronger variant)
morning_star_doji:
  C2_body / (C2.high - C2.low) <= 0.05  // C2 is doji
  All other morning_star conditions met

// Evening Star (mirror)
evening_star:
  C1.close > C1.open                     // C1 bullish
  (C1.close - C1.open) >= atr_14 * 0.7
  min(C2.open, C2.close) >= C1.close     // C2 above C1
  C3.close < C3.open                     // C3 bearish
  C3.close <= (C1.open + C1.close) / 2   // closes below C1 midpoint
```

**Morris reliability:** Morning Star = 65–72%. Evening Star = 64–70%. These are the
highest-reliability three-candle patterns. Doji variant adds 3–5% to reliability.
Backtests (QuantifiedStrategies, 2023): 60–70% win rate on S&P 500 daily bars, rising
to 67–75% with volume and trend context filters.

**Volume pattern:** Ideal Morning Star has C1 high volume (selling climax), C2 low
volume (indecision/drying up), C3 high volume (buyers returning). This pattern is
critical in crypto where capitulation followed by accumulation shows clearly in volume.

---

### 11. Three White Soldiers and Three Black Crows

**Meaning:** Three consecutive strong candles in same direction. Trend acceleration/
confirmation signal.

**Structural definition (Three White Soldiers):**
- Three consecutive bullish candles
- Each opens within previous candle's body
- Each closes near its high (minimal upper wick)
- Each candle body is similar or larger than the previous

**Algorithmic detection:**
```
three_white_soldiers:
  // All three candles bullish
  C1.close > C1.open AND C2.close > C2.open AND C3.close > C3.open

  // Each higher close
  C2.close > C1.close AND C3.close > C2.close

  // Each opens within prior body (continuation, not gap)
  C2.open >= C1.open AND C2.open <= C1.close
  C3.open >= C2.open AND C3.open <= C2.close

  // Minimal upper wicks (strong closes)
  upper_wick_pct(C1) <= 0.2              // upper wick <= 20% of body
  upper_wick_pct(C2) <= 0.2
  upper_wick_pct(C3) <= 0.2
  // where: upper_wick_pct = (high - close) / (close - open)

  // Progressive or consistent body sizes
  C2_body >= C1_body * 0.7
  C3_body >= C2_body * 0.7

// Three Black Crows (bearish mirror)
three_black_crows:
  All conditions mirrored for bearish
  Each opens within prior body (near prior close)
  Each closes near its low (minimal lower wick)
```

**Morris reliability:** Three White Soldiers = 70–78% continuation (highest among
Morris patterns). Three Black Crows = 68–75%. The strength comes from three-bar
confirmation — by the third bar, the trend change has established momentum.

**Caution (Morris "Advance Block" variant):** If the third soldier shows diminishing
body size and growing upper wick, this is an "Advance Block" — warning of exhaustion.
The pattern is no longer bullish; treat as potential reversal.

```
advance_block_warning:
  three_white_soldiers conditions otherwise met
  C3_body < C2_body * 0.6               // third body shrinks significantly
  upper_wick_pct(C3) > 0.3              // third candle has notable upper wick
```

---

### 12. Three Inside Up and Three Inside Down

**Meaning:** Harami followed by confirmation. The harami creates indecision; C3
confirms the reversal.

**Structural definition (Three Inside Up):**
- C1: large bearish candle
- C2: bullish candle contained within C1 body (harami)
- C3: bullish candle closing above C1 open (confirmation)

**Algorithmic detection:**
```
three_inside_up:
  // C1-C2: bullish harami
  C1.close < C1.open AND C2.close > C2.open
  C2.open >= C1.close AND C2.close <= C1.open
  abs(C2.close - C2.open) <= (C1.open - C1.close) * 0.6

  // C3: confirmation
  C3.close > C3.open
  C3.close > C1.open                    // closes above C1's entire body

three_inside_down:
  // Mirror for bearish
  C1 bullish, C2 bearish harami, C3 bearish below C1 open
```

**Morris reliability:** Three Inside Up = 65–70%. Slightly less than Morning Star
because the confirmation candle is less dramatic. But more common pattern frequency.

---

### 13. Three Outside Up and Three Outside Down

**Meaning:** Engulfing pattern followed by confirmation. Most powerful three-candle
reversal structure.

**Algorithmic detection:**
```
three_outside_up:
  // C1-C2: bullish engulfing
  bullish_engulfing(C1, C2) = true

  // C3: continuation confirmation
  C3.close > C3.open
  C3.close > C2.close                   // higher close than engulfing candle
  C3.volume >= C2.volume * 0.8          // volume stays strong

three_outside_down:
  // bearish_engulfing(C1, C2) + C3 closes below C2 close
```

**Morris reliability:** 68–75% — second highest after Three White Soldiers. The
engulfing provides strong reversal foundation, C3 eliminates most false signals.

---

## Continuation Patterns

Morris covers several candlestick continuation patterns. These signal a pause in
trend rather than reversal:

### 14. Rising and Falling Three Methods

**Structural definition (Rising Three Methods):**
- C1: large bullish candle
- C2-C4: three small bearish candles (pullback), staying within C1's range
- C5: large bullish candle closing above C1 close

**Algorithmic detection:**
```
rising_three_methods:
  // C1: strong bullish
  C1.close > C1.open
  C1_body = C1.close - C1.open
  C1_body >= atr_14 * 0.8               // substantial initial thrust

  // C2-C4: small pullback candles within C1 range
  for i in [2, 3, 4]:
    Ci.high <= C1.high
    Ci.low >= C1.low                    // stay within C1's shadow
    abs(Ci.close - Ci.open) <= C1_body * 0.4  // small bodies

  // C5: bullish breakout
  C5.close > C5.open
  C5.close > C1.close                   // closes above C1
  C5.volume > C1.volume * 0.9           // volume returns
```

**Morris reliability:** 65–72% continuation. Strong pattern for trend-following
systems, but only valid when the three inner candles remain within C1's range.

### 15. Mat Hold (Upside/Downside)

Variant of Three Methods where the star (C2) gaps away from C1. Less common but
higher reliability (~70%) due to the gap signaling institutional conviction.

### 16. Separating Lines

- Same-direction candle opens at same price as prior candle's open
- Continuation of prior trend
- Reliability: 55–60% — low, rarely worth trading in isolation

---

## Pattern Reliability Rankings

Based on Morris's empirical data (1991–2004, 7,275 stocks) combined with more recent
quantified backtest data (QuantifiedStrategies 2023, S&P 500):

| Rank | Pattern | Type | Morris WR | QS Backtest WR |
|------|---------|------|-----------|----------------|
| 1 | Three White Soldiers | Continuation | 70–78% | 72–80% |
| 2 | Three Black Crows | Continuation | 68–75% | 70–77% |
| 3 | Three Outside Up/Down | Reversal | 68–75% | 68–74% |
| 4 | Morning Star Doji | Reversal | 68–73% | 67–75% |
| 5 | Morning Star | Reversal | 65–72% | 65–73% |
| 6 | Evening Star Doji | Reversal | 67–71% | 65–72% |
| 7 | Evening Star | Reversal | 64–70% | 63–71% |
| 8 | Bullish Engulfing (volume conf.) | Reversal | 63–72% | 62–70% |
| 9 | Bearish Engulfing (volume conf.) | Reversal | 63–72% | 61–69% |
| 10 | Three Inside Up/Down | Reversal | 65–70% | 60–68% |
| 11 | Rising Three Methods | Continuation | 65–72% | 60–67% |
| 12 | Piercing Line / Dark Cloud | Reversal | 61–68% | 58–65% |
| 13 | Harami Cross | Reversal | 58–65% | 55–63% |
| 14 | Hammer (confirmed) | Reversal | 60–65% | 55–63% |
| 15 | Shooting Star (confirmed) | Reversal | 60–68% | 55–62% |
| 16 | Harami | Reversal | 55–62% | 52–60% |
| 17 | Dragonfly/Gravestone Doji | Reversal | 55–62% | 52–60% |
| 18 | Hanging Man (confirmed) | Reversal | 55–60% | 50–58% |
| 19 | Standard Doji | Neutral | 50–55% | 48–54% |
| 20 | Spinning Top | Neutral | 48–52% | 45–52% |
| 21 | Tweezer Top/Bottom | Reversal | 55–60% | 48–55% |
| 22 | Separating Lines | Continuation | 55–60% | 48–53% |

**Key finding (Morris Chapter 7):** All patterns improved significantly when:
1. Combined with RSI divergence confirmation: +8–12% WR
2. Combined with volume expansion on signal candle: +6–10% WR
3. Context filter (pattern at support/resistance): +10–15% WR
4. Trend filter (trading with higher timeframe bias): +5–8% WR

**Academic crypto research (IEEE 2021, MDPI 2024):** Standalone candlestick patterns
in crypto showed 48–55% accuracy on 15M–1H timeframes — barely above random. When
filtered by trend context + volume, accuracy rose to 58–65%. When combined with
support/resistance and volume indicators, 62–68%.

---

## Volume Confirmation (Morris Framework)

Morris treats volume as the single most important confirmation factor:

### Volume rules for each pattern category:

**Reversal patterns at bottoms (Hammer, Engulfing, Morning Star):**
```
// Volume signature for genuine bottom reversal
C_signal.volume >= avg_volume_20 * 1.5   // at minimum
C_signal.volume >= avg_volume_20 * 2.0   // strong confirmation
```

**Reversal patterns at tops (Shooting Star, Dark Cloud, Evening Star):**
```
// Volume on exhaustion candle
C_signal.volume >= avg_volume_20 * 1.3   // even modest volume increase is meaningful
// because distribution tops often form on declining volume
```

**Continuation patterns (Three White Soldiers, Rising Three Methods):**
```
// Volume should expand on breakout candle
C_final.volume >= avg_volume_20 * 1.2
// Inner pullback candles should have LOWER volume than thrust candles
avg(C2.vol, C3.vol, C4.vol) < C1.volume * 0.7  // in Rising Three Methods
```

**Morris's filtering framework:**
He found that filtering candlestick signals through complementary indicators reduced
false signals by 30–40% while reducing total signals by 20–30% — a net positive for
system performance. His preferred filters:
1. MACD crossing signal line (trend/momentum)
2. RSI extremes (30/70 levels)
3. Bollinger %B (price position within bands)
4. Volume ratio (above/below 20-bar average)

---

## Candlestick Patterns in Crypto Markets

### Key differences from traditional stock markets

**1. 24/7 trading — no true gaps:**
In stocks, gaps between close and next-day open are common and meaningful. In crypto,
gaps only appear between exchange sessions (weekends on some platforms) and are rare
on spot. This affects:
- Morning/Evening Star patterns (gap between C1 and C2 is the ideal; in crypto, "star"
  is often just a small candle without a gap)
- Mat Hold pattern reliability is reduced
- Piercing Line / Dark Cloud Cover lose the gap-open component

**Crypto adaptation:**
```
// Relax gap requirement for crypto patterns
// Instead of actual gap, require "significant separation"
separation_threshold = 0.001 * C1.close  // 0.1% price difference vs open/close

// Morning Star without gap (crypto-adapted)
morning_star_crypto:
  max(C2.open, C2.close) <= C1.close + separation_threshold  // near or below C1 close
  (not required to be strictly below)
```

**2. Higher volatility and wider ATR:**
BTC: ATR/price typically 0.25–0.40% on 15M
ETH: ATR/price typically 0.38–0.45% on 15M
SOL: ATR/price typically 0.55–0.75% on 15M

This means body/wick thresholds need ATR-normalization, not fixed percentages:
```
// ATR-normalized body threshold (preferred over fixed ratio for crypto)
is_large_body = (close - open) >= atr_14 * 0.8     // substantial candle
is_small_body = abs(close - open) <= atr_14 * 0.3  // small candle
is_long_wick  = upper_wick >= atr_14 * 0.6         // significant wick
```

**3. Funding rate and liquidation cascade dynamics:**
Crypto futures have periodic funding rate payments (8-hour intervals on Bybit).
Large liquidation events create instant marubozu candles that look like Three Black
Crows in one bar. These are noise, not signal.

Detection filter for liquidation spikes:
```
// Avoid acting on extreme volume spikes that aren't pattern-based
spike_filter:
  candle.volume > avg_volume_20 * 5.0   // 5x normal volume = liquidation cascade
  // Skip pattern signal when spike_filter is true
```

**4. Retail-driven wick hunting (especially SOL, high-beta alts):**
Market makers on crypto exchanges use stop-hunt wicks that create false hammers,
shooting stars, and pinbars. These look identical to genuine reversal patterns but
reverse immediately.

Counter-filter for stop-hunt wicks:
```
// If wick exceeds 3× ATR, likely stop-hunt rather than genuine sentiment
stop_hunt_filter:
  lower_wick > atr_14 * 3.0             // suspicious wick length
  OR upper_wick > atr_14 * 3.0
  AND volume NOT significantly above average  // no real volume behind the move
```

**5. Session-specific patterns:**
Asia session (00:00–08:00 UTC): lower volume, patterns form more cleanly but have
less follow-through.
London session (08:00–16:00 UTC): higher reliability, institutional participation.
NY session (13:00–21:00 UTC): highest volume, most reliable pattern confirmation.

Pattern reliability multiplier by session:
- Asia only: reduce confidence 15%
- London/NY overlap: increase confidence 10%
- Weekend: reduce confidence 20%

**6. Bitcoin correlation (for altcoins):**
Candlestick patterns on altcoins that conflict with BTC's current direction have
significantly reduced reliability. A bullish engulfing on SOLUSDT is far less reliable
if BTCUSDT is in a bearish structure.

BTC correlation filter:
```
// For alt patterns: verify BTC alignment
btc_bias = get_htf_structure(BTCUSDT, 4H)  // bullish or bearish
if alt_signal.direction != btc_bias:
  reduce_confidence(alt_signal, 30%)
  require higher confluence_score threshold
```

---

## Algorithmic Detection — Implementation Reference

### Universal helper functions

```typescript
interface Candle {
  open: number;
  high: number;
  close: number;
  low: number;
  volume: number;
  timestamp: number;
}

// Core measurements
function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function totalRange(c: Candle): number {
  return c.high - c.low;
}

function upperWick(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

function bodyRatio(c: Candle): number {
  return totalRange(c) > 0 ? bodySize(c) / totalRange(c) : 0;
}

// ATR-14 helper (for context)
function calcATR14(candles: Candle[]): number {
  const trueRanges = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });
  return trueRanges.slice(-14).reduce((a, b) => a + b, 0) / 14;
}

// Volume average
function avgVolume(candles: Candle[], period = 20): number {
  return candles.slice(-period).reduce((sum, c) => sum + c.volume, 0) / period;
}
```

### Pattern detection functions

```typescript
// DOJI
function isDoji(c: Candle): boolean {
  const range = totalRange(c);
  if (range === 0) return false;
  return bodySize(c) / range <= 0.05;
}

function isGravestoneDoji(c: Candle): boolean {
  if (!isDoji(c)) return false;
  const range = totalRange(c);
  return upperWick(c) >= range * 0.6 && lowerWick(c) <= range * 0.1;
}

function isDragonflyDoji(c: Candle): boolean {
  if (!isDoji(c)) return false;
  const range = totalRange(c);
  return lowerWick(c) >= range * 0.6 && upperWick(c) <= range * 0.1;
}

// HAMMER
function isHammer(c: Candle, atr: number): boolean {
  const body = bodySize(c);
  const lower = lowerWick(c);
  const upper = upperWick(c);
  const range = totalRange(c);
  return (
    lower >= body * 2.0 &&              // lower wick >= 2x body
    upper <= range * 0.1 &&             // minimal upper wick
    body <= range * 0.35 &&             // small body in upper range
    range >= atr * 0.5                  // not a micro-candle
  );
}

// SHOOTING STAR
function isShootingStar(c: Candle, atr: number): boolean {
  const body = bodySize(c);
  const upper = upperWick(c);
  const lower = lowerWick(c);
  const range = totalRange(c);
  return (
    upper >= body * 2.0 &&
    lower <= range * 0.1 &&
    body <= range * 0.35 &&
    range >= atr * 0.5
  );
}

// MARUBOZU
function isMarubozu(c: Candle): boolean {
  const range = totalRange(c);
  if (range === 0) return false;
  return (
    upperWick(c) <= range * 0.03 &&
    lowerWick(c) <= range * 0.03
  );
}

// BULLISH ENGULFING
function isBullishEngulfing(c1: Candle, c2: Candle): boolean {
  return (
    isBearish(c1) &&
    isBullish(c2) &&
    c2.open <= c1.close &&
    c2.close >= c1.open
  );
}

// HARAMI
function isBullishHarami(c1: Candle, c2: Candle): boolean {
  const c1Body = bodySize(c1);
  const c2Body = bodySize(c2);
  return (
    isBearish(c1) &&
    isBullish(c2) &&
    c2.open >= c1.close &&
    c2.close <= c1.open &&
    c2Body <= c1Body * 0.5
  );
}

// MORNING STAR
function isMorningStar(c1: Candle, c2: Candle, c3: Candle, atr: number): boolean {
  const c1Midpoint = (c1.open + c1.close) / 2;
  const c1Body = c1.open - c1.close;  // bearish: open > close
  const c2Body = bodySize(c2);

  return (
    isBearish(c1) &&
    c1Body >= atr * 0.7 &&             // substantial C1
    c2Body <= c1Body * 0.4 &&          // small C2 body
    Math.max(c2.open, c2.close) <= c1.close * 1.001 &&  // C2 near/below C1
    isBullish(c3) &&
    c3.close >= c1Midpoint             // C3 closes above C1 midpoint
  );
}

// THREE WHITE SOLDIERS
function isThreeWhiteSoldiers(
  c1: Candle, c2: Candle, c3: Candle, atr: number
): boolean {
  const c1Body = c1.close - c1.open;
  const c2Body = c2.close - c2.open;
  const c3Body = c3.close - c3.open;

  const upperWickPct = (c: Candle): number => {
    const body = c.close - c.open;
    return body > 0 ? upperWick(c) / body : 1;
  };

  return (
    isBullish(c1) && isBullish(c2) && isBullish(c3) &&
    c2.close > c1.close && c3.close > c2.close &&
    c2.open >= c1.open && c2.open <= c1.close &&   // opens inside prior body
    c3.open >= c2.open && c3.open <= c2.close &&
    upperWickPct(c1) <= 0.2 &&                     // close near highs
    upperWickPct(c2) <= 0.2 &&
    upperWickPct(c3) <= 0.2 &&
    c2Body >= c1Body * 0.7 &&                      // consistent body sizes
    c3Body >= c2Body * 0.7 &&
    c1Body >= atr * 0.5                             // minimum thrust size
  );
}
```

---

## Actionable Insights for Our Bot

### Integration with SMC confluence scorer

Candlestick patterns should be added as a **secondary confirmation layer** in our
confluence scorer — not as a standalone signal source. Morris's research and crypto
backtests both confirm: patterns alone are insufficient. But patterns that align with
OBs, FVGs, and structure breaks dramatically increase confidence.

**Recommended implementation approach:**

1. **Add CandlePatternAnalyzer** as a new indicator module:
   - File: `src/indicators/classic/candle-patterns.ts`
   - Outputs: `{patternName, direction, reliability, strengthScore}`

2. **Integrate as bonus points in confluence scorer:**
```
// Current max: 100 points
// Proposed: candlestick bonus up to +10 points

CandlePatternBonus:
  Tier 1 patterns at OB/FVG level (+10 pts):
    - Three White/Black Soldiers
    - Morning/Evening Star (Doji variant)
    - Three Outside Up/Down

  Tier 2 patterns at OB/FVG level (+7 pts):
    - Morning/Evening Star (regular)
    - Bullish/Bearish Engulfing (with volume)
    - Three Inside Up/Down

  Tier 3 patterns at OB/FVG level (+5 pts):
    - Hammer/Shooting Star (confirmed)
    - Harami Cross
    - Piercing Line / Dark Cloud Cover

  Tier 4 (context only, no bonus, but mention in signal):
    - Standard Doji
    - Spinning Top
    - Tweezer (at exact OB high/low)
```

3. **Volume filter (mandatory for all patterns):**
```
pattern_valid = pattern_detected AND
  current_volume >= avg_volume_20 * 1.3  // minimum 1.3x volume
```

4. **Context filter (mandatory for all patterns):**
```
// Pattern only counts if at meaningful level
context_valid = (
  price_at_order_block OR
  price_at_fvg OR
  price_at_swing_high_low OR
  price_at_liquidity_zone
)
```

5. **Crypto-specific adjustments for 15M timeframe:**
   - No gap requirement for star patterns
   - ATR-normalize all body/wick thresholds
   - Apply session bonus/penalty (London/NY: +5%, Asia: -10%)
   - Apply BTC correlation filter for altcoin signals

6. **Pattern filtering over raw detection:**
   Following Morris's filtering framework, never trade a pattern signal alone.
   Our existing SMC filters (OB, FVG, structure, premium/discount) already serve
   as the "indicator filter" Morris recommends. The combination should yield 65–75%
   WR on qualifying setups.

### Priority patterns to implement first

Given our 15M timeframe and SMC confluence system, the highest-value patterns are:

| Priority | Pattern | Why |
|----------|---------|-----|
| P1 | Bullish/Bearish Engulfing | Most common, good reliability at OB |
| P1 | Morning/Evening Star | Strong reversal at FVG/OB confluence |
| P2 | Hammer/Shooting Star | Good as OB candle confirmation |
| P2 | Three White/Black Soldiers | Trend continuation at FVG fill |
| P3 | Harami Cross | Indecision at OB = accumulation signal |
| P3 | Marubozu detection | Identifies impulse candles → creates OBs |

### What NOT to use

Based on Morris's own reliability findings and crypto market research:
- Tweezer patterns (reliability below 60%, too much noise in crypto)
- Separating Lines (55%, poor standalone signal)
- Standard Doji in ranging markets (random)
- Any pattern during extreme volume spikes (>5x avg = liquidation cascade)
- Any pattern on Four-Price Doji candles (illiquid period, data quality issue)

---

## Summary

Gregory Morris's core insight is that candlestick patterns provide a timing signal —
not an edge in themselves. The edge comes from context: trend, volume, and
support/resistance. In crypto specifically, academic research confirms standalone
pattern reliability is 48–55% (barely above random). With proper filters, this rises
to 62–68%. Combined with our existing SMC framework (OBs, FVGs, structure, liquidity),
the combination should target 68–75% WR on qualifying signals.

The implementation priority is: context first, pattern second. A Morning Star at a
pristine Order Block with volume is a high-quality signal. A Morning Star in the
middle of a ranging session with average volume is noise.

---

**Sources:**
- Morris, G.L. "Candlestick Charting Explained" (McGraw-Hill, 3rd ed. 2006) — Chapters 2-8
- [QuantifiedStrategies — Complete Backtest of 75 Candlestick Patterns](https://www.quantifiedstrategies.com/the-complete-backtest-of-all-75-candlestick-patterns/)
- [IEEE — Do Candlestick Patterns Work in Cryptocurrency Trading?](https://ieeexplore.ieee.org/document/9671826/)
- [MDPI — Candlestick Pattern Recognition in Cryptocurrency Using Rule-Based Methods](https://www.mdpi.com/2079-3197/12/7/132)
- [TA-Lib Pattern Recognition Functions Reference](https://ta-lib.github.io/ta-lib-python/func_groups/pattern_recognition.html)
- [Altrady — Most Reliable Candlestick Patterns](https://www.altrady.com/crypto-trading/technical-analysis/candlestick-pattern-most-reliable)

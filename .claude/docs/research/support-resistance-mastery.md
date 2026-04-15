# Support & Resistance Mastery

**Date:** 2026-04-06
**Sources:** Momoh S.O. "Resistance & Support Mastery", LuxAlgo, MDPI Research, MQL5 Articles, multiple technical analysis resources

---

## Overview

Support and Resistance (S/R) are the foundational building blocks of price action analysis. As documented by MOMOH S.O. in "Resistance & Support Mastery: The Ultimate Entry/Exit Trade Signal for Consistent Profitability," these are not merely horizontal lines on a chart — they are **price memory zones** where the market previously made a decision, and where it is likely to make one again.

For an algorithmic trading bot, S/R is not decorative — it is an active filter and signal generator. A price approaching a high-strength S/R level is a qualitatively different event from price moving through open space.

---

## Types of S/R Levels

### 1. Static (Horizontal) S/R

The most fundamental type. A fixed price zone derived from historical swing highs and swing lows where the market reversed, consolidated, or accelerated.

**Characteristics:**
- Does not change with time — the level is anchored to a price
- Strongest when tested multiple times and rejected
- A level that held 3+ times on a high timeframe (Weekly/Daily) carries extreme institutional memory
- Weakens with each test: after 4–5 touches, liquidity at that level is depleted and a breakout becomes more likely

**Detection algorithm (swing-based):**
```typescript
function findStaticLevels(candles: Candle[], lookback = 5): SRLevel[] {
  const levels: SRLevel[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const isSwingHigh = candles.slice(i - lookback, i + lookback + 1)
      .every((c, idx) => idx === lookback || c.high <= candles[i].high);
    const isSwingLow = candles.slice(i - lookback, i + lookback + 1)
      .every((c, idx) => idx === lookback || c.low >= candles[i].low);
    if (isSwingHigh) levels.push({ price: candles[i].high, type: 'resistance', barIndex: i });
    if (isSwingLow)  levels.push({ price: candles[i].low,  type: 'support',    barIndex: i });
  }
  return levels;
}
```

### 2. Dynamic S/R (Moving Average-Based)

Dynamic levels shift with each new candle, following the trend. They do not predict a fixed price — they define a zone that moves.

**Key dynamic levels:**
- **EMA 20** — Short-term dynamic S/R, used by scalpers and 15M traders
- **EMA 50** — Intermediate trend dynamic S/R, most widely watched
- **EMA 200** — Macro dynamic S/R, watched by institutional desks
- **Bollinger Bands** — Upper/lower bands act as dynamic overbought/oversold S/R

**Important finding from research:** Dynamic levels are weaker than horizontal static levels in isolation. However, when a dynamic level (e.g., EMA 200) aligns with a static horizontal zone, it creates a **confluence zone** of significantly higher probability. This alignment is what we want to detect algorithmically.

**Detection:**
```typescript
function getDynamicLevels(candles: Candle[]): DynamicLevel {
  return {
    ema20:  calcEMA(candles, 20).at(-1),
    ema50:  calcEMA(candles, 50).at(-1),
    ema200: calcEMA(candles, 200).at(-1),
  };
}
```

### 3. S/R Flip Levels (Polarity Change)

One of the most powerful concepts in all of technical analysis. When a support level is broken decisively, it becomes resistance — and vice versa. The logic: the traders who were long at the support level are now trapped. When price returns to that level, they want to exit at breakeven, creating selling pressure that turns the old support into new resistance.

**Conditions for a valid S/R flip:**
1. Level must have functioned as S or R at least twice (proven it was a real level)
2. Breakout must be decisive — close beyond the level, not just a wick
3. Retest from the other side confirms the flip (price approaches from below old support → resistance holds)
4. Time between break and retest matters: the shorter, the more reliable the flip

**Quantified strength of flip:** A flip is stronger when the original level had more touches. An S/R level with 4 touches that flips and holds on retest is an extremely high-conviction setup.

```typescript
function detectSRFlip(
  levels: SRLevel[],
  currentCandles: Candle[],
  tolerance = 0.003 // 0.3%
): SRFlip[] {
  const flips: SRFlip[] = [];
  for (const level of levels) {
    const lastCandle = currentCandles.at(-1)!;
    const priceNearLevel = Math.abs(lastCandle.close - level.price) / level.price < tolerance;
    if (level.type === 'support' && lastCandle.close < level.price * (1 - tolerance)) {
      // Support broken → now resistance
      flips.push({ price: level.price, newType: 'resistance', originalTouches: level.touches });
    }
    if (level.type === 'resistance' && lastCandle.close > level.price * (1 + tolerance)) {
      // Resistance broken → now support
      flips.push({ price: level.price, newType: 'support', originalTouches: level.touches });
    }
  }
  return flips;
}
```

### 4. Trendline S/R (Diagonal)

Sloped levels connecting swing highs (descending resistance) or swing lows (ascending support). Less reliable than horizontal levels for algorithmic detection due to ambiguity in endpoint selection. Useful as a secondary confirmation but not recommended as a primary signal generator in automated systems.

### 5. Fibonacci-Derived S/R

Retracement levels (23.6%, 38.2%, 50%, 61.8%, 78.6%) from significant swing moves. The 61.8% (golden ratio) is the most respected. These are semi-static — they derive from a specific swing and remain fixed until a new significant swing is identified.

**Key insight:** Fibonacci levels are only meaningful when they **cluster with other S/R types** (horizontal level + 61.8% fib + EMA = very high strength zone).

---

## Algorithmic S/R Detection

### The Clustering Approach

The most robust programmatic method for identifying S/R zones is **price level clustering**. Individual swing points are noisy — zones are meaningful.

**Algorithm:**
```typescript
interface RawLevel {
  price: number;
  barIndex: number;
  type: 'high' | 'low';
  timeframe: string;
}

function clusterLevels(
  rawLevels: RawLevel[],
  clusterTolerance = 0.005, // 0.5% price range = one zone
  totalBars: number
): SRZone[] {
  // Sort by price
  const sorted = [...rawLevels].sort((a, b) => a.price - b.price);
  const zones: SRZone[] = [];
  let cluster: RawLevel[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const pctDiff = Math.abs(curr.price - prev.price) / prev.price;

    if (pctDiff <= clusterTolerance) {
      cluster.push(curr);
    } else {
      zones.push(buildZone(cluster, totalBars));
      cluster = [curr];
    }
  }
  if (cluster.length > 0) zones.push(buildZone(cluster, totalBars));

  return zones;
}

function buildZone(cluster: RawLevel[], totalBars: number): SRZone {
  const prices = cluster.map(c => c.price);
  const centerPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const mostRecentBar = Math.max(...cluster.map(c => c.barIndex));
  const recencyScore = mostRecentBar / totalBars; // 0..1, higher = more recent

  return {
    price: centerPrice,
    low: Math.min(...prices),
    high: Math.max(...prices),
    touches: cluster.length,
    recencyScore,
    timeframes: [...new Set(cluster.map(c => c.timeframe))],
  };
}
```

### Fractal-Based Detection

Williams Fractals offer a clean, parameter-free baseline for swing detection:
- **Fractal High:** `candle[i].high > candle[i-2].high && candle[i].high > candle[i-1].high && candle[i].high > candle[i+1].high && candle[i].high > candle[i+2].high`
- **Fractal Low:** mirror condition

Fractals are more conservative than simple lookback swings and produce fewer but higher-quality pivot points for clustering.

---

## Volume Profile Analysis

Volume Profile answers the critical question that price charts cannot: **at which prices did the market actually transact the most volume?** This reveals where institutional participants built positions.

### Key Components

**Point of Control (POC)**
The single price level with the highest traded volume over a defined period. Acts as the gravitational center — price tends to return to POC. In sideways markets, POC is the fair value center. In trending markets, the gap between current price and POC indicates trend strength.

**Value Area (VA)**
The price range containing 70% of all traded volume. The upper bound is **Value Area High (VAH)** and lower bound is **Value Area Low (VAL)**. Analogous to one standard deviation around the mean in a normal distribution of volume.

**High Volume Nodes (HVN)**
Peaks in the volume distribution at specific price levels. Represent zones of strong agreement between buyers and sellers — "fair value" areas. Price tends to slow down and consolidate in HVNs. These are strong S/R zones.

**Low Volume Nodes (LVN)**
Valleys in the volume distribution. Represent zones of rapid price movement — price skipped through quickly with little agreement. LVNs act as thin air — price tends to accelerate through them. Key insight: an LVN between a current price and a target is a "highway" — there is little historical resistance until the next HVN.

### Volume Profile as S/R Generator

```typescript
interface VolumeProfileLevel {
  price: number;           // price bucket midpoint
  volume: number;          // total volume at this price
  volumePct: number;       // % of session total volume
  type: 'HVN' | 'LVN' | 'POC' | 'VAH' | 'VAL' | 'normal';
}

function buildVolumeProfile(
  candles: Candle[],
  priceBuckets = 100
): VolumeProfileLevel[] {
  const priceMin = Math.min(...candles.map(c => c.low));
  const priceMax = Math.max(...candles.map(c => c.high));
  const bucketSize = (priceMax - priceMin) / priceBuckets;
  const profile = new Array(priceBuckets).fill(0);

  for (const candle of candles) {
    // Distribute candle volume across price range uniformly
    const startBucket = Math.floor((candle.low - priceMin) / bucketSize);
    const endBucket   = Math.floor((candle.high - priceMin) / bucketSize);
    const bucketsInCandle = Math.max(1, endBucket - startBucket);
    const volPerBucket = candle.volume / bucketsInCandle;
    for (let b = startBucket; b <= Math.min(endBucket, priceBuckets - 1); b++) {
      profile[b] += volPerBucket;
    }
  }

  const totalVolume = profile.reduce((a, b) => a + b, 0);
  const pocIndex = profile.indexOf(Math.max(...profile));

  // Find Value Area: 70% of volume centered on POC
  let vaVolume = profile[pocIndex];
  let vaLow = pocIndex, vaHigh = pocIndex;
  while (vaVolume < totalVolume * 0.7) {
    const expandDown = vaLow > 0 ? profile[vaLow - 1] : 0;
    const expandUp   = vaHigh < priceBuckets - 1 ? profile[vaHigh + 1] : 0;
    if (expandDown >= expandUp) vaLow--;
    else vaHigh++;
    vaVolume += Math.max(expandDown, expandUp);
  }

  const avgVolume = totalVolume / priceBuckets;
  const hvnThreshold = avgVolume * 1.5;
  const lvnThreshold = avgVolume * 0.5;

  return profile.map((vol, i) => ({
    price: priceMin + (i + 0.5) * bucketSize,
    volume: vol,
    volumePct: vol / totalVolume,
    type: i === pocIndex ? 'POC'
        : i === vaHigh   ? 'VAH'
        : i === vaLow    ? 'VAL'
        : vol > hvnThreshold ? 'HVN'
        : vol < lvnThreshold ? 'LVN'
        : 'normal',
  }));
}
```

### Practical Volume Profile Rules for BTCUSDT

1. **Price returning to POC from either side** → expect a bounce or consolidation; treat as support/resistance
2. **Price at VAL in an uptrend** → high-probability long entry zone (institutional value buyers step in)
3. **Price at VAH in a downtrend** → high-probability short zone (institutions sell into perceived overvaluation)
4. **LVN between entry and target** → reduced friction, wider TP targets justified
5. **HVN between entry and target** → expect deceleration; consider taking partial profits at the HVN

---

## S/R Strength Ranking Algorithm

The central challenge: not all S/R levels are equal. A bot needs a **numerical score** to rank levels and decide which ones matter.

### Scoring Factors

| Factor | Weight | Rationale |
|--------|--------|-----------|
| Touch count | High | Each confirmed rejection reinforces institutional memory |
| Timeframe of origin | High | Weekly > Daily > 4H > 1H > 15M |
| Recency | Medium | Recent levels carry more live order memory than ancient ones |
| Volume at level | High | Volume confirms institutional participation |
| Clean rejection (wick/body ratio) | Medium | A sharp rejection shows strong conviction |
| S/R flip status | High | Flip levels have dual memory (both sides tested) |
| Confluence with other types | High | Fib + HVN + horizontal = multiply strength |

### Full Strength Scoring Function

```typescript
interface SRZone {
  price: number;
  low: number;
  high: number;
  touches: number;
  timeframe: '15m' | '1h' | '4h' | '1d' | '1w';
  barsSinceLastTouch: number;
  totalBarsInDataset: number;
  avgRejectionWickRatio: number;  // wick vs body size at rejections
  volumeAtLevel: number;          // from volume profile
  avgVolumeOfDataset: number;
  isFlipLevel: boolean;
  confluenceCount: number;        // how many other S/R types align here
}

function scoreLevel(zone: SRZone): number {
  let score = 0;

  // 1. Touch count (max 25 pts)
  // Sweet spot: 3-5 touches. More than 5 = potentially depleted
  const touchScore = zone.touches <= 5
    ? Math.min(zone.touches * 5, 25)
    : Math.max(25 - (zone.touches - 5) * 2, 10);
  score += touchScore;

  // 2. Timeframe weight (max 20 pts)
  const tfWeights = { '15m': 4, '1h': 8, '4h': 14, '1d': 18, '1w': 20 };
  score += tfWeights[zone.timeframe];

  // 3. Recency (max 15 pts)
  const recencyRatio = 1 - (zone.barsSinceLastTouch / zone.totalBarsInDataset);
  score += recencyRatio * 15;

  // 4. Volume confirmation (max 20 pts)
  const volumeRatio = zone.volumeAtLevel / zone.avgVolumeOfDataset;
  score += Math.min(volumeRatio * 10, 20);

  // 5. Rejection quality (max 10 pts)
  // High wick-to-body ratio at rejections = clean, sharp rejection
  score += Math.min(zone.avgRejectionWickRatio * 5, 10);

  // 6. S/R flip bonus (10 pts)
  if (zone.isFlipLevel) score += 10;

  // 7. Confluence bonus (max 15 pts)
  score += Math.min(zone.confluenceCount * 5, 15);

  return Math.min(score, 100);
}
```

### Level Classification by Score

| Score | Classification | Trading Use |
|-------|---------------|-------------|
| 80–100 | Tier 1 (Institutional) | High-conviction entry zone; tight SL acceptable |
| 60–79  | Tier 2 (Significant)   | Valid confluence add; moderate position |
| 40–59  | Tier 3 (Moderate)      | Use as TP target or secondary filter only |
| 0–39   | Tier 4 (Noise)         | Ignore for trading decisions |

---

## Multi-Timeframe Confluence

The core principle: **a level that appears on multiple timeframes is more powerful than one that exists on a single timeframe.** A price zone that is support on both the 4H and Daily chart carries the memory of both timeframes' participants.

### MTF S/R Detection Methodology

```typescript
interface MTFLevel {
  price: number;
  timeframes: string[];   // ['4h', '1d'] = confirmed on both
  confluenceScore: number;
  type: 'support' | 'resistance' | 'dual';
}

function buildMTFLevels(
  levelsByTimeframe: Record<string, SRZone[]>,
  priceTolerance = 0.005 // 0.5% = same zone across TFs
): MTFLevel[] {
  const allLevels = Object.entries(levelsByTimeframe)
    .flatMap(([tf, zones]) => zones.map(z => ({ ...z, tf })));

  const mtfLevels: MTFLevel[] = [];

  for (const anchor of allLevels) {
    const matching = allLevels.filter(
      l => Math.abs(l.price - anchor.price) / anchor.price < priceTolerance
    );
    const uniqueTFs = [...new Set(matching.map(l => l.tf))];
    if (uniqueTFs.length >= 2) {
      mtfLevels.push({
        price: anchor.price,
        timeframes: uniqueTFs,
        confluenceScore: uniqueTFs.length * 20 + matching.length * 5,
        type: anchor.type === 'support' ? 'support' : 'resistance',
      });
    }
  }

  // Deduplicate
  return mtfLevels.filter((l, i) =>
    mtfLevels.findIndex(
      m => Math.abs(m.price - l.price) / l.price < priceTolerance
    ) === i
  );
}
```

### Timeframe Cascade (Bias → Structure → Entry)

Following standard SMC methodology applied to S/R:
- **Weekly/Daily** → Defines macro S/R zones (institutional positioning)
- **4H** → Intermediate structure, trend context
- **1H** → Confirms intermediate S/R within the macro bias
- **15M** → Entry timeframe — look for price behavior at the 4H+ S/R zone

**Rule:** Only take 15M entries when price is at a level confirmed on 4H or higher. A 15M-only level is low priority.

### Confluence Matrix

| 15M at... | 1H confirms | 4H confirms | Daily confirms | Action |
|-----------|------------|------------|----------------|--------|
| S/R touch | No | No | No | Skip |
| S/R touch | Yes | No | No | Low priority |
| S/R touch | Yes | Yes | No | Valid entry zone |
| S/R touch | Yes | Yes | Yes | High-conviction entry |

---

## Round Number Effect in Crypto

### The Psychology

Round numbers (integers divisible by 1000, 5000, 10000 for BTC) represent **psychological price magnets**. Multiple forces converge at these levels:

1. **Retail order clustering** — Traders place limit orders, stop losses, and take profits at "clean" numbers because they are cognitively easier to remember and communicate
2. **Option strike clustering** — Derivatives market participants (CME, Deribit) anchor contracts at round strikes; large open interest at these strikes creates gamma exposure that dealers must hedge
3. **Media attention** — Financial media obsesses over round number milestones ("Bitcoin hits $100,000"), which creates new retail FOMO/fear around these levels
4. **Institutional benchmark anchoring** — Fund managers and analysts use round numbers in forecasts and position sizing calculations

### Bitcoin-Specific Levels

For BTCUSDT, the psychological level hierarchy:
- **Tier 1 (Major):** $10,000 multiples — $70K, $80K, $90K, $100K, $110K
- **Tier 2 (Significant):** $5,000 multiples — $75K, $85K, $95K, $105K
- **Tier 3 (Minor):** $1,000 multiples — $81K, $82K, $83K

**Research finding:** Bitcoin spent only 28 days in the $70,000–$80,000 range over 5 years. This thin historical volume means round number levels in this region have psychological significance but weaker volume-based support. This makes them reactive rather than structural.

### Algorithmic Round Number Detection

```typescript
function isNearRoundNumber(
  price: number,
  symbol: 'BTCUSDT' | string
): { isNear: boolean; level: number; tier: 1 | 2 | 3; distancePct: number } {
  const roundLevels = symbol === 'BTCUSDT'
    ? [10000, 5000, 1000]  // Tier 1, 2, 3 spacing
    : [100, 50, 10];        // For altcoins

  for (let tier = 0; tier < roundLevels.length; tier++) {
    const spacing = roundLevels[tier];
    const nearestRound = Math.round(price / spacing) * spacing;
    const distancePct = Math.abs(price - nearestRound) / price;
    if (distancePct < 0.005) { // within 0.5%
      return { isNear: true, level: nearestRound, tier: (tier + 1) as 1|2|3, distancePct };
    }
  }
  return { isNear: false, level: 0, tier: 3, distancePct: 1 };
}
```

### Trading the Round Number Effect

- **Approaching from below:** Expect deceleration and potential reversal at round number. Reduce TP to just below the round number (e.g., TP at $99,700 instead of $100,200)
- **Breakout through round number:** If price closes convincingly above (especially on volume), the round number flips to support. First retest is a high-probability long entry
- **Initial test at round number:** Often rejected. Wait for volume confirmation before trading through

---

## Institutional S/R vs Retail S/R

### What Distinguishes Institutional Levels

**Institutional S/R characteristics:**
- Originates from Daily, Weekly, or Monthly timeframes
- Associated with significant volume (order block formation or large institutional accumulation/distribution)
- Clean price memory: when price returns after weeks or months, the reaction is sharp
- Often coincides with prior ATH/ATL, previous cycle peaks, or macro Fibonacci levels
- Visible in the orderbook as large resting orders (not available in standard candle data, requires Level 2)

**Retail S/R characteristics:**
- Typically formed on 1H or lower timeframes
- Lower volume at formation
- More noise — small fund traders and individual accounts
- More easily swept by institutional players hunting stop-losses

### S/R and the Liquidity Hunt

Institutional traders have a structural incentive to **trade against retail S/R**. Retail stop-losses cluster just below support and just above resistance. Institutions sweep these stops (fake breakout) to acquire liquidity at favorable prices before the real move.

**Implication for the bot:** A shallow penetration of a retail-level support that quickly reverses is often a **liquidity sweep** — a high-conviction entry signal in the direction of the reversal, not a signal to follow the fake breakout.

This is precisely what SMC's "Liquidity Sweep" indicator captures: if our existing liquidity detection triggers AND the price is near a significant S/R level (especially a round number or HTF zone), the combined signal is extremely high quality.

### Order Flow Confirmation at S/R

The Cumulative Volume Delta (CVD) provides the most reliable confirmation that institutional buying or selling is occurring at an S/R level:

- **CVD rising while price is at support** → buyers are absorbing sell pressure → high probability bounce
- **CVD falling while price is at resistance** → sellers are absorbing buy pressure → high probability rejection
- **CVD divergence** (price makes new high but CVD doesn't) at resistance → distribution → reversal likely

```typescript
function confirmSRWithCVD(
  candles: Candle[],
  level: SRZone,
  lookback = 10
): 'bullish_confirmation' | 'bearish_confirmation' | 'neutral' {
  const recent = candles.slice(-lookback);
  const nearLevel = recent.filter(c => {
    const midPrice = (c.high + c.low) / 2;
    return Math.abs(midPrice - level.price) / level.price < 0.005;
  });

  if (nearLevel.length === 0) return 'neutral';

  // Proxy: if volume spikes at level with bullish candles = buyers
  const bullishVolume = nearLevel.filter(c => c.close > c.open).reduce((s, c) => s + c.volume, 0);
  const bearishVolume = nearLevel.filter(c => c.close < c.open).reduce((s, c) => s + c.volume, 0);
  const ratio = bullishVolume / (bearishVolume + 1);

  if (ratio > 1.5) return 'bullish_confirmation';
  if (ratio < 0.67) return 'bearish_confirmation';
  return 'neutral';
}
```

---

## Crypto-Specific S/R Characteristics

### 24/7 Market — No Gaps, But CME Gaps Exist

Traditional stock markets create gaps on open. Bitcoin's spot market trades continuously, so gaps do not form on the spot chart. However, **CME Bitcoin Futures** trade only on weekdays, creating genuine gaps when the futures market reopens Sunday after the weekend.

**CME Gap Statistics:** 70–80% of CME gaps eventually fill. These levels function as S/R for institutional participants who trade via futures.

**Key implication for the bot:** Monitor active CME gaps. An unfilled gap below current price = a downside S/R target that will attract price. An unfilled gap above = potential resistance or bullish target depending on trend.

### Funding Rate Effect on S/R

In perpetual futures, extreme funding rates (positive > +0.1% or negative < -0.1%) create artificial pressure that distorts S/R. A level that appears to be holding as support may break purely because funding is forcing longs to exit. The bot's existing funding rate filter (skip when |funding| > 0.1%) handles this correctly.

### Altcoin Correlation Distortion

When BTC moves violently, altcoin S/R levels become temporarily meaningless — all alts move together regardless of their own structure. This correlation spike makes altcoin S/R trading unreliable during BTC high-volatility events.

**Recommendation:** For BTCUSDT specifically, this is not an issue. But for the multi-pair expansion (ETHUSDT, SOLUSDT), add a filter: skip alt S/R signals when BTC 15M ATR > 2× normal ATR.

### Liquidity Voids (Low Volume Nodes in Crypto)

Due to 24/7 trading and frequently extreme bull/bear cycles, Bitcoin often creates large LVNs — price zones that were crossed rapidly during bull runs or crashes with little actual volume traded there. These zones offer almost zero resistance to price. Examples: the $30K–$40K range after the 2020 run had very thin volume, causing price to traverse it extremely quickly both up and down.

**Detection:** Use volume profile across 1–2 year timeframe to identify macro LVNs vs HVNs. An LVN on the path between entry and TP means TP can be extended significantly.

---

## Actionable Insights for Our Bot

### Integration with Existing Confluence Scorer

The current `ConfluenceScorer` has 100 points across SMC + classic indicators. S/R analysis should be integrated as either:

**Option A: Separate S/R filter (binary)** — Only take signals when price is within X% of a Tier 1 or Tier 2 S/R level. All other signals are ignored.

**Option B: S/R as a scored component** — Replace or supplement the Premium/Discount (10 pts) component with a full S/R strength score contributing up to 15 pts.

Recommendation: **Option B**, upgrading Premium/Discount to a full S/R zone system.

### Proposed S/R Contribution to Confluence Score

```typescript
function scoreSRContext(
  price: number,
  srZones: SRZone[],
  side: 'long' | 'short',
  volumeProfile: VolumeProfileLevel[]
): number {
  let score = 0;

  // Find nearest relevant S/R zone
  const relevantZone = srZones
    .filter(z => side === 'long' ? z.type === 'support' : z.type === 'resistance')
    .filter(z => Math.abs(z.price - price) / price < 0.01) // within 1%
    .sort((a, b) => b.strength - a.strength)[0];

  if (!relevantZone) return 0;

  // Base: level strength tier
  if (relevantZone.strength >= 80) score += 15;       // Tier 1 Institutional
  else if (relevantZone.strength >= 60) score += 10;  // Tier 2
  else if (relevantZone.strength >= 40) score += 5;   // Tier 3

  // Bonus: confirmed on HTF (4H+)
  if (relevantZone.timeframes.some(tf => ['4h', '1d', '1w'].includes(tf))) score += 5;

  // Bonus: volume profile confirmation (HVN at level)
  const vpAtLevel = volumeProfile.find(
    vp => Math.abs(vp.price - relevantZone.price) / relevantZone.price < 0.005
  );
  if (vpAtLevel?.type === 'HVN' || vpAtLevel?.type === 'POC') score += 5;

  // Bonus: round number alignment
  const rn = isNearRoundNumber(relevantZone.price, 'BTCUSDT');
  if (rn.isNear && rn.tier === 1) score += 5;
  if (rn.isNear && rn.tier === 2) score += 3;

  // Penalty: too many touches (depleted)
  if (relevantZone.touches > 6) score -= 5;

  return Math.max(0, Math.min(score, 20));
}
```

### Concrete Rules for Implementation

**Rule 1 — Level freshness gate:** Do not use an S/R level for entry if it has been touched more than 6 times. Too many tests = depleted liquidity = breakout likely.

**Rule 2 — TP adjustment at round numbers:** If TP1 would land within 0.3% above a Tier 1 or 2 round number (for longs), set TP1 at the round number minus 0.2%. Round numbers attract profit-taking.

**Rule 3 — SL placement around S/R:** SL for a long should be placed below the nearest S/R support, not just below a fixed ATR multiple. `SL = zone.low - buffer`. This ensures the SL is structurally valid, not just arbitrary.

**Rule 4 — S/R flip confirmation:** When a support level is broken, do not immediately re-enter long at that level. Wait for price to retest from below (now acting as resistance) and fail to close above it before considering a short, OR wait for a reclaim with volume before re-entering long.

**Rule 5 — Volume profile targeting:** When calculating TP2/trailing stop target, identify the next major HVN above the entry (for longs) using the volume profile. This is where price will slow down and potentially reverse. Set TP2 just below that HVN, or tighten trailing stop when price enters the HVN zone.

**Rule 6 — CME gap tracking:** Maintain a list of unfilled CME gaps. If price is between a CME gap and our TP, reduce TP to the CME gap level (it acts as a magnet that may cause a reversal before our original TP).

**Rule 7 — MTF requirement:** Only enter when the S/R level is confirmed on at least 2 timeframes. A 15M-only S/R level is insufficient for entry confirmation.

### S/R Priority Hierarchy for BTCUSDT Bot

When multiple S/R levels exist near the entry, prioritize in this order:
1. Weekly/Daily S/R zone with volume confirmation (POC or HVN) — Tier 1
2. 4H S/R zone with 3+ touches — Tier 2
3. S/R flip level (polarity changed) — Tier 2+
4. Round number ($5K or $10K multiple) with high OI on Deribit/CME — Tier 2
5. Fibonacci 61.8% from recent significant swing — Tier 3
6. 1H S/R with 2+ touches — Tier 3
7. Dynamic EMA 200 alignment — Tier 3 (only when aligned with above)

---

## Summary

Support and Resistance mastery, as taught by Momoh S.O. and confirmed by quantitative research, reduces to three core insights for algorithmic implementation:

1. **S/R levels are not lines — they are zones with memory.** The strength of that memory is quantifiable: touches, timeframe, volume, recency, and confluence all contribute to a score.

2. **The most powerful setups occur where multiple S/R types converge.** A horizontal level + volume POC + round number + EMA 200 at the same price zone is not 4 reasons to trade — it is 4 independent sources of institutional memory pointing to the same price, compounding probability far beyond any individual factor.

3. **Institutional and retail S/R serve different functions.** Retail S/R levels are hunting grounds — institutions sweep retail stops below these levels to fill their own orders. Recognizing a liquidity sweep at a real institutional level (HTF, high volume, round number) is a high-conviction reversal signal — precisely the scenario that our existing SMC Liquidity Sweep indicator is designed to catch.

---

**Sources:**
- [MOMOH S.O. — Resistance & Support Mastery (Amazon)](https://www.amazon.com/RESISTANCE-SUPPORT-MASTERY-CONSISTENT-PROFITABILITY/dp/B0CNS448VP)
- [Support Resistance Levels towards Profitability in Intelligent Algorithmic Trading Models — MDPI Mathematics](https://www.mdpi.com/2227-7390/10/20/3888)
- [Analytical Volume Profile Trading (AVPT) — MQL5 Articles](https://www.mql5.com/en/articles/20327)
- [Static vs. Dynamic Support and Resistance Explained — LuxAlgo](https://www.luxalgo.com/blog/static-vs-dynamic-support-and-resistance-explained/)
- [Volume Profile Map: Where Smart Money Trades — LuxAlgo](https://www.luxalgo.com/blog/volume-profile-map-where-smart-money-trades/)
- [Cumulative Volume Delta (CVD) — Phemex Academy](https://phemex.com/academy/what-is-cumulative-delta-cvd-indicator)
- [Round Numbers Psychology in S/R — FasterCapital](https://fastercapital.com/content/Round-Numbers--The-Psychology-of-Round-Numbers-in-Support-and-Resistance-Level-Trading.html)
- [Bitcoin CME Gap Trading Guide — Bitget Academy](https://www.bitget.com/academy/cme-bitcoin-gap)
- [Multi-TimeFrame S/R w/ Strength Rating — TradingView](https://www.tradingview.com/script/joTGw5wM-Multi-TimeFrame-Support-and-Resistance-w-Strength-Rating/)
- [MTF Confluence Key Levels — GrandAlgo](https://grandalgo.com/indicators/mtf-confluence-key-levels)
- [Algorithmically Identifying S/R in Python — Medium](https://medium.com/@crisvelasquez/algorithmically-identifying-stock-price-support-resistance-in-python-b9095f9aa279)
- [Order Flow Trading: Delta and CVD — DayTradingProfitCalculator](https://www.daytradingprofitcalculator.com/blog/order-flow-trading-explained.html)
- [The Weekend Effect in Crypto Momentum — ACR Journal](https://acr-journal.com/article/the-weekend-effect-in-crypto-momentum-does-momentum-change-when-markets-never-sleep--1514/)
- [Bitcoin Support Levels Trading Guide — Stoic.ai](https://stoic.ai/blog/how-to-identify-bitcoin-support-and-resistance-levels-trading-guide/)

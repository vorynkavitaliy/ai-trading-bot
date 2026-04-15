# Demand & Supply Dynamics

**Date:** 2026-04-06
**Sources:**
- MOMOH S.O. "Demand and Supply Dynamics: The market force behind price movement" (Dec 2024)
- Sam Seiden — supply/demand methodology (Chicago Mercantile Exchange origin)
- PriceActionNinja: [RBR/DBD Guide](https://priceactionninja.com/trading-rally-base-rally-drop-base-drop-zones-complete-guide/)
- AlgoAlpha: [S&D Zone Detection](https://www.algoalpha.io/post/supply-and-demand-trading)
- ForexBee: [Order Block vs S&D](https://forexbee.co/order-block-vs-supply-and-demand-in-trading/)
- WritoFinance: [DBR Pattern](https://www.writofinance.com/drop-base-rally-dbr-reversal-pattern/)
- LuxAlgo: [S&D Zone Strategies](https://www.luxalgo.com/blog/supply-and-demand-zones-core-trading-strategies/)
- MAK Trading School: [Proximal/Distal Lines](https://maktradingschool.com/how-to-draw-proximal-and-distal-lines/)

---

## 1. Supply/Demand vs Traditional S/R

### Fundamental Conceptual Difference

Traditional support and resistance (S/R) are drawn from **swing highs and lows** — they encode price memory, the collective psychology of traders who remember "price bounced here before." S/R lines are points or thin levels. They tell you *where* price reacted, not *why*.

Supply and demand (S/D) zones are drawn from the **base of an impulsive move** — specifically, the consolidation candles immediately before an explosive departure. They encode **order imbalance**: the hypothesis that institutional participants left unfilled limit orders at that price cluster when the market ran away from the zone.

| Dimension | Traditional S/R | Supply/Demand Zones |
|---|---|---|
| Structure | Single horizontal line (a point) | Rectangle zone (proximal–distal range) |
| Formation logic | Swing high/low history | Base consolidation before impulse |
| Underlying theory | Trader psychology memory | Unfilled institutional pending orders |
| Strength decay | Weakens with each test | Weakens with each test (freshness critical) |
| Width | Zero (a line) | Proportional to base size (1–4 candles typical) |
| Directionality | Bidirectional (S becomes R, R becomes S) | Typed: demand zone or supply zone, pattern-specific |
| Entry precision | At the line | At proximal line (nearest edge to price) |
| Stop placement | Below/above the line | Beyond distal line (farthest edge) |

### The Institutional Order Hypothesis

Sam Seiden's core insight (from his time handling institutional order flow at the Chicago Mercantile Exchange) is that when a large institution places a massive buy or sell order, the market cannot absorb it all at once. Price runs away rapidly, leaving a cluster of unfilled limit orders behind in the base. When price later returns to that level, those pending orders are still waiting — they cause a reaction.

This explains why **fresh zones react so powerfully** — the orders haven't been consumed yet. It also explains why **tested zones weaken** — each touch fills more of the pending order book.

MOMOH S.O. frames this as the core market force: price is always moving toward equilibrium between demand (buying pressure) and supply (selling pressure). Zones are the physical locations where that imbalance became so extreme that it launched price explosively in one direction.

### Key Consequence for Algorithmic Implementation

- S/R levels are drawn after the fact from past wicks and bodies
- S/D zones are anchored to a specific structural event: an impulsive move departing from a base
- Algorithmically, detecting S/D zones requires identifying the **impulse first**, then locating the **base that preceded it**

---

## 2. Zone Identification Algorithm

### Step 1: Define Impulse

An **impulse** is a sequence of 2 or more consecutive directional candles with large bodies and small wicks, departing rapidly from a price area. For algorithmic detection:

```
Bullish Impulse:
  - 2+ consecutive bullish candles (close > open)
  - Combined move > impulseThreshold (e.g. 1.5× ATR(14))
  - Body-to-range ratio > 0.6 (large bodies, small wicks)
  - Candles do NOT overlap significantly (each closes near high)

Bearish Impulse:
  - 2+ consecutive bearish candles (close < open)
  - Combined move > impulseThreshold
  - Same body/wick criteria inverted
```

### Step 2: Locate the Base

Working backward from the first candle of the impulse, find the **base**: the consolidation that immediately preceded the impulse. Base criteria:

```
Base Candle(s):
  - 1 to 4 candles (ideally 1–2; more than 4 = weak zone)
  - Body size < 0.5× ATR(14) (small, indecisive candles)
  - Price range contained (high - low < 0.7× ATR(14))
  - Direction: ANY (base candles can be bullish or bearish)
  - Time limit: base must be immediately adjacent to impulse start
```

### Step 3: Define Proximal and Distal Lines

**Demand Zone (price came FROM below, impulse went UP):**
```
Single base candle:
  Proximal = base.high  (entry side, nearest to current price when price returns)
  Distal   = base.low   (stop side, farthest from current price)

Multiple base candles (2–4):
  Proximal = highest body high of all base candles
  Distal   = lowest body low of all base candles
  (Use BODY extremes, not wicks — wicks are noise)
```

**Supply Zone (price came FROM above, impulse went DOWN):**
```
Single base candle:
  Proximal = base.low   (entry side)
  Distal   = base.high  (stop side)

Multiple base candles (2–4):
  Proximal = lowest body low of all base candles
  Distal   = highest body high of all base candles
```

### Step 4: Validate Zone

```
Filter out:
  - Base with more than 4 candles (too much consolidation = not institutional)
  - Impulse strength < 1.5× ATR (too weak — could be noise)
  - Zone already mitigated (price has returned and closed inside zone)
  - Zone where price closed beyond distal line on retest
    (means zone was broken, not respected)
```

### Step 5: Zone Mitigation Tracking

A zone is **mitigated** (consumed) when:
- Price returns and a candle **closes inside** the zone body (beyond proximal line)

A zone is **broken** when:
- Price passes entirely through the zone (closes beyond distal line)
- Zone should be marked invalid and removed from active set

---

## 3. Zone Quality Scoring

Community consensus and research (AlgoAlpha, PriceActionNinja) converge on a multi-factor scoring approach for zones. Every active zone receives a score 0–100:

### Factor 1: Freshness (0–25 points)

The number of times price has returned to the zone (touches):

| Touches | Score | Rationale |
|---|---|---|
| 0 (never tested) | 25 | Full institutional order book intact |
| 1 | 18 | First test, still strong |
| 2 | 10 | Weakening, 50%+ of orders filled |
| 3 | 4 | Near exhaustion |
| 4+ | 0 | Zone functionally dead |

**Critical rule:** Only trade fresh zones (0 touches) or first-test zones (1 touch). Zones with 2+ touches have lower institutional order depth remaining.

### Factor 2: Departure Strength (0–25 points)

How aggressively price left the zone. Measured as the magnitude of the initial impulse:

```
impulse_pct = (impulse_end_price - zone_proximal) / zone_proximal × 100

Score:
  impulse_pct > 3%:    25 pts  (explosive institutional departure)
  impulse_pct 2–3%:    20 pts
  impulse_pct 1.5–2%:  15 pts
  impulse_pct 1–1.5%:  8 pts
  impulse_pct < 1%:    0 pts   (too weak — likely not institutional)
```

### Factor 3: Base Duration (0–20 points)

Time price spent in the base BEFORE the impulse. Tight bases = more concentrated orders:

| Base Candles | Score | Rationale |
|---|---|---|
| 1 candle | 20 | Maximum concentration — single-candle base is clearest signal |
| 2 candles | 16 | Very strong |
| 3 candles | 10 | Moderate |
| 4 candles | 5 | Acceptable minimum |
| 5+ candles | 0 | Too much time = distributed orders, weaker zone |

### Factor 4: Higher Timeframe Confluence (0–20 points)

Does the zone coincide with a zone on a higher timeframe?

| Confluence | Score |
|---|---|
| Zone aligns with 4H or Daily zone | 20 |
| Zone aligns with 1H zone | 12 |
| Zone stands alone on 15M only | 0 |
| Zone contradicts higher TF bias | -10 (penalty) |

### Factor 5: Zone Width Ratio (0–10 points)

Width of zone relative to ATR. Tight zones are more precise entries:

```
zone_width = distal - proximal
width_ratio = zone_width / ATR(14)

Score:
  width_ratio < 0.5:   10 pts  (tight, precise)
  width_ratio 0.5–1.0: 6 pts
  width_ratio 1.0–2.0: 3 pts
  width_ratio > 2.0:   0 pts   (too wide, imprecise entry)
```

### Factor 6: Volume at Departure (0 points baseline, binary bonus)

If volume data is available:
- Volume spike at impulse departure (> 2× 20-period average): +5 bonus points
- Normal volume: +0

### Total Score Interpretation

| Score | Zone Quality | Action |
|---|---|---|
| 75–100 | Tier 1 — Premium | High weight in confluence scoring |
| 50–74 | Tier 2 — Standard | Moderate weight, require other confluence |
| 25–49 | Tier 3 — Weak | Low weight only, do not trade alone |
| 0–24 | Invalid | Remove from active zones |

---

## 4. Pattern Types: RBR, DBD, RBD, DBR

### Rally-Base-Rally (RBR) — Demand Zone, Continuation

```
Structure: [Bullish impulse] → [Base 1–4 candles] → [Bullish impulse]
Type: DEMAND zone (bullish continuation)
Context: Price was already in an uptrend
Logic: Institution placed buy orders in the base, demand absorbed all supply,
       price continued upward
Location of demand zone: the BASE between the two rallies

Trade direction: LONG when price returns to the base
```

The RBR zone captures the demand accumulation during a brief pause in an uptrend. Institutionally, this represents "buying the dip" by large players who want to add to long positions. The zone is valid as long as the uptrend structure is intact.

**Algorithmic detection:**
```
1. Identify bullish impulse A (2+ up candles, > 1.5 ATR)
2. Identify subsequent base (1–4 small candles)
3. Identify bullish impulse B immediately after base (2+ up candles, > 1.5 ATR)
4. Zone = base range
5. Valid only if pattern appears in bullish market structure (no CHoCH before it)
```

### Drop-Base-Drop (DBD) — Supply Zone, Continuation

```
Structure: [Bearish impulse] → [Base 1–4 candles] → [Bearish impulse]
Type: SUPPLY zone (bearish continuation)
Context: Price was already in a downtrend
Logic: Institution placed sell orders in the base, supply absorbed all demand,
       price continued downward
Location of supply zone: the BASE between the two drops
```

Mirror of RBR. Valid as long as downtrend structure is intact.

**Note from PriceActionNinja research:** Some practitioners argue that RBR/DBD continuation zones are actually *lower quality* than reversal zones (RBD/DBR) because they form within existing trends. The institutional order concentration may be lower since the market was already moving in their direction. Test both separately in backtests.

### Rally-Base-Drop (RBD) — Supply Zone, REVERSAL

```
Structure: [Bullish impulse] → [Base 1–4 candles] → [Bearish impulse]
Type: SUPPLY zone (bearish reversal)
Context: Price was at or near a structural high
Logic: Institution placed massive sell orders in the base; demand was completely
       exhausted; price reversed down aggressively
Location of supply zone: the BASE between the rally and the drop
```

RBD zones mark **major structural tops**. The reversal from bullish to bearish during the drop phase is the key signal — this is where institutional sellers entered with enough volume to flip the market direction entirely.

**Quality criteria for RBD:**
- Drop after base must be significantly stronger than the rally that preceded it (momentum shift)
- Volume ideally increases on the drop vs. the rally
- The base should show decreasing momentum candles (bearish doji, spinning tops)

**Algorithmic detection:**
```
1. Identify bullish impulse A (2+ up candles, > 1.5 ATR)
2. Identify base (1–4 small candles at the top)
3. Identify bearish impulse B (2+ down candles, > 1.5 ATR) immediately after base
4. Zone = base range → tagged as SUPPLY (bearish)
5. Bonus: check if zone is at HTF premium zone (above equilibrium)
```

### Drop-Base-Rally (DBR) — Demand Zone, REVERSAL

```
Structure: [Bearish impulse] → [Base 1–4 candles] → [Bullish impulse]
Type: DEMAND zone (bullish reversal)
Context: Price was at or near a structural low
Logic: Institution placed massive buy orders in the base; supply was completely
       exhausted; price reversed up aggressively
Location of demand zone: the BASE between the drop and the rally
```

DBR zones mark **major structural bottoms** and are among the highest-probability long setups. The exhaustion of the preceding drop followed by explosive upside is a clear institutional accumulation signal.

**Quality criteria for DBR:**
- Rally after base must be clearly stronger than the drop (momentum exhaustion + reversal)
- Base candles show indecision (small wicks, mixed direction)
- Ideally at HTF discount zone (below equilibrium)

### Pattern Hierarchy by Expected Performance

Based on community research and practitioner consensus:

```
Tier 1 (Highest quality):
  DBR — demand reversal zones at structural lows
  RBD — supply reversal zones at structural highs

Tier 2 (Good quality):
  RBR — demand continuation zones in uptrends
  DBD — supply continuation zones in downtrends

Rule: Reversal zones (RBD/DBR) outperform continuation zones
because they represent the TOTAL exhaustion of one side,
not just a pause. The institutional order density is maximized.
```

---

## 5. Relationship to SMC Order Blocks

### Conceptual Overlap

SMC Order Blocks and S/D zones describe the **same market phenomenon** from different angles:

| Dimension | S/D Zone | SMC Order Block |
|---|---|---|
| What it captures | The entire base consolidation (all accumulation candles) | The LAST opposing candle before the impulse |
| Zone width | 1–4 candle range | Single candle |
| Origin theory | Unfilled pending institutional orders | Large block order placement by banks |
| Pattern vocabulary | RBR, DBD, RBD, DBR | Bullish OB, Bearish OB, Mitigated OB |
| Entry point | Proximal line (edge of base) | OB high/low |
| Stop loss | Beyond distal line | Beyond OB extreme |

### Structural Relationship

In practice, the **SMC Order Block is the most important candle inside the S/D zone**. Specifically:

**For a Demand Zone (DBR or RBR):**
- The S/D zone spans the entire base
- The Bullish Order Block = the last BEARISH candle in the base (or the candle immediately before the impulse)
- The OB sits at or near the proximal line of the S/D zone

**For a Supply Zone (RBD or DBD):**
- The S/D zone spans the entire base
- The Bearish Order Block = the last BULLISH candle in the base
- The OB sits at or near the proximal line of the S/D zone

```
Visual example — DBR Demand Zone:

Price:   [DROP][DROP][base1][base2][OB_candle][RALLY][RALLY]
                     |___S/D zone___|
                                    |OB| ← last bearish candle before rally
                     ^proximal      ^proximal (tighter, OB-based)
         ^distal
```

### When They Conflict

Occasionally the SMC Order Block (last opposing candle) and the S/D Zone proximal line disagree. Priority rules:

1. If OB is INSIDE the S/D zone: use OB for entry (tighter, higher precision, smaller SL)
2. If OB is AT the proximal line: they agree — maximum confidence
3. If base has only 1 candle: OB = S/D zone (identical)
4. If base has 2–4 candles and OB is at distal line: use S/D proximal for entry, OB provides additional validation

### Practical Hybrid Approach

The strongest setups combine both concepts:
- **S/D zone** provides the context: is this a fresh, high-quality demand/supply area?
- **Order Block** within the zone provides the precise entry: where exactly to place the limit order
- **FVG** (Fair Value Gap) within the S/D zone adds confirmation: there is an unfilled price gap that price needs to return to fill

Current bot strategy already uses this hybrid implicitly (OB + FVG scoring). The S/D zone framework formalizes the wider context around the OB.

---

## 6. Multi-Timeframe Zone Analysis

### Timeframe Hierarchy and Zone Strength

Higher timeframe zones carry more institutional weight because they represent orders from longer-horizon participants (hedge funds, central banks) who trade enormous size:

| Timeframe | Zone Type | Institutional Horizon | Zone Strength |
|---|---|---|---|
| Weekly / Daily | Macro S/D zones | Weeks to months | Highest — rarely violated |
| 4H | Swing S/D zones | Days | Strong — forms structural bias |
| 1H | Intraday S/D zones | Hours | Medium — good for direction |
| 15M | Entry S/D zones | Minutes to hours | Lower — use for timing only |
| 5M | Micro zones | Minutes | Noise — confirmation only |

### Nested Zone Strategy

When multiple timeframe zones align at the same price level, institutional agreement across time horizons is maximized:

```
Maximum strength setup (all 4 align):
  4H zone: 83,000–83,500 (demand)
  1H zone: 83,100–83,400 (demand, nested inside 4H)
  15M zone: 83,150–83,350 (demand, nested inside 1H)
  OB at: 83,200–83,300 (bullish OB inside all zones)

Entry: limit at 83,350 (15M proximal)
Stop: below 83,000 (4H distal)
Result: very tight SL relative to the broader zone support
```

**Rule:** When you have 2+ lower timeframe zones nested within a higher timeframe zone, execute based on the highest timeframe zone boundaries, not the lower timeframe zone. The 4H zone provides the true institutional footprint.

### Zone Alignment Procedure for the Bot

```
Step 1 (4H bias): Identify active 4H demand or supply zones
  → These define whether the HTF bias is bullish or bearish at current price

Step 2 (1H structure): Find 1H zones that ALIGN with 4H direction
  → Nested 1H zone inside 4H zone = double confluence

Step 3 (15M entry): Look for 15M zone at or near 1H zone proximal
  → This is the actual entry zone for limit order placement

Step 4 (OB precision): Find the OB within the 15M zone
  → Place limit order at OB high (bullish) or OB low (bearish)

Step 5 (stop placement): SL beyond the 4H zone distal (not just 15M)
  → Wide enough to survive noise, anchored to institutional level
```

### Zone Conflict Resolution

When 4H is bullish (demand zone active) but 1H shows a supply zone at same price:
- **Lower timeframe supply < Higher timeframe demand** — go with HTF
- The 1H supply is likely to be absorbed by 4H demand
- Consider not trading if the conflict is significant (score penalty)

---

## 7. Actionable Insights for Our Bot

### Gap Analysis: Current OB Detection vs S/D Zone Framework

Current bot strategy (from `strategy.md`):
```
Bullish OB: последняя медвежья свеча перед импульсным бычьим движением
  - Медвежья свеча (close < open)
  - Следующие 1-3 свечи импульсно закрываются выше high медвежьей
  - Импульс > 1.5× ATR(14)
```

This is precisely the **SMC Order Block** definition — a single candle. The S/D zone framework adds:
1. The **base context** (what are the 1–4 candles around the OB?)
2. **Pattern classification** (is this RBR, DBR, RBD, or DBD?)
3. **Freshness tracking** as a scored metric, not just a binary filter
4. **Zone width quality** (tight base = better zone)

### Specific Improvements to Implement

**Improvement 1: Pattern-Type Weighting**

Add pattern type as a scoring modifier:

```
Pattern Type Bonus (applied to OB score):
  DBR or RBD (reversal patterns):  +5 points bonus
  RBR or DBD (continuation):        0 points
  Ambiguous / no clear pattern:    -5 points penalty

Rationale: Reversal patterns indicate more concentrated institutional activity
```

**Improvement 2: Base Quality as OB Sub-score**

Currently the OB check is binary (OB exists or not). Replace with scored sub-factors:

```
OB Score Breakdown (current max 20 pts → expand to include quality):
  Base candle count:
    1 candle:   +5 pts (maximum precision)
    2 candles:  +3 pts
    3–4:        +1 pt
    5+:         -3 pts (zone too wide)

  Zone freshness (touches since formation):
    0 touches:  +5 pts
    1 touch:    +3 pts
    2 touches:  +1 pt
    3+ touches: -5 pts

  OB + FVG inside zone:
    FVG entirely within S/D zone: +5 pts (existing bonus, keep)
    FVG partially overlapping:    +2 pts

  Departure strength:
    Impulse > 2.5% from zone:    +3 pts
    Impulse 1.5–2.5%:            +1 pt
    Impulse < 1.5%:              0 pts
```

**Improvement 3: Zone Type Classification for Strategy**

When detecting OBs, also classify the surrounding pattern:

```typescript
enum SDZonePattern {
  DBR = 'drop_base_rally',   // Reversal demand — highest quality long
  RBR = 'rally_base_rally',  // Continuation demand — good long
  RBD = 'rally_base_drop',   // Reversal supply — highest quality short
  DBD = 'drop_base_drop',    // Continuation supply — good short
  AMBIGUOUS = 'ambiguous',   // Cannot classify
}

interface SDZone {
  pattern: SDZonePattern;
  proximal: number;
  distal: number;
  touchCount: number;
  formationIndex: number;  // candle index when formed
  quality: number;         // 0–100 composite score
}
```

**Improvement 4: Proximal Line for Entry Precision**

Current entry: at OB high/low (correct, this is already the proximal line concept)
Improvement: also validate that OB sits within a broader S/D zone

```
Valid OB entry conditions:
  1. OB identified (last opposing candle before impulse)
  2. A valid S/D base (1–4 candles) exists around/before the OB
  3. The S/D zone quality score >= 50 (Tier 2 minimum)
  4. OB is at or within S/D proximal line (not deeper in zone)

If OB is at distal line (far edge):
  → De-prioritize: entry would require price to traverse entire zone
  → Score penalty: -5 points
```

**Improvement 5: Multi-TF S/D Zone Confluence in Scoring**

Enhance the existing Premium/Discount scoring (currently 10 pts) with explicit zone alignment:

```
Current: 10 pts for price in discount/premium zone
Proposed enhancement:
  Price in 4H demand zone AND 15M OB present:  10 pts (current)
  + 1H zone also aligns:                       +5 pts bonus
  + 4H zone is fresh (0 touches):              +3 pts bonus
  Maximum possible from zone confluence:        18 pts
```

**Improvement 6: Zone Invalidation Rule**

Add explicit zone invalidation that removes OBs from active consideration:

```
Invalidate an active OB/zone when:
  1. Price closes BELOW the OB low (bullish OB) → zone broken
  2. Price closes above OB high with body > 80% of OB range → zone consumed
  3. Touch count reaches 4 → zone exhausted

Do NOT invalidate when:
  1. Price wicks into zone but closes outside (wick test = still valid)
  2. Price sweeps liquidity below zone then returns above (liquidity sweep = confirmation)
```

**Improvement 7: Zone Age Filter**

```
Zone age filter:
  Max zone age for 15M OBs: 96 candles (24 hours)
  Max zone age for 1H OBs:  120 candles (5 days)
  Max zone age for 4H OBs:  90 candles (15 days)

Rationale: MOMOH's work and community consensus indicate institutions
do not hold pending orders indefinitely. Very old zones lose relevance
as the market context changes.
```

### Statistical Context for Crypto

Direct statistical backtests on crypto-specific S/D zones are sparse in published research. However, practitioner consensus and available data indicate:

- Multi-timeframe confirmed S/D zones (at least 2 TF alignment) show significantly higher win rates than single-TF zones
- Fresh zones (0 touches) outperform retested zones (2+ touches) by an estimated 15–25% in win rate
- RBD/DBR reversal zones historically show stronger first-touch reactions than RBR/DBD continuation zones
- Crypto-specific risk: S/D zones are more susceptible to violation during high-impact events (halving, ETF news, liquidation cascades) — always combine with macro filter
- In sideways/ranging markets (ATR < 0.15% for BTC), S/D zones produce excessive false signals — the existing ATR filter (`atrFilterMin: 0.001`) already partially addresses this but consider raising to 0.0015 for BTC

### Implementation Priority

| Priority | Change | Impact |
|---|---|---|
| High | Add SDZonePattern classification to OB detection | Enables pattern-type bonus in scoring |
| High | Add touch count tracking to existing OB cache in Redis | Freshness scoring |
| Medium | Add base quality sub-score to OB evaluation | Better zone ranking |
| Medium | Enhance Premium/Discount with explicit 1H zone alignment | +3–8 pts per qualifying setup |
| Low | Add zone age filter (max 96 candles for 15M) | Reduces stale OB false signals |
| Low | Zone width ratio scoring | Minor refinement to existing OB filter |

---

## Summary

Supply and demand zone methodology is the **foundational framework underlying SMC Order Blocks**. The two approaches are not competing — they are nested: S/D zones define the macro context, Order Blocks define the precise entry within that context.

Key additions this framework provides over our current OB-only detection:
1. **Pattern classification** (RBR/DBD/RBD/DBR) adds directional quality signal
2. **Base quality scoring** formalizes what makes one OB better than another
3. **Freshness as a scored metric** (not just binary "mitigated/not") enables nuanced weighting
4. **Proximal/distal line framework** clarifies entry and stop placement logic
5. **Multi-TF zone nesting** formalizes the HTF confluence that currently only uses Premium/Discount zones

The bot already implements the core of this methodology implicitly through its OB + FVG + Premium/Discount scoring. The improvements above are **refinements to the existing signal**, not a wholesale replacement.

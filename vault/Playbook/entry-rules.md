---
name: Entry Rules
description: The conditions under which I open a position. Derived from 8-factor confluence + SMC + research.
type: playbook
priority: 1
last_revised: 2026-04-17
---

# Entry Rules

> **Opening a position is the single most important decision I make all day. A bad entry cannot be rescued by management; a great entry makes management trivial.**

---

## The Entry Decision Tree

Before I open any position, I answer these in order. A NO at any step = no trade.

### 1. Am I allowed to trade right now?

- ✅ Within trading window (07:00–22:00 UTC)
- ✅ Outside dead zone (22:00–00:00 UTC)
- ✅ Not within ±10 min of funding windows (00:00 / 08:00 / 16:00 UTC)
- ✅ Daily DD < 4% — if ≥ 4%, kill switch is active, NO entries
- ✅ Total DD < 8%
- ✅ Open position count < 5
- ✅ Portfolio heat (sum of all position risks) < 5%

If any NO → stand down. The market will be here tomorrow.

### 2. Does this pair meet the BTC correlation filter?

*Applies to altcoins only — BTCUSDT bypasses this check.*

| BTC State | Long Alt | Short Alt |
|---|---|---|
| 4H Bull | Allowed | Needs 6/8 counter-trend |
| 4H Range | Allowed | Allowed |
| 4H Bear | **Blocked** (regime factor = 0) | Allowed |
| 1H trend DOWN | Multi-TF factor = 0 for Long | Allowed |
| 1H trend UP | Allowed | Multi-TF factor = 0 for Short |

If BTC context blocks my direction → no entry. BTC leads. Don't fight the leader.

### 3. What does the 8-factor confluence score?

I score BOTH long and short every cycle. The higher-scoring direction is my candidate.

| # | Factor | Long (bull case) | Short (bear case) |
|---|--------|-----------------|-------------------|
| 1 | **SMC / Structure** | sweep + OB tap (STRONG = 2pts), weak BOS = 1pt | mirror for shorts |
| 2 | **Technical (tiebreaker)** | RSI < 30 or bull div, EMA21 > EMA55 (MACD hist = tiebreaker only, not primary) | RSI > 70 / bear div, EMA21 < EMA55 (MACD hist = tiebreaker only) |
| 3 | **Volume** | OBV bullish, green vol spike, price > VWAP | OBV bearish div, declining vol |
| 4 | **Multi-TF + BTC** | 4H→1H→15M→3M + BTC 1H aligned up | all aligned down |
| 5 | **Regime + BTC** | Bull / Range + BTC aligned | Bear regime + BTC bear |
| 6 | **News / Macro** | neutral or risk-on | neutral or risk-off |
| 7 | **Momentum** | ADX > 20, +DI > -DI, RSI slope up | ADX > 20, -DI > +DI, RSI slope down |
| 8 | **Volatility** | ATR between 10th and 85th percentile | same |

### 4. Does the score cross the threshold?

| Setup type | Threshold | Risk size |
|---|---|---|
| **Structural entry** (sweep + OB + multi-TF aligned) | **4/8** | 0.5% (default) |
| **Standard entry** (reactive confirmation) | **5/8** | 0.5% |
| **Counter-trend** (against regime or news) | **6/8** | 0.5% |
| **A+ setup** (structural + all factors firing) | **7-8/8** | 1.0% (A+ only) |

**The key insight:** clean structure at 4/8 > muddled 6/8 without structure. *(ref: `00-trader-identity.md` → Where My Edge Lives)*

### 5. Can I actually execute the trade cleanly?

- ✅ Entry price within 0.3% of current mark (or a valid limit at OB level)
- ✅ SL distance ≤ 2% from entry (BTC) / ≤ 3% (altcoins)
- ✅ R:R ≥ **1.5:1 standard** / ≥ **1.3:1 A+** with realistic TP (near next structural level, not fantasy) — see **A+ Execution Exception** below
- ✅ Position size respects leverage limits for the pair
- ✅ Orderbook not showing obvious manipulation at entry level

#### A+ Execution Exception (confluence ≥ 7/8)

Standard rule: minimum R:R = 1.5.
**A+ exception: for 7-8/8 confluence setups, minimum R:R = 1.3.**

**Justification (EV math):**
Expected value per trade = `WR × avg_win − (1 − WR) × avg_loss`. Setups with 7-8/8 confluence are expected to have higher win rate than the 5-6/8 baseline (discipline-validated accumulation of signal quality, not speculation). Indicative EV at 1.3R across WR levels:

| Win Rate | EV at 1.3R | EV at 1.5R |
|---|---|---|
| 40% | −0.08R (losing) | 0.00R (breakeven) |
| 45% | +0.04R | +0.13R |
| **50%** | **+0.15R** | **+0.25R** |
| 55% | +0.26R | +0.38R |

**The 1.3R threshold is only positive-EV if A+ WR is ≥ ~43%.** We accept this as an operating hypothesis to capture high-confluence setups clipped by nearby structure (the 2026-04-17 AVAX 7/8 × 5 consecutive case). Once we accumulate ≥ 20 A+ closed trades, we validate WR against this hypothesis and adjust.

**What this is NOT:**
- NOT a blanket R:R reduction — 5-6/8 setups still require 1.5R.
- NOT permission to force A+ labeling — confluence must genuinely score 7 or 8.
- NOT a TP-widening excuse — planner still places TP at real structure, not fantasy. The exception only accepts shorter *realized* R:R when structure clips it.

**Telemetry to watch:** `skipReason` log line shows the effective threshold and A+ flag, e.g. `R:R 1.28 < 1.3 (7/8 A+)` vs `R:R 1.28 < 1.5 (6/8)` — lets postmortems diagnose whether A+ trades actually hit their hypothesized WR.

### 6. Is this a unique bet, or am I doubling my exposure?

*(Portfolio check)*

- If 2+ existing positions are same direction on correlated pairs (AVAX+SOL+ETH long = 3× same bet) → reject unless A+ and I close the weakest.
- If all 5 slots full and this is higher-confluence than my weakest position → close weakest, open this. *(Position replacement rule.)*
- If all 5 slots full and this is ≤ weakest → pass.

---

## Entry Execution

### Market vs. Limit

- **Market entry** (default): when structure has already triggered and I am catching a confirmed move. Immediate, taker fee.
- **Limit entry**: when price is approaching a clean OB or supply/demand zone and I can place the order at the level. Better entry, maker fee. But watch:
  - OB must still be valid (no structure break against it)
  - Limit age < 30 min (stale limits become invalid as context shifts)
  - If price moves 2%+ past the limit without filling → cancel

### Stop-Loss Placement

ATR-based, structurally aware:
- **Long**: SL = max(entry − 1.0×ATR, below last swing low or below OB low − buffer)
- **Short**: SL = min(entry + 1.0×ATR, above last swing high or above OB high + buffer)
- Cap: 2% from entry for BTC, 3% for altcoins

**Server-side, on Bybit, within 5 minutes of opening. No exceptions.**

### Take-Profit Placement

R:R target of **1.5:1 minimum**. TP placement:
- Near next structural level (previous swing, key S/R, daily high/low)
- NOT a fantasy extension (a 5R target at a level price has not touched in 30 days is a fantasy)
- In range markets: TP at opposite range boundary — do NOT demand 3R
- In trending markets: TP at the next major swing

### Size

`size = (account_balance × risk_fraction) / (entry − SL)`

- Default risk_fraction: 0.5%
- A+ risk_fraction: 1.0%
- News-adjusted: multiply by news_multiplier (see `CLAUDE.md` News Rules)
  - High-impact news pending: × 0.25
  - Medium-impact: × 0.5
  - Fear & Greed ≤ 15: additional × 0.5

---

## When To Walk Away

The hardest entries are the ones I decline. Walk away when:

- Score is 3/8 or below — this is noise, not signal
- I'm seeing a "setup" but can't articulate it in one sentence — I'm forcing
- Two pairs are flashing the same signal and I already have a correlated position
- I've had 3 losses in a row and my identity is not crystal clear — step back, reread identity, return
- A major macro print is in the next 30 min — wait for the print, then re-evaluate
- I'm tired / distracted / rushed (for the human operator reading this: this applies to you too)

**The edge in patience is massive.** Most setups that I pass on would have been losses. The ones I miss are a rounding error over a year.

---

## Key Research References

- `stop-hunting-market-traps.md` — SMC structural entries (sweep + OB)
- `support-resistance-mastery.md` — level identification methodology
- `demand-supply-dynamics.md` — OB and supply/demand zones
- `volume-analysis-deep.md` — volume confirmation
- `rsi-advanced-strategies.md` — RSI divergence + capitulation
- `momentum-trading-clenow.md` — momentum entries
- `systematic-trading-carver.md` — scoring frameworks
- `position-sizing-advanced.md` — sizing math

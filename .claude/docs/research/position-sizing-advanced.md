# Advanced Position Sizing Methodologies for Algorithmic Trading

**Date:** 2026-04-06
**Context:** BTCUSDT + multi-pair expansion (ETHUSDT, SOLUSDT and others)
**Constraints:** HyroTrader 2-Step — daily DD 5%, max DD 10%, SL max 3% per trade

---

## Kelly Criterion (Full & Fractional)

### Original Formula

John L. Kelly Jr. (1956, Bell System Technical Journal) derived the optimal fraction
of capital to wager by maximising the expected log-growth rate of wealth. For a binary
outcome game (win B units or lose 1 unit):

```
f* = (p × B - q) / B
   = p - q/B

Where:
  f* = fraction of capital to risk
  p  = probability of winning
  q  = 1 - p = probability of losing
  B  = net odds (profit per unit risked)
```

For trading, where the "odds" are the ratio of average win to average loss:

```
f* = W - (1 - W) / R

Where:
  W = Win Rate (fraction of trades won)
  R = Reward-to-Risk ratio (avg_win / avg_loss)

Example (our BTCUSDT calibrated system):
  W = 0.52, avg_win = 2.2%, avg_loss = 1.0%
  R = 2.2 / 1.0 = 2.2
  f* = 0.52 - (0.48 / 2.2) = 0.52 - 0.218 = 0.302 → 30.2% of capital
```

Full Kelly recommends betting 30% of capital — far too aggressive for a prop firm context.
It maximises geometric growth rate but produces stomach-churning drawdowns: a run of 10
consecutive losses from a 30% Kelly bet wipes 97.4% of capital.

### Half-Kelly and Fractional Kelly

Mathematically, betting half-Kelly (f = 0.5 × f*) returns **75% of the Kelly-optimal
geometric growth rate** while cutting variance (and thus drawdown) to **25% of full Kelly**.
This is the core trade-off:

```
Fractional Kelly multiplier   Growth (% of max)   Variance (% of full Kelly)
0.25×                          43.75%               6.25%
0.50×                          75.00%               25.00%
0.75×                          93.75%               56.25%
1.00×                         100.00%              100.00%
```

In practice, Kelly inputs are estimated from noisy historical data. Over-estimating W or R
produces an f* that is too high — the position explodes, not the account. Fractional Kelly
acts as insurance against estimation error.

**Rule of thumb (quantitative trading practice):**
- Full Kelly: theoretical maximum, never use in practice
- Half-Kelly (0.5×): appropriate for well-established systems with 200+ trade history
- Quarter-Kelly (0.25×): recommended when system has <50 trades or high variance trades

### Risk-Constrained Kelly (Busseti et al., 2016)

The risk-constrained Kelly criterion adds a hard drawdown ceiling to the optimisation:

```
Maximise: E[log(1 + f × r)]
Subject to: P(drawdown > D_max) ≤ ε

Where D_max = 10% (HyroTrader limit), ε = 0.05 (5% probability)
```

This is the theoretically correct approach for prop firm accounts. In practice it
approximates to using a fractional Kelly where f is determined by the drawdown constraint
rather than purely by the growth objective.

### Kelly for Our Bot

Given our HyroTrader constraints (3% max SL per trade), Kelly provides an upper ceiling:

```
Kelly f* (estimated):
  W ≈ 0.50, R ≈ 2.0 (conservative estimate)
  f* = 0.50 - (0.50 / 2.0) = 0.25 → 25% of capital at risk

Quarter-Kelly = 6.25% of capital per trade
Half-Kelly    = 12.5% of capital per trade

HyroTrader SL hard cap = 3% of starting balance
→ Our effective ceiling is 3%, well below even quarter-Kelly.
→ HyroTrader rules are more binding than Kelly in our case.
```

The SL cap of 3% per trade is the binding constraint, not Kelly. However, Kelly is still
useful for determining how to allocate the SL budget across varying trade quality levels
(high-confluence vs borderline signals).

---

## Optimal f (Ralph Vince)

### Concept and Formula

Ralph Vince introduced Optimal f in "Portfolio Management Formulas" (1990) and expanded
it in "The Mathematics of Money Management" (1992). Optimal f maximises the Terminal
Wealth Relative (TWR):

```
TWR(f) = PRODUCT[ HPR_i(f) ] for all trades i

HPR_i(f) = 1 + f × (-Return_i / Largest_Loss)

Where:
  f           = fraction to test (0 to 1)
  Return_i    = P&L of trade i (negative for losses)
  Largest_Loss = absolute value of the worst historical loss

Position size in units:
  N = (f × Capital) / |Largest_Loss|
```

The optimal f is the value of f that produces the highest TWR across all historical trades.

### Worked Example

```
Historical trades: +5%, +3%, -1%, +8%, -2%, +4%, -1.5%
Largest loss: -2%

At f = 0.20:
  HPR for +5% trade: 1 + 0.20 × (5 / 2) = 1.50
  HPR for -2% trade: 1 + 0.20 × (-2 / 2) = 0.80
  TWR = 1.50 × 1.15 × 0.90 × 1.80 × 0.80 × 1.40 × 0.85 = ...

The f that maximises TWR is the Optimal f.
```

### Kelly vs Optimal f — Key Differences

| Aspect | Kelly Criterion | Optimal f (Vince) |
|---|---|---|
| Input data | W and R (two parameters) | Full trade distribution |
| Assumed distribution | Binary outcomes | Any empirical distribution |
| Calculation | Closed-form formula | Numerical optimisation |
| Sensitivity | Low (two inputs) | High (depends on worst trade) |
| Typical result | Moderate fraction | Often very high fraction (20-50%) |
| Main risk | Over-betting if W/R mis-estimated | Worst case trade re-estimation risk |

### The Largest Loss Problem

Optimal f's critical weakness: it is calibrated against the historical largest loss. If a
future trade exceeds that loss (gap risk, flash crash, extreme slippage), the actual f
applied is too high. Vince acknowledged this: "You can never know your largest loss until
after it happens."

For crypto, where 10-30% overnight gaps occur rarely but exist, optimal f derived from a
1-year history may be calibrated against a -3% SL-based loss, while the next crisis
produces a -8% gap-through fill.

**Practical verdict:** Optimal f provides useful theoretical insight but is too aggressive
and too sensitive for live algorithmic prop firm trading. Use it as an upper bound
reference, not a sizing formula.

---

## Fixed Fractional vs Fixed Ratio

### Fixed Fractional (the industry standard)

Position size is a fixed percentage of current account equity risked per trade.

```
Capital_at_Risk = Equity × risk_pct
Position_Size   = Capital_at_Risk / (Entry - StopLoss)

Example (our bot):
  Equity     = $10,000
  risk_pct   = 1.5%
  Capital_at_Risk = $150
  Entry = $95,000, SL = $94,050 → R per BTC = $950
  Contracts (BTC) = $150 / $950 = 0.158 BTC (~ $15,000 notional at 5× leverage... verify)

  Using our leverage model:
  Margin used = Equity × 22.5% = $2,250
  Risk (as % of entry) = (Entry - SL) / Entry = $950 / $95,000 = 1.0%
  Dollar risk = $2,250 × 5 × 1.0% = $112.50 → within 3% start balance limit
```

**Properties:**
- Position size scales up automatically as equity grows (compounding effect)
- Position size scales down automatically during drawdowns (capital preservation)
- Most widely used by institutional and systematic traders
- Recommended by Van Tharp, Larry Williams, most quant practitioners

### Fixed Ratio (Ryan Jones, "The Trading Game", 1999)

Jones designed Fixed Ratio to solve what he saw as a flaw in Fixed Fractional: small
accounts grow too slowly because 1% of $10,000 is only $100.

```
N(n+1) = N(n) + 1  when  Profit ≥ N(n) × Delta

Where:
  N(n) = current number of contracts
  Delta = profit required per contract to add one contract

Example:
  Delta = $5,000 per contract
  Start: 1 contract
  After $5,000 profit: 2 contracts
  After $5,000 × 2 = $10,000 more profit: 3 contracts
```

**Properties:**
- Grows more slowly than Fixed Fractional during winning runs
- Does not automatically downscale after losses (must explicitly code this)
- Better suited for very small accounts trying to build up quickly
- More complex to implement and reason about

### Comparison Table

| Property | Fixed Fractional | Fixed Ratio |
|---|---|---|
| Scales up after profit | Yes, continuously | Yes, at milestones |
| Scales down after loss | Yes, automatically | No, must code manually |
| Complexity | Low | Moderate |
| Prop firm suitability | Excellent | Poor (no auto-downscale) |
| Compounding | Continuous | Step-function |
| Best for | Our bot | Not recommended |

**Verdict for our bot:** Fixed Fractional is correct. It auto-scales down during drawdowns,
which is essential for HyroTrader compliance. Fixed Ratio's lack of automatic downscaling
during losses creates catastrophic risk in a prop firm context.

---

## Volatility-Based Sizing (ATR)

### Core Principle

ATR-based sizing normalises position size relative to the instrument's current volatility.
The intuition: when BTC's ATR is $3,000 (high vol), a fixed-unit position has 3× the
P&L risk of when ATR is $1,000. Volatility-based sizing holds dollar P&L risk constant.

### Formula

```
Dollar_Risk     = Equity × risk_pct
ATR_Stop_Dist   = ATR(14) × slAtrMultiplier
Position_Notional = Dollar_Risk / (ATR_Stop_Dist / Price)
                  = Dollar_Risk × Price / ATR_Stop_Dist
Margin_Used     = Position_Notional / Leverage

Alternatively expressed:
  Contracts = Dollar_Risk / ATR_Stop_Dist
```

### Worked Example (BTCUSDT current config)

```
Equity             = $10,000
risk_pct           = 1.5%   → Dollar_Risk = $150
slAtrMultiplier    = 2.0    (from BTCUSDT.json)
ATR(14) on 15M     = $500 (typical quiet period)

Stop Distance = $500 × 2.0 = $1,000

Contracts = $150 / $1,000 = 0.15 BTC
Notional  = 0.15 × $95,000 = $14,250
Margin    = $14,250 / 5 = $2,850   ← checks against 22.5% of $10,000 = $2,250

→ If ATR spikes to $1,500 (high vol period):
  Stop Distance = $1,500 × 2.0 = $3,000
  Contracts = $150 / $3,000 = 0.05 BTC
  Notional  = 0.05 × $95,000 = $4,750
  Margin    = $4,750 / 5 = $950   ← much smaller, protects against volatility spikes
```

### ATR Percentile Filter Enhancement

Instead of using the raw ATR value, some systems normalise by the rolling percentile of
ATR. This prevents entering at all when ATR is in an extreme regime:

```
atr_percentile = percentile_rank(ATR, lookback=1000)

If atr_percentile < 15: market too quiet → skip (our atrFilterMin: 0.005)
If atr_percentile > 85: market too chaotic → skip (our atrFilterMax: 0.03)
If 15 <= atr_percentile <= 85: trade with size = Dollar_Risk / stop_distance
```

This is already implemented as an optional feature in our BTCUSDT config
(`atrPercentileEnabled: false`). Worth enabling after sufficient trade history.

### Per-Pair ATR Calibration

Different pairs require different ATR multipliers:

```
BTCUSDT: slAtrMultiplier = 2.0 (ATR ~0.35% of price on 15M)
ETHUSDT: slAtrMultiplier = 2.0 (ATR ~0.40% of price, slightly wider)
SOLUSDT: slAtrMultiplier = 1.8 (ATR ~0.65% of price, wider absolute = smaller multiplier)
```

Rationale for SOLUSDT: SOL's absolute ATR percentage is higher, so applying the same 2×
multiplier produces a stop that is too wide as a percentage of capital. A tighter
multiplier (1.8×) keeps the dollar risk within the 3% HyroTrader cap while respecting
the instrument's natural noise range.

---

## Correlation-Adjusted Multi-Pair Sizing

### The Problem: Hidden Concentration Risk

When trading BTC and ETH simultaneously (correlation ~0.87), two "separate" positions are
functionally one large concentrated position. If both hit SL in the same hourly candle
(which happens during flash crashes), total loss = SL_BTC + SL_ETH ≈ 2× expected per-trade
loss. This can breach the 5% daily DD limit in a single move.

### Correlation Penalty Formula

The effective combined risk of two positions scales by correlation:

```
Combined_Risk = sqrt(R1² + R2² + 2 × ρ × R1 × R2)

Where:
  R1, R2 = dollar risk of each position
  ρ      = correlation coefficient between the two pairs

Example:
  R1 = R2 = $150 (1.5% of $10,000 each)
  ρ = 0.87 (BTC-ETH)

  Combined_Risk = sqrt(150² + 150² + 2 × 0.87 × 150 × 150)
               = sqrt(22,500 + 22,500 + 39,150)
               = sqrt(84,150)
               = $290.09

  vs simple sum = $300
  vs uncorrelated = sqrt(22,500 + 22,500) = $212.13
```

The formula shows that two highly-correlated positions at 1.5% risk each produce an
effective combined risk of ~2.9% — close to the 3% single-trade SL limit.

### Practical Correlation Rules

Three regimes to handle in the bot:

```
ρ < 0.50 (low correlation): trade both at full size
0.50 <= ρ < 0.70 (moderate): reduce second position to 75%
0.70 <= ρ < 0.85 (high): reduce second position to 50%
ρ >= 0.85 (very high): block new entry; or reduce to 33%
```

Important: **correlations spike during crisis events**. BTC-ETH correlation historically
rises from 0.87 (normal) to 0.97+ during major selloffs (March 2020, FTX collapse Nov 2022,
LUNA collapse May 2022). Design the correlation gate with crisis ρ as the baseline, not
calm-market ρ.

**Implementation for our bot (correlation-tracker.ts, planned):**

```typescript
interface CorrelationState {
  pairs: [string, string];
  correlation30d: number;
  correlationStress: number;  // 90th percentile (crisis estimate)
  lastUpdated: Date;
}

function getPositionSizeMultiplier(rho: number): number {
  if (rho < 0.50) return 1.0;
  if (rho < 0.70) return 0.75;
  if (rho < 0.85) return 0.50;
  return 0.33;  // allow entry but greatly reduced
}
```

### Veto Condition

When two highly-correlated positions are already open (both BTC and ETH longs) and a
SOLUSDT long signal fires, the portfolio correlation is now BTC+ETH+SOL — all three
moving together. At this point, block the SOL entry entirely until one position closes.

```typescript
// In portfolio-risk.ts
if (openPositions.filter(p => p.side === 'long').length >= 2
    && avgCorrelationAmong(openPositions) > 0.80) {
  return { vetoed: true, reason: 'portfolio_correlation_overload' };
}
```

---

## Portfolio Heat Management

### Definition

Portfolio heat = total percentage of account at risk if ALL open stop-losses hit
simultaneously. This is the true measure of account risk at any moment.

```
Portfolio_Heat = SUM(dollar_risk_per_position) / Account_Equity × 100%

Example:
  Position 1 (BTC Long): SL risk = $150 (1.5% of $10,000)
  Position 2 (ETH Long): SL risk = $120 (1.2% of $10,000)
  Position 3 (SOL Short): SL risk = $100 (1.0% of $10,000)

  Portfolio_Heat = ($150 + $120 + $100) / $10,000 = 3.7%
```

### Heat Caps by Context

```
HyroTrader daily DD limit     = 5.0%
Safe buffer (80% of limit)    = 4.0%   ← our PORTFOLIO_HEAT_CAP in constants.ts
Conservative (60% of limit)   = 3.0%   ← recommended when in drawdown
Crisis mode (40% of limit)    = 2.0%   ← when equity < 95% of start balance
```

### Heat-Based Blocking Logic

```typescript
const MAX_PORTFOLIO_HEAT = 0.04;  // 4% (already in constants.ts)

function canOpenNewPosition(newTradeRiskPct: number): boolean {
  const currentHeat = getCurrentPortfolioHeat();  // sum of all open SL risks
  return (currentHeat + newTradeRiskPct) <= MAX_PORTFOLIO_HEAT;
}

// More nuanced: scale down new trade if we're approaching cap
function getScaledRiskPct(targetRiskPct: number): number {
  const currentHeat = getCurrentPortfolioHeat();
  const remaining = MAX_PORTFOLIO_HEAT - currentHeat;
  return Math.min(targetRiskPct, remaining * 0.8);  // 20% safety buffer
}
```

### Sector/Correlation Heat

Portfolio heat for highly correlated assets should use the **correlated heat** formula,
not simple summation:

```
Correlation_Adjusted_Heat = sqrt(SUM_ij(ρ_ij × risk_i × risk_j)) / Equity

Where the sum is over all pairs of open positions.
```

In a 5-pair portfolio where all positions are long and correlations average 0.80, the
adjusted heat is significantly higher than the sum of individual risks.

---

## Position Sizing Under Drawdown Limits

### The Prop Firm Problem

Standard position sizing ignores account-level constraints. Prop firm trading has two
hard floors that invalidate naive sizing:

1. **Daily DD limit (5%):** Cannot lose more than $500/day on a $10,000 account
2. **Max DD limit (10%):** Cannot lose more than $1,000 total

These limits are not targets — they are termination triggers.

### Drawdown Budget Framework

```
Daily budget allocation:
  Daily DD limit    = $500
  Safety margin     = 20% → effective daily budget = $400
  Max trades/day    = 3 (typically)
  Max loss/trade    = $400 / 3 = $133 → 1.33% of starting balance

This is lower than our SL cap of 3%, meaning:
  - If 3 trades open and all hit SL: 3 × 1.33% = 4% → within 5% limit
  - If we allow 3% SL per trade: worst case 3 × 3% = 9% → breaches daily AND max limit!
```

This analysis reveals a critical constraint: **with a daily DD limit of 5%, you cannot
have 3 simultaneously open positions each risking 3% per trade.**

### Recommended Per-Trade Risk Under HyroTrader

```
Scenario: MAX 3 simultaneous positions

Per-trade risk budget (conservative):
  Daily budget      = 4% (80% of 5% limit)
  Max simultaneous  = 3
  Per-trade risk    = 4% / 3 = 1.33%

Per-trade risk budget (normal, 2 pairs):
  Daily budget      = 4%
  Max simultaneous  = 2
  Per-trade risk    = 4% / 2 = 2.0%

Current BTCUSDT single-pair operation:
  Per-trade risk    = up to 3% (entire daily budget for 1 trade)
  → Acceptable for 1-pair mode, but requires reduction in multi-pair mode
```

### Dynamic Sizing Tiers Based on Drawdown Progress

This is the most important practical framework for prop firm trading. Position size
must decrease as drawdown progresses:

```
Tier 0 (healthy): equity > 97% of start balance
  → Full size: risk_pct = configured value (e.g., 1.5%)
  → No restrictions beyond normal heat cap

Tier 1 (caution): equity 94-97% of start balance (DD 3-6%)
  → Reduced size: risk_pct × 0.70
  → Max 2 simultaneous positions
  → Raise confluence threshold by +5 pts

Tier 2 (warning): equity 91-94% of start balance (DD 6-9%)
  → Half size: risk_pct × 0.50
  → Max 1 simultaneous position
  → Raise confluence threshold by +10 pts

Tier 3 (danger): equity < 91% of start balance (DD > 9%)
  → Minimum size only (token trading for min day count)
  → OR stop trading entirely
  → Alert Telegram immediately
```

### Daily Drawdown Reset Logic

HyroTrader's daily DD is measured from the **start-of-day equity** (or the highest intraday
equity if trailing). The bot must track:

```typescript
interface DailyState {
  startOfDayEquity: number;        // reset at midnight UTC
  peakIntraday: number;            // track highest equity today
  realizedLossToday: number;       // cumulative closed P&L today (negative)
  unrealizedExposure: number;      // sum of open position risks
  dailyBudgetRemaining: number;    // dailyLimit - realizedLossToday
}

// Before opening new position:
const projectedDailyLoss = dailyState.realizedLossToday - newTradeSLRisk;
if (Math.abs(projectedDailyLoss) > startBalance × 0.045) {
  // block: would consume >90% of daily budget
  return { vetoed: true, reason: 'daily_budget_exhausted' };
}
```

---

## Anti-Martingale Position Sizing

### Core Concept

Anti-Martingale (also called positive progression or reverse Martingale) increases
position size after wins and decreases after losses. This is the opposite of the
mathematically ruinous Martingale system (which doubles down on losses).

### Variants

**Pure Anti-Martingale:**
```
After win:  size = size × 2.0 (double up)
After loss: size = initial_size (reset to base)
```

**Proportional Anti-Martingale:**
```
After n consecutive wins: size = base_size × (1 + n × scale_factor)
After any loss: size = base_size

Example (scale_factor = 0.25):
  Trade 1 (win):  base_size × 1.25
  Trade 2 (win):  base_size × 1.50
  Trade 3 (win):  base_size × 1.75
  Trade 4 (loss): reset to base_size
```

**Van Tharp's "Market's Money" Anti-Martingale:**
```
After equity rises above initial capital + buffer (e.g., 5% profit):
  → Unlock "market's money" tier
  → Additional 0.5× size on positions using only the profit portion
```

### Advantages and Limitations

Advantages:
- Capital is naturally protected during losing streaks
- Profits compound during winning streaks
- Aligns with momentum/trend-following intuition (systems "run hot")
- Banned by no prop firms (unlike Martingale)

Limitations:
- Depends on winning streaks existing — random outcomes benefit least
- Requires system with positive expectancy (all position sizing does)
- Resetting after a single loss can leave gains on the table
- In ranging markets, no streaks form, system reverts to flat base size

### Anti-Martingale for Our Bot

The most appropriate anti-Martingale variant for our SMC system is equity-curve-based
scaling — a softer form that does not depend on consecutive win/loss tracking:

```typescript
function getAntiMartingaleMultiplier(equityCurve: number[]): number {
  const ma20 = movingAverage(equityCurve, 20);
  const currentEquity = equityCurve[equityCurve.length - 1];

  if (currentEquity > ma20 * 1.02) return 1.15;   // equity above MA: +15%
  if (currentEquity > ma20)        return 1.00;   // equity at MA: normal
  if (currentEquity > ma20 * 0.98) return 0.85;   // slightly below: -15%
  return 0.70;                                     // below MA: -30%
}
```

This provides gentle anti-Martingale behaviour without the abrupt reset of pure
consecutive-trade tracking.

---

## Actionable Insights for Our Bot

### Summary: What to Implement

The following is a prioritised implementation roadmap grounded in the research above.

#### Priority 1 — Immediate (pre-multi-pair)

**1. Drawdown Tier System in risk.ts**

```typescript
type DrawdownTier = 0 | 1 | 2 | 3;

function getDrawdownTier(currentEquity: number, startBalance: number): DrawdownTier {
  const ddPct = (startBalance - currentEquity) / startBalance;
  if (ddPct < 0.03) return 0;   // healthy
  if (ddPct < 0.06) return 1;   // caution
  if (ddPct < 0.09) return 2;   // warning
  return 3;                       // danger zone
}

function getRiskPctForTier(basePct: number, tier: DrawdownTier): number {
  const multipliers = [1.0, 0.70, 0.50, 0.20];
  return basePct * multipliers[tier];
}
```

**2. Daily Budget Tracking in daily-state.ts**

Track realized P&L from 00:00 UTC. Block new entries when:
- `realizedLossToday + newTradeRisk > 4.0% × startBalance`

#### Priority 2 — Multi-Pair Launch

**3. Portfolio Heat Cap Enforcement**

```typescript
const PORTFOLIO_HEAT_CAP = 0.04;  // 4% total

// In executor.ts before placing new order:
const existingHeat = positions.reduce((sum, p) => sum + p.riskPct, 0);
const effectiveRisk = Math.min(targetRisk, PORTFOLIO_HEAT_CAP - existingHeat);
if (effectiveRisk < 0.005) return { blocked: 'heat_cap_reached' };
```

**4. Correlation Gate for Simultaneous Positions**

Using 30-day rolling correlation as proxy:
- BTC + ETH open (ρ ≈ 0.87): block third long, or reduce ETH to 50% size
- BTC + ETH + SOL: effectively one position — block new entries, only allow exits

**5. ATR Volatility-Based Sizing**

Formalise the existing `slAtrMultiplier` into a proper volatility-normalised formula:
```
riskDollars = equity × riskPct × ddTierMultiplier × antiMartingaleMultiplier
stopDistance = ATR(14) × slAtrMultiplier
contracts = riskDollars / stopDistance
```

#### Priority 3 — Optimisation Phase

**6. Equity Curve Anti-Martingale**

Implement soft equity-curve-MA-based multiplier (±15-30%) after accumulating 50+
real trades. Requires at minimum 20-trade window for stable MA.

**7. Monte Carlo Validation of Sizing Parameters**

After each 100 trades:
1. Extract R-multiple distribution
2. Run 1,000 Monte Carlo reshuffles
3. Check that 95th percentile drawdown < 8% (leaving 2% buffer to 10% limit)
4. If not: reduce base risk_pct until 95th percentile DD comes within bounds

### Parameter Reference: Current vs Recommended

| Parameter | Current (BTCUSDT single) | Recommended (multi-pair) |
|---|---|---|
| risk_pct per trade | Implicit (22.5% × leverage × SL%) | Explicit: 1.5% per trade |
| max simultaneous | 1 | 3 (with correlation gating) |
| portfolio heat cap | 4% (constants.ts) | 4% active enforcement |
| DD tier 0→1 boundary | Not implemented | 3% drawdown |
| DD tier 1→2 boundary | Not implemented | 6% drawdown |
| ATR-based sizing | Partial (slAtrMultiplier) | Full formula |
| correlation gate | Not implemented | ρ > 0.85 → block |
| anti-Martingale | Not implemented | Equity curve MA method |

### Critical HyroTrader Constraints (Non-Negotiable)

Every position sizing decision must be evaluated against:

1. **SL ≤ 3% per trade** — this is the hard Kelly ceiling, not a target
2. **Daily DD ≤ 5%** — track from start-of-day equity, budget each trade
3. **Max DD ≤ 10%** — triggers Tier 3 (emergency stop)
4. **Exposure ≤ 25% per position** — our 22.5% margin allocation already satisfies this
5. **Total exposure ≤ 2× balance** — at 5× leverage on 22.5% margin: 22.5% × 5 = 1.125×,
   well within limits; at 3 simultaneous: 3 × 1.125 = 3.375× (caution — approaching limit)

**The single most important insight from this research:**

> Position sizing does not determine whether your system is profitable — that is determined
> by edge (expectancy). Position sizing determines whether you survive long enough to
> realise that edge. For a prop firm account with 5%/10% DD limits, survival is everything.
> The optimal strategy is not maximum growth — it is maximum probability of reaching payout
> without breaching limits.

This means: when in doubt, size down. A 25% reduction in risk_pct from 1.5% to 1.125%
reduces expected monthly return by 25% but reduces probability of catastrophic drawdown
by roughly 60% (due to the non-linear relationship between risk and ruin probability).

---

**Sources:**
- Kelly, J.L. (1956). "A New Interpretation of Information Rate." Bell System Technical Journal.
- Vince, R. (1992). "The Mathematics of Money Management." Wiley.
- Tharp, V.K. "Trade Your Way to Financial Freedom." McGraw-Hill.
- Busseti, E. et al. (2016). "Risk-Constrained Kelly Criterion." arXiv.
- [Kelly Criterion — QuantStart](https://www.quantstart.com/articles/Money-Management-via-the-Kelly-Criterion/)
- [Kelly Criterion Formula — QuantMatter](https://quantmatter.com/kelly-criterion-formula/)
- [Optimal F — QuantifiedStrategies](https://www.quantifiedstrategies.com/optimal-f-money-management/)
- [Fixed Fractional vs Fixed Ratio — TTTMarkets](https://tttmarkets.com/articles/fixed-fractional-vs-fixed-ratio-position-sizing/)
- [Fixed Ratio Position Sizing — Adaptrade](http://www.adaptrade.com/Articles/article-frps.htm)
- [ATR Position Sizing — Finaur](https://finaur.com/blog/en/risk-management/atr-trading-strategy/)
- [Portfolio Heat Management — ProTraderDashboard](https://protraderdashboard.com/blog/portfolio-heat-management/)
- [Prop Firm Position Sizing Guide 2026 — PropTradingVibes](https://www.proptradingvibes.com/blog/position-sizing-prop-firms)
- [Dynamic Position Sizing under Drawdown — QuantFish](https://quant.fish/wiki/reducing-position-sizing-during-drawdowns/)
- [Anti-Martingale Strategy — AlgoTradingLib](https://algotradinglib.com/en/pedia/a/anti-martingale_strategy.html)
- [Risk-Constrained Kelly — QuantInsti](https://blog.quantinsti.com/risk-constrained-kelly-criterion/)

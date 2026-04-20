---
name: crypto-trade-planner
description: >
  Plan a complete trade with entry, stop-loss, take-profit, position size, and risk assessment.
  Anchored to pre-committed zones and flow confirmation per the 12-factor rubric.
  Use when you have a valid signal (≥9/12) and need to build a full trade plan before execution.
  Triggers: "trade plan", "plan entry", "setup trade", "where to enter", "SL/TP"
user_invocable: true
arguments:
  - name: pair
    description: "Trading pair (e.g., BTCUSDT)"
    required: true
  - name: direction
    description: "LONG or SHORT"
    required: true
---

# Crypto Trade Planner

Converts a valid 12-factor signal into an executable trade plan: entry, SL, TP, size, rationale. You call `execute.ts` with the result.

## When to Use

- After crypto-signal-generator produces a ≥ 9/12 signal with all hard gates passing.
- Before any `execute.ts open` or `execute.ts place-limit` call.

## Research Foundation

- `docs/research/swing-trading-methodology.md` — entry/exit mechanics
- `docs/research/execution-algorithms-johnson.md` — limit placement, OBI
- `docs/research/stop-hunting-market-traps.md` — SL placement beyond liquidity
- `docs/research/demand-supply-dynamics.md` — zone-based entry
- `docs/research/support-resistance-mastery.md` — TP at next major level

## Step 1 — Validate setup (hard gates)

Before planning, confirm:
1. **Confluence score ≥ 9/12** (standard), ≥ 10/12 (counter-trend), or 8/12 with STRONG Factor 1 + Factor 4 = 1.
2. **Risk manager CLEAR** — daily DD < 4%, total DD < 8%.
3. **Factor 1 has flow confirmation** — BOS aligned with cvd_5m (or cvd_1m for STRONG).
4. **No macro catalyst within 30 min** — check `vault/Watchlist/catalysts.md`.
5. **Slot available** — open + pending < 5 (3 base, 5 A+).
6. **Total heat + proposed risk < 5%**.
7. **Not within funding window** (±10 min around 00/08/16 UTC) — hard block. 24h trading otherwise; in dead zone (22-00 UTC) require +1 confluence and apply size ×0.7.

Any fail → **NO TRADE**. Log reason in Journal.

## Step 2 — Zones as entry anchor

Entries are **anchored to pre-committed zones** from `vault/Watchlist/zones.md` (rewritten at each 1H close). Three entry modes:

- **At zone tap (limit):** price hasn't reached the zone yet → place limit at zone edge + 0.1% buffer.
- **At zone sweep + reclaim (market):** `zone_swept_15m=true` + reclaim confirmed by CVD → market entry.
- **Momentum pullback (market):** trending regime, price pulled back to EMA21 or prior S/R with flow intact → market entry at current with tight SL.

**Never enter outside a zone.** Trading outside zones = chasing.

## Step 3 — Entry placement

**Limit-order distance rules (from CLAUDE.md § "Limit Order Rules"):**

| Condition | Max limit distance |
|---|---|
| ADX>25 + dominant DI (trend) | **≤ 0.3%** from price |
| ADX<20 (range) | ≤ 0.5% acceptable |
| Never limit > 0.6% from price | unless at major structural level |

**Cancel a limit when:**
- Price drifted > 0.3% away from limit
- ADX climbed > 5 pts (momentum shifted)
- Structure invalidated (BOS flip confirmed by CVD)
- Don't wait for 45-min maxAge

## Step 4 — Stop-loss (WITHIN 5 MIN — INVIOLABLE)

Structural placement + ATR buffer:
- **LONG:** below the swept low / demand zone / OB base − 0.5× ATR(1H)
- **SHORT:** above the swept high / supply zone / OB top + 0.5× ATR(1H)
- Place **beyond liquidity pools** (equal lows for LONG, equal highs for SHORT).

**Distance caps** (executor rejects otherwise):
- BTC: max 2% from entry
- Alts: max 3% from entry
- Min: 0.5× ATR (avoid noise stops)

## Step 5 — Take-profit

TP = **next major structural level** (1H OB, 4H pivot, prior-day H/L, liq-cluster magnet). NOT micro nearS/nearR.

| Rule | Value |
|---|---|
| Minimum R:R | 1.5 |
| Preferred R:R | 2.0+ |
| Single TP (default) | next major level |
| Multi-TP (A+ only, 11+/12) | 50% at 1R, 50% trailed |

If next major level gives R:R < 1.5 → **reject trade** (shallow TP in trend = underscoring the move).

## Step 6 — Size

From confluence score:

| Score | Risk % |
|---|---|
| 12/12 (A+) | 1.0% |
| 10-11/12 (A) | 0.75% |
| 9/12 (B+) | 0.5% |
| 8/12 (structural only) | 0.5% |

**News multipliers stack:**
- High-impact news (3+ triggers active) → ×0.25
- Medium-impact (1-2 triggers) → ×0.5
- F&G ≤15 → additional ×0.5

**Regime transitioning** (`hmm_regime.transitioning=true`) → ×0.5.

Delegate math to **crypto-position-sizer**: size_usdt = risk_usd / (sl_distance_pct).

## Step 7 — Peak-protection cascade (post-entry)

Managed automatically by the trailing logic in executor + `vault/Playbook/exit-rules.md`:

- **At +1.5R:** SL moves to breakeven, 1× ATR(1H) trail activates.
- **< 1R profit + OPPOSITE score ≥ 8/12 after 9-min grace:** proactive exit via `execute.ts close`.
- **OPPOSITE ≥ 10/12 at any profit < 1R:** force exit.
- **Profit > 1R:** let the trail handle it. Never exit early.

## Step 8 — Output (for the execute.ts call)

```
## TRADE PLAN: {PAIR} {LONG/SHORT} — {timestamp}

### Signal
- Confluence: {score}/12 — {A+/A/B+/Structural}
- Factor 1 flow: {cvd_5m / cvd_1m confirmation}
- HMM regime: {state} @ {confidence}
- Zone: {zone-id from zones.md}

### Levels
- Entry: {price} ({market / limit})
- Stop-Loss: {price} ({distance_pct}%, structural + 0.5×ATR)
- Take-Profit: {price} ({R:R})
- R:R: {ratio}

### Sizing
- Risk: {risk_pct}% × {news_mult} × {regime_mult} = {effective}% = ${dollar_risk}
- Notional: ${notional}
- Contracts: {qty}

### Execute command
npx tsx src/execute.ts open \
  --symbol {pair} --direction {Long/Short} \
  --entry {entry} --sl {sl} --tp {tp} \
  --risk-pct {pct} --confluence {score}/12 \
  --rationale-file /tmp/rationale.txt

### Rationale (goes in --rationale-file)
{2-3 sentences: what confluence, which flow signal, why this zone, what invalidates}
```

## Key Principles

1. **No plan, no trade.** Every open has a complete plan persisted to Trade file.
2. **Zones anchor entries.** Trading outside zones = chasing.
3. **SL within 5 min — inviolable.** Move only tighter, never wider.
4. **Minimum 1.5 R:R.** Prefer 2.0. Shallow TP in a trending move = underscoring.
5. **Flow confirms structure.** No CVD → no STRONG Factor 1.
6. **Limit distance is tight in trends.** ≤ 0.3% at ADX>25, cancel early when drifted.
7. **News/regime multipliers stack.** Apply before sizing.

# Strategy v3 — VP-SMC

**Active.** Codified after backtest gate passed on BTC + ETH.

> Source of truth for entry/exit rules. If this contradicts CLAUDE.md, CLAUDE.md wins (operational charter > strategy file). Lessons-learned informs the next revision; it does not override active rules mid-cycle.

---

## Scope

- **Pairs:** BTCUSDT, ETHUSDT (Bybit perpetual, linear).
- **Decision TF:** 1H close.
- **Direction:** long + short, mean-reversion to value.
- **Goal:** ≥1% / month / pair on starting equity (combined ~2%/month).

---

## Thesis

Price spends most time inside its **value area** (70% of session volume). When price taps the **edge** of value (VAL/VAH) and **re-enters**, mean reversion to **POC** has positive expectancy if confirmed by:

1. **HTF context** — previous-week structural levels (PWL/PWH) as bias filter and structural SL anchor.
2. **Order-flow imbalance** — bullish/bearish FVG (Fair Value Gap) on 1H within last N bars.
3. **Crowd-fade** — funding not extreme + top traders not already on the same side (else no edge in fading).

Stops are placed at **structural levels (PWL/PWH ± 0.3 × ATR)**, not statistical (BB/ATR-multiplier). Targets are **POC / opposite VA edge**, not arbitrary R-multiples.

---

## Entry rules

### LONG (BTC and ETH)

All conditions required (1H close):

| # | Condition | Source |
|---|---|---|
| 1 | **VAL touched** within last 6 × 1H bars (any low ≤ VAL) | Daily VP from prior 24×1H |
| 2 | **Re-entry above VAL** — current close > VAL | 1H close |
| 3 | **Bullish FVG** present in last 8 × 1H bars: `bar[n−2].high < bar[n].low` and gap ≥ 0.3 × ATR | 1H bars |
| 4 | **Above PWL** — current price > previous-week low | Last closed 1W bar |
| 5 | **No funding extreme** — `|funding_oi_weighted|` ≤ 0.005 | Coinglass |
| 6 | **Top traders not too long** — `ls_top_position` ≤ 1.7 | Coinglass |
| 7 | **Stop sane** — proposed SL distance is between `0.5 × ATR` and `3.0%` of price (BTC) / `4.5%` (ETH) | computed |
| 8 | **TP1 valid** — TP1 ≥ entry + 0.4 × ATR (must be in trade direction) | computed |
| 9 | **Cooldown clear** — ≥6h since last LONG signal on this symbol | tracker |

### SHORT — mirror

Replace VAL→VAH, PWL→PWH, bullish FVG→bearish FVG (`bar[n−2].low > bar[n].high`), `ls_top_position ≥ 0.7`.

### Coinglass missing → permissive

If Coinglass features are null at decision time (data gap, early backfill window), **conditions 5–6 default to pass**. Documented gap in OOS coverage; live trading runs with full Coinglass.

---

## Exits — fixed

| Element | Long | Short |
|---|---|---|
| **SL** (initial) | PWL − 0.3 × ATR | PWH + 0.3 × ATR |
| **TP1** | POC (or VAH if entry already above POC) | POC (or VAL if entry already below POC) |
| **TP2** | VAH (or VAH + 0.5 × VA-width if shifted) | VAL (or VAL − 0.5 × VA-width if shifted) |
| **TP1 fill action** | Close 50%, move SL → breakeven | Close 50%, move SL → breakeven |
| **Server-side SL** | Bybit `stopLoss` param at order create, within 5 min | same |
| **SL move** | `amend_order` — never cancel-then-create | same |

No discretionary exits. No trailing beyond TP1→BE. Time stop = end of test window only (live: hold until SL/TP).

---

## Sizing

- **Risk per trade base:** 0.6% of equity.
- **Hard cap:** 1.0% (CLAUDE.md global).
- **Leverage cap:** notional ≤ equity × 10. Strategy auto-trims qty if structural SL is too tight (good — avoids the −141R pre-fix incident).
- **Max parallel:** 2 (one per pair).
- **Total heat cap:** 1.5% of equity (CLAUDE.md).

---

## Volume Profile construction

**Lookback:** 24 × 1H bars **before** the current 6-bar touch window (so VP is "what was value yesterday", touch is "what's happening now").

**Bins:** 24, evenly distributed between min(low) and max(high) of the lookback slice.

**Volume distribution:** each bar's volume is split evenly across bins overlapped by `[bar.low, bar.high]`.

**POC:** bin with maximum volume.

**Value Area (70%):** start at POC, expand symmetrically (toward whichever neighbor bin has higher volume) until cumulative volume ≥ 70% of total. VAL = lower edge of the area, VAH = upper edge.

---

## Filters / safety

- **Cooldown:** 6h between same-side entries on same pair (prevents over-trading the same VAL/VAH touch).
- **Min stop:** 0.5 × ATR (rejects too-tight SLs that get noised out).
- **Max stop:** 3.0% of price for BTC, 4.5% for ETH (ETH "step is bigger" — wider tolerance).
- **Min TP distance:** 0.4 × ATR (rejects TP-too-close which makes TP1→BE eat all the wins).
- **CLAUDE.md global gates** apply on top: dead zone (22:00–00:00 UTC), funding window (±10 min around 00/08/16 UTC), daily kill switches.

---

## Backtest evidence (1y OOS, walk-forward 30d windows)

Period: 2025-04-29 → 2026-04-29. Coinglass full coverage only last ~85 days; first 280d ran with permissive crowd-fade.

| Metric | BTC | ETH | Gate | OK |
|---|---|---|---|---|
| Trades | 57 | 66 | ≥100 (combined 123) | ✅ |
| WR | 87.7% | 90.9% | — | |
| **expR** | **0.370R** | **0.368R** | ≥0.3 | ✅ |
| **PF** | **8.98** | **6.73** | ≥1.4 | ✅ |
| **MaxDD** | **0.63%** | **1.25%** | ≤4% | ✅ |
| Sharpe | 13.05 | 12.81 | — | |
| Net %/year | +11.99% | +14.15% | — | |
| **≈ /month** | **1.00%** | **1.18%** | ≥1% | 🎯 |
| Profitable WF windows | 12/13 | 11/13 | — | |

Worst trade: −1.05R (clean SL hit, no anomaly). Worst window: −0.55R (BTC May 2025, 7 trades, MaxDD 0.6% — survivable).

---

## Parameters (locked)

```ts
// src/backtest/strategies/btc-vp-smc.ts → DEFAULT_BTC_VP_SMC
{
  // Volume profile
  vpBins: 24,
  vpValueAreaPct: 0.7,
  vpLookbackHours: 24,
  vpVaTouchLookback: 6,
  vpReentryRequired: true,
  // FVG
  fvgLookback: 8,
  fvgMinSizeAtrFrac: 0.3,
  // Crowd fade
  fundingExtremeAbs: 0.005,
  lsTopMaxLong: 1.7,
  lsTopMinShort: 0.7,
  // SL / TP
  slBufferAtr: 0.3,
  minStopAtr: 0.5,
  maxStopAtrPct: 3.0,    // ETH override: 4.5
  minTpAtrFromEntry: 0.4,
  // Sizing
  riskPct: 0.6,
  // Cooldown
  cooldownHours: 6,
}
```

ETH uses the same defaults with one override: `maxStopAtrPct: 4.5`. See `src/backtest/cli/eth-vp-smc.ts`.

---

## What this strategy does NOT do

- **No trend-following.** Pure mean reversion. In sustained trends without value-area touches, no signals fire — that's correct, not a bug.
- **No momentum continuation.** If price is above POC and tagging VAH from above, no LONG (TP1 invalid).
- **No counter-HTF.** LONG below PWL and SHORT above PWH are blocked.
- **No re-entry within 6h.** Same VAL touch will not re-fire (this fix took us from 25→15 trades on 85d but raised expR meaningfully).

---

## When to revisit

- **WR < 60% on last 20 trades** → review.
- **3 consecutive losing weeks** → pause and review.
- **A regime change in BTC structure** (ATH break, sub-50k crash) — value-area logic still works but PWL/PWH stretches; verify max-stop limits don't choke it.
- **Coinglass coverage extends to full year** → re-run OOS to confirm crowd-fade adds edge.

Lessons go to `lessons-learned.md`. Strategy file stays locked between formal revisions.

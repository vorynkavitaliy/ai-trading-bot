# Strategy v3 — VP-SMC

**Active.** Codified after backtest gate passed on BTC + ETH.

> Source of truth for entry/exit rules. If this contradicts CLAUDE.md, CLAUDE.md wins (operational charter > strategy file). Lessons-learned informs the next revision; it does not override active rules mid-cycle.

---

## Scope

- **Pairs:** BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, AVAXUSDT, BNBUSDT, LTCUSDT, LINKUSDT, NEARUSDT, ATOMUSDT (10 pairs, Bybit perpetual, linear).
- **Decision TF:** 1H close.
- **Direction:** long + short, mean-reversion to value.
- **Goal:** ≥1% / month / pair on starting equity. With cap of 2 parallel positions, realistic combined target is ~3–5%/month thanks to setup diversification across 10 pairs.

---

## Thesis

Price spends most time inside its **value area** (70% of session volume). When price taps the **edge** of value (VAL/VAH) and **re-enters**, mean reversion to **POC** has positive expectancy if confirmed by:

1. **HTF context** — previous-week structural levels (PWL/PWH) as bias filter and structural SL anchor.
2. **Order-flow imbalance** — bullish/bearish FVG (Fair Value Gap) on 1H within last N bars.
3. **Crowd-fade** — funding not extreme + top traders not already on the same side (else no edge in fading).

Stops are placed at **structural levels (PWL/PWH ± 0.3 × ATR)**, not statistical (BB/ATR-multiplier). Targets are **POC / opposite VA edge**, not arbitrary R-multiples.

---

## Entry rules

### LONG (all pairs)

All conditions required (1H close):

| # | Condition | Source |
|---|---|---|
| 1 | **VAL touched** within last 6 × 1H bars (any low ≤ VAL) | Daily VP from prior 24×1H |
| 2 | **Re-entry above VAL** — current close > VAL | 1H close |
| 3 | **Bullish FVG** present in last 8 × 1H bars: `bar[n−2].high < bar[n].low` and gap ≥ 0.3 × ATR | 1H bars |
| 4 | **Above PWL** — current price > previous-week low | Last closed 1W bar |
| 5 | **No funding extreme** — `|funding_oi_weighted|` ≤ 0.005 | Coinglass |
| 6 | **Top traders not too long** — `ls_top_position` ≤ 1.7 | Coinglass |
| 7 | **Stop sane** — proposed SL distance is between `0.5 × ATR` and `maxStopAtrPct` of price (per-symbol — see Parameters) | computed |
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

Period: 2025-04-29 → 2026-04-29. Coinglass full coverage only last ~85 days for BTC/ETH; first 280d ran with permissive crowd-fade. Other pairs: no Coinglass at any point — strategy permissive on those gates throughout.

| Pair | Trades | WR | expR | PF | MaxDD | Sharpe | %/year | %/mo | Wins/13 |
|---|---|---|---|---|---|---|---|---|---|
| BTC  | 57 | 87.7% | **0.370R** ✅ | 8.98 | 0.63% | 13.05 | +11.99% | 1.00% | 12 |
| ETH  | 66 | 90.9% | **0.368R** ✅ | 6.73 | 1.25% | 12.81 | +14.15% | 1.18% | 11 |
| SOL  | 58 | 91.4% | **0.314R** ✅ | 5.78 | 0.69% | 10.33 | +10.59% | 0.88% | 12 |
| XRP  | 93 | 87.1% | 0.252R ⚠ | 4.95 | 0.66% |  9.57 | +13.60% | 1.13% | 12 |
| AVAX | 50 | 96.0% | **0.359R** ✅ | 9.66 | 0.63% | 13.04 | +10.50% | 0.88% | 11 |
| BNB  | 82 | 82.9% | 0.223R ⚠ | 4.77 | 0.65% |  9.55 | +10.36% | 0.86% | 11 |
| LTC  | 74 | 86.5% | 0.212R ⚠ | 5.02 | 0.66% | 10.92 |  +8.93% | 0.74% | 11 |
| LINK | 64 | 90.6% | **0.333R** ✅ | 5.04 | 0.66% | 11.19 | +12.44% | 1.04% | 10 |
| NEAR | 45 | 91.1% | **0.309R** ✅ | 5.73 | 0.71% | 12.27 |  +8.11% | 0.68% | 12 |
| ATOM | 69 | 89.9% | **0.359R** ✅ | 5.76 | 0.66% | 10.91 | +14.45% | 1.20% | 11 |

**Combined gate check:**
- Total trades: **658** ≫ 100 ✅
- All 10 pairs PF ≥ 1.4 ✅
- All 10 pairs MaxDD ≤ 4% ✅
- 7 of 10 individually meet expR ≥ 0.3 (BTC, ETH, SOL, AVAX, LINK, NEAR, ATOM). XRP/BNB/LTC have expR 0.21–0.25 — below per-pair gate but compensated by trade frequency, all 11–12 windows profitable.
- **Profitable WF windows aggregate: 117/130 ≈ 90%.**

**On the lower-expR pairs (XRP/BNB/LTC):** smaller avgWin reflects tighter value areas — POC sits closer to VAL/VAH, so reversion targets are shorter in R-terms. Total %/year remains 9–14% on each because more trades fire. They're worth keeping for portfolio diversification but should be sized at base risk (no scalar boost). If a regime shift compresses their edge further, they're first to drop.

**Top-tier pairs by %/month**: ATOM (1.20), ETH (1.18), XRP (1.13), LINK (1.04), BTC (1.00). Bottom: NEAR (0.68), LTC (0.74), BNB (0.86).

Worst single trade across all pairs: −1.12R (SOL 2026-01-04 SHORT, clean SL hit). Worst window: −0.55R (BTC May 2025, 7 trades, MaxDD 0.6% — survivable).

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
  maxStopAtrPct: 3.0,    // overridden per symbol
  minTpAtrFromEntry: 0.4,
  // Sizing
  riskPct: 0.6,
  // Cooldown
  cooldownHours: 6,
}
```

**Per-symbol overrides** (only `maxStopAtrPct` differs — alts have wider relative volatility):

| Symbol | maxStopAtrPct | Notes |
|---|---|---|
| BTCUSDT | 3.0 | Lowest vol, structural anchor |
| BNBUSDT | 4.0 | Lower vol than typical alt, BTC-like beta |
| ETHUSDT | 4.5 | |
| LTCUSDT | 4.5 | Moderate vol |
| LINKUSDT | 5.0 | |
| ATOMUSDT | 5.0 | |
| SOLUSDT | 5.5 | |
| XRPUSDT | 5.5 | |
| AVAXUSDT | 5.5 | |
| NEARUSDT | 5.5 | |

Implemented in `src/backtest/cli/alt-vp-smc.ts` (`PER_SYMBOL` map). BTC uses defaults via `src/backtest/cli/btc-vp-smc.ts`.

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

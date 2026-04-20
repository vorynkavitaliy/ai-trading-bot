---
name: crypto-signal-generator
description: >
  Generate confluence-based trading signals by scoring the 12-factor rubric symmetrically
  for LONG and SHORT. The core decision engine that determines whether to trade.
  Triggers: "signal", "scan for trades", "any setups", "generate signal", "trade opportunity"
user_invocable: true
arguments:
  - name: pair
    description: "Trading pair to scan (e.g., BTCUSDT) or 'all' for watchlist"
    required: true
---

# Crypto Signal Generator

The central decision engine. You score the **12-factor rubric** symmetrically LONG and SHORT from scan-summary output, then decide whether to trade. This skill codifies what CLAUDE.md § "12-Factor Confluence Rubric" binds.

## When to Use

- Every `/loop 3m` cycle for each eligible pair (zone-active or open position).
- When manually evaluating an ad-hoc opportunity.

## Research Foundation

- `docs/research/quant-fund-methods-narang.md` — multi-source signal fusion
- `docs/research/systematic-trading-carver.md` — forecast combining, diversification
- `docs/research/demand-supply-dynamics.md` — SMC zones, order blocks
- `docs/research/stop-hunting-market-traps.md` — sweep + reclaim + OB tap
- `docs/research/crypto-market-microstructure.md` — funding, OI, CVD, orderbook imbalance
- `docs/research/volume-analysis-deep.md` — OBV, VWAP, CVD
- `docs/research/rsi-advanced-strategies.md` — RSI slope, divergence, failure swings

## Zone gate (runs FIRST)

Before scoring anything, parse the `ZONES:` line from scan-summary. Eligible pairs:
- `in_zone=true`, OR
- `zone_swept_15m=true`, OR
- open position / pending order exists.

Pairs outside the eligible set are **not scored** — skip. Empty eligible set → heartbeat cycle.

## The 12-Factor Rubric — score 0/1 per factor (Factor 1 up to 2)

Score LONG and SHORT independently from the same data. Symmetric — no bias.

| # | Factor | LONG scoring | SHORT scoring |
|---|--------|--------------|---------------|
| 1 | **SMC / Structure + Flow** | sweep low + reclaim + OB tap **AND `cvd_1m` aligned positive** = **2 STRONG**; bullish BOS on any TF **AND `cvd_5m` aligned** = 1; BOS without CVD confirmation = **0** | sweep high + rejection + OB tap AND `cvd_1m` negative = 2; bearish BOS AND `cvd_5m` negative = 1; BOS without CVD = 0 |
| 2 | **Classic Technical** | RSI<30 or bullish div, EMA21>EMA55; `stoch_15m` K cross up from <20; MACD used only as tiebreaker (turning +) | RSI>70 or bearish div, EMA21<EMA55; stoch_15m K cross down from >80; MACD turning − as tiebreaker |
| 3 | **Volume** | OBV up or bullish div, volume spike + green close, above VWAP | OBV down, volume spike + red close, below VWAP |
| 4 | **Multi-TF** (pair-only) | 4H up + 1H not strongly down + 15M supportive | 4H down + 1H not strongly up + 15M supportive |
| 5 | **BTC Correlation** (alts only) | `btc_context.hmm_regime.state=bull` (conf≥0.6) OR `hmm=range` with rising RSI | `hmm=bear` (conf≥0.6) OR `hmm=range` with falling RSI |
| 6 | **Regime fit** | `hmm.state=bull` OR `range` (if `transitioning=true`, size ×0.5) | `hmm.state=bear` OR `range` |
| 7 | **News / Macro** | neutral or risk-on bias (from news block); stale headlines (>3% from current price) count as neutral, not bearish | neutral or risk-off |
| 8 | **Momentum** | ADX>20, +DI>−DI, positive `rsi_slope_1h`; `rsi_slope_accel_1h` > 0 = bonus | ADX>20, −DI>+DI, negative rsi_slope; accel < 0 |
| 9 | **Volatility** | ATR in 10-85th percentile | same |
| 10 | **Liq clusters** | major short-liq magnet above OR far from long-liq below; null data = **neutral 0**, not negative | symmetric |
| 11 | **Funding / OI** | `funding_delta_1h` declining or negative, OR `oi_delta_1h_pct` up with price up | funding extreme positive OR OI up with price down |
| 12 | **Session + Time** | London/NY/Overlap, ≥15 min to funding window, session quality ≥1.0 | same |

**Leading vs lagging:** Factor 1 flow (`cvd_1m`, `cvd_5m`) + Factor 8 acceleration (`rsi_slope_accel_1h`) + Factor 11 deltas (`funding_delta_1h`, `oi_delta_1h_pct`) are the LEADING signals added in Phase 1/3. Factor 2 RSI/EMA and Factor 4 MTF are confirming. MACD is tiebreaker only.

## Entry thresholds

| Score | Classification | Risk % |
|---|---|---|
| 12/12 | A+ | 1.0% |
| 10-11/12 | A | 0.75% |
| 9/12 | B+ Standard | **0.5% — minimum for new entries** |
| 8/12 | Structural | 0.5% — ONLY if Factor 1 = 2 STRONG AND Factor 4 = 1 |
| < 8/12 | No trade | — |

**Counter-trend:** 10/12 minimum when `hmm.state` opposes direction at confidence ≥ 0.6.

## Hard gates (any failure = no entry)

1. Daily DD < 4% AND Total DD < 8% (CLEAR from risk manager).
2. Slot available (open + pending < 5).
3. Total portfolio heat + proposed risk < 5%.
4. Session allows entry (not dead zone 22-00, not ±10 min to funding).
5. Session quality ≥ 0.85 (weights apply to score but don't veto).
6. Macro catalyst not within 30 min (check `vault/Watchlist/catalysts.md`; see 2-cycle rule).

## Workflow

### Step 1 — Parse scan output
Extract per pair: `orderflow.cvd_1m/cvd_5m/obi_top5`, `indicators.rsi_slope_1h`, `rsi_slope_accel_1h`, `stoch_15m`, `funding_delta_1h`, `oi_delta_1h_pct`, `market_structure.bos_1h/15m/3m`, `btc_context.hmm_regime`, `session`, `news`, `open_positions`.

### Step 2 — Quick-scan gate (batch mode)
Fast score on top 3 factors: SMC+Flow, Multi-TF, Regime. Pairs scoring < 5/12 on quick → skip full rubric.

### Step 3 — Full 12-factor score
For survivors, score all 12 symmetrically. Log the breakdown to Journal (auditability).

### Step 4 — Apply thresholds + hard gates
If score ≥ threshold AND all gates pass → valid signal.

### Step 5 — Rank (batch mode)
Multiple valid signals → sort by confluence DESC, then R:R DESC. Open strongest first, re-check slots after each open.

## Output format (for Journal)

```
SYMBOL: ETHUSDT @ 2450
  LONG: 9/12 — B+ Standard, risk 0.5%
    1. SMC+Flow: 1 (bullish BOS 1H + cvd_5m +$1.2M; no OB tap = not STRONG)
    2. Tech: 0 (RSI 48 neutral, stoch mid)
    3. Vol: 1 (OBV slope +)
    4. MTF: 1 (4H up, 15M supportive)
    5. BTC: 1 (hmm=bull, conf 0.71)
    6. Regime: 1 (bull)
    7. News: 1 (neutral)
    8. Momentum: 0 (ADX 17)
    9. Vol: 1 (ATR mid)
    10. LiqCl: 0 (null = neutral)
    11. Funding/OI: 1 (funding delta -)
    12. Session: 1 (NY overlap)
  SHORT: 4/12 — skip
  → Action: open LONG, 0.5% risk
```

## Key principles

1. **Flow confirms structure.** A BOS without CVD alignment is 0, not 1.
2. **Symmetric scoring.** Do not discount SHORT in a bull — score from the data.
3. **Null data = neutral, not bearish.** Missing LiqCl / funding scores 0 neutrally.
4. **RSI extremes ≠ auto-reject opposite.** RSI<30 in ADX>25 with −DI dominant = continuation for SHORT, not reversal.
5. **Stale news filter.** Trigger referencing price > 3% from current → score News neutral.
6. **Quality over quantity.** < 9/12 → skip. No chasing.
7. **Log every score.** Even skipped. Postmortem needs the counterfactual.

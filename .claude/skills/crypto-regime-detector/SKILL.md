---
name: crypto-regime-detector
description: >
  Read the current market regime from the HMM output in scan-summary.
  Use when assessing overall market conditions, deciding exposure level, or filtering trades.
  Triggers: "regime", "market state", "bull or bear", "market conditions", "exposure level"
user_invocable: true
---

# Crypto Regime Detector — HMM Wrapper

**Post-refactor architecture:** regime classification is now done by a trained 3-state Gaussian HMM (hidden Markov model) on BTC 1H log-returns + realized vol. The scanner emits the HMM output on every cycle. This skill is a thin wrapper — you do not compute regime yourself.

## Authoritative field

`scan-summary.ts` emits, per cycle, inside `btc_context`:

```
hmm_regime: {
  state: "bull" | "bear" | "range",
  probs: { bull: 0.xx, bear: 0.xx, range: 0.xx },
  confidence: 0.0-1.0,     // probability of the top state
  transitioning: bool      // true if top-2 states within 0.15 of each other
}
```

This **replaces** the old rule-based `effective_regime` field. Old TA heuristics (EMA alignment, ADX thresholds, BTC.D, DXY, 4-factor weighted scoring) are retired — the HMM learns the mixture from data.

## How the 12-factor rubric uses it

| Factor | LONG | SHORT |
|---|---|---|
| 5 — BTC Correlation (alts only) | `hmm.state=bull` (conf≥0.6) OR `hmm=range` with rising RSI | `hmm.state=bear` (conf≥0.6) OR `hmm=range` with falling RSI |
| 6 — Regime fit | `hmm.state=bull` OR (`hmm=range` AND `transitioning=true`, size ×0.5) | `hmm.state=bear` OR (`hmm=range` AND `transitioning=true`, size ×0.5) |

**Counter-trend threshold:** 10/12 minimum when `hmm.state` opposes trade direction and `confidence ≥ 0.6`.

## Workflow

1. Read `btc_context.hmm_regime` from the scan output. Done.
2. If `hmm_regime == null` (params file missing, infer error) → **fall back to slow 4H `regime` field**. Flag in Journal: "HMM unavailable — scored on 4H regime only." Trigger retrain via `npm run train-hmm`.
3. If `hmm_regime.transitioning == true` → size ×0.5 on any entry, prefer mean-reversion over trend-following, require extra confluence.
4. If top-of-hour and `hmm.state` differs from last hour → flag next cycle as "regime shift", full-score all 8 pairs regardless of zone gate (see CLAUDE.md § "1H-Close Protocol").

## Retraining

Weekly cadence. Run `npm run train-hmm` to refit params on a fresh rolling window. Params file: `src/analysis/regime-hmm.params.json`. If this file is stale (> 14 days) or missing, infer returns null and fallback kicks in.

## Key principles

1. **HMM is authoritative** — do not re-compute regime from EMA/ADX/DXY.
2. **Confidence matters** — a bull state at 0.45 confidence is a transitioning market, treat as range.
3. **Transitioning = smaller size** — the posterior is split, so is your conviction.
4. **BTC leads alts** — Factor 5 is the alts' regime channel through BTC.
5. **Retrain weekly** — HMM params drift as market structure evolves.

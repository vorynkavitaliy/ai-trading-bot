/**
 * Per-pair strategy mapping for the live portfolio.
 *
 * ── STANDALONE TWO-SIDED-EDGE PORTFOLIO (2026-06-03 migration) ───────────────────
 * Retired the v5 8-pair scaled-in alt book in favour of a 3-pair portfolio of
 * individually walk-forward-validated, SINGLE-ENTRY (no DCA) strategies: BTC + SOL + ADA.
 *
 * How it was built (see memory/project_standalone_pairs_2026_06_03 +
 * project_btc_eth_signal_edge_2026_06_03):
 *   - Per-pair config search (single entry, both OOS halves) → each pair's winner.
 *   - Long/short balance = the robustness test. BTC + SOL are genuine TWO-SIDED edges
 *     (both sides profitable). ADA is two-sided but short-tilted (long works, smaller) —
 *     the watch-pair (weakest OOS, flat in the reverse walk-forward split).
 *   - Walk-forward BOTH directions (select config on TRAIN, validate on untouched TEST),
 *     selection by PF (robustness, not max-sumR): OOS +43-62%/yr, MaxDD 3-7%, 0 Hyro
 *     breaches. Honest expectation ≈ +50%/yr (in-sample +64% was selection-inflated).
 *   - Universal packaging: DROP scaled-in DCA (loses on low/mid-vol pairs — the tight-SL
 *     artifact). BTC → ls_top_position fade (funding flips on BTC); alts → funding fade,
 *     wider thresholds .70/.30. BTC-trend filter is load-bearing (alts follow BTC).
 *
 * pair-strategies.ts is the SINGLE SOURCE OF TRUTH for the live universe + per-pair
 * strategy + per-pair risk. tier1Pairs()/getStrategyForPair() flow to scan-decide,
 * risk-guard, reporting, ingestion. Disabling a pair here drops it everywhere at once.
 *
 * Multi-entry execution path (still present for any future scaled-in pair): scaledIn
 * config flows strategy.decide() → Action → scan-decide JSON → auto-execute → execute.ts.
 * The active 3 pairs are single-entry (no scaledIn) → one limit order each.
 */
import { Strategy } from '../backtest/types';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../strategies/cg-fade';
import { cgSlowFadeV5 } from '../strategies/cg-slow-fade';

// ── v5 cgSlowFade portfolio (2026-06-10 migration from srcNew research) ────────
// Per-trade risk: BTC carries 1.0% (the most validated leg: permutation p=0.000,
// full stress battery); alts 0.5%. Heat 1.0+0.5×3 = 2.5% < 3.75% cap.
// Headline (limit entries): +64.1%/yr, MTM maxDD -8.17%, worst day -2.36%.
// Measured LIVE config (market entry, CG lag-1, asymmetric funding window =
// boundary entries taken): +52.5%/yr, PF 1.50, maxDD -6.92%, worst day -2.96%
// — live-policy-experiments.ts 'market-lag120' 2026-06-10.
export const LIVE_RISK_PCT = 0.5;          // alt per-trade risk (ETH/SOL/XRP)
export const LIVE_RISK_PCT_BTC = 1.0;      // BTC per-trade risk

// Archived risk constants (standalone portfolio 2026-06-03, retired 2026-06-10).
export const LIVE_RISK_PCT_LINK = 0.6;

// Scaled-in FIXED config — ARCHIVED. Only the disabled v5 pairs below reference it.
// The active 3-pair portfolio is single-entry (drop-DCA was a universal win).
const SCALED_IN_FIXED = {
  nEntries: 3,
  spacingAtr: 0.5,
  tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const,
  dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

export interface PairStrategyCfg {
  pair: string;
  strategy: Strategy;
  enabled: boolean;
}

export const TIER1_PORTFOLIO: PairStrategyCfg[] = [
  // ═══ ACTIVE — v5 cgSlowFade portfolio (2026-06-10), SINGLE ENTRY MARKET, mixed risk ═══
  // Validated end-to-end on the srcNew honest engine (see src/strategies/cg-slow-fade.ts
  // header): permutation p=0.000, WF both directions OOS +18%/half, 11/13 months green.
  // BTC — own signals (L/S top position + funding fade + liq-cascade momentum short).
  { pair: 'BTCUSDT', enabled: true,
    strategy: cgSlowFadeV5({ btcMode: 'none', riskPct: LIVE_RISK_PCT_BTC }) },
  // ETH — own signals gated by BTC trend, shorts only (long leg dead on alts).
  { pair: 'ETHUSDT', enabled: true,
    strategy: cgSlowFadeV5({ btcMode: 'trend', shortsOnly: true, riskPct: LIVE_RISK_PCT }) },
  // SOL — trades off BTC's positioning extremes (btc-signal): BTC's crowd predicts
  // SOL better than SOL's own (srcNew btc-aware research, OOS PF 1.40).
  { pair: 'SOLUSDT', enabled: true,
    strategy: cgSlowFadeV5({ btcMode: 'signal', riskPct: LIVE_RISK_PCT }) },
  // XRP — btc-signal, shorts only (own signals are noise: PF 1.06 -> 1.49 with BTC's).
  { pair: 'XRPUSDT', enabled: true,
    strategy: cgSlowFadeV5({ btcMode: 'signal', shortsOnly: true, riskPct: LIVE_RISK_PCT }) },

  // ═══ ARCHIVED 2026-06-10 — standalone two-sided portfolio (2026-06-03). Retired for
  //     the v5 cgSlowFade portfolio above. enabled:false (kept for fast rollback). ═══
  { pair: 'ADAUSDT', enabled: false,
    strategy: fundingFade({ pctHi: 0.75, pctLo: 0.25,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: 0.875 }) },
  { pair: 'LINKUSDT', enabled: false,
    strategy: fundingTaConfluence({ pctHi: 0.70, pctLo: 0.30,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT_LINK }) },

  // ═══ ARCHIVED 2026-06-03 — prior v5 8-pair scaled-in alt book. Retired for the
  //     standalone portfolio above. enabled:false (kept for history / fast rollback).
  //     Used scaled-in FIXED DCA (decay 0.5) at 0.5%/slot — the DCA loses on low-vol pairs. ═══
  { pair: 'INJUSDT', enabled: false,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ATOMUSDT', enabled: false,
    strategy: fundingFade({ riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT', enabled: false,
    strategy: fundingFade({ riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'XRPUSDT', enabled: false,
    strategy: fundingTaConfluence({ riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'LTCUSDT', enabled: false,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'HYPEUSDT', enabled: false,
    strategy: fundingTaConfluence({ riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ETHUSDT', enabled: false,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'BNBUSDT', enabled: false,
    strategy: fundingFade({ riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'TAOUSDT', enabled: false,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
];

export function getStrategyForPair(pair: string): Strategy | null {
  const cfg = TIER1_PORTFOLIO.find(c => c.pair === pair && c.enabled);
  return cfg ? cfg.strategy : null;
}

export function tier1Pairs(): string[] {
  return TIER1_PORTFOLIO.filter(c => c.enabled).map(c => c.pair);
}

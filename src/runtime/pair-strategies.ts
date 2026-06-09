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

// Per-trade risk. SINGLE-ENTRY now, so this IS the per-trade risk (not per-slot).
// Mixed: BTC carries more (cleanest two-sided edge, lowest DD); SOL/ADA less (correlated
// to BTC, dialed back so a joint bad day stays under Hyro −5%). Validated mix.
export const LIVE_RISK_PCT = 0.875;       // SOL / ADA per-trade risk
export const LIVE_RISK_PCT_BTC = 1.25;    // BTC per-trade risk (more weight)
export const LIVE_RISK_PCT_LINK = 0.6;    // LINK per-trade risk (thin edge n~30/yr, heat-fit: 1.25+0.875+0.875+0.6=3.6<3.75 cap)

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
  // ═══ ACTIVE — standalone two-sided portfolio (2026-06-03), SINGLE ENTRY, mixed risk ═══
  // BTC — ls_top_position fade (BTC's stable signal; funding flips on it) + BTC trend +
  // wide stop (2.0×ATR survives the ~48h reversion). WF both halves +, PF 1.47/1.90.
  { pair: 'BTCUSDT', enabled: true,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: false, useBtcTrend: true,
      slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT_BTC }) },
  // SOL — funding fade, wider thresholds .70/.30 + wide stop. Strongest standalone,
  // two-sided (long +$26.5k / short +$30.8k over the year). WF both halves +, PF 1.58/1.78.
  { pair: 'SOLUSDT', enabled: true,
    strategy: fundingFade({ pctHi: 0.70, pctLo: 0.30,
      slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT }) },
  // ADA — funding fade .75/.25, tight stop. Two-sided but short-tilted (long works,
  // smaller). WATCH-PAIR: weakest OOS (flat in reverse WF). Ready to drop if it lags live.
  { pair: 'ADAUSDT', enabled: true,
    strategy: fundingFade({ pctHi: 0.75, pctLo: 0.25,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT }) },
  // LINK — funding + L/S Top Account confluence (S4), .70/.30, tight stop. Added 2026-06-04
  // (see memory/project_link_addition_flatten_2026_06_04): only ROBUST of 14 candidates in
  // the two-sided WF screen (long+short both dirs +, same S4 config picked on both halves);
  // 4-pair combined A/B +39pp/yr with MaxDD↓, and it fixes the 3-pair flatten-concentration
  // pathology. Risk 0.6% (thin edge, heat-fit). 4-pair WF OOS +107%/+38%/yr both dirs.
  { pair: 'LINKUSDT', enabled: true,
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

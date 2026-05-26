/**
 * Per-pair strategy mapping for live Tier-1 portfolio.
 *
 * Strategy v5 FINAL (2026-05-24): 7-pair portfolio with scaled-in FIXED on every
 * pair. Honest-engine backtest: +77.76%/yr FULL, OOS TEST +58% annualized,
 * MaxDD 6.75%, PF 1.91. See memory/portfolio_v5_final.md.
 *
 * Key changes from v4:
 *   - BTCUSDT removed: 0R on honest engine (funding window blocks half its setups)
 *   - TAOUSDT removed: marginal +4.84R baseline, −1R with scaled-in
 *   - SOLUSDT added (S4 funding+TA confluence)
 *   - HYPEUSDT added (S4 funding+TA confluence)
 *   - All pairs run scaled-in FIXED: 3 ATR-spaced limits, dca_boost decay 0.5,
 *     TP locked at signal+2·ATR (does NOT recompute on DCA fills)
 *
 * Multi-entry execution: scaledIn config flows from strategy.decide() → Action →
 * scan-decide JSON → auto-execute → execute.ts which places 3 limit orders with
 * per-slot qty determined by dca_boost (1R, 0.5R, 0.25R risk allocation).
 */
import { Strategy } from '../backtest/types';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../strategies/cg-fade';

// Live trial risk per trade. 0.5% per slot baseline — full-deploy (3 fills)
// risks 1.75R = 0.875% deposit at full DCA.
export const LIVE_RISK_PCT = 0.5;

// Scaled-in FIXED config — same parameters used across all pairs.
// Engine + execute.ts treat this as: 3 ATR-spaced limit orders, deeper entries
// get bigger qty, TP price LOCKED at signal+2*ATR (does NOT pull closer on fills).
//
// 2026-05-25 — spacing 0.6→0.5 after XRP incident: at 0.6 spacing, slot 3 was at
// +1.2*ATR vs SL at +1.5*ATR, leaving only 0.3*ATR buffer. Slot 3 qty (sized to
// 0.125% risk on that tiny distance) inflated notional + had near-instant SL risk.
// At 0.5 spacing: slot 3 at +1.0*ATR, buffer 0.5*ATR — safer.
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
  // S4 funding+TA confluence (replaced BTC — honest engine 0R, S4 SOL +10.65R)
  { pair: 'SOLUSDT', enabled: true,
    strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  // S2 L/S Top Position fade + BTC macro
  { pair: 'INJUSDT', enabled: true,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: false, useBtcTrend: true,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  // S3 funding fade
  { pair: 'ATOMUSDT', enabled: true,
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT', enabled: true,
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  // S4 funding+TA confluence
  { pair: 'XRPUSDT', enabled: true,
    strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  // S2 (validated 2026-05-23 — funding fade gave PF 1.02, S2 gave PF 1.31 in pair sweep)
  { pair: 'LTCUSDT', enabled: true,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: false, useBtcTrend: true,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  // S4 funding+TA confluence (new pair — backtest PF 1.83 / MaxDD 2.88%)
  { pair: 'HYPEUSDT', enabled: true,
    strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  // S1 ls-top-pos fade + pair trend (added 2026-05-25, walk-forward TEST n=21,
  // WR 71.4%, PF 2.92, +13.34% return — atypical reverse degradation from TRAIN
  // but TEST strongly profitable, MaxDD 1.99%).
  { pair: 'ETHUSDT', enabled: true,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: true, useBtcTrend: false,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
  // S3 funding fade (added 2026-05-25, walk-forward TEST n=42, WR 52.4%,
  // PF 1.38, +6.63% return — classic TRAIN→TEST degradation but TEST profitable).
  { pair: 'BNBUSDT', enabled: true,
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: SCALED_IN_FIXED }) },
];

export function getStrategyForPair(pair: string): Strategy | null {
  const cfg = TIER1_PORTFOLIO.find(c => c.pair === pair && c.enabled);
  return cfg ? cfg.strategy : null;
}

export function tier1Pairs(): string[] {
  return TIER1_PORTFOLIO.filter(c => c.enabled).map(c => c.pair);
}

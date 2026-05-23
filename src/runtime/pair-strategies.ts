/**
 * Per-pair strategy mapping for live Tier-1 portfolio (validated via walk-forward
 * 2026-05-23). Each pair runs ONE strategy; engine + scan-decide route accordingly.
 *
 * To add a pair: walk-forward validate first (cg-pair-strategy-sweep.ts).
 * To remove: comment out — auto-execute will skip pairs not in this map.
 *
 * Risk strategy: 0.25% during live trial (first 1-2 weeks). Scale to 0.5% if
 * metrics match backtest (WR ~55%, PF ~1.5, MaxDD < 5%).
 */
import { Strategy } from '../backtest/types';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../strategies/cg-fade';

// Live trial risk per trade. Conservative on launch.
export const LIVE_RISK_PCT = 0.25;

export interface PairStrategyCfg {
  pair: string;
  strategy: Strategy;
  // Optional: skip if pair is in cool-off (we set this after notable drawdowns).
  enabled: boolean;
}

export const TIER1_PORTFOLIO: PairStrategyCfg[] = [
  // S1: L/S Top Position fade + pair trend (BTC champion — walk-forward WR 62.5% OOS)
  { pair: 'BTCUSDT', enabled: true,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: true, useBtcTrend: false,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK_PCT }) },
  // S2: L/S Top Position fade + BTC macro (INJ — walk-forward OOS sumR +13.28R)
  { pair: 'INJUSDT', enabled: true,
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: false, useBtcTrend: true,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK_PCT }) },
  // S3: Funding fade + both trends (TAO/ATOM/LTC/ARB — walk-forward passed)
  { pair: 'TAOUSDT', enabled: true,
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT }) },
  { pair: 'ATOMUSDT', enabled: true,
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT }) },
  { pair: 'LTCUSDT', enabled: true,
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT }) },
  { pair: 'ARBUSDT', enabled: true,
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT }) },
  // S4: Funding + L/S Top Account confluence (XRP — walk-forward WR 66.7% OOS, PF 2.50)
  { pair: 'XRPUSDT', enabled: true,
    strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT }) },
];

export function getStrategyForPair(pair: string): Strategy | null {
  const cfg = TIER1_PORTFOLIO.find(c => c.pair === pair && c.enabled);
  return cfg ? cfg.strategy : null;
}

export function tier1Pairs(): string[] {
  return TIER1_PORTFOLIO.filter(c => c.enabled).map(c => c.pair);
}

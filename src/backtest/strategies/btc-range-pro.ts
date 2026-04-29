import { Action, Strategy, StrategyContext, Bar } from '../types';
import { CoinglassFeatures } from '../../data/coinglass-features';

// BTC-only optimized range-fade. Lessons applied:
//   - Wider, structural SL: under min(low) of last N bars + buffer (Walk insight).
//   - Coinglass extreme-funding/OI gate to skip retail traps.
//   - Conservative TPs: half-band partial + full middle. No moonshot tp2.
//   - ETH dropped — focus on a single instrument.
// Target: 1%/month with MaxDD ≤ 4%.

export interface BtcRangeProParams {
  rsiLow: number;          // 32
  rsiHigh: number;         // 68
  volSpikeMin: number;     // 1.5
  adxMax: number;          // 22
  atrPctMax: number;       // 1.5
  // Coinglass gates
  fundingExtremeAbs: number;        // 0.005
  oiPctChg24hAbsMax: number;        // 5
  // SL placement
  recentLowsLookback: number;       // 10 — last N bars to find swing low/high
  slBufferAtr: number;              // 0.3 — extra ATR beyond swing
  minStopAtr: number;               // 0.4
  // Targets (conservative)
  tp1HalfBandFrac: number;          // 0.5 — TP1 at halfway between entry and BB.middle
  riskPct: number;                  // 0.6
}

export const DEFAULT_BTC_RANGE_PRO: BtcRangeProParams = {
  rsiLow: 32,
  rsiHigh: 68,
  volSpikeMin: 1.5,
  adxMax: 22,
  atrPctMax: 1.5,
  fundingExtremeAbs: 0.005,
  oiPctChg24hAbsMax: 5,
  recentLowsLookback: 10,
  slBufferAtr: 0.3,
  minStopAtr: 0.4,
  tp1HalfBandFrac: 0.5,
  riskPct: 0.6,
};

function recentLow(bars: Bar[]): number | null {
  if (!bars || bars.length === 0) return null;
  return Math.min(...bars.map(b => b.low));
}

function recentHigh(bars: Bar[]): number | null {
  if (!bars || bars.length === 0) return null;
  return Math.max(...bars.map(b => b.high));
}

function passCoinglassLong(cg: CoinglassFeatures | undefined, p: BtcRangeProParams): boolean {
  if (!cg || cg.oi_close == null) return false;
  if (cg.funding_oi_weighted != null && Math.abs(cg.funding_oi_weighted) > p.fundingExtremeAbs) return false;
  if (cg.oi_pct_chg_24h != null && cg.oi_pct_chg_24h < -p.oiPctChg24hAbsMax) return false;
  return true;
}

function passCoinglassShort(cg: CoinglassFeatures | undefined, p: BtcRangeProParams): boolean {
  if (!cg || cg.oi_close == null) return false;
  if (cg.funding_oi_weighted != null && Math.abs(cg.funding_oi_weighted) > p.fundingExtremeAbs) return false;
  if (cg.oi_pct_chg_24h != null && cg.oi_pct_chg_24h > p.oiPctChg24hAbsMax) return false;
  return true;
}

export function btcRangePro(params: BtcRangeProParams = DEFAULT_BTC_RANGE_PRO): Strategy {
  return {
    name: `btc-range-pro(adx<${params.adxMax}, atr%<${params.atrPctMax}, recent-low-SL+${params.slBufferAtr}×ATR)`,
    needsCoinglass: true,
    decide(ctx: StrategyContext): Action {
      if (ctx.symbol !== 'BTCUSDT') return { kind: 'hold' };       // BTC only
      const f = ctx.features1h;
      if (
        f.bb_upper == null || f.bb_lower == null || f.bb_middle == null ||
        f.rsi == null || f.atr == null || f.atr_pct == null || f.adx == null ||
        f.volume_spike == null
      ) return { kind: 'hold' };

      // Regime gates
      if (f.adx >= params.adxMax) return { kind: 'hold' };
      if (f.atr_pct >= params.atrPctMax) return { kind: 'hold' };
      if (f.volume_spike < params.volSpikeMin) return { kind: 'hold' };

      const cg = ctx.coinglass as CoinglassFeatures | undefined;
      const recent = ctx.recentBars?.slice(-params.recentLowsLookback) ?? [];

      // LONG
      if (ctx.price <= f.bb_lower && f.rsi < params.rsiLow) {
        if (!passCoinglassLong(cg, params)) return { kind: 'hold' };
        const swingLow = recentLow(recent);
        if (swingLow == null) return { kind: 'hold' };
        const sl = swingLow - params.slBufferAtr * f.atr;
        const stopDist = ctx.price - sl;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        // TP1 — halfway to BB.middle (conservative); TP2 — BB.middle (full mean revert)
        const tp1 = ctx.price + (f.bb_middle - ctx.price) * params.tp1HalfBandFrac;
        const tp2 = f.bb_middle;
        return {
          kind: 'enter', side: 'long', orderType: 'market',
          entryPrice: ctx.price, sl, tp1, tp2,
          sizePct: params.riskPct,
          rationale: `BTC range-pro LONG: ADX ${f.adx.toFixed(1)}, ATR% ${f.atr_pct.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, vol×${f.volume_spike.toFixed(2)}, swing-low SL ${swingLow.toFixed(0)}, funding ${cg?.funding_oi_weighted ?? 'n/a'}, OI Δ ${cg?.oi_pct_chg_24h?.toFixed(2) ?? 'n/a'}%.`,
        };
      }
      // SHORT
      if (ctx.price >= f.bb_upper && f.rsi > params.rsiHigh) {
        if (!passCoinglassShort(cg, params)) return { kind: 'hold' };
        const swingHigh = recentHigh(recent);
        if (swingHigh == null) return { kind: 'hold' };
        const sl = swingHigh + params.slBufferAtr * f.atr;
        const stopDist = sl - ctx.price;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        const tp1 = ctx.price - (ctx.price - f.bb_middle) * params.tp1HalfBandFrac;
        const tp2 = f.bb_middle;
        return {
          kind: 'enter', side: 'short', orderType: 'market',
          entryPrice: ctx.price, sl, tp1, tp2,
          sizePct: params.riskPct,
          rationale: `BTC range-pro SHORT: ADX ${f.adx.toFixed(1)}, ATR% ${f.atr_pct.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, vol×${f.volume_spike.toFixed(2)}, swing-high SL ${swingHigh.toFixed(0)}.`,
        };
      }
      return { kind: 'hold' };
    },
  };
}

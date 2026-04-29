import { Action, Strategy, StrategyContext } from '../types';
import { CoinglassFeatures } from '../../data/coinglass-features';

// Range-fade v3 — Coinglass-aware. Adds cross-exchange context to v2's TA filters.
//
// From Stage 3.5 Walk: even within ADX<22 + ATR%<1.5, the trigger sometimes fires
// during covert capitulation moments where retail is trapped (extreme funding) or
// smart money is positioned against us (extreme L/S top-trader ratio). v3 filters
// those out.

export interface RangeFadeV3Params {
  rsiLow: number;          // 32
  rsiHigh: number;         // 68
  volSpikeMin: number;     // 1.5
  adxMax: number;          // 22
  atrPctMax: number;       // 1.5
  // Coinglass gates
  fundingExtremeAbs: number;        // 0.005 (0.5%) — skip beyond this either side
  oiPctChg24hAbsMax: number;        // 5 — skip if |OI Δ24h| > 5% (panic flow)
  lsTopPosLongMax: number;          // 2.0 — skip LONG if top traders extremely long already
  lsTopPosShortMin: number;         // 0.5 — skip SHORT if top traders extremely short already
  // Stop / target geometry
  slAtrMult: number;
  minStopAtr: number;
  riskPct: number;
}

export const DEFAULT_RANGE_FADE_V3: RangeFadeV3Params = {
  rsiLow: 32,
  rsiHigh: 68,
  volSpikeMin: 1.5,
  adxMax: 22,
  atrPctMax: 1.5,
  fundingExtremeAbs: 0.005,
  oiPctChg24hAbsMax: 5,
  lsTopPosLongMax: 2.0,
  lsTopPosShortMin: 0.5,
  slAtrMult: 1.0,                  // wider than v2 (recent-low-style)
  minStopAtr: 0.5,
  riskPct: 0.6,
};

function passCoinglassLong(cg: CoinglassFeatures, p: RangeFadeV3Params): { ok: boolean; reason: string } {
  if (cg.funding_oi_weighted == null) return { ok: false, reason: 'no funding data' };
  if (cg.funding_oi_weighted > p.fundingExtremeAbs) {
    return { ok: false, reason: `funding +${(cg.funding_oi_weighted * 100).toFixed(3)}% extreme positive — retail trapped long` };
  }
  if (cg.oi_pct_chg_24h == null) return { ok: false, reason: 'no OI delta data' };
  if (cg.oi_pct_chg_24h < -p.oiPctChg24hAbsMax) {
    return { ok: false, reason: `OI ${cg.oi_pct_chg_24h.toFixed(2)}%/24h — panic exit, capitulation in progress` };
  }
  if (cg.ls_top_position != null && cg.ls_top_position > p.lsTopPosLongMax) {
    return { ok: false, reason: `top trader L/S ${cg.ls_top_position} extreme long, no contrarian setup` };
  }
  return { ok: true, reason: '' };
}

function passCoinglassShort(cg: CoinglassFeatures, p: RangeFadeV3Params): { ok: boolean; reason: string } {
  if (cg.funding_oi_weighted == null) return { ok: false, reason: 'no funding data' };
  if (cg.funding_oi_weighted < -p.fundingExtremeAbs) {
    return { ok: false, reason: `funding ${(cg.funding_oi_weighted * 100).toFixed(3)}% extreme negative — short squeeze setup` };
  }
  if (cg.oi_pct_chg_24h == null) return { ok: false, reason: 'no OI delta data' };
  if (cg.oi_pct_chg_24h > p.oiPctChg24hAbsMax) {
    return { ok: false, reason: `OI +${cg.oi_pct_chg_24h.toFixed(2)}%/24h — FOMO accumulation peak, may continue up` };
  }
  if (cg.ls_top_position != null && cg.ls_top_position < p.lsTopPosShortMin) {
    return { ok: false, reason: `top trader L/S ${cg.ls_top_position} extreme short, no contrarian setup` };
  }
  return { ok: true, reason: '' };
}

export function rangeFadeV3(params: RangeFadeV3Params = DEFAULT_RANGE_FADE_V3): Strategy {
  return {
    name: `range-fade-v3(adx<${params.adxMax}, atr%<${params.atrPctMax}, |fr|<${params.fundingExtremeAbs * 100}%, |Δoi|<${params.oiPctChg24hAbsMax}%, sl=${params.slAtrMult}×ATR)`,
    needsCoinglass: true,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features1h;
      if (
        f.bb_upper == null || f.bb_lower == null || f.bb_middle == null ||
        f.rsi == null || f.atr == null || f.atr_pct == null || f.adx == null ||
        f.volume_spike == null
      ) {
        return { kind: 'hold' };
      }
      // Regime gates (TA)
      if (f.adx >= params.adxMax) return { kind: 'hold' };
      if (f.atr_pct >= params.atrPctMax) return { kind: 'hold' };
      if (f.volume_spike < params.volSpikeMin) return { kind: 'hold' };

      // Coinglass required — if not available (older periods), SKIP
      const cg = ctx.coinglass as CoinglassFeatures | undefined;
      if (!cg || cg.oi_close == null) return { kind: 'hold' };

      // LONG branch
      if (ctx.price <= f.bb_lower && f.rsi < params.rsiLow) {
        const cgCheck = passCoinglassLong(cg, params);
        if (!cgCheck.ok) return { kind: 'hold' };
        const sl = f.bb_lower - params.slAtrMult * f.atr;
        const stopDist = ctx.price - sl;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter',
          side: 'long',
          orderType: 'market',
          entryPrice: ctx.price,
          sl,
          tp1: f.bb_middle,
          tp2: f.bb_upper,
          sizePct: params.riskPct,
          rationale: `range-fade-v3 LONG: ADX ${f.adx.toFixed(1)} (range), ATR% ${f.atr_pct.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, funding ${(cg.funding_oi_weighted! * 100).toFixed(3)}%, OI ${cg.oi_pct_chg_24h!.toFixed(1)}%/24h, top-pos ${cg.ls_top_position}.`,
        };
      }
      // SHORT branch
      if (ctx.price >= f.bb_upper && f.rsi > params.rsiHigh) {
        const cgCheck = passCoinglassShort(cg, params);
        if (!cgCheck.ok) return { kind: 'hold' };
        const sl = f.bb_upper + params.slAtrMult * f.atr;
        const stopDist = sl - ctx.price;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter',
          side: 'short',
          orderType: 'market',
          entryPrice: ctx.price,
          sl,
          tp1: f.bb_middle,
          tp2: f.bb_lower,
          sizePct: params.riskPct,
          rationale: `range-fade-v3 SHORT: ADX ${f.adx.toFixed(1)} (range), ATR% ${f.atr_pct.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, funding ${(cg.funding_oi_weighted! * 100).toFixed(3)}%, OI ${cg.oi_pct_chg_24h!.toFixed(1)}%/24h, top-pos ${cg.ls_top_position}.`,
        };
      }
      return { kind: 'hold' };
    },
  };
}

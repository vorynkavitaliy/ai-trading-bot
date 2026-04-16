import { Candle, Indicators } from '../analysis/indicators';
import { Structure } from '../analysis/structure';

export type Regime = 'Bull' | 'Bear' | 'Range' | 'Transitional';

/**
 * Regime detection on the 4H chart:
 *   Bull         — EMA50 > EMA200, structure=up, ADX>=20
 *   Bear         — EMA50 < EMA200, structure=down, ADX>=20
 *   Range        — ADX<20 OR structure=range with overlapping EMAs
 *   Transitional — mixed signals (EMA cross fresh / structure flipping)
 */
export function detectRegime(c4h: Candle[]): { regime: Regime; reason: string; adx?: number } {
  if (c4h.length < 200) return { regime: 'Range', reason: 'Insufficient 4H data' };

  const ema50 = Indicators.ema(c4h, 50);
  const ema200 = Indicators.ema(c4h, 200);
  const adx = Indicators.adx(c4h, 14);
  const trend = Structure.trend(c4h);
  const last = c4h[c4h.length - 1].close;

  if (ema50 === undefined || ema200 === undefined) {
    return { regime: 'Range', reason: 'EMA undefined' };
  }

  const adxVal = adx?.adx ?? 0;
  const emaSpreadPct = Math.abs(ema50 - ema200) / ema200 * 100;

  if (adxVal < 20 && emaSpreadPct < 1.0) {
    return { regime: 'Range', reason: `ADX ${adxVal.toFixed(1)} weak, EMA spread ${emaSpreadPct.toFixed(2)}%`, adx: adxVal };
  }

  if (ema50 > ema200 && last > ema50 && trend === 'up' && adxVal >= 20) {
    return { regime: 'Bull', reason: `EMA50>EMA200, price>EMA50, ADX ${adxVal.toFixed(1)}`, adx: adxVal };
  }

  if (ema50 < ema200 && last < ema50 && trend === 'down' && adxVal >= 20) {
    return { regime: 'Bear', reason: `EMA50<EMA200, price<EMA50, ADX ${adxVal.toFixed(1)}`, adx: adxVal };
  }

  return { regime: 'Transitional', reason: `Mixed: ema50/200 ${ema50 > ema200 ? '↑' : '↓'}, structure ${trend}, ADX ${adxVal.toFixed(1)}`, adx: adxVal };
}

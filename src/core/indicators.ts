/**
 * Pure technical indicators used across strategies, backtest and diagnostics.
 *
 * Single source of truth. Earlier each module had its own atr()/ema()/percentile()
 * — drift between them caused subtle edge-case bugs (null vs 0 on insufficient
 * data, off-by-one window indexing). All callers now import from here.
 */

export interface OHLC {
  high: number;
  low: number;
  close: number;
}

/** Average True Range over the last `period` bars. Returns null when insufficient data. */
export function atr(bars: OHLC[], period: number): number | null {
  if (bars.length < period + 1) return null;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    sum += tr;
  }
  return sum / period;
}

/** Exponential moving average over `values`. Returns null when insufficient data. */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** True when the fast EMA is above the slow EMA. Null when insufficient data. */
export function trendUp(closes: number[], fast: number, slow: number): boolean | null {
  const eF = ema(closes, fast);
  const eS = ema(closes, slow);
  if (eF == null || eS == null) return null;
  return eF > eS;
}

/** Fraction of `series` values ≤ `value`. Range [0, 1]. */
export function percentile(series: number[], value: number): number {
  if (series.length === 0) return 0;
  let cnt = 0;
  for (const v of series) if (v <= value) cnt++;
  return cnt / series.length;
}

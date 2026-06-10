import { Candle } from '../data/types';

export function sma(values: readonly number[], window: number): number | null {
  if (values.length < window) return null;
  let sum = 0;
  for (let i = values.length - window; i < values.length; i++) sum += values[i];
  return sum / window;
}

export function ema(values: readonly number[], window: number): number | null {
  if (values.length < window) return null;
  const k = 2 / (window + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

export function atr(bars: readonly Candle[], window: number): number | null {
  if (bars.length < window + 1) return null;
  let sum = 0;
  for (let i = bars.length - window; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose),
    );
    sum += tr;
  }
  return sum / window;
}

export function rsi(values: readonly number[], window: number): number | null {
  if (values.length < window + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - window; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function percentileRank(history: readonly number[], value: number): number | null {
  if (history.length === 0) return null;
  let below = 0;
  for (const h of history) if (h <= value) below++;
  return below / history.length;
}

export function highest(values: readonly number[], window: number): number | null {
  if (values.length < window) return null;
  let max = -Infinity;
  for (let i = values.length - window; i < values.length; i++) max = Math.max(max, values[i]);
  return max;
}

export function lowest(values: readonly number[], window: number): number | null {
  if (values.length < window) return null;
  let min = Infinity;
  for (let i = values.length - window; i < values.length; i++) min = Math.min(min, values[i]);
  return min;
}

export function stdev(values: readonly number[], window: number): number | null {
  const mean = sma(values, window);
  if (mean === null) return null;
  let sum = 0;
  for (let i = values.length - window; i < values.length; i++) {
    sum += (values[i] - mean) ** 2;
  }
  return Math.sqrt(sum / window);
}

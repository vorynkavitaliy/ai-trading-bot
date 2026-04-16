import { Candle, swingIdx } from './indicators';

/**
 * Lightweight Smart Money / market-structure helpers.
 * Goal: detect liquidity sweeps, order blocks, BOS, demand/supply zones —
 * good enough for confluence scoring (not a full SMC engine).
 */

export interface SwingPoint { idx: number; price: number; type: 'high' | 'low' }

export const Structure = {
  /** Return the most recent N swing highs/lows */
  swings(c: Candle[], pivot = 3, last = 6): SwingPoint[] {
    const highIdx = swingIdx(c.map((k) => k.high), pivot, 'high');
    const lowIdx = swingIdx(c.map((k) => k.low), pivot, 'low');
    const swings: SwingPoint[] = [
      ...highIdx.map((i): SwingPoint => ({ idx: i, price: c[i].high, type: 'high' })),
      ...lowIdx.map((i): SwingPoint => ({ idx: i, price: c[i].low, type: 'low' })),
    ].sort((a, b) => a.idx - b.idx);
    return swings.slice(-last);
  },

  /** Higher-highs + higher-lows → uptrend; lower-lows + lower-highs → downtrend */
  trend(c: Candle[]): 'up' | 'down' | 'range' {
    const sw = Structure.swings(c, 3, 6);
    const highs = sw.filter((s) => s.type === 'high').map((s) => s.price);
    const lows = sw.filter((s) => s.type === 'low').map((s) => s.price);
    if (highs.length < 2 || lows.length < 2) return 'range';

    const hh = highs[highs.length - 1] > highs[highs.length - 2];
    const hl = lows[lows.length - 1] > lows[lows.length - 2];
    const lh = highs[highs.length - 1] < highs[highs.length - 2];
    const ll = lows[lows.length - 1] < lows[lows.length - 2];

    if (hh && hl) return 'up';
    if (lh && ll) return 'down';
    return 'range';
  },

  /**
   * Liquidity sweep: last bar wicks beyond a recent swing high/low and closes back inside.
   * Bullish sweep = wicked under recent low (stop-hunt under support), closed back above.
   */
  liquiditySweep(c: Candle[], lookback = 30): 'bullish' | 'bearish' | 'none' {
    if (c.length < lookback + 2) return 'none';
    const window = c.slice(-(lookback + 1), -1);
    const recentHigh = Math.max(...window.map((k) => k.high));
    const recentLow = Math.min(...window.map((k) => k.low));
    const cur = c[c.length - 1];

    if (cur.low < recentLow && cur.close > recentLow) return 'bullish';
    if (cur.high > recentHigh && cur.close < recentHigh) return 'bearish';
    return 'none';
  },

  /**
   * Most-recent bullish/bearish order block: last opposite-color candle before
   * a strong impulsive move in the desired direction.
   */
  lastOrderBlock(c: Candle[], dir: 'bullish' | 'bearish'): { high: number; low: number; idx: number } | null {
    if (c.length < 10) return null;
    for (let i = c.length - 3; i >= Math.max(0, c.length - 50); i--) {
      const k = c[i];
      const next = c[i + 1];
      const next2 = c[i + 2];
      if (!next || !next2) continue;

      const moveSize = Math.abs(next2.close - k.close);
      const range = Math.abs(k.high - k.low);
      if (range === 0) continue;
      const impulse = moveSize / range;

      if (dir === 'bullish' && k.close < k.open && next.close > next.open && next2.close > next.close && impulse > 1.2) {
        return { high: k.high, low: k.low, idx: i };
      }
      if (dir === 'bearish' && k.close > k.open && next.close < next.open && next2.close < next.close && impulse > 1.2) {
        return { high: k.high, low: k.low, idx: i };
      }
    }
    return null;
  },

  /** Recent support / resistance (max/min over `look` bars excluding current) */
  recentLevels(c: Candle[], look = 50): { support: number; resistance: number } {
    const w = c.slice(-Math.min(look + 1, c.length), -1);
    return {
      support: Math.min(...w.map((k) => k.low)),
      resistance: Math.max(...w.map((k) => k.high)),
    };
  },

  /** Break of structure: current close beyond the prior swing high/low */
  bos(c: Candle[]): 'bullish' | 'bearish' | 'none' {
    const sw = Structure.swings(c, 3, 6);
    const highs = sw.filter((s) => s.type === 'high');
    const lows = sw.filter((s) => s.type === 'low');
    const cur = c[c.length - 1];

    const lastHigh = highs[highs.length - 1]?.price;
    const lastLow = lows[lows.length - 1]?.price;
    if (lastHigh !== undefined && cur.close > lastHigh) return 'bullish';
    if (lastLow !== undefined && cur.close < lastLow) return 'bearish';
    return 'none';
  },
};

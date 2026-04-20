import {
  RSI, EMA, SMA, MACD, ATR, BollingerBands, OBV, ADX, Stochastic,
} from 'technicalindicators';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
}

const closes = (c: Candle[]) => c.map((k) => k.close);
const highs = (c: Candle[]) => c.map((k) => k.high);
const lows = (c: Candle[]) => c.map((k) => k.low);
const vols = (c: Candle[]) => c.map((k) => k.volume);

/** Last value of a series, or undefined */
const last = <T>(arr: T[]): T | undefined => arr.length ? arr[arr.length - 1] : undefined;

export const Indicators = {
  rsi(c: Candle[], period = 14): number | undefined {
    if (c.length < period + 1) return undefined;
    return last(RSI.calculate({ values: closes(c), period }));
  },

  ema(c: Candle[], period: number): number | undefined {
    if (c.length < period) return undefined;
    return last(EMA.calculate({ values: closes(c), period }));
  },

  emaSeries(c: Candle[], period: number): number[] {
    return EMA.calculate({ values: closes(c), period });
  },

  sma(c: Candle[], period: number): number | undefined {
    if (c.length < period) return undefined;
    return last(SMA.calculate({ values: closes(c), period }));
  },

  macd(c: Candle[]): { MACD: number; signal: number; histogram: number } | undefined {
    if (c.length < 35) return undefined;
    const r = MACD.calculate({
      values: closes(c),
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false,
    });
    const v = last(r);
    if (!v || v.MACD === undefined || v.signal === undefined || v.histogram === undefined) return undefined;
    return { MACD: v.MACD, signal: v.signal, histogram: v.histogram };
  },

  atr(c: Candle[], period = 14): number | undefined {
    if (c.length < period + 1) return undefined;
    return last(ATR.calculate({ high: highs(c), low: lows(c), close: closes(c), period }));
  },

  bb(c: Candle[], period = 20, stdDev = 2): { upper: number; middle: number; lower: number } | undefined {
    if (c.length < period) return undefined;
    const r = last(BollingerBands.calculate({ values: closes(c), period, stdDev }));
    return r ? { upper: r.upper, middle: r.middle, lower: r.lower } : undefined;
  },

  obv(c: Candle[]): number[] {
    return OBV.calculate({ close: closes(c), volume: vols(c) });
  },

  adx(c: Candle[], period = 14): { adx: number; pdi: number; mdi: number } | undefined {
    if (c.length < period * 2) return undefined;
    const r = last(ADX.calculate({ high: highs(c), low: lows(c), close: closes(c), period }));
    if (!r) return undefined;
    return { adx: r.adx, pdi: r.pdi, mdi: r.mdi };
  },

  stoch(c: Candle[]): { k: number; d: number } | undefined {
    if (c.length < 17) return undefined;
    const r = last(Stochastic.calculate({
      high: highs(c), low: lows(c), close: closes(c),
      period: 14, signalPeriod: 3,
    }));
    return r ? { k: r.k, d: r.d } : undefined;
  },

  /** Volume-weighted average price for the candle window */
  vwap(c: Candle[]): number | undefined {
    if (!c.length) return undefined;
    let pv = 0, v = 0;
    for (const k of c) {
      const typical = (k.high + k.low + k.close) / 3;
      pv += typical * k.volume;
      v += k.volume;
    }
    return v > 0 ? pv / v : undefined;
  },

  /** RSI divergence between price and RSI on the last `look` swing points */
  rsiDivergence(c: Candle[], look = 30): 'bullish' | 'bearish' | 'none' {
    if (c.length < look + 14) return 'none';
    const rsi = RSI.calculate({ values: closes(c), period: 14 });
    if (rsi.length < look) return 'none';
    const window = c.slice(-look);
    const rsiW = rsi.slice(-look);

    // Find last two significant lows + highs
    const lowIdx = swingIdx(window.map((k) => k.low), 3, 'low');
    const highIdx = swingIdx(window.map((k) => k.high), 3, 'high');

    if (lowIdx.length >= 2) {
      const [a, b] = lowIdx.slice(-2);
      if (window[b].low < window[a].low && rsiW[b] > rsiW[a]) return 'bullish';
    }
    if (highIdx.length >= 2) {
      const [a, b] = highIdx.slice(-2);
      if (window[b].high > window[a].high && rsiW[b] < rsiW[a]) return 'bearish';
    }
    return 'none';
  },

  /** OBV divergence: price up + OBV down → bearish, and vice versa */
  obvDivergence(c: Candle[], look = 30): 'bullish' | 'bearish' | 'none' {
    if (c.length < look + 5) return 'none';
    const obv = OBV.calculate({ close: closes(c), volume: vols(c) });
    if (obv.length < look) return 'none';
    const w = c.slice(-look);
    const o = obv.slice(-look);
    const priceDelta = w[w.length - 1].close - w[0].close;
    const obvDelta = o[o.length - 1] - o[0];
    if (priceDelta > 0 && obvDelta < 0) return 'bearish';
    if (priceDelta < 0 && obvDelta > 0) return 'bullish';
    return 'none';
  },

  /** Volume spike: last bar volume vs SMA(20) */
  volumeSpike(c: Candle[], period = 20, mult = 1.8): boolean {
    if (c.length < period + 1) return false;
    const s = SMA.calculate({ values: vols(c), period });
    const avg = last(s);
    const cur = last(c)?.volume;
    if (avg === undefined || cur === undefined) return false;
    return cur >= avg * mult;
  },

  /** RSI slope over last N bars: positive = rising momentum, negative = fading */
  rsiSlope(c: Candle[], rsiPeriod = 14, lookback = 5): number | undefined {
    if (c.length < rsiPeriod + lookback + 1) return undefined;
    const rsi = RSI.calculate({ values: closes(c), period: rsiPeriod });
    if (rsi.length < lookback) return undefined;
    const recent = rsi.slice(-lookback);
    return (recent[recent.length - 1] - recent[0]) / lookback;
  },

  /** RSI slope acceleration: (slope now) - (slope `shift` bars ago). Positive = turning more bullish. */
  rsiSlopeAcceleration(c: Candle[], rsiPeriod = 14, lookback = 5, shift = 3): number | undefined {
    if (c.length < rsiPeriod + lookback + shift + 1) return undefined;
    const rsi = RSI.calculate({ values: closes(c), period: rsiPeriod });
    if (rsi.length < lookback + shift) return undefined;
    const nowWin = rsi.slice(-lookback);
    const slopeNow = (nowWin[nowWin.length - 1] - nowWin[0]) / lookback;
    const priorWin = rsi.slice(-(lookback + shift), -shift);
    const slopePrior = (priorWin[priorWin.length - 1] - priorWin[0]) / lookback;
    return slopeNow - slopePrior;
  },

  /** ATR percentile: where current ATR sits vs last N ATR values (0-100) */
  atrPercentile(c: Candle[], atrPeriod = 14, lookback = 100): number | undefined {
    if (c.length < atrPeriod + lookback) return undefined;
    const atrValues = ATR.calculate({ high: highs(c), low: lows(c), close: closes(c), period: atrPeriod });
    if (atrValues.length < lookback) return undefined;
    const window = atrValues.slice(-lookback);
    const current = window[window.length - 1];
    const below = window.filter((v) => v <= current).length;
    return (below / window.length) * 100;
  },

  /** Volume declining: average volume of last 5 bars vs previous 10 bars */
  volumeDeclining(c: Candle[]): boolean {
    if (c.length < 15) return false;
    const recent5 = c.slice(-5).reduce((s, k) => s + k.volume, 0) / 5;
    const prev10 = c.slice(-15, -5).reduce((s, k) => s + k.volume, 0) / 10;
    return recent5 < prev10 * 0.6; // volume dropped 40%+
  },
};

/** Find indices of swing highs/lows (`pivot` bars on each side). */
function swingIdx(values: number[], pivot: number, type: 'high' | 'low'): number[] {
  const out: number[] = [];
  for (let i = pivot; i < values.length - pivot; i++) {
    let isPivot = true;
    for (let j = 1; j <= pivot; j++) {
      if (type === 'high') {
        if (!(values[i] >= values[i - j] && values[i] >= values[i + j])) { isPivot = false; break; }
      } else {
        if (!(values[i] <= values[i - j] && values[i] <= values[i + j])) { isPivot = false; break; }
      }
    }
    if (isPivot) out.push(i);
  }
  return out;
}

export { swingIdx };

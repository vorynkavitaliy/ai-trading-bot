import { Candle, Indicators } from '../analysis/indicators';
import { Structure } from '../analysis/structure';
import { Regime, detectRegime } from './regime';

export type Direction = 'Long' | 'Short';

export interface DirectionScores {
  smc: 0 | 1;
  technical: 0 | 1;
  volume: 0 | 1;
  multiTf: 0 | 1;
  total: number;
  details: Record<string, string>;
}

export interface Signal {
  symbol: string;
  regime: Regime;
  regimeReason: string;
  long: DirectionScores;
  short: DirectionScores;
  direction: Direction | 'None';
  confluence: number;
  rejectReason?: string;
}

export interface SignalInput {
  symbol: string;
  c4h: Candle[];
  c1h: Candle[];
  c15m: Candle[];
  /** 3M candles — used for fine-grained entry trigger inside multi-TF score */
  c3m?: Candle[];
  newsBias?: 'risk-on' | 'risk-off' | 'neutral';
}

/**
 * Confluence model (CLAUDE.md): require 3 of 4 conditions on the dominant direction.
 *   1. SMC/Structure — order block tap, liquidity sweep, BOS
 *   2. Technical    — RSI divergence/EMA alignment/MACD
 *   3. Volume       — OBV divergence, volume spike, VWAP confluence
 *   4. Multi-TF     — 4H bias → 1H structure → 15M trigger
 */
export function generateSignal(i: SignalInput): Signal {
  const { regime, reason: regimeReason } = detectRegime(i.c4h);

  const long = scoreDirection('Long', i, regime);
  const short = scoreDirection('Short', i, regime);

  const better = long.total >= short.total ? long : short;
  const direction: Direction | 'None' = better === long
    ? (long.total > short.total ? 'Long' : 'None')
    : 'Short';

  let rejectReason: string | undefined;
  if (better.total < 3) rejectReason = `Confluence ${better.total}/4 below threshold`;
  if (regime === 'Bull' && direction === 'Short' && better.total < 4) rejectReason = 'Counter-trend short in Bull regime requires 4/4';
  if (regime === 'Bear' && direction === 'Long' && better.total < 4) rejectReason = 'Counter-trend long in Bear regime requires 4/4';
  if (i.newsBias === 'risk-off' && direction === 'Long') rejectReason = 'News bias risk-off — skip long';
  if (i.newsBias === 'risk-on' && direction === 'Short') rejectReason = 'News bias risk-on — skip short';

  return {
    symbol: i.symbol,
    regime,
    regimeReason,
    long, short,
    direction: rejectReason ? 'None' : direction,
    confluence: better.total,
    rejectReason,
  };
}

function scoreDirection(dir: Direction, i: SignalInput, regime: Regime): DirectionScores {
  const details: Record<string, string> = {};
  let smc: 0 | 1 = 0, technical: 0 | 1 = 0, volume: 0 | 1 = 0, multiTf: 0 | 1 = 0;

  // ─── 1. SMC / Structure (1H + 15M) ───
  const sweep1h = Structure.liquiditySweep(i.c1h);
  const bos1h = Structure.bos(i.c1h);
  const ob1h = Structure.lastOrderBlock(i.c1h, dir === 'Long' ? 'bullish' : 'bearish');
  const last15m = i.c15m[i.c15m.length - 1];

  if (dir === 'Long') {
    if (sweep1h === 'bullish' || bos1h === 'bullish') { smc = 1; details.smc = `1H ${sweep1h !== 'none' ? 'sweep' : 'BOS'} bullish`; }
    else if (ob1h && last15m && last15m.low <= ob1h.high && last15m.close > ob1h.low) {
      smc = 1; details.smc = `Tap bullish OB @ ${ob1h.low.toFixed(2)}-${ob1h.high.toFixed(2)}`;
    }
  } else {
    if (sweep1h === 'bearish' || bos1h === 'bearish') { smc = 1; details.smc = `1H ${sweep1h !== 'none' ? 'sweep' : 'BOS'} bearish`; }
    else if (ob1h && last15m && last15m.high >= ob1h.low && last15m.close < ob1h.high) {
      smc = 1; details.smc = `Tap bearish OB @ ${ob1h.low.toFixed(2)}-${ob1h.high.toFixed(2)}`;
    }
  }
  if (!smc) details.smc = 'no SMC trigger';

  // ─── 2. Technical (1H) ───
  const rsi1h = Indicators.rsi(i.c1h);
  const macd1h = Indicators.macd(i.c1h);
  const ema20 = Indicators.ema(i.c1h, 20);
  const ema50 = Indicators.ema(i.c1h, 50);
  const div1h = Indicators.rsiDivergence(i.c1h);

  let techHits = 0;
  const techReasons: string[] = [];
  if (dir === 'Long') {
    if (div1h === 'bullish') { techHits++; techReasons.push('RSI bullish div'); }
    if (rsi1h !== undefined && rsi1h < 40) { techHits++; techReasons.push(`RSI ${rsi1h.toFixed(0)} oversold`); }
    if (ema20 !== undefined && ema50 !== undefined && ema20 > ema50) { techHits++; techReasons.push('EMA20>EMA50'); }
    if (macd1h && macd1h.histogram > 0 && macd1h.MACD > macd1h.signal) { techHits++; techReasons.push('MACD bull cross'); }
  } else {
    if (div1h === 'bearish') { techHits++; techReasons.push('RSI bearish div'); }
    if (rsi1h !== undefined && rsi1h > 60) { techHits++; techReasons.push(`RSI ${rsi1h.toFixed(0)} overbought`); }
    if (ema20 !== undefined && ema50 !== undefined && ema20 < ema50) { techHits++; techReasons.push('EMA20<EMA50'); }
    if (macd1h && macd1h.histogram < 0 && macd1h.MACD < macd1h.signal) { techHits++; techReasons.push('MACD bear cross'); }
  }
  if (techHits >= 2) { technical = 1; details.technical = techReasons.join(', '); }
  else details.technical = `only ${techHits} tech hits: ${techReasons.join(', ') || 'none'}`;

  // ─── 3. Volume (1H) ───
  const obvDiv = Indicators.obvDivergence(i.c1h);
  const volSpike = Indicators.volumeSpike(i.c1h);
  const vwap = Indicators.vwap(i.c1h.slice(-24));
  const lastClose = i.c1h[i.c1h.length - 1].close;

  let volHits = 0;
  const volReasons: string[] = [];
  if (dir === 'Long') {
    if (obvDiv === 'bullish') { volHits++; volReasons.push('OBV bull div'); }
    if (volSpike && i.c1h[i.c1h.length - 1].close > i.c1h[i.c1h.length - 1].open) { volHits++; volReasons.push('vol spike + green'); }
    if (vwap !== undefined && lastClose > vwap) { volHits++; volReasons.push('above VWAP'); }
  } else {
    if (obvDiv === 'bearish') { volHits++; volReasons.push('OBV bear div'); }
    if (volSpike && i.c1h[i.c1h.length - 1].close < i.c1h[i.c1h.length - 1].open) { volHits++; volReasons.push('vol spike + red'); }
    if (vwap !== undefined && lastClose < vwap) { volHits++; volReasons.push('below VWAP'); }
  }
  if (volHits >= 1) { volume = 1; details.volume = volReasons.join(', '); }
  else details.volume = 'no volume confirmation';

  // ─── 4. Multi-TF alignment (4H bias → 1H structure → 15M setup → 3M trigger) ───
  const trend4h = Structure.trend(i.c4h);
  const trend1h = Structure.trend(i.c1h);
  const trend15m = Structure.trend(i.c15m);
  const trend3m = i.c3m ? Structure.trend(i.c3m) : undefined;

  // 3M entry trigger — last bar must move in our direction
  const c3mLast = i.c3m && i.c3m.length >= 2 ? i.c3m[i.c3m.length - 1] : undefined;
  const trigger3m = c3mLast
    ? (dir === 'Long' ? c3mLast.close > c3mLast.open : c3mLast.close < c3mLast.open)
    : true;

  if (dir === 'Long') {
    const bias4h = regime === 'Bull' || trend4h === 'up';
    const struct1h = trend1h !== 'down';
    const trigger15 = trend15m === 'up' || trend15m === 'range';
    const ok3m = trigger3m && (trend3m === undefined || trend3m !== 'down');
    if (bias4h && struct1h && trigger15 && ok3m) { multiTf = 1; details.multiTf = `4H ${trend4h}/1H ${trend1h}/15M ${trend15m}/3M ${trend3m ?? 'n/a'}`; }
    else details.multiTf = `misaligned 4H ${trend4h}/1H ${trend1h}/15M ${trend15m}/3M ${trend3m ?? 'n/a'}${!trigger3m ? ' (no 3M trigger)' : ''}`;
  } else {
    const bias4h = regime === 'Bear' || trend4h === 'down';
    const struct1h = trend1h !== 'up';
    const trigger15 = trend15m === 'down' || trend15m === 'range';
    const ok3m = trigger3m && (trend3m === undefined || trend3m !== 'up');
    if (bias4h && struct1h && trigger15 && ok3m) { multiTf = 1; details.multiTf = `4H ${trend4h}/1H ${trend1h}/15M ${trend15m}/3M ${trend3m ?? 'n/a'}`; }
    else details.multiTf = `misaligned 4H ${trend4h}/1H ${trend1h}/15M ${trend15m}/3M ${trend3m ?? 'n/a'}${!trigger3m ? ' (no 3M trigger)' : ''}`;
  }

  return { smc, technical, volume, multiTf, total: smc + technical + volume + multiTf, details };
}

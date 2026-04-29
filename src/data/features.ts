import { query } from '../lib/db';
import { getRedis } from '../lib/redis';
import {
  BollingerBands,
  RSI,
  ATR,
  EMA,
  SMA,
  MACD,
  ADX,
  OBV,
} from 'technicalindicators';

export interface CandleRow {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function loadCandles(
  symbol: string,
  tf: string,
  limit: number,
  beforeTs?: number
): Promise<CandleRow[]> {
  // Returns chronological order (oldest first).
  const params: any[] = [symbol, tf];
  let where = `WHERE symbol = $1 AND tf = $2`;
  if (beforeTs !== undefined) {
    where += ` AND ts <= $3`;
    params.push(beforeTs);
  }
  params.push(limit);
  const sql = `SELECT ts::text, open, high, low, close, volume
               FROM candles ${where}
               ORDER BY ts DESC
               LIMIT $${params.length}`;
  const r = await query<any>(sql, params);
  return r.rows
    .map((row) => ({
      ts: parseInt(row.ts, 10),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseFloat(row.volume),
    }))
    .reverse();
}

export interface FeatureSnapshot {
  symbol: string;
  tf: string;
  asOfTs: number;
  close: number;
  // Bollinger Bands (20, 2)
  bb_upper: number | null;
  bb_middle: number | null;
  bb_lower: number | null;
  // RSI(14)
  rsi: number | null;
  // ATR(14) absolute and as percent of close
  atr: number | null;
  atr_pct: number | null;
  // EMAs
  ema8: number | null;
  ema21: number | null;
  ema55: number | null;
  ema200: number | null;
  ema_stack_aligned: 'bull' | 'bear' | null;
  // ADX(14) + directional indicators
  adx: number | null;
  pdi: number | null;
  mdi: number | null;
  // MACD (12, 26, 9)
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  // Volume
  volume: number;
  volume_sma20: number | null;
  volume_spike: number | null; // ratio v/sma
  // OBV
  obv: number | null;
}

function last<T>(arr: T[] | undefined): T | null {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1];
}

export function computeFeatures(symbol: string, tf: string, candles: CandleRow[]): FeatureSnapshot {
  if (candles.length === 0) {
    throw new Error(`computeFeatures: empty candles for ${symbol} ${tf}`);
  }
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const lastCandle = candles[candles.length - 1];

  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const lastBb = last(bb);

  const rsi = RSI.calculate({ period: 14, values: closes });
  const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });

  const ema8 = last(EMA.calculate({ period: 8, values: closes }));
  const ema21 = last(EMA.calculate({ period: 21, values: closes }));
  const ema55 = last(EMA.calculate({ period: 55, values: closes }));
  const ema200 = last(EMA.calculate({ period: 200, values: closes }));

  let stack: 'bull' | 'bear' | null = null;
  if (ema8 != null && ema21 != null && ema55 != null && ema200 != null) {
    if (ema8 > ema21 && ema21 > ema55 && ema55 > ema200) stack = 'bull';
    else if (ema8 < ema21 && ema21 < ema55 && ema55 < ema200) stack = 'bear';
  }

  const adxArr = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
  const lastAdx = last(adxArr) as { adx: number; pdi: number; mdi: number } | null;

  const macdArr = MACD.calculate({
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
    values: closes,
  });
  const lastMacd = last(macdArr) as { MACD?: number; signal?: number; histogram?: number } | null;

  const volSma20 = last(SMA.calculate({ period: 20, values: volumes }));
  const obv = last(OBV.calculate({ close: closes, volume: volumes }));

  const lastAtr = last(atr);

  return {
    symbol,
    tf,
    asOfTs: lastCandle.ts,
    close: lastCandle.close,
    bb_upper: lastBb?.upper ?? null,
    bb_middle: lastBb?.middle ?? null,
    bb_lower: lastBb?.lower ?? null,
    rsi: last(rsi),
    atr: lastAtr,
    atr_pct: lastAtr != null ? (lastAtr / lastCandle.close) * 100 : null,
    ema8,
    ema21,
    ema55,
    ema200,
    ema_stack_aligned: stack,
    adx: lastAdx?.adx ?? null,
    pdi: lastAdx?.pdi ?? null,
    mdi: lastAdx?.mdi ?? null,
    macd: lastMacd?.MACD ?? null,
    macd_signal: lastMacd?.signal ?? null,
    macd_hist: lastMacd?.histogram ?? null,
    volume: lastCandle.volume,
    volume_sma20: volSma20,
    volume_spike: volSma20 ? lastCandle.volume / volSma20 : null,
    obv,
  };
}

export async function getFeatures(
  symbol: string,
  tf: string,
  beforeTs?: number,
  useCache = true
): Promise<FeatureSnapshot> {
  // We need ~250 candles to make ADX/EMA200 stable; pull 300 to be safe.
  const cacheKey = `feat:${symbol}:${tf}:${beforeTs ?? 'now'}`;
  if (useCache) {
    const r = getRedis();
    const cached = await r.get(cacheKey);
    if (cached) return JSON.parse(cached) as FeatureSnapshot;
  }
  const candles = await loadCandles(symbol, tf, 300, beforeTs);
  const feat = computeFeatures(symbol, tf, candles);
  if (useCache) {
    const ttl = tfTtlSeconds(tf);
    await getRedis().set(cacheKey, JSON.stringify(feat), 'EX', ttl);
  }
  return feat;
}

function tfTtlSeconds(tf: string): number {
  switch (tf) {
    case '1m': return 30;
    case '5m': return 150;
    case '15m': return 450;
    case '60m': return 1800;
    case '240m': return 7200;
    default: return 300;
  }
}

export async function recentFunding(symbol: string, count = 3): Promise<{ ts: number; rate: number }[]> {
  const r = await query<{ ts: string; rate: string }>(
    `SELECT ts::text, rate::text FROM funding_history
     WHERE symbol = $1 ORDER BY ts DESC LIMIT $2`,
    [symbol, count]
  );
  return r.rows.map((row) => ({ ts: parseInt(row.ts, 10), rate: parseFloat(row.rate) }));
}

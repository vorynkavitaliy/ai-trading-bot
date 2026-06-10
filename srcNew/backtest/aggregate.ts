import { Candle } from '../data/types';

export function aggregateCandles(minuteCandles: readonly Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  let bucket: Candle | null = null;

  for (const candle of minuteCandles) {
    const bucketTs = Math.floor(candle.ts / bucketMs) * bucketMs;

    if (bucket === null || bucket.ts !== bucketTs) {
      if (bucket !== null) out.push(bucket);
      bucket = {
        ts: bucketTs,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
      continue;
    }

    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.volume += candle.volume;
  }

  if (bucket !== null) out.push(bucket);
  return out;
}

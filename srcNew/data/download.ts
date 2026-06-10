import { BybitPublicClient, KlineInterval } from '../clients/bybit/public';
import { CoinglassClient } from '../clients/coinglass';
import { Logger } from '../core/logger';
import { writeNdjson } from './store';
import { Candle, SeriesPoint } from './types';

const MINUTE_MS = 60_000;

export async function downloadKlines(
  client: BybitPublicClient,
  symbol: string,
  interval: KlineInterval,
  fromTs: number,
  toTs: number,
  logger: Logger,
): Promise<Candle[]> {
  const stepMs = interval === 'D' ? 86_400_000 : interval === 'W' ? 604_800_000 : Number(interval) * MINUTE_MS;
  const windowMs = 1000 * stepMs;
  const out: Candle[] = [];
  let cursor = fromTs;

  // Bybit returns the LATEST bars within [start, end] — page with fixed-width windows.
  while (cursor < toTs) {
    const windowEnd = Math.min(cursor + windowMs - 1, toTs);
    const batch = await client.getKlines({ symbol, interval, start: cursor, end: windowEnd, limit: 1000 });

    for (const candle of batch) {
      if (candle.ts >= cursor && candle.ts < toTs) out.push(candle);
    }

    cursor += windowMs;

    if (out.length % 50_000 < 1000) {
      logger.info('klines progress', { symbol, interval, fetched: out.length, cursorIso: new Date(cursor).toISOString() });
    }
  }

  out.sort((a, b) => a.ts - b.ts);
  return dedupeByTs(out);
}

function dedupeByTs(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let prevTs = -1;
  for (const candle of candles) {
    if (candle.ts === prevTs) continue;
    out.push(candle);
    prevTs = candle.ts;
  }
  return out;
}

interface CgSeriesSpec {
  name: string;
  path: string;
  params: Record<string, string | number>;
  mapRow: (row: Record<string, unknown>) => SeriesPoint;
}

function num(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`non-numeric CG value: ${JSON.stringify(value)}`);
  }
  return parsed;
}

function ohlcPoint(row: Record<string, unknown>): SeriesPoint {
  return {
    ts: num(row.time),
    values: { open: num(row.open), high: num(row.high), low: num(row.low), close: num(row.close) },
  };
}

export function cgSeriesSpecs(coin: string, pair: string, exchange: string, interval: string): CgSeriesSpec[] {
  return [
    {
      name: `cg_oi_aggregated_${coin}_${interval}`,
      path: '/futures/open-interest/aggregated-history',
      params: { symbol: coin, interval },
      mapRow: ohlcPoint,
    },
    {
      name: `cg_funding_oi_weighted_${coin}_${interval}`,
      path: '/futures/funding-rate/oi-weight-history',
      params: { symbol: coin, interval },
      mapRow: ohlcPoint,
    },
    {
      name: `cg_ls_global_account_${pair}_${interval}`,
      path: '/futures/global-long-short-account-ratio/history',
      params: { exchange, symbol: pair, interval },
      mapRow: row => ({
        ts: num(row.time),
        values: {
          longPct: num(row.global_account_long_percent),
          shortPct: num(row.global_account_short_percent),
          ratio: num(row.global_account_long_short_ratio),
        },
      }),
    },
    {
      name: `cg_ls_top_account_${pair}_${interval}`,
      path: '/futures/top-long-short-account-ratio/history',
      params: { exchange, symbol: pair, interval },
      mapRow: row => ({
        ts: num(row.time),
        values: {
          longPct: num(row.top_account_long_percent),
          shortPct: num(row.top_account_short_percent),
          ratio: num(row.top_account_long_short_ratio),
        },
      }),
    },
    {
      name: `cg_ls_top_position_${pair}_${interval}`,
      path: '/futures/top-long-short-position-ratio/history',
      params: { exchange, symbol: pair, interval },
      mapRow: row => ({
        ts: num(row.time),
        values: {
          longPct: num(row.top_position_long_percent),
          shortPct: num(row.top_position_short_percent),
          ratio: num(row.top_position_long_short_ratio),
        },
      }),
    },
    {
      name: `cg_liquidation_${pair}_${interval}`,
      path: '/futures/liquidation/history',
      params: { exchange, symbol: pair, interval },
      mapRow: row => ({
        ts: num(row.time),
        values: {
          longLiqUsd: num(row.long_liquidation_usd),
          shortLiqUsd: num(row.short_liquidation_usd),
        },
      }),
    },
    {
      name: `cg_taker_${pair}_${interval}`,
      path: '/futures/taker-buy-sell-volume/history',
      params: { exchange, symbol: pair, interval },
      mapRow: row => ({
        ts: num(row.time),
        values: {
          buyUsd: num(row.taker_buy_volume_usd),
          sellUsd: num(row.taker_sell_volume_usd),
        },
      }),
    },
  ];
}

export async function downloadCgSeries(
  client: CoinglassClient,
  spec: CgSeriesSpec,
  fromTs: number,
  toTs: number,
  intervalMs: number,
  logger: Logger,
): Promise<SeriesPoint[]> {
  const out: SeriesPoint[] = [];
  let cursor = fromTs;

  while (cursor < toTs) {
    const rows = await client.request<Record<string, unknown>[]>(spec.path, {
      ...spec.params,
      start_time: cursor,
      end_time: toTs,
      limit: 1000,
    });
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const point = spec.mapRow(row);
      if (point.ts >= cursor && point.ts <= toTs) out.push(point);
    }

    const lastTs = num(rows[rows.length - 1].time);
    const nextCursor = lastTs + intervalMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  out.sort((a, b) => a.ts - b.ts);
  logger.info('cg series downloaded', { name: spec.name, points: out.length });
  return out;
}

export function persistSeries(name: string, points: readonly SeriesPoint[], logger: Logger): void {
  const file = writeNdjson(name, points);
  logger.info('cache written', { file, rows: points.length });
}

export function persistCandles(name: string, candles: readonly Candle[], logger: Logger): void {
  const file = writeNdjson(name, candles);
  logger.info('cache written', { file, rows: candles.length });
}

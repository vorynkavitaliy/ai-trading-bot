import { CgSeriesInput } from '../backtest/cg-view';
import { BybitPublicClient } from '../clients/bybit/public';
import { CoinglassClient } from '../clients/coinglass';
import { Candle, SeriesPoint } from '../data/types';
import { LivePortfolioConfig } from './config';

const MINUTE_MS = 60_000;

function num(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`non-numeric CG value: ${JSON.stringify(value)}`);
  return parsed;
}

async function fetchSeries(
  cg: CoinglassClient,
  path: string,
  params: Record<string, string | number>,
  mapRow: (row: Record<string, unknown>) => SeriesPoint,
  limit: number,
): Promise<SeriesPoint[]> {
  const rows = await cg.request<Record<string, unknown>[]>(path, { ...params, limit });
  return (rows ?? []).map(mapRow).sort((a, b) => a.ts - b.ts);
}

export async function fetchPairCgInputs(
  cg: CoinglassClient,
  coin: string,
  pair: string,
  config: LivePortfolioConfig,
  prefix = '',
): Promise<CgSeriesInput[]> {
  const interval = '4h';
  const intervalMs = config.decisionIntervalMs;
  const limit = config.pctWindowBars + 20;

  const [lsTopPosition, funding, liq] = await Promise.all([
    fetchSeries(
      cg,
      '/futures/top-long-short-position-ratio/history',
      { exchange: config.referenceExchange, symbol: pair, interval },
      row => ({
        ts: num(row.time),
        values: {
          longPct: num(row.top_position_long_percent),
          shortPct: num(row.top_position_short_percent),
          ratio: num(row.top_position_long_short_ratio),
        },
      }),
      limit,
    ),
    fetchSeries(
      cg,
      '/futures/funding-rate/oi-weight-history',
      { symbol: coin, interval },
      row => ({
        ts: num(row.time),
        values: { open: num(row.open), high: num(row.high), low: num(row.low), close: num(row.close) },
      }),
      limit,
    ),
    fetchSeries(
      cg,
      '/futures/liquidation/history',
      { exchange: config.referenceExchange, symbol: pair, interval },
      row => ({
        ts: num(row.time),
        values: { longLiqUsd: num(row.long_liquidation_usd), shortLiqUsd: num(row.short_liquidation_usd) },
      }),
      limit,
    ),
  ]);

  const names =
    prefix === 'btc'
      ? { ls: 'btcLsTopPosition', funding: 'btcFunding', liq: 'btcLiq' }
      : { ls: 'lsTopPosition', funding: 'funding', liq: 'liq' };

  return [
    { name: names.ls, intervalMs, points: lsTopPosition },
    { name: names.funding, intervalMs, points: funding },
    { name: names.liq, intervalMs, points: liq },
  ];
}

export async function fetchClosedDecisionBars(
  bybit: BybitPublicClient,
  pair: string,
  config: LivePortfolioConfig,
  nowTs: number,
  count = 300,
): Promise<Candle[]> {
  const bars = await bybit.getKlines({ symbol: pair, interval: '240', limit: Math.min(count, 1000) });
  return bars.filter(bar => bar.ts + config.decisionIntervalMs <= nowTs);
}

export async function fetchClosedMinutes(
  bybit: BybitPublicClient,
  pair: string,
  fromTs: number,
  nowTs: number,
): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = Math.floor(fromTs / MINUTE_MS) * MINUTE_MS;
  const lastClosedTs = Math.floor(nowTs / MINUTE_MS) * MINUTE_MS - MINUTE_MS;

  while (cursor <= lastClosedTs) {
    const windowEnd = Math.min(cursor + 999 * MINUTE_MS, lastClosedTs);
    const batch = await bybit.getKlines({ symbol: pair, interval: '1', start: cursor, end: windowEnd + MINUTE_MS - 1, limit: 1000 });
    for (const candle of batch) {
      if (candle.ts >= cursor && candle.ts <= lastClosedTs) out.push(candle);
    }
    cursor = windowEnd + MINUTE_MS;
  }

  out.sort((a, b) => a.ts - b.ts);
  return out;
}

export async function fetchLastClosedMinuteClose(
  bybit: BybitPublicClient,
  pair: string,
  nowTs: number,
): Promise<number> {
  const bars = await bybit.getKlines({ symbol: pair, interval: '1', limit: 3 });
  const closed = bars.filter(bar => bar.ts + MINUTE_MS <= nowTs);
  if (closed.length === 0) throw new Error(`${pair}: no closed minute bar available`);
  return closed[closed.length - 1].close;
}

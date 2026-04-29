import { RestClientV5 } from 'bybit-api';
import { log } from '../lib/logger';

// Public REST client — no auth needed for klines/funding/oi historical data.
let client: RestClientV5 | null = null;

export function getPublicRest(): RestClientV5 {
  if (client) return client;
  client = new RestClientV5({ testnet: false, recv_window: 10_000 });
  return client;
}

// TF mapping between our DB tag and Bybit interval string
export const TF_TO_BYBIT: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '60m': '60',
  '240m': '240',
  '1D': 'D',
  '1W': 'W',
};

export const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '60m': 60 * 60_000,
  '240m': 4 * 60 * 60_000,
  '1D': 24 * 60 * 60_000,
  '1W': 7 * 24 * 60 * 60_000,
};

export interface BybitKline {
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export async function fetchKlines(
  symbol: string,
  tf: string,
  startMs: number,
  endMs: number
): Promise<BybitKline[]> {
  const interval = TF_TO_BYBIT[tf];
  if (!interval) throw new Error(`unknown tf: ${tf}`);
  const c = getPublicRest();
  const res = await c.getKline({
    category: 'linear',
    symbol,
    interval: interval as any,         // 'D' / 'W' valid in Bybit V5 but typed narrowly in SDK
    start: startMs,
    end: endMs,
    limit: 1000,
  });
  if (res.retCode !== 0) {
    throw new Error(`getKline retCode=${res.retCode} ${res.retMsg}`);
  }
  const list = res.result?.list ?? [];
  // Bybit returns newest-first — reverse for chronological
  return list.reverse().map((row: any) => ({
    startTime: parseInt(row[0], 10),
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    turnover: parseFloat(row[6]),
  }));
}

export interface BybitFunding {
  ts: number;
  rate: number;
}

export async function fetchFunding(
  symbol: string,
  startMs: number,
  endMs: number
): Promise<BybitFunding[]> {
  const c = getPublicRest();
  const res = await c.getFundingRateHistory({
    category: 'linear',
    symbol,
    startTime: startMs,
    endTime: endMs,
    limit: 200,
  });
  if (res.retCode !== 0) {
    throw new Error(`getFundingRateHistory retCode=${res.retCode} ${res.retMsg}`);
  }
  const list = res.result?.list ?? [];
  return list
    .map((row: any) => ({
      ts: parseInt(row.fundingRateTimestamp, 10),
      rate: parseFloat(row.fundingRate),
    }))
    .reverse();
}

export async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import { readNdjson } from '../data/store';
import { Candle, SeriesPoint } from '../data/types';
import { CgSeriesInput, CgView } from './cg-view';

const HOUR_MS = 3_600_000;

export interface BtcDataset {
  minutes: Candle[];
  cgInputs: CgSeriesInput[];
  fundingPoints: SeriesPoint[];
}

export const CG = {
  oi: 'oi',
  funding: 'funding',
  lsGlobal: 'lsGlobal',
  lsTopAccount: 'lsTopAccount',
  lsTopPosition: 'lsTopPosition',
  liq: 'liq',
  taker: 'taker',
} as const;

export function loadDataset(coin: string, pair: string, cgInterval: '1h' | '4h'): BtcDataset {
  const minutes = readNdjson<Candle>(`bybit_${pair}_1m`);
  const intervalMs = cgInterval === '4h' ? 4 * HOUR_MS : HOUR_MS;
  const fundingPoints = readNdjson<SeriesPoint>(`cg_funding_oi_weighted_${coin}_${cgInterval}`);

  const cgInputs: CgSeriesInput[] = [
    { name: CG.oi, intervalMs, points: readNdjson<SeriesPoint>(`cg_oi_aggregated_${coin}_${cgInterval}`) },
    { name: CG.funding, intervalMs, points: fundingPoints },
    { name: CG.lsGlobal, intervalMs, points: readNdjson<SeriesPoint>(`cg_ls_global_account_${pair}_${cgInterval}`) },
    { name: CG.lsTopAccount, intervalMs, points: readNdjson<SeriesPoint>(`cg_ls_top_account_${pair}_${cgInterval}`) },
    { name: CG.lsTopPosition, intervalMs, points: readNdjson<SeriesPoint>(`cg_ls_top_position_${pair}_${cgInterval}`) },
    { name: CG.liq, intervalMs, points: readNdjson<SeriesPoint>(`cg_liquidation_${pair}_${cgInterval}`) },
    { name: CG.taker, intervalMs, points: readNdjson<SeriesPoint>(`cg_taker_${pair}_${cgInterval}`) },
  ];

  return { minutes, cgInputs, fundingPoints };
}

export function loadBtcDataset(cgInterval: '1h' | '4h' = '1h'): BtcDataset {
  return loadDataset('BTC', 'BTCUSDT', cgInterval);
}

export function clampMinutesToCgWindow(dataset: BtcDataset, publishLagMs: number): Candle[] {
  let earliest = 0;
  for (const input of dataset.cgInputs) {
    if (input.points.length === 0) continue;
    const firstAvailable = input.points[0].ts + input.intervalMs + publishLagMs;
    earliest = Math.max(earliest, firstAvailable);
  }
  return dataset.minutes.filter(m => m.ts >= earliest);
}

export function buildCgView(dataset: BtcDataset, publishLagMs: number): CgView {
  return new CgView(dataset.cgInputs, publishLagMs);
}

// CG funding OHLC values are PERCENT (verified vs Bybit native: CG -0.004531 ↔ Bybit -0.00004518).
const CG_FUNDING_PERCENT_TO_FRACTION = 1 / 100;

export function buildFundingProvider(
  fundingPoints: readonly SeriesPoint[],
  publishLagMs: number,
  intervalMs: number,
): (ts: number) => number | null {
  const sorted = [...fundingPoints].sort((a, b) => a.ts - b.ts);
  const availableAt = sorted.map(p => p.ts + intervalMs + publishLagMs);

  return (ts: number) => {
    let lo = 0;
    let hi = availableAt.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (availableAt[mid] <= ts) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return null;
    return sorted[lo - 1].values.close * CG_FUNDING_PERCENT_TO_FRACTION;
  };
}

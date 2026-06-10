import { aggregateCandles } from '../aggregate';
import { CgView } from '../cg-view';
import { percentileRank } from '../indicators';
import { readNdjson } from '../../data/store';
import { Candle, SeriesPoint } from '../../data/types';

const HOUR_MS = 3_600_000;
const BUCKET_MS = 4 * HOUR_MS;
const PUBLISH_LAG_MS = 120_000;
const PCT_WINDOW = 180;

interface EventDef {
  name: string;
  test: (ctx: EventContext) => boolean;
}

interface EventContext {
  bars: Candle[];
  idx: number;
  cg: CgView;
}

interface Stats {
  n: number;
  meanAtr: number[];
  hitRate: number[];
  tStat: number[];
}

const HORIZONS = [1, 2, 6, 12];

function atrAt(bars: Candle[], idx: number, window: number): number | null {
  if (idx + 1 < window + 1) return null;
  let sum = 0;
  for (let i = idx - window + 1; i <= idx; i++) {
    const prevClose = bars[i - 1].close;
    sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prevClose), Math.abs(bars[i].low - prevClose));
  }
  return sum / window;
}

function pctOf(cg: CgView, series: string, field: string): number | null {
  const history = cg.valueHistory(series, field, PCT_WINDOW + 1);
  if (history.length < PCT_WINDOW) return null;
  return percentileRank(history.slice(0, -1), history[history.length - 1]);
}

function lastDelta(cg: CgView, series: string, field: string): number | null {
  const history = cg.valueHistory(series, field, 2);
  if (history.length < 2) return null;
  const prev = history[0];
  if (prev === 0) return null;
  return history[1] / prev - 1;
}

function buildEvents(): EventDef[] {
  return [
    { name: 'baseline(all bars)', test: () => true },

    { name: 'funding pct>=0.95', test: ctx => (pctOf(ctx.cg, 'funding', 'close') ?? 0.5) >= 0.95 },
    { name: 'funding pct<=0.05', test: ctx => (pctOf(ctx.cg, 'funding', 'close') ?? 0.5) <= 0.05 },
    { name: 'funding negative abs', test: ctx => (ctx.cg.latest('funding')?.values.close ?? 0) < -0.005 },

    { name: 'lsTopPos pct>=0.95', test: ctx => (pctOf(ctx.cg, 'lsTopPosition', 'ratio') ?? 0.5) >= 0.95 },
    { name: 'lsTopPos pct<=0.05', test: ctx => (pctOf(ctx.cg, 'lsTopPosition', 'ratio') ?? 0.5) <= 0.05 },
    { name: 'lsGlobal pct>=0.95', test: ctx => (pctOf(ctx.cg, 'lsGlobal', 'ratio') ?? 0.5) >= 0.95 },
    { name: 'lsGlobal pct<=0.05', test: ctx => (pctOf(ctx.cg, 'lsGlobal', 'ratio') ?? 0.5) <= 0.05 },

    { name: 'taker buy/sell>1.3', test: ctx => {
      const latest = ctx.cg.latest('taker');
      if (!latest) return false;
      return latest.values.buyUsd / Math.max(latest.values.sellUsd, 1) > 1.3;
    } },
    { name: 'taker buy/sell<0.77', test: ctx => {
      const latest = ctx.cg.latest('taker');
      if (!latest) return false;
      return latest.values.buyUsd / Math.max(latest.values.sellUsd, 1) < 0.77;
    } },

    { name: 'longLiq spike p97', test: ctx => {
      const history = ctx.cg.valueHistory('liq', 'longLiqUsd', PCT_WINDOW + 1);
      if (history.length < PCT_WINDOW) return false;
      return (percentileRank(history.slice(0, -1), history[history.length - 1]) ?? 0) >= 0.97;
    } },
    { name: 'shortLiq spike p97', test: ctx => {
      const history = ctx.cg.valueHistory('liq', 'shortLiqUsd', PCT_WINDOW + 1);
      if (history.length < PCT_WINDOW) return false;
      return (percentileRank(history.slice(0, -1), history[history.length - 1]) ?? 0) >= 0.97;
    } },

    { name: 'OI up>2% & price up', test: ctx => {
      const dOi = lastDelta(ctx.cg, 'oi', 'close');
      const bar = ctx.bars[ctx.idx];
      return dOi !== null && dOi > 0.02 && bar.close > bar.open;
    } },
    { name: 'OI up>2% & price down', test: ctx => {
      const dOi = lastDelta(ctx.cg, 'oi', 'close');
      const bar = ctx.bars[ctx.idx];
      return dOi !== null && dOi > 0.02 && bar.close < bar.open;
    } },
    { name: 'OI down>2% & price down', test: ctx => {
      const dOi = lastDelta(ctx.cg, 'oi', 'close');
      const bar = ctx.bars[ctx.idx];
      return dOi !== null && dOi < -0.02 && bar.close < bar.open;
    } },
    { name: 'OI down>2% & price up', test: ctx => {
      const dOi = lastDelta(ctx.cg, 'oi', 'close');
      const bar = ctx.bars[ctx.idx];
      return dOi !== null && dOi < -0.02 && bar.close > bar.open;
    } },

    { name: 'bigDown bar (<-1.5 ATR)', test: ctx => {
      const atrValue = atrAt(ctx.bars, ctx.idx, 14);
      if (atrValue === null) return false;
      const bar = ctx.bars[ctx.idx];
      return bar.close - bar.open < -1.5 * atrValue;
    } },
    { name: 'bigUp bar (>+1.5 ATR)', test: ctx => {
      const atrValue = atrAt(ctx.bars, ctx.idx, 14);
      if (atrValue === null) return false;
      const bar = ctx.bars[ctx.idx];
      return bar.close - bar.open > 1.5 * atrValue;
    } },
  ];
}

function main(): void {
  const minutes = readNdjson<Candle>('bybit_BTCUSDT_1m');
  const bars = aggregateCandles(minutes, BUCKET_MS).slice(0, -1);

  const seriesNames: Array<[string, string]> = [
    ['oi', 'cg_oi_aggregated_BTC_4h'],
    ['funding', 'cg_funding_oi_weighted_BTC_4h'],
    ['lsGlobal', 'cg_ls_global_account_BTCUSDT_4h'],
    ['lsTopAccount', 'cg_ls_top_account_BTCUSDT_4h'],
    ['lsTopPosition', 'cg_ls_top_position_BTCUSDT_4h'],
    ['liq', 'cg_liquidation_BTCUSDT_4h'],
    ['taker', 'cg_taker_BTCUSDT_4h'],
  ];
  const cg = new CgView(
    seriesNames.map(([name, file]) => ({
      name,
      intervalMs: BUCKET_MS,
      points: readNdjson<SeriesPoint>(file),
    })),
    PUBLISH_LAG_MS,
  );

  const events = buildEvents();
  const stats = new Map<string, { rets: number[][]; }>();
  for (const event of events) stats.set(event.name, { rets: HORIZONS.map(() => []) });

  const maxHorizon = Math.max(...HORIZONS);

  for (let idx = PCT_WINDOW + 20; idx < bars.length - maxHorizon; idx++) {
    const decisionTs = bars[idx].ts + BUCKET_MS + 60_000;
    cg.setCursor(decisionTs);
    const atrValue = atrAt(bars, idx, 14);
    if (atrValue === null || atrValue <= 0) continue;

    const ctx: EventContext = { bars, idx, cg };
    const baseClose = bars[idx].close;

    for (const event of events) {
      if (!event.test(ctx)) continue;
      const bucket = stats.get(event.name)!;
      for (let h = 0; h < HORIZONS.length; h++) {
        const futureClose = bars[idx + HORIZONS[h]].close;
        bucket.rets[h].push((futureClose - baseClose) / atrValue);
      }
    }
  }

  console.log(`bars=${bars.length} (4h), window=${PCT_WINDOW}, horizons=${HORIZONS.join(',')} (x4h)`);
  console.log('event\tn\t' + HORIZONS.map(h => `m${h * 4}h\tt${h * 4}h\thit${h * 4}h`).join('\t'));

  for (const event of events) {
    const bucket = stats.get(event.name)!;
    const n = bucket.rets[0].length;
    if (n === 0) {
      console.log(`${event.name}\t0`);
      continue;
    }
    const cols: string[] = [];
    for (let h = 0; h < HORIZONS.length; h++) {
      const rets = bucket.rets[h];
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
      const tStat = mean / Math.sqrt(variance / rets.length);
      const hit = rets.filter(r => r > 0).length / rets.length;
      cols.push(`${mean.toFixed(3)}\t${tStat.toFixed(2)}\t${(hit * 100).toFixed(0)}%`);
    }
    console.log(`${event.name}\t${n}\t${cols.join('\t')}`);
  }
}

main();

/**
 * xliq-depth — find the real max history depth for the two aggregated endpoints by
 * sweeping the `limit` param, and try start_time/end_time range params. Read-only.
 */
import { cgGet } from '../../core/coinglass';

const LIQ = '/futures/liquidation/aggregated-history';
const TAKER = '/futures/aggregated-taker-buy-sell-volume/history';
const EX = 'Binance,OKX,Bybit';

async function tryLimit(path: string, lim: number) {
  try {
    const r = await cgGet<any[]>(path, { symbol: 'BTC', exchange_list: EX, interval: '4h', limit: lim });
    const d = r.data || [];
    if (!d.length) { console.log(`    limit=${lim}: 0 rows`); return 0; }
    console.log(`    limit=${lim}: rows=${d.length}  ${new Date(d[0].time).toISOString()} -> ${new Date(d[d.length-1].time).toISOString()}`);
    return d.length;
  } catch (e: any) {
    console.log(`    limit=${lim}: ERR ${e?.message ?? String(e)}`);
    return -1;
  }
}

async function tryRange(path: string, label: string, params: Record<string, string|number>) {
  try {
    const r = await cgGet<any[]>(path, { symbol: 'BTC', exchange_list: EX, interval: '4h', ...params });
    const d = r.data || [];
    if (!d.length) { console.log(`    ${label}: 0 rows`); return; }
    console.log(`    ${label}: rows=${d.length}  ${new Date(d[0].time).toISOString()} -> ${new Date(d[d.length-1].time).toISOString()}`);
  } catch (e: any) {
    console.log(`    ${label}: ERR ${e?.message ?? String(e)}`);
  }
}

async function main() {
  const now = Date.now();
  const yearAgo = now - 365 * 24 * 3600 * 1000;
  const twoYearAgo = now - 730 * 24 * 3600 * 1000;

  for (const [name, path] of [['LIQ', LIQ], ['TAKER', TAKER]] as const) {
    console.log(`=== ${name} limit sweep ===`);
    for (const lim of [100, 500, 1000, 2000, 4500, 10000]) await tryLimit(path, lim);
    console.log(`=== ${name} range params ===`);
    // sec epoch
    await tryRange(path, 'start/end sec', { start_time: Math.floor(twoYearAgo/1000), end_time: Math.floor(now/1000) });
    // ms epoch
    await tryRange(path, 'start/end ms', { start_time: twoYearAgo, end_time: now });
    await tryRange(path, 'startTime/endTime ms', { startTime: twoYearAgo, endTime: now });
    await tryRange(path, 'limit=4500 + start sec 1y', { limit: 4500, start_time: Math.floor(yearAgo/1000) });
  }
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

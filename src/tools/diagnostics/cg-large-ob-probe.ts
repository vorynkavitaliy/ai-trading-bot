/**
 * cg-large-ob-probe — read-only probe of Coinglass v4 "large limit orders / order-book
 * depth" endpoint family + inventory of existing cg_orderbook_pair coverage.
 *
 * Goal: confirm 200-ok + history depth before any IC work. Reuses shared cgGet.
 * Run: npx tsx src/tools/diagnostics/cg-large-ob-probe.ts
 */
import { cgGet } from '../../core/coinglass';
import { query, close } from '../../core/db';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 350;

interface Probe { name: string; path: string; params: Record<string, string | number>; }

// Candidate v4 paths for large-orders / depth family. Hints from prompt + obvious variants.
const probes: Probe[] = [
  { name: 'large-orderbook',              path: '/futures/large-orderbook',              params: { exchange: 'Binance', symbol: 'BTCUSDT' } },
  { name: 'large-orderbook-history',      path: '/futures/large-orderbook-history',      params: { exchange: 'Binance', symbol: 'BTCUSDT', limit: 5 } },
  { name: 'large-limit-order',            path: '/futures/large-limit-order',            params: { exchange: 'Binance', symbol: 'BTCUSDT' } },
  { name: 'large-limit-order-history',    path: '/futures/large-limit-order-history',    params: { exchange: 'Binance', symbol: 'BTCUSDT', limit: 5 } },
  { name: 'orderbook-large-limit',        path: '/futures/orderbook/large-limit-order',  params: { exchange: 'Binance', symbol: 'BTCUSDT' } },
  { name: 'orderbook-large-limit-hist',   path: '/futures/orderbook/large-limit-order-history', params: { exchange: 'Binance', symbol: 'BTCUSDT', limit: 5 } },
  { name: 'orderbook-ask-bids-history',   path: '/futures/orderbook/ask-bids-history',   params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', range: 5, limit: 5 } },
  { name: 'orderbook-history',            path: '/futures/orderbook/history',            params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5 } },
  { name: 'orderbook-aggregated-history', path: '/futures/orderbook/aggregated-ask-bids-history', params: { symbol: 'BTC', interval: '4h', range: 5, limit: 5, exchange_list: 'Binance' } },
  { name: 'spot-large-orderbook',         path: '/spot/large-orderbook',                 params: { exchange: 'Binance', symbol: 'BTCUSDT' } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms)),
  ]);
}

function shapeReport(data: any): string {
  if (data == null) return 'null';
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : typeof first;
    return `array len=${data.length} firstKeys=${JSON.stringify(keys)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    // column-array shape check
    const colHint = keys.filter(k => Array.isArray((data as any)[k])).map(k => `${k}[${(data as any)[k].length}]`);
    return `object keys=${JSON.stringify(keys).slice(0,300)}${colHint.length ? ' cols=' + colHint.join(',') : ''}`;
  }
  return String(data).slice(0, 80);
}

async function main() {
  console.log('=== LARGE-ORDERBOOK FAMILY PROBE ===\n');
  for (const p of probes) {
    try {
      const r: any = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      console.log(`OK   ${p.name.padEnd(30)} ${p.path}`);
      console.log(`     ${shapeReport(r.data)}`);
      // print one sample row if array
      if (Array.isArray(r.data) && r.data[0]) console.log(`     sample[0]=${JSON.stringify(r.data[0]).slice(0,400)}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.log(`ERR  ${p.name.padEnd(30)} ${p.path}`);
      console.log(`     ${msg.slice(0, 240)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }

  // --- existing cg_orderbook_pair inventory ---
  console.log('\n=== cg_orderbook_pair INVENTORY (existing ingested depth ±5%) ===');
  try {
    const r = await query<any>(
      `SELECT pair, COUNT(*)::int AS n,
              to_timestamp(MIN(ts)/1000)::date AS first_d,
              to_timestamp(MAX(ts)/1000)::date AS last_d
       FROM cg_orderbook_pair GROUP BY pair ORDER BY pair`);
    console.table(r.rows);
    const span = await query<any>(
      `SELECT to_timestamp(MIN(ts)/1000) AS first_ts, to_timestamp(MAX(ts)/1000) AS last_ts,
              COUNT(*)::int AS total FROM cg_orderbook_pair`);
    console.log('overall:', JSON.stringify(span.rows[0]));
    const samp = await query<any>(
      `SELECT pair, ts, bids_usd, asks_usd, bids_qty, asks_qty FROM cg_orderbook_pair
       WHERE pair='BTCUSDT' ORDER BY ts DESC LIMIT 3`);
    console.log('BTC sample rows:'); console.table(samp.rows);
  } catch (e: any) {
    console.log('inventory query failed:', e?.message ?? String(e));
  }
  await close();
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

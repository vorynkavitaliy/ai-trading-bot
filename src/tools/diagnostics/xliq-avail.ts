/**
 * xliq-avail — availability check for the cross-exchange aggregated liquidation +
 * taker family test. Read-only. Prints:
 *   1) candle coverage (240m) for BTCUSDT + book pairs
 *   2) one sample call to each aggregated endpoint to confirm shape + span
 */
import { cgGet } from '../../core/coinglass';
import { query, close } from '../../core/db';

const PAIRS = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];

async function candleCoverage() {
  console.log('=== candle coverage (240m) ===');
  for (const sym of PAIRS) {
    const r = await query<any>(
      `SELECT count(*) AS n, min(ts)::text AS mn, max(ts)::text AS mx FROM candles WHERE symbol=$1 AND tf='240m'`,
      [sym],
    );
    const row = r.rows[0];
    const mn = row.mn ? new Date(parseInt(row.mn, 10)).toISOString() : 'NA';
    const mx = row.mx ? new Date(parseInt(row.mx, 10)).toISOString() : 'NA';
    console.log(`  ${sym.padEnd(9)} n=${String(row.n).padStart(6)}  ${mn} -> ${mx}`);
  }
}

async function probeEndpoint(label: string, path: string, params: Record<string, string | number>) {
  try {
    const r = await cgGet<any>(path, params);
    const data: any = r.data;
    if (Array.isArray(data)) {
      const first = data[0];
      const last = data[data.length - 1];
      console.log(`  [${label}] OK array rows=${data.length}`);
      console.log(`     firstKeys=${first && typeof first === 'object' ? JSON.stringify(Object.keys(first)) : typeof first}`);
      console.log(`     first=${JSON.stringify(first)}`);
      console.log(`     last =${JSON.stringify(last)}`);
    } else if (data && typeof data === 'object') {
      console.log(`  [${label}] OK object topKeys=${JSON.stringify(Object.keys(data))}`);
      // show lengths of any array fields
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) console.log(`     ${k}: array len=${v.length} sample=${JSON.stringify(v.slice(0, 2))}`);
      }
    } else {
      console.log(`  [${label}] OK scalar=${JSON.stringify(data)}`);
    }
  } catch (e: any) {
    console.log(`  [${label}] ERR ${e?.message ?? String(e)}`);
  }
}

async function main() {
  await candleCoverage();

  console.log('\n=== aggregated liquidation history (no exchange_list, then with) ===');
  await probeEndpoint('liq-agg no-exlist', '/futures/liquidation/aggregated-history', { symbol: 'BTC', interval: '4h', limit: 5 });
  await probeEndpoint('liq-agg exlist=ALL', '/futures/liquidation/aggregated-history', { symbol: 'BTC', exchange_list: 'ALL', interval: '4h', limit: 5 });
  await probeEndpoint('liq-agg multi-ex', '/futures/liquidation/aggregated-history', { symbol: 'BTC', exchange_list: 'Binance,OKX,Bybit', interval: '4h', limit: 5 });

  console.log('\n=== aggregated taker buy/sell history ===');
  await probeEndpoint('taker no-exlist', '/futures/aggregated-taker-buy-sell-volume/history', { symbol: 'BTC', interval: '4h', limit: 5 });
  await probeEndpoint('taker exlist=ALL', '/futures/aggregated-taker-buy-sell-volume/history', { symbol: 'BTC', exchange_list: 'ALL', interval: '4h', limit: 5 });

  console.log('\n=== max history probe: large limit on liq-agg ===');
  await probeEndpoint('liq-agg big', '/futures/liquidation/aggregated-history', { symbol: 'BTC', exchange_list: 'ALL', interval: '4h', limit: 5000 });
  await probeEndpoint('taker big', '/futures/aggregated-taker-buy-sell-volume/history', { symbol: 'BTC', exchange_list: 'ALL', interval: '4h', limit: 5000 });

  await close();
}

main().catch(async e => { console.error('crashed', e?.message ?? String(e)); await close(); process.exit(1); });

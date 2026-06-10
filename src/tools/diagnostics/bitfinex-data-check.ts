/**
 * bitfinex-data-check — verify (a) borrow rate variance/depth on Binance+OKX,
 * (b) BTC daily candle coverage in our candles table for the margin-LS span.
 *
 * Run: npx tsx src/tools/diagnostics/bitfinex-data-check.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

async function borrowDepth(exchange: string) {
  const r = await cgGet<any[]>('/borrow-interest-rate/history', { exchange, symbol: 'BTC', interval: '1d', limit: 4500 });
  const d = r.data;
  if (!Array.isArray(d) || d.length === 0) { console.log(`borrow ${exchange} 1d: 0 rows`); return; }
  const rates = d.map(x => x.interest_rate).filter((x: any) => x != null);
  const uniq = new Set(rates.map((x: number) => x.toFixed(8)));
  const min = Math.min(...rates), max = Math.max(...rates);
  const ft = d[0].time, lt = d[d.length - 1].time;
  console.log(`borrow ${exchange} 1d: ${d.length} rows  span ${new Date(ft * 1000).toISOString().slice(0, 10)}..${new Date(lt * 1000).toISOString().slice(0, 10)}  uniqVals=${uniq.size}  min=${min} max=${max}`);
}

async function candleCheck(symbol: string, tf: string) {
  const r = await query<any>(
    `SELECT COUNT(*) AS n, MIN(ts)::text AS mn, MAX(ts)::text AS mx FROM candles WHERE symbol=$1 AND tf=$2`,
    [symbol, tf]
  );
  const row = r.rows[0];
  const mn = row.mn ? new Date(parseInt(row.mn)).toISOString().slice(0, 10) : '?';
  const mx = row.mx ? new Date(parseInt(row.mx)).toISOString().slice(0, 10) : '?';
  console.log(`candles ${symbol} ${tf}: n=${row.n}  span ${mn}..${mx}`);
}

async function main() {
  console.log('\n=== borrow-rate depth + variance ===');
  for (const ex of ['Binance', 'OKX']) {
    try { await borrowDepth(ex); } catch (e: any) { console.log(`borrow ${ex}: FAIL ${String(e?.message ?? e).slice(0, 120)}`); }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n=== candle coverage ===');
  for (const tf of ['1D', '1d', '240m', '60m']) {
    try { await candleCheck('BTCUSDT', tf); } catch (e: any) { console.log(`candles BTCUSDT ${tf}: FAIL ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  // also list distinct tf values present
  const tfs = await query<any>(`SELECT DISTINCT tf FROM candles WHERE symbol='BTCUSDT' ORDER BY tf`, []);
  console.log(`distinct tf for BTCUSDT: ${tfs.rows.map(r => r.tf).join(', ')}`);
  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? e); process.exit(1); });

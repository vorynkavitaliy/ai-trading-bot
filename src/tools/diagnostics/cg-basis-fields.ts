/**
 * cg-basis-fields — inspect the full field set + value ranges of basis rows to
 * understand units (close_basis vs close_change) before building the IC study.
 * Also pulls the matching candle close to sanity-check basis units.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

async function main() {
  const r = await cgGet<any[]>('/futures/basis/history', { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 6 });
  const arr = (r as any).data as any[];
  console.log('=== full BTC basis rows (latest 6) ===');
  for (const row of arr) {
    console.log(JSON.stringify(row));
  }
  console.log('\nall keys:', JSON.stringify(Object.keys(arr[0])));

  // align with candle close at same ts to see if close_basis is in USD
  console.log('\n=== ts alignment vs candle close ===');
  for (const row of arr) {
    const ts = row.time;
    const c = await query<{ close: string }>(
      `SELECT close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' AND ts=$1`, [ts],
    );
    const px = c.rows[0] ? parseFloat(c.rows[0].close) : null;
    console.log(`ts=${new Date(ts).toISOString()} close_basis=${row.close_basis} close_change=${row.close_change} candleClose=${px} basis/px%=${px ? (row.close_basis / px * 100).toFixed(4) : 'NA'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

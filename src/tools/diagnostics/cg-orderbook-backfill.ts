// One-shot orderbook ask-bids-history backfill for our 14-pair universe.
// 4h interval, range=5 (±5% from market), 540 bars (~90 days).
import { cgGet } from '../../core/coinglass';
import { close as closePg, query } from '../../core/db';
import { log } from '../../core/logger';

const PAIRS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','LTCUSDT','ATOMUSDT','DOGEUSDT','TONUSDT','APTUSDT','ARBUSDT','INJUSDT','TAOUSDT','HYPEUSDT'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  for (const pair of PAIRS) {
    const r = await cgGet<any[]>('/futures/orderbook/ask-bids-history', {
      exchange: 'Binance', symbol: pair, interval: '4h', range: 5, limit: 4500,
    });
    const data = r.data ?? [];
    if (data.length === 0) { log.warn('orderbook backfill empty', { pair }); continue; }
    // Batch insert via VALUES + ON CONFLICT DO NOTHING
    const values: any[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const d of data) {
      placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      values.push('Binance', pair, d.time, d.bids_usd, d.asks_usd, d.bids_quantity, d.asks_quantity);
    }
    await query(
      `INSERT INTO cg_orderbook_pair (exchange,pair,ts,bids_usd,asks_usd,bids_qty,asks_qty)
       VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
      values
    );
    log.info('orderbook backfilled', { pair, n: data.length, first: new Date(data[0].time).toISOString().slice(0,10), last: new Date(data[data.length-1].time).toISOString().slice(0,10) });
    await sleep(220);
  }

  const r = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM cg_orderbook_pair`);
  log.info('cg_orderbook_pair total rows', { count: r.rows[0].c });
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

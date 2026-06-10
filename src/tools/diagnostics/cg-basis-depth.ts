/**
 * cg-basis-depth — for the confirmed /futures/basis/history (exchange=Binance,
 * symbol=<PAIR>, interval=4h): measure max history depth per book pair, and
 * cross-check which candle symbols + funding_oi history we have in the DB to
 * align the IS/OOS forward-return study.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const PAIRS = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT', 'ETHUSDT'];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ]);
}

async function main() {
  console.log('=== basis history depth per pair (interval=4h, limit=5000) ===\n');
  for (const pair of PAIRS) {
    try {
      const r = await withTimeout(
        cgGet<any[]>('/futures/basis/history', { exchange: 'Binance', symbol: pair, interval: '4h', limit: 4500 }),
        20_000, pair,
      );
      const arr = (r as any).data as any[];
      if (Array.isArray(arr) && arr.length) {
        const first = arr[0].time;
        const last = arr[arr.length - 1].time;
        const fStr = new Date(first).toISOString().slice(0, 10);
        const lStr = new Date(last).toISOString().slice(0, 10);
        // basis value distribution
        const vals = arr.map(x => x.close_basis).filter((v: any) => v != null && !Number.isNaN(v));
        const mn = Math.min(...vals), mx = Math.max(...vals);
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
        console.log(`${pair}: rows=${arr.length}  span=${fStr}..${lStr}  close_basis[min=${mn.toFixed(4)} mean=${mean.toFixed(4)} max=${mx.toFixed(4)}]`);
      } else {
        console.log(`${pair}: empty / non-array`);
      }
    } catch (e: any) {
      console.log(`${pair}: FAIL ${(e?.message ?? String(e)).slice(0, 160)}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n=== DB candle coverage (tf=240m) ===');
  for (const pair of PAIRS) {
    const r = await query<{ n: string; mn: string; mx: string }>(
      `SELECT count(*)::text n, min(ts)::text mn, max(ts)::text mx FROM candles WHERE symbol=$1 AND tf='240m'`,
      [pair],
    );
    const row = r.rows[0];
    const mn = row.mn ? new Date(parseInt(row.mn)).toISOString().slice(0, 10) : 'NA';
    const mx = row.mx ? new Date(parseInt(row.mx)).toISOString().slice(0, 10) : 'NA';
    console.log(`${pair}: ${row.n} 4H bars  ${mn}..${mx}`);
  }

  console.log('\n=== funding_oi_weighted DB coverage (for orthogonality) ===');
  for (const coin of ['BTC', 'SOL', 'ADA', 'LINK', 'ETH']) {
    const r = await query<{ n: string; mn: string; mx: string }>(
      `SELECT count(*)::text n, min(ts)::text mn, max(ts)::text mx FROM cg_funding_oi_weighted WHERE symbol=$1`,
      [coin],
    );
    const row = r.rows[0];
    const mn = row.mn ? new Date(parseInt(row.mn)).toISOString().slice(0, 10) : 'NA';
    const mx = row.mx ? new Date(parseInt(row.mx)).toISOString().slice(0, 10) : 'NA';
    console.log(`${coin}: ${row.n} rows  ${mn}..${mx}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

/**
 * eth-data-coverage — one-shot inventory of what data we actually have for ETH (and
 * controls BTC/SOL) before launching the deep ETH-strategy search. Prints, per symbol:
 *   - candle bar counts + date range for every timeframe present
 *   - CG signal coverage (row count + date range) for each cg_* table
 * Read-only. Run: npx tsx src/tools/diagnostics/eth-data-coverage.ts
 */
import { query, close as closePg } from '../../core/db';

const PAIRS = ['ETHUSDT', 'BTCUSDT', 'SOLUSDT'];

function fmt(ts: number | null): string {
  return ts == null ? '—' : new Date(Number(ts)).toISOString().slice(0, 10);
}

async function main() {
  console.log('══ CANDLE COVERAGE ══');
  for (const p of PAIRS) {
    const { rows } = await query<any>(
      `SELECT tf, count(*) n, min(ts) lo, max(ts) hi FROM candles WHERE symbol=$1 GROUP BY tf ORDER BY tf`,
      [p],
    );
    console.log(`\n${p}:`);
    for (const r of rows) {
      console.log(`  ${String(r.tf).padEnd(8)} n=${String(r.n).padStart(7)}  ${fmt(r.lo)} → ${fmt(r.hi)}`);
    }
  }

  console.log('\n\n══ COINGLASS COVERAGE (by table) ══');
  const cgTables: Array<{ t: string; key: 'symbol' | 'pair'; coin: boolean }> = [
    { t: 'cg_funding_oi_weighted', key: 'symbol', coin: true },
    { t: 'cg_funding_vol_weighted', key: 'symbol', coin: true },
    { t: 'cg_oi_aggregated', key: 'symbol', coin: true },
    { t: 'cg_ls_top_position', key: 'pair', coin: false },
    { t: 'cg_ls_top_account', key: 'pair', coin: false },
    { t: 'cg_ls_global_account', key: 'pair', coin: false },
    { t: 'cg_taker_pair', key: 'pair', coin: false },
    { t: 'cg_liq_pair', key: 'pair', coin: false },
  ];
  for (const p of PAIRS) {
    const coin = p.replace(/USDT$/, '');
    console.log(`\n${p} (coin ${coin}):`);
    for (const ct of cgTables) {
      const idVal = ct.coin ? coin : p;
      const exchFilter = ct.key === 'pair' ? ` AND exchange='Binance'` : '';
      try {
        const { rows } = await query<any>(
          `SELECT count(*) n, min(ts) lo, max(ts) hi FROM ${ct.t} WHERE ${ct.key}=$1${exchFilter}`,
          [idVal],
        );
        const r = rows[0];
        console.log(`  ${ct.t.padEnd(26)} n=${String(r.n).padStart(7)}  ${fmt(r.lo)} → ${fmt(r.hi)}`);
      } catch (e: any) {
        console.log(`  ${ct.t.padEnd(26)} ERROR ${e.message?.slice(0, 60)}`);
      }
    }
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * lever-screen-coverage — data-coverage inventory for the BROADER pair-screen lever.
 * For a broad liquid Bybit-perp candidate set NOT in the live book, prints per pair:
 *   - 4H candle count + date range
 *   - CG coverage for the 3 fade signals we actually screen on:
 *       funding_oi_weighted (symbol/coin), ls_top_position (pair, Binance), ls_top_account (pair, Binance)
 *   - VERDICT: enough data to screen now (≥300 4H bars AND ≥250d of all 3 CG signals)
 *             vs NEEDS BACKFILL (CG missing/thin).
 * Read-only. Compact final block. Run: npx tsx src/backtest/cli/lever-screen-coverage.ts
 */
import { query, close as closePg } from '../../core/db';

const CANDS = [
  'AVAXUSDT', 'DOTUSDT', 'POLUSDT', 'NEARUSDT', 'SUIUSDT', 'OPUSDT', 'ARBUSDT', 'ATOMUSDT',
  'INJUSDT', 'LTCUSDT', 'TAOUSDT', 'RENDERUSDT', 'WLDUSDT', 'SEIUSDT', 'TIAUSDT', 'AAVEUSDT',
  'UNIUSDT', 'FILUSDT', 'TRXUSDT', 'BNBUSDT', 'APTUSDT', 'DOGEUSDT', 'XRPUSDT', 'HYPEUSDT',
  'PEPEUSDT', 'TRUMPUSDT', 'ETHUSDT',
];

const DAY = 86_400_000;
function fmt(ts: number | null): string { return ts == null ? '—' : new Date(Number(ts)).toISOString().slice(0, 10); }
function span(lo: number | null, hi: number | null): number { return lo == null || hi == null ? 0 : Math.round((Number(hi) - Number(lo)) / DAY); }

async function cov(table: string, key: string, idVal: string, exch: boolean): Promise<{ n: number; lo: number | null; hi: number | null }> {
  const ef = exch ? ` AND exchange='Binance'` : '';
  try {
    const { rows } = await query<any>(`SELECT count(*) n, min(ts) lo, max(ts) hi FROM ${table} WHERE ${key}=$1${ef}`, [idVal]);
    return { n: Number(rows[0].n), lo: rows[0].lo == null ? null : Number(rows[0].lo), hi: rows[0].hi == null ? null : Number(rows[0].hi) };
  } catch { return { n: 0, lo: null, hi: null }; }
}

async function main() {
  const ready: string[] = [], thin: string[] = [], missing: string[] = [];
  console.log('pair       | 4Hbars  candleRange            | fundOi(d) lsPos(d) lsAcc(d) | verdict');
  console.log('─'.repeat(100));
  for (const p of CANDS) {
    const coin = p.replace(/USDT$/, '');
    const c = await query<any>(`SELECT count(*) n, min(ts) lo, max(ts) hi FROM candles WHERE symbol=$1 AND tf='240m'`, [p]);
    const cn = Number(c.rows[0].n), clo = c.rows[0].lo == null ? null : Number(c.rows[0].lo), chi = c.rows[0].hi == null ? null : Number(c.rows[0].hi);
    const fo = await cov('cg_funding_oi_weighted', 'symbol', coin, false);
    const lp = await cov('cg_ls_top_position', 'pair', p, true);
    const la = await cov('cg_ls_top_account', 'pair', p, true);
    const foD = span(fo.lo, fo.hi), lpD = span(lp.lo, lp.hi), laD = span(la.lo, la.hi);
    const cgMinD = Math.min(foD, lpD, laD);
    const cgMinN = Math.min(fo.n, lp.n, la.n);

    let verdict: string;
    if (cn >= 300 && cgMinD >= 250 && cgMinN >= 800) { verdict = 'READY ✅'; ready.push(p); }
    else if (cgMinN > 0 && cgMinD >= 120) { verdict = `THIN ⚠ (cgMin ${cgMinD}d/${cgMinN}rows)`; thin.push(p); }
    else { verdict = 'NEEDS BACKFILL ❌ (CG missing)'; missing.push(p); }

    console.log(
      p.padEnd(10) + ' | ' + String(cn).padStart(6) + '  ' + (fmt(clo) + '→' + fmt(chi)).padEnd(22) + ' | ' +
      String(foD).padStart(7) + ' ' + String(lpD).padStart(7) + ' ' + String(laD).padStart(7) + ' | ' + verdict,
    );
  }
  console.log('\n══ SUMMARY ══');
  console.log(`READY (screen now, n=${ready.length}): ${ready.join(' ')}`);
  console.log(`THIN  (partial CG, n=${thin.length}): ${thin.join(' ')}`);
  console.log(`MISSING/NEEDS-BACKFILL (n=${missing.length}): ${missing.join(' ')}`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

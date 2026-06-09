/**
 * lever-screen-coverage — data-coverage inventory for the LEVER-3 broad pair screen.
 * For each candidate pair NOT in the live book, reports whether it has:
 *   - 4H candles (count + range) — needed for backtest
 *   - the 3 CG signals the live strategies fade: cg_funding_oi_weighted (S3/S4),
 *     cg_ls_top_position (S1), cg_ls_top_account (S4 confluence)
 * Prints a compact READY / PARTIAL / MISSING verdict per pair so we know which pairs
 * can be screened now vs which would need coinglass-backfill.
 * Read-only. Run: npx tsx src/tools/diagnostics/lever-screen-coverage.ts
 */
import { query, close as closePg } from '../../core/db';

const CANDIDATES = [
  'AVAXUSDT', 'DOTUSDT', 'POLUSDT', 'NEARUSDT', 'SUIUSDT', 'OPUSDT', 'ARBUSDT', 'ATOMUSDT',
  'INJUSDT', 'LTCUSDT', 'TAOUSDT', 'RENDERUSDT', 'WLDUSDT', 'SEIUSDT', 'TIAUSDT', 'AAVEUSDT',
  'UNIUSDT', 'FILUSDT', 'TRXUSDT', 'BNBUSDT', 'APTUSDT', 'DOGEUSDT', 'XRPUSDT', 'HYPEUSDT',
  'PEPEUSDT', 'TRUMPUSDT', 'ETHUSDT',
];

const DAY = 24 * 3600_000;

async function cgCount(table: string, key: 'symbol' | 'pair', id: string): Promise<{ n: number; lo: number | null; hi: number | null }> {
  const exch = key === 'pair' ? ` AND exchange='Binance'` : '';
  try {
    const { rows } = await query<any>(`SELECT count(*) n, min(ts) lo, max(ts) hi FROM ${table} WHERE ${key}=$1${exch}`, [id]);
    return { n: Number(rows[0].n), lo: rows[0].lo ? Number(rows[0].lo) : null, hi: rows[0].hi ? Number(rows[0].hi) : null };
  } catch {
    return { n: 0, lo: null, hi: null };
  }
}

function days(lo: number | null, hi: number | null): number {
  return lo && hi ? Math.round((hi - lo) / DAY) : 0;
}

async function main() {
  console.log('══ LEVER-3 DATA COVERAGE (candidates NOT in live book) ══');
  console.log('pair'.padEnd(11) + '4Hcandles'.padEnd(20) + 'funding_oi'.padEnd(12) + 'ls_top_pos'.padEnd(12) + 'ls_top_acc'.padEnd(12) + 'verdict');
  console.log('─'.repeat(95));

  const ready: string[] = [], partial: string[] = [], missing: string[] = [];
  const now = Date.now();

  for (const p of CANDIDATES) {
    const coin = p.replace(/USDT$/, '');
    const { rows: c } = await query<any>(`SELECT count(*) n, min(ts) lo, max(ts) hi FROM candles WHERE symbol=$1 AND tf='240m'`, [p]);
    const cN = Number(c[0].n), cHi = c[0].hi ? Number(c[0].hi) : null, cLo = c[0].lo ? Number(c[0].lo) : null;
    const cFresh = cHi ? Math.round((now - cHi) / DAY) : 9999;

    const fo = await cgCount('cg_funding_oi_weighted', 'symbol', coin);
    const lp = await cgCount('cg_ls_top_position', 'pair', p);
    const la = await cgCount('cg_ls_top_account', 'pair', p);

    // "usable" = candles present + enough CG for a 180-bar window + at least ~180d span
    const cgDays = Math.max(days(fo.lo, fo.hi), days(lp.lo, lp.hi));
    const hasFund = fo.n > 1000 && days(fo.lo, fo.hi) >= 180;
    const hasLsPos = lp.n > 1000 && days(lp.lo, lp.hi) >= 180;
    const hasLsAcc = la.n > 1000 && days(la.lo, la.hi) >= 180;
    const candlesOk = cN > 1000 && cFresh < 10;

    let verdict: string;
    if (candlesOk && hasFund && hasLsPos && hasLsAcc) { verdict = 'READY (all signals)'; ready.push(p); }
    else if (candlesOk && (hasFund || hasLsPos)) { verdict = 'PARTIAL'; partial.push(p); }
    else { verdict = 'MISSING (backfill)'; missing.push(p); }

    const cInfo = cN > 0 ? `n=${cN} ${cFresh < 10 ? 'fresh' : `stale${cFresh}d`}` : 'none';
    console.log(
      p.padEnd(11) +
      cInfo.padEnd(20) +
      `${fo.n}/${days(fo.lo, fo.hi)}d`.padEnd(12) +
      `${lp.n}/${days(lp.lo, lp.hi)}d`.padEnd(12) +
      `${la.n}/${days(la.lo, la.hi)}d`.padEnd(12) +
      verdict,
    );
  }

  console.log('\n── SUMMARY ──');
  console.log(`READY  (${ready.length}): ${ready.join(' ')}`);
  console.log(`PARTIAL(${partial.length}): ${partial.join(' ')}`);
  console.log(`MISSING(${missing.length}): ${missing.join(' ')}`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

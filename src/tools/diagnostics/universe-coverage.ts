/**
 * universe-coverage — dump data coverage across the WHOLE stored universe so we can
 * see which pairs are screenable as new portfolio candidates. A pair is screenable if
 * it has (a) 240m + 1m candles and (b) the CG signal tables the 4 archetypes need:
 *   - cg_ls_top_position (pair)        — S1/S2
 *   - cg_funding_oi_weighted (coin)    — S3 + S4 leg
 *   - cg_ls_top_account (pair)         — S4 leg
 * Reports row counts + date ranges so we know how many days of history each has.
 *
 * Run: npx tsx src/tools/diagnostics/universe-coverage.ts
 */
import { query, close as closePg } from '../../core/db';

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (firstMs: number) => Math.round((now - firstMs) / DAY);
const span = (firstMs: number, lastMs: number) => Math.round((lastMs - firstMs) / DAY);

async function main() {
  // 240m candle coverage by symbol
  const c240 = await query<any>(
    `SELECT symbol, COUNT(*)::int AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
       FROM candles WHERE tf = '240m' GROUP BY symbol ORDER BY symbol`,
  );
  const c1m = await query<any>(
    `SELECT symbol, COUNT(*)::int AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
       FROM candles WHERE tf = '1m' GROUP BY symbol`,
  );
  const c1mBy = new Map<string, any>(c1m.rows.map((r: any) => [r.symbol, r]));

  // CG coverage
  const lsPos = await query<any>(
    `SELECT pair, COUNT(*)::int AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
       FROM cg_ls_top_position WHERE exchange = 'Binance' GROUP BY pair`,
  );
  const lsAcc = await query<any>(
    `SELECT pair, COUNT(*)::int AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
       FROM cg_ls_top_account WHERE exchange = 'Binance' GROUP BY pair`,
  );
  const fund = await query<any>(
    `SELECT symbol, COUNT(*)::int AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
       FROM cg_funding_oi_weighted GROUP BY symbol`,
  );
  const lsPosBy = new Map<string, any>(lsPos.rows.map((r: any) => [r.pair, r]));
  const lsAccBy = new Map<string, any>(lsAcc.rows.map((r: any) => [r.pair, r]));
  const fundBy = new Map<string, any>(fund.rows.map((r: any) => [r.symbol, r]));

  const coinOf = (pair: string) => pair.replace(/USDT$/, '').replace(/USD$/, '');

  console.log('\n=== UNIVERSE COVERAGE (candles 240m, with CG signal tables) ===');
  console.log('pair        240m(rows/days back→span)   1m?   lsPos(d)  lsAcc(d)  funding(d)  SCREENABLE');
  for (const row of c240.rows) {
    const pair = row.symbol as string;
    const coin = coinOf(pair);
    const back240 = daysAgo(Number(row.first_ts));
    const span240 = span(Number(row.first_ts), Number(row.last_ts));
    const has1m = c1mBy.has(pair);
    const lp = lsPosBy.get(pair);
    const la = lsAccBy.get(pair);
    const fu = fundBy.get(coin);
    const lpDays = lp ? span(Number(lp.first_ts), Number(lp.last_ts)) : 0;
    const laDays = la ? span(Number(la.first_ts), Number(la.last_ts)) : 0;
    const fuDays = fu ? span(Number(fu.first_ts), Number(fu.last_ts)) : 0;
    // Screenable if all three CG tables have >=300d AND 1m candles exist.
    const screenable = has1m && lpDays >= 300 && laDays >= 300 && fuDays >= 300;
    console.log(
      `  ${pair.padEnd(10)} ${String(row.rows).padStart(5)}/${String(back240).padStart(4)}→${String(span240).padStart(4)}d   ` +
      `${has1m ? 'y' : '·'}    ${String(lpDays).padStart(5)}    ${String(laDays).padStart(5)}     ${String(fuDays).padStart(5)}      ${screenable ? 'YES' : '—'}`,
    );
  }
  console.log('\n(days back = age of oldest 240m bar; span = first→last coverage in days)');
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

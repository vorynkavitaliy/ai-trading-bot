/**
 * cg-altseason-cadence — inspect the cadence (spacing) of the 3 accessible
 * endpoints + check what BTC daily candle history we have in the candles table
 * (the price source for forward returns).
 *
 * Run: npx tsx src/tools/diagnostics/cg-altseason-cadence.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

function spacingStats(times: number[]): string {
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) diffs.push(times[i] - times[i - 1]);
  diffs.sort((a, b) => a - b);
  const day = 86400000;
  const med = diffs[Math.floor(diffs.length / 2)];
  const min = diffs[0];
  const max = diffs[diffs.length - 1];
  // histogram of day-counts
  const counts: Record<number, number> = {};
  for (const d of diffs) {
    const days = Math.round(d / day);
    counts[days] = (counts[days] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([d, c]) => `${d}d×${c}`).join(' ');
  return `n=${times.length} medGap=${(med / day).toFixed(2)}d min=${(min / day).toFixed(2)}d max=${(max / day).toFixed(2)}d  topGaps: ${top}`;
}

async function cadence(label: string, path: string, tKey: string) {
  const r = await cgGet<any[]>(path, {});
  const data = r.data as any[];
  const times = data.map(d => Number(d[tKey])).filter(t => !isNaN(t)).sort((a, b) => a - b);
  console.log(`\n${label}  (${path})`);
  console.log(`  ${spacingStats(times)}`);
  console.log(`  first=${new Date(times[0]).toISOString()}  last=${new Date(times[times.length - 1]).toISOString()}`);
  // recent 8 rows to see current cadence
  console.log(`  last 6 rows:`);
  for (const row of data.slice(-6)) {
    console.log(`    ${new Date(Number(row[tKey])).toISOString().slice(0, 10)}  ${JSON.stringify(row)}`);
  }
}

async function main() {
  await cadence('Altcoin Season', '/index/altcoin-season', 'timestamp');
  await cadence('BTC-vs-M2',       '/index/bitcoin-vs-global-m2-growth', 'timestamp');
  await cadence('BTC Macro Osc',   '/index/bitcoin-macro-oscillator', 'timestamp');

  console.log('\n=== candles table (price source) ===');
  const tfs = await query<any>(
    `SELECT symbol, tf, count(*) n, min(ts) a, max(ts) b
     FROM candles WHERE symbol IN ('BTCUSDT','ETHUSDT') GROUP BY symbol, tf ORDER BY symbol, tf`,
    [],
  );
  for (const row of tfs.rows) {
    console.log(`  ${row.symbol} ${row.tf}: n=${row.n}  ${new Date(Number(row.a)).toISOString().slice(0,10)} .. ${new Date(Number(row.b)).toISOString().slice(0,10)}`);
  }
  process.exit(0);
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

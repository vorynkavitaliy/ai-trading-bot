/**
 * entry-timing-audit — measures REAL live entry timing vs the 4H decision boundary.
 *
 * cg-fade decides on a closed 4H bar (boundaries 00/04/08/12/16/20 UTC). The backtest
 * cronRealistic model enters at the NEXT HH:00 after the boundary (+1h), skipping funding
 * windows. This checks what live ACTUALLY does: offset of opened_at from its 4H boundary,
 * and which boundary hours produce trades (funding hours 00/08/16 should be MISSED live).
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/entry-timing-audit.ts [days=180]
 */
import { query, close as closePg } from '../../core/db';

const FOURH = 4 * 3600_000;
const FUNDING_HOURS = new Set([0, 8, 16]);

async function main() {
  const days = parseFloat(process.argv[2] ?? '180');
  const since = Date.now() - days * 86_400_000;
  const onlyAuto = !process.argv.includes('--all');
  const { rows } = await query<any>(
    `SELECT DISTINCT ON (symbol, date_trunc('second', opened_at))
            symbol, (EXTRACT(EPOCH FROM opened_at)*1000)::float8 opened
     FROM trades
     WHERE opened_at IS NOT NULL AND opened_at >= to_timestamp($1/1000.0)
       ${onlyAuto ? "AND rationale LIKE '[auto]%'" : ''}
     ORDER BY symbol, date_trunc('second', opened_at), id`, [since]);
  console.log(onlyAuto ? '(clean cron-direct algo entries only; pass --all to include manual/watcher/reconcile)' : '(ALL entries incl manual)');

  const offsets: number[] = [];
  const byBoundaryHour: Record<number, number> = {};
  let fundingHourEntries = 0;
  for (const t of rows) {
    const boundary = Math.floor(t.opened / FOURH) * FOURH;
    const offMin = (t.opened - boundary) / 60_000;
    const bHour = new Date(boundary).getUTCHours();
    offsets.push(offMin);
    byBoundaryHour[bHour] = (byBoundaryHour[bHour] ?? 0) + 1;
    if (FUNDING_HOURS.has(bHour)) fundingHourEntries++;
  }

  offsets.sort((a, b) => a - b);
  const pct = (p: number) => offsets.length ? offsets[Math.min(offsets.length - 1, Math.floor(p * offsets.length))] : 0;
  console.log(`\n=== entry-timing audit · ${days}d · ${rows.length} signals (deduped) ===`);
  console.log(`offset opened_at − 4H boundary (minutes):`);
  console.log(`  min ${pct(0).toFixed(1)}  median ${pct(0.5).toFixed(1)}  p90 ${pct(0.9).toFixed(1)}  p99 ${pct(0.99).toFixed(1)}  max ${pct(1).toFixed(1)}`);
  const within5 = offsets.filter(o => o <= 5).length;
  const within15 = offsets.filter(o => o <= 15).length;
  const over55 = offsets.filter(o => o >= 55).length;
  console.log(`  ≤5min: ${within5} (${(within5/offsets.length*100).toFixed(0)}%)   ≤15min: ${within15} (${(within15/offsets.length*100).toFixed(0)}%)   ≥55min(≈+1h): ${over55} (${(over55/offsets.length*100).toFixed(0)}%)`);
  console.log(`\nentries by 4H-boundary hour (UTC):`);
  for (const h of [0, 4, 8, 12, 16, 20]) {
    const n = byBoundaryHour[h] ?? 0;
    console.log(`  ${String(h).padStart(2,'0')}:00 ${FUNDING_HOURS.has(h) ? '(funding)' : '         '}  ${n}`);
  }
  // any other hours (unexpected)
  const other = Object.keys(byBoundaryHour).map(Number).filter(h => ![0,4,8,12,16,20].includes(h));
  if (other.length) console.log(`  other hours: ${other.map(h => `${h}:00=${byBoundaryHour[h]}`).join(' ')}`);
  console.log(`\nfunding-hour (00/08/16) entries: ${fundingHourEntries}/${rows.length} (${(fundingHourEntries/rows.length*100).toFixed(0)}%)  ← live should MISS these if blocked + no re-fire`);
  await closePg();
}
main().catch(e => { console.error(e); process.exit(1); });

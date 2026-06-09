/**
 * cg-anchor-probe — does live read a DIFFERENT Coinglass value than the 4H backtest?
 *
 * Live (scan-decide) loads CG at the last-closed-1H bar ts. The honest backtest loads
 * CG at the 4H decision-bar ts. CG rows are 4H-bucketed (ts = bucket OPEN). This probe
 * loads CG at several candidate timestamps and prints ls_top_position / funding so we
 * can see whether the 1H-anchor vs 4H-anchor pick different (possibly forming-bucket)
 * CG buckets → which would diverge the SIDE signal, not just price.
 *
 * Run: npx tsx src/tools/diagnostics/cg-anchor-probe.ts SOLUSDT
 */
import { loadBars } from '../../data/candles';
import { loadCoinglassAt } from '../../data/coinglass-features';
import { close as closePg } from '../../core/db';

const FOUR_H = 4 * 3_600_000;
const HOUR = 3_600_000;

async function main() {
  const pair = (process.argv[2] ?? 'SOLUSDT').toUpperCase();
  const coin = pair.replace(/USDT$/, '');
  const now = Date.now();

  const bars1h = await loadBars(pair, '60m', { limit: 10 });
  const bars4h = await loadBars(pair, '240m', { limit: 10 });
  const lastClosed1h = [...bars1h].filter(b => b.ts + HOUR <= now).pop();
  const newest1h = bars1h[bars1h.length - 1];
  const lastClosed4h = [...bars4h].filter(b => b.ts + FOUR_H <= now).pop();
  const newest4h = bars4h[bars4h.length - 1];

  const iso = (t?: number) => t == null ? 'n/a' : new Date(t).toISOString();
  console.log(`\n${pair} @ now=${iso(now)}`);
  console.log(`  newest 1H bar ts=${iso(newest1h?.ts)} (open)  | last CLOSED 1H ts=${iso(lastClosed1h?.ts)}`);
  console.log(`  newest 4H bar ts=${iso(newest4h?.ts)} (open)  | last CLOSED 4H ts=${iso(lastClosed4h?.ts)}`);

  const probes: Array<{ label: string; ts: number }> = [];
  if (newest1h) probes.push({ label: 'CG @ newest-1H ts (live decisionBar?)', ts: newest1h.ts });
  if (lastClosed1h) probes.push({ label: 'CG @ last-closed-1H ts', ts: lastClosed1h.ts });
  if (newest4h) probes.push({ label: 'CG @ newest-4H ts (forming bucket)', ts: newest4h.ts });
  if (lastClosed4h) probes.push({ label: 'CG @ last-closed-4H ts (backtest anchor)', ts: lastClosed4h.ts });
  probes.push({ label: 'CG @ now', ts: now });

  console.log('');
  for (const p of probes) {
    const cg = await loadCoinglassAt(coin, pair, p.ts);
    console.log(`  ${p.label.padEnd(42)} → ls_top_position=${cg.ls_top_position ?? 'null'}  funding_oi=${cg.funding_oi_weighted ?? 'null'}  histLen=${cg.ls_top_position_history?.length ?? 0}`);
  }
  console.log('\n(If "newest-1H ts" and "last-closed-4H ts" give DIFFERENT ls_top_position,');
  console.log(' live and the 4H backtest read different CG buckets → SIDE signal diverges.)');
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

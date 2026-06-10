/**
 * oi-divergence-probe — read-only: how deep is the per-exchange OI history-chart
 * endpoint at different `range` values? Cross-exchange OI divergence needs a long
 * aligned per-venue series; if the deepest range only returns a few dozen bars we
 * cannot do IS/OOS on divergence. Pure HTTP, no DB writes.
 *
 * Run: npx tsx src/tools/diagnostics/oi-divergence-probe.ts
 */
import { cgGet } from '../../core/coinglass';

async function probeRange(symbol: string, range: string) {
  try {
    const r = await cgGet<any>('/futures/open-interest/exchange-history-chart', { symbol, range });
    const d = r.data;
    const tl: any[] = d.time_list ?? [];
    const n = tl.length;
    const first = n ? new Date(Number(tl[0])).toISOString() : 'n/a';
    const last = n ? new Date(Number(tl[n - 1])).toISOString() : 'n/a';
    const spanD = n > 1 ? (Number(tl[n - 1]) - Number(tl[0])) / 86400000 : 0;
    const spacingH = n > 1 ? (Number(tl[1]) - Number(tl[0])) / 3600000 : 0;
    const exchanges = d.data_map ? Object.keys(d.data_map) : [];
    // how many exchanges have a non-trivial (mostly non-null) series?
    let active = 0;
    if (d.data_map) {
      for (const ex of exchanges) {
        const arr: any[] = d.data_map[ex] ?? [];
        const nonNull = arr.filter(v => v != null && Number(v) > 0).length;
        if (nonNull > n * 0.5) active++;
      }
    }
    console.log(`  ${symbol} range=${range.padEnd(4)} n=${String(n).padStart(4)} span=${spanD.toFixed(1).padStart(7)}d spacing=${spacingH.toFixed(2)}h exch=${exchanges.length} active(>50% filled)=${active}  [${first.slice(0,10)} -> ${last.slice(0,10)}]`);
  } catch (e: any) {
    console.log(`  ${symbol} range=${range.padEnd(4)} ERR ${(e?.message ?? String(e)).slice(0, 120)}`);
  }
}

async function main() {
  console.log('=== per-exchange OI history-chart depth probe ===');
  for (const range of ['all', '1y', '6m', '3m', '1m', '7d', '12h', '4h', '1h']) {
    await probeRange('BTC', range);
    await new Promise(r => setTimeout(r, 350));
  }
  console.log('\n=== same for SOL/ADA/LINK at best range ===');
  for (const sym of ['SOL', 'ADA', 'LINK']) {
    await probeRange(sym, 'all');
    await new Promise(r => setTimeout(r, 350));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

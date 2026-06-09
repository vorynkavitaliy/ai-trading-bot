/**
 * cg-depth-probe — how many days of 4h Coinglass history can we actually pull for a
 * coin/pair (before committing to a backfill)? Requests a large limit and reports the
 * bar count + earliest date returned. Run: npx tsx src/tools/diagnostics/cg-depth-probe.ts
 */
import { cgGet } from '../../core/coinglass';
import { close as closePg } from '../../core/db';

const TF = '4h';
const LIMIT = 2400; // ~400d if available

async function probe(label: string, endpoint: string, params: Record<string, any>) {
  try {
    const r = await cgGet<any[]>(endpoint, { ...params, interval: TF, limit: LIMIT });
    const data = (r as any).data ?? [];
    const times = data.map((d: any) => Number(d.time)).filter((t: number) => Number.isFinite(t));
    if (!times.length) { console.log(`  ${label.padEnd(22)} → 0 bars (no data)`); return; }
    const min = Math.min(...times), max = Math.max(...times);
    console.log(`  ${label.padEnd(22)} → ${String(data.length).padStart(5)} bars  ${new Date(min).toISOString().slice(0, 10)} → ${new Date(max).toISOString().slice(0, 10)}  (${Math.round((max - min) / 86_400_000)}d)`);
  } catch (e: any) {
    console.log(`  ${label.padEnd(22)} → ERROR ${e?.message ?? e}`);
  }
}

async function main() {
  console.log(`\nCoinglass depth probe (interval ${TF}, requested limit ${LIMIT}):\n`);
  for (const [coin, pair] of [['LINK', 'LINKUSDT'], ['ADA', 'ADAUSDT'], ['SOL', 'SOLUSDT']]) {
    console.log(`${coin}:`);
    await probe('funding-oi-weight', '/futures/funding-rate/oi-weight-history', { symbol: coin });
    await probe('top-position-ratio', '/futures/top-long-short-position-ratio/history', { exchange: 'Binance', symbol: pair });
    await probe('top-account-ratio', '/futures/top-long-short-account-ratio/history', { exchange: 'Binance', symbol: pair });
    await probe('oi-aggregated', '/futures/open-interest/aggregated-history', { symbol: coin });
  }
  console.log(`\n(SOL is the control — it has 376d already, so its depth = the plan's max.)`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

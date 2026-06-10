/**
 * cg-vesting-inspect — deep look at /coin/vesting chart shape for active-vesting alts.
 * Print full chart point dates + total unlocked_token_amount + sum-of-allocation unlocked,
 * to decide whether per-allocation diffs yield a dense, accurate unlock-event series.
 */
import { cgGet } from '../../core/coinglass';

const T = 20_000;
function withTimeout<T2>(p: Promise<T2>, ms: number, label: string): Promise<T2> {
  return Promise.race([p, new Promise<T2>((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${label})`)), ms))]);
}

async function main() {
  const coins = ['INJ', 'OP', 'SUI', 'APT', 'ARB', 'TAO', 'ATOM', 'DOT', 'WLD', 'TON'];
  for (const coin of coins) {
    try {
      const r = await withTimeout(cgGet<any>('/coin/vesting', { symbol: coin }), T, coin);
      const d = (r as any).data;
      const chart: any[] = Array.isArray(d?.chart) ? d.chart : [];
      const sorted = [...chart].sort((a, b) => a.date - b.date);
      console.log(`\n=== ${coin} === total_supply=${d?.total_supply} circ=${d?.circulating_supply} chartPts=${sorted.length} allocations=${(d?.allocations||[]).length}`);
      // print every chart point: date, top-level unlocked, sum of allocation unlocked
      let prevTop = 0, prevSum = 0;
      let printed = 0;
      for (const pt of sorted) {
        const top = pt.unlocked_token_amount ?? 0;
        const sum = Array.isArray(pt.allocations)
          ? pt.allocations.reduce((s: number, a: any) => s + (a.unlocked_token_amount ?? 0), 0)
          : 0;
        const dTop = top - prevTop;
        const dSum = sum - prevSum;
        prevTop = top; prevSum = sum;
        const ds = new Date(pt.date).toISOString().slice(0, 10);
        // only print points in/after 2024 (our price window) plus a couple before, to keep output sane
        if (pt.date >= Date.parse('2024-01-01') && printed < 40) {
          const pctSupplyTop = d?.total_supply > 0 ? (dTop / d.total_supply * 100).toFixed(3) : '-';
          const pctSupplySum = d?.total_supply > 0 ? (dSum / d.total_supply * 100).toFixed(3) : '-';
          console.log(`  ${ds}  dTop=${dTop.toExponential(2)} (${pctSupplyTop}% sup)  dAllocSum=${dSum.toExponential(2)} (${pctSupplySum}% sup)  tge=${!!pt.is_tge}`);
          printed++;
        }
      }
    } catch (e: any) {
      console.log(`\n=== ${coin} === FAIL ${(e?.message ?? String(e)).slice(0, 140)}`);
    }
    await new Promise(r => setTimeout(r, 350));
  }
}
main().catch(e => { console.error(e); process.exit(1); });

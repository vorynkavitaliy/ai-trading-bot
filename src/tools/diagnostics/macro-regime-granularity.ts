/**
 * macro-regime-granularity — read-only: determine the time-step distribution of
 * the dominance + fear-greed series, and how many points fall inside our candle
 * window (BTC 1D from 2024-05-25). Tells us if an IS/OOS daily split is feasible.
 */
import { cgGet } from '../../core/coinglass';

function stepStats(tsMs: number[]): { medianDays: number; modeDays: number; n: number } {
  const sorted = [...tsMs].sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) diffs.push((sorted[i] - sorted[i - 1]) / 86400000);
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  // mode (rounded to 0.25 day)
  const counts = new Map<number, number>();
  for (const d of diffs) {
    const r = Math.round(d * 4) / 4;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let mode = 0, best = -1;
  for (const [k, v] of counts) if (v > best) { best = v; mode = k; }
  return { medianDays: median, modeDays: mode, n: sorted.length };
}

async function main() {
  const winStart = Date.parse('2024-05-25T00:00:00Z');

  const dom = await cgGet<any>('/index/bitcoin-dominance', {});
  const domTs: number[] = (dom.data as any[]).map((r) => Number(r.timestamp));
  const ds = stepStats(domTs);
  const domInWin = domTs.filter((t) => t >= winStart).length;
  console.log('=== bitcoin-dominance ===');
  console.log(`total ${ds.n}, median step ${ds.medianDays.toFixed(2)}d, mode step ${ds.modeDays}d`);
  console.log(`points >= 2024-05-25: ${domInWin}`);
  console.log(`first ${new Date(Math.min(...domTs)).toISOString()}  last ${new Date(Math.max(...domTs)).toISOString()}`);
  // recent 10 steps
  const recent = [...domTs].sort((a, b) => a - b).slice(-11);
  console.log('last 10 steps (days):', recent.slice(1).map((t, i) => ((t - recent[i]) / 86400000).toFixed(2)).join(' '));

  const fng = await cgGet<any>('/index/fear-greed-history', {});
  const fts: number[] = (fng.data as any).time_list.map((t: any) => Number(t));
  const fs = stepStats(fts);
  const fInWin = fts.filter((t) => t >= winStart).length;
  console.log('\n=== fear-greed-history ===');
  console.log(`total ${fs.n}, median step ${fs.medianDays.toFixed(2)}d, mode step ${fs.modeDays}d`);
  console.log(`points >= 2024-05-25: ${fInWin}`);
  console.log(`first ${new Date(Math.min(...fts)).toISOString()}  last ${new Date(Math.max(...fts)).toISOString()}`);
  const fr = [...fts].sort((a, b) => a - b).slice(-11);
  console.log('last 10 steps (days):', fr.slice(1).map((t, i) => ((t - fr[i]) / 86400000).toFixed(2)).join(' '));
  // fng value distribution
  const vals: number[] = (fng.data as any).data_list.map((v: any) => Number(v));
  const v2 = [...vals].sort((a, b) => a - b);
  console.log(`fng range ${v2[0]}..${v2[v2.length - 1]}, p10=${v2[Math.floor(v2.length*0.1)]} p50=${v2[Math.floor(v2.length*0.5)]} p90=${v2[Math.floor(v2.length*0.9)]}`);
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });

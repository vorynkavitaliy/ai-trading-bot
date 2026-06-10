/**
 * macro-dom-orthogonality — is the dominance-level relative signal correlated
 * with the funding / ls_top_position percentile fade the book already trades?
 * Pull CG funding + ls_top_position history for BTC, percentile-rank as the live
 * strategy does, and correlate against the daily dominance level on matched days.
 */
import { query } from '../../core/db';
import { cgGet } from '../../core/coinglass';

const DAY = 86400000;
function dayKey(t: number): number { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

function spearman(x: number[], y: number[]): number {
  const n = x.length; if (n < 8) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n).fill(0); let i = 0;
    while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

// try a couple known CG history endpoints used by the live cg-fade strategy
async function tryFundingDaily(): Promise<Map<number, number> | null> {
  const paths = [
    { p: '/futures/funding-rate/oi-weight-history', params: { symbol: 'BTC', interval: '1d', limit: 1000 } },
    { p: '/futures/funding-rate/history', params: { symbol: 'BTCUSDT', interval: '1d', limit: 1000 } },
  ];
  for (const c of paths) {
    try {
      const r = await cgGet<any>(c.p, c.params);
      const d = r.data;
      const m = new Map<number, number>();
      if (Array.isArray(d)) {
        for (const row of d) {
          const t = Number(row.time ?? row.timestamp ?? row.t);
          const v = Number(row.close ?? row.funding_rate ?? row.value ?? row.fundingRate);
          if (Number.isFinite(t) && Number.isFinite(v)) m.set(dayKey(t), v);
        }
      } else if (d && d.time_list) {
        const tl = d.time_list, vl = d.close_list ?? d.data_list ?? d.value_list;
        for (let i = 0; i < tl.length; i++) m.set(dayKey(Number(tl[i])), Number(vl[i]));
      }
      if (m.size > 50) { console.log(`funding via ${c.p} (${m.size} days)`); return m; }
    } catch (e: any) { /* try next */ }
  }
  return null;
}

async function main() {
  const winStart = Date.parse('2024-05-25T00:00:00Z');
  const dom = await cgGet<any>('/index/bitcoin-dominance', {});
  const domMap = new Map<number, number>();
  for (const r of (dom.data as any[])) { const t = Number(r.timestamp); if (t >= winStart) domMap.set(dayKey(t), Number(r.bitcoin_dominance)); }

  const funding = await tryFundingDaily();
  if (!funding) { console.log('could not load a funding daily series — orthogonality vs funding skipped'); }
  else {
    // percentile-rank funding over trailing 30d window, like the live fade does, then
    // correlate the percentile (the actual signal driver) with the dominance level.
    const days = [...funding.keys()].filter((k) => k >= winStart).sort((a, b) => a - b);
    const fp: number[] = [], dl: number[] = [];
    for (let i = 30; i < days.length; i++) {
      const k = days[i];
      if (!domMap.has(k)) continue;
      const wnd = days.slice(i - 30, i).map((d) => funding.get(d)!).filter(Number.isFinite);
      const cur = funding.get(k)!;
      const pct = wnd.filter((v) => v <= cur).length / wnd.length;
      fp.push(pct); dl.push(domMap.get(k)!);
    }
    console.log(`\n=== orthogonality: dominance LEVEL vs funding-percentile (the live fade driver) ===`);
    console.log(`matched days=${fp.length}  Spearman corr = ${spearman(dl, fp).toFixed(3)}`);
    console.log('(|corr| small => dominance-relative signal is orthogonal new info, not a re-skin of the funding fade)');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });

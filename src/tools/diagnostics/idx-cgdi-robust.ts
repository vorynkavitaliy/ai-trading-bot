/**
 * idx-cgdi-robust — stress the one borderline candidate: CGDI raw-LEVEL fade
 * (IC_IS -0.116 / IC_OOS -0.095 @7d). Is it a real stationary signal or a
 * raw-level / lagged-price artifact?
 *
 * Checks:
 *  1. Orthogonality of CGDI raw level vs BTC price level itself (Spearman) and
 *     vs trailing 7d/30d return — if level tracks price, the "edge" is just
 *     "buy-the-dip on a price proxy".
 *  2. Thirds split (3 contiguous sub-periods) IC@7d for level + z60 — does the
 *     raw level hold up across ALL thirds, or only because the index drifted up
 *     with a 2-yr bull leg?
 *  3. Detrended level (level minus its own 90d mean) IC@7d both halves — the
 *     honest stationary version.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length; if (n < 3) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db); return den === 0 ? NaN : num / den;
}
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));
const dayKey = (ms: number) => Math.floor(ms / 86400000) * 86400000;

function rollMean(xs: number[], win: number): number[] {
  return xs.map((_, i) => {
    const lo = Math.max(0, i - win + 1); const w = xs.slice(lo, i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}
function rollZ(xs: number[], win: number): number[] {
  return xs.map((_, i) => {
    const lo = Math.max(0, i - win + 1); const w = xs.slice(lo, i + 1);
    if (w.length < 5) return NaN;
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) * (b - m), 0) / w.length);
    return sd === 0 ? 0 : (xs[i] - m) / sd;
  });
}

async function main() {
  const r = await cgGet<any>('/futures/cgdi-index/history', { interval: '1d', limit: 1000 });
  const idx = (r.data as any[]).map(d => ({ t: dayKey(d.time), v: Number(d.cgdi_index_value) }))
    .filter(d => Number.isFinite(d.t) && Number.isFinite(d.v)).sort((a, b) => a.t - b.t);
  const byDay = new Map<number, number>(); for (const d of idx) byDay.set(d.t, d.v);

  const pr = await query<any>(`SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='1D' ORDER BY ts ASC`);
  const price = new Map<number, number>(); for (const row of pr.rows) price.set(dayKey(parseInt(row.ts, 10)), parseFloat(row.close));

  const days: number[] = []; const cg: number[] = []; const px: number[] = [];
  for (const d of [...byDay.keys()].sort((a, b) => a - b)) {
    if (!price.has(d)) continue;
    days.push(d); cg.push(byDay.get(d)!); px.push(price.get(d)!);
  }
  const n = days.length;
  console.log(`aligned rows: ${n}  ${new Date(days[0]).toISOString().slice(0,10)} .. ${new Date(days[n-1]).toISOString().slice(0,10)}`);

  const fwd = (h: number) => px.map((_, i) => i + h < n ? px[i + h] / px[i] - 1 : NaN);
  const trail = (h: number) => px.map((_, i) => i - h >= 0 ? px[i] / px[i - h] - 1 : NaN);
  const cleanCorr = (a: number[], b: number[]) => {
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { x.push(a[i]); y.push(b[i]); }
    return { c: spearman(x, y), n: x.length };
  };

  // 1. CGDI level vs price level + trailing returns
  console.log('\n[1] CGDI raw level confound checks (Spearman):');
  const lp = cleanCorr(cg, px); console.log(`   level vs BTC price level: ${lp.c.toFixed(3)} (n=${lp.n})  <- if high, "level fade" = buy-low-price`);
  const lt7 = cleanCorr(cg, trail(7)); console.log(`   level vs trailing 7d ret: ${lt7.c.toFixed(3)} (n=${lt7.n})`);
  const lt30 = cleanCorr(cg, trail(30)); console.log(`   level vs trailing 30d ret: ${lt30.c.toFixed(3)} (n=${lt30.n})`);

  // 2. thirds split IC@7d for level and z60
  const z60 = rollZ(cg, 60);
  const f7 = fwd(7);
  const thirds = [[0, Math.floor(n/3)], [Math.floor(n/3), Math.floor(2*n/3)], [Math.floor(2*n/3), n]];
  console.log('\n[2] thirds split IC@7d:');
  thirds.forEach(([a, b], k) => {
    const subCorr = (sig: number[]) => {
      const x: number[] = [], y: number[] = [];
      for (let i = a; i < b; i++) if (Number.isFinite(sig[i]) && Number.isFinite(f7[i])) { x.push(sig[i]); y.push(f7[i]); }
      return { c: spearman(x, y), n: x.length };
    };
    const lv = subCorr(cg); const zz = subCorr(z60);
    console.log(`   third ${k+1} (${new Date(days[a]).toISOString().slice(0,10)}..${new Date(days[b-1]).toISOString().slice(0,10)}): level IC=${lv.c.toFixed(3)} (n=${lv.n})   z60 IC=${zz.c.toFixed(3)} (n=${zz.n})`);
  });

  // 3. detrended level (level - 90d mean) IC@7d both halves — stationary version
  const dt = cg.map((v, i) => v - rollMean(cg, 90)[i]);
  const mid = Math.floor(n / 2);
  const halfCorr = (sig: number[], lo: number, hi: number) => {
    const x: number[] = [], y: number[] = [];
    for (let i = lo; i < hi; i++) if (Number.isFinite(sig[i]) && Number.isFinite(f7[i])) { x.push(sig[i]); y.push(f7[i]); }
    return { c: spearman(x, y), n: x.length };
  };
  console.log('\n[3] detrended (level - 90d mean) IC@7d:');
  const dIS = halfCorr(dt, 0, mid); const dOOS = halfCorr(dt, mid, n);
  console.log(`   IS=${dIS.c.toFixed(3)} (n=${dIS.n})   OOS=${dOOS.c.toFixed(3)} (n=${dOOS.n})  <- stationary truth`);

  process.exit(0);
}
main().catch(e => { console.error('CRASH', e?.message ?? e); process.exit(1); });

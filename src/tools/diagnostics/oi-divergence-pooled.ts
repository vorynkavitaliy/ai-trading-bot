/**
 * oi-divergence-pooled — pool the two surviving-candidate signals across all 5
 * book pairs to get a higher-n IS/OOS read (per-pair daily halves are only ~700
 * obs). Confirms whether divLead (the ORTHOGONAL one) or daily agg momentum has a
 * pooled stable edge that the per-pair view missed. READ-ONLY.
 *
 * Run: npx tsx src/tools/diagnostics/oi-divergence-pooled.ts
 */
import { query, close as closePg } from '../../core/db';
import { cgGet } from '../../core/coinglass';

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
  }
  return r;
}
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 10) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = xs[i] - mx, ay = ys[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}
function spearman(x: number[], y: number[]): { ic: number; n: number } {
  if (x.length < 30) return { ic: NaN, n: x.length };
  return { ic: pearson(rank(x), rank(y)), n: x.length };
}
function quintile(sig: number[], fwd: number[]): number {
  const pairs = sig.map((s, i) => [s, fwd[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const n = pairs.length; const q: number[] = [];
  for (let bk = 0; bk < 5; bk++) {
    const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5);
    let s = 0; for (let i = lo; i < hi; i++) s += pairs[i][1];
    q.push(hi > lo ? (s / (hi - lo)) * 100 : NaN);
  }
  return q[4] - q[0];
}
function zscoredDelta(level: (number | null)[], LB: number, ZW: number): (number | null)[] {
  const N = level.length; const d: (number | null)[] = new Array(N).fill(null);
  for (let i = LB; i < N; i++) { const a = level[i], b = level[i - LB]; if (a != null && b != null && b !== 0) d[i] = (a - b) / Math.abs(b); }
  const z: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (d[i] == null) continue;
    const win: number[] = []; for (let k = Math.max(0, i - ZW); k < i; k++) if (d[k] != null && isFinite(d[k]!)) win.push(d[k]!);
    if (win.length < 20) continue;
    const m = win.reduce((s, v) => s + v, 0) / win.length;
    const sd = Math.sqrt(win.reduce((s, v) => s + (v - m) * (v - m), 0) / win.length);
    if (sd > 0) z[i] = (d[i]! - m) / sd;
  }
  return z;
}

interface Obs { half: 'IS' | 'OOS'; divLead: number; aggZ: number; f1: number; f3: number; f7: number; }

async function perPair(coin: string): Promise<Obs[]> {
  const r = await cgGet<any>('/futures/open-interest/exchange-history-chart', { symbol: coin, range: 'all' });
  const d = r.data;
  const ts: number[] = (d.time_list ?? []).map((t: any) => Number(t));
  const price: number[] = (d.price_list ?? []).map((p: any) => Number(p));
  const N = ts.length;
  const venues: Record<string, (number | null)[]> = {};
  for (const [ex, arr] of Object.entries(d.data_map ?? {})) venues[ex] = (arr as any[]).map(v => (v == null || !isFinite(Number(v)) ? null : Number(v)));
  const well = Object.entries(venues).filter(([, a]) => a.filter(x => x != null && x > 0).length > N * 0.6).map(([k]) => k);
  if (well.length < 4 || N < 400) return [];
  const ZW = 60;
  const venueZ: Record<string, (number | null)[]> = {};
  for (const v of well) venueZ[v] = zscoredDelta(venues[v], 1, ZW);
  const total: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) { let s = 0, ok = 0; for (const v of well) { const x = venues[v][i]; if (x != null && x > 0) { s += x; ok++; } } if (ok === well.length) total[i] = s; }
  const aggZ = zscoredDelta(total, 1, ZW);
  const divLead: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const zs: number[] = []; for (const v of well) { const z = venueZ[v][i]; if (z != null && isFinite(z)) zs.push(z); }
    if (zs.length < well.length - 1) continue;
    const mean = zs.reduce((s, x) => s + x, 0) / zs.length;
    divLead[i] = Math.max(...zs) - mean;
  }
  const fwd = (K: number, i: number) => (i + K < N && price[i] > 0 ? (price[i + K] - price[i]) / price[i] : null);
  const sigIdx = ts.map((_, i) => i).filter(i => divLead[i] != null && aggZ[i] != null);
  const midTs = ts[sigIdx[Math.floor(sigIdx.length / 2)]];
  const out: Obs[] = [];
  for (const i of sigIdx) {
    const f1 = fwd(1, i), f3 = fwd(3, i), f7 = fwd(7, i);
    if (f1 == null || f3 == null || f7 == null) continue;
    out.push({ half: ts[i] < midTs ? 'IS' : 'OOS', divLead: divLead[i]!, aggZ: aggZ[i]!, f1, f3, f7 });
  }
  return out;
}

async function main() {
  const PAIRS = ['BTC', 'SOL', 'ADA', 'LINK', 'ETH'];
  const all: Obs[] = [];
  for (const c of PAIRS) { try { all.push(...await perPair(c)); } catch (e: any) { console.log(c, 'ERR', (e?.message ?? '').slice(0, 80)); } await new Promise(r => setTimeout(r, 350)); }
  console.log(`\n══ POOLED cross-exchange OI divergence (daily, all 5 pairs) ══  total obs=${all.length}`);
  for (const half of ['IS', 'OOS'] as const) {
    const h = all.filter(o => o.half === half);
    for (const [nm, get] of [['divLead', (o: Obs) => o.divLead], ['aggZ', (o: Obs) => o.aggZ]] as [string, (o: Obs) => number][]) {
      const sig = h.map(get);
      for (const [hl, fwd] of [['1d', (o: Obs) => o.f1], ['3d', (o: Obs) => o.f3], ['7d', (o: Obs) => o.f7]] as [string, (o: Obs) => number][]) {
        const f = h.map(fwd);
        const ic = spearman(sig, f).ic;
        const q = quintile(sig, f);
        console.log(`  ${half.padEnd(3)} ${nm.padEnd(8)} ${hl}: IC=${(ic >= 0 ? '+' : '') + ic.toFixed(4)}  Q5-Q1=${(q >= 0 ? '+' : '') + q.toFixed(2)}%  n=${h.length}`);
      }
    }
  }
  await closePg(); process.exit(0);
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

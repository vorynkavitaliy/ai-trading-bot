/**
 * eth-relval-windows — ANGLE 5 follow-up: robustness of ETH/BTC ratio reversion
 * across multiple z-windows and across THIRDS of the sample (regime structure).
 * If the IC sign is unstable across windows AND across thirds, reversion is a
 * regime artifact, not an edge. Read-only.
 *
 * Run: npx tsx src/tools/diagnostics/eth-relval-windows.ts
 */
import { query, close as closePg } from '../../core/db';

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  for (let k = 0; k < idx.length; k++) r[idx[k][1]] = k + 1;
  return r;
}
function spearman(x: (number | null)[], y: (number | null)[]): number {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } }
  const n = xs.length; if (n < 30) return NaN;
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return num / Math.sqrt(dx * dy);
}
function rollingZ(series: number[], win: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  for (let i = 0; i < series.length; i++) {
    if (i < win) continue;
    let s = 0, s2 = 0;
    for (let k = i - win; k < i; k++) { s += series[k]; s2 += series[k] * series[k]; }
    const mean = s / win; const varr = s2 / win - mean * mean; const sd = Math.sqrt(Math.max(varr, 1e-18));
    out[i] = sd > 0 ? (series[i] - mean) / sd : null;
  }
  return out;
}
async function loadCloses(symbol: string): Promise<Map<number, number>> {
  const { rows } = await query<any>(`SELECT ts, close::text AS c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [symbol]);
  const m = new Map<number, number>();
  for (const r of rows) { const c = parseFloat(r.c); if (isFinite(c) && c > 0) m.set(Number(r.ts), c); }
  return m;
}

async function main() {
  const ethM = await loadCloses('ETHUSDT');
  const btcM = await loadCloses('BTCUSDT');
  const ts: number[] = [];
  for (const t of ethM.keys()) if (btcM.has(t)) ts.push(t);
  ts.sort((a, b) => a - b);
  const ratio = ts.map(t => ethM.get(t)! / btcM.get(t)!);
  const N = ratio.length;

  const fwdRatio = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) out[i] = (ratio[i + K] - ratio[i]) / ratio[i];
    return out;
  };
  const fr24 = fwdRatio(6);

  // log-ratio z-score variant (more stationary for a price ratio)
  const logRatio = ratio.map(r => Math.log(r));

  const wins = [30, 45, 90, 180, 360];

  // thirds boundaries
  const b1 = Math.floor(N / 3), b2 = Math.floor(2 * N / 3);
  const labels = ['T1', 'T2', 'T3'] as const;
  const inThird = (i: number, t: typeof labels[number]) => t === 'T1' ? i < b1 : t === 'T2' ? (i >= b1 && i < b2) : i >= b2;
  console.log(`\n══ ETH/BTC RATIO REVERSION — WINDOW × THIRDS ROBUSTNESS ══`);
  console.log(`N=${N}  T1 ${new Date(ts[0]).toISOString().slice(0,10)}..${new Date(ts[b1-1]).toISOString().slice(0,10)}  T2 ..${new Date(ts[b2-1]).toISOString().slice(0,10)}  T3 ..${new Date(ts[N-1]).toISOString().slice(0,10)}`);
  console.log(`IC(z, fwd-24h ratio chg).  NEG=reverts, POS=trends. Need NEG in all thirds for a real reversion edge.\n`);

  for (const useLog of [false, true]) {
    const base = useLog ? logRatio : ratio;
    console.log(`${useLog ? 'LOG-ratio' : 'RAW-ratio'} z-score:`);
    console.log('  win │   T1      T2      T3     │ full');
    for (const w of wins) {
      const z = rollingZ(base, w);
      const icThird = (t: typeof labels[number]) => spearman(z.map((v, i) => inThird(i, t) ? v : null), fr24);
      const t1 = icThird('T1'), t2 = icThird('T2'), t3 = icThird('T3');
      const full = spearman(z, fr24);
      const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : 'NaN').padStart(7);
      const allNeg = [t1, t2, t3].every(v => isFinite(v) && v < -0.03);
      console.log(`  ${String(w).padStart(3)} │ ${f(t1)} ${f(t2)} ${f(t3)} │ ${f(full)}  ${allNeg ? '<= all-neg' : ''}`);
    }
    console.log('');
  }

  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

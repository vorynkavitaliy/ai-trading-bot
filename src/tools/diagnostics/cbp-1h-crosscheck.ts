/**
 * cbp-1h-crosscheck — confirm the 4h finding on finer 1h data: is the rate_level
 * FORWARD edge just lagged price autocorrelation? Compare corr(rate, FWD) vs
 * corr(rate, PAST) at 12/24/48h on 1h bars, plus IS/OOS IC. Read-only.
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close as closePg } from '../../core/db';

function rank(vals: number[]): number[] { const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array<number>(vals.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
function spearman(x: (number | null)[], y: (number | null)[]) { const xs: number[] = [], ys: number[] = []; for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } } const n = xs.length; if (n < 25) return { ic: NaN, n }; const rx = rank(xs), ry = rank(ys); const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; } return { ic: num / Math.sqrt(dx * dy), n }; }
function fmt(v: number) { return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN'; }

async function main() {
  const r = await cgGet<any>('/coinbase-premium-index', { interval: '1h', limit: 4500 });
  const raw: any[] = Array.isArray(r.data) ? r.data : [];
  const pts = raw.map(x => ({ ts: Number(x.time) * 1000, rate: Number(x.premium_rate) })).filter(p => isFinite(p.ts) && isFinite(p.rate)).sort((a, b) => a.ts - b.ts);
  const bars = await loadBars('BTCUSDT', '60m', { fromTs: pts[0].ts - 1, toTs: pts[pts.length - 1].ts + 1 });
  const ciByTs = new Map<number, number>(); bars.forEach((b, i) => ciByTs.set(b.ts, i));
  const al: { ts: number; rate: number; close: number }[] = [];
  for (const p of pts) { const ci = ciByTs.get(p.ts); if (ci !== undefined) al.push({ ts: p.ts, rate: p.rate, close: bars[ci].close }); }
  const N = al.length, rate = al.map(a => a.rate as number | null), close = al.map(a => a.close), ts = al.map(a => a.ts);
  const STEP = 3600 * 1000;
  const fwd = (K: number) => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) if (ts[i + K] - ts[i] === K * STEP && close[i] > 0) o[i] = (close[i + K] - close[i]) / close[i]; return o; };
  const bwd = (K: number) => { const o: (number | null)[] = new Array(N).fill(null); for (let i = K; i < N; i++) if (ts[i] - ts[i - K] === K * STEP && close[i - K] > 0) o[i] = (close[i] - close[i - K]) / close[i - K]; return o; };
  console.log(`1h aligned rows=${N}  span ${new Date(ts[0]).toISOString().slice(0,10)} .. ${new Date(ts[N-1]).toISOString().slice(0,10)}`);
  const mid = Math.floor(N / 2);
  const half = (arr: (number | null)[], h: 'IS' | 'OOS') => arr.map((v, i) => (h === 'IS' ? i < mid : i >= mid) ? v : null);
  console.log('\nrate_level: IS/OOS FORWARD IC, plus full-sample FWD-vs-PAST lead-lag');
  for (const K of [12, 24, 48]) {
    const f = fwd(K), b = bwd(K);
    const is = spearman(half(rate, 'IS'), f), oos = spearman(half(rate, 'OOS'), f);
    const icF = spearman(rate, f), icB = spearman(rate, b);
    console.log(`  ${(K+'h').padEnd(4)} FWD IC IS ${fmt(is.ic)}/OOS ${fmt(oos.ic)}  | full corr(rate,FWD) ${fmt(icF.ic)} vs corr(rate,PAST) ${fmt(icB.ic)} ${Math.abs(icB.ic) > Math.abs(icF.ic) ? '<< LAGS' : '>> leads'}`);
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

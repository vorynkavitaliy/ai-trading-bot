/**
 * cbp-level-deepdive — the only consistent-sign archetype from cbp-edge-scan was
 * rate_level (FOLLOW). It just missed the gate (IS-48h IC +0.041 < 0.05) and the OOS
 * half is 4x stronger than IS. This tool stress-tests that thread:
 *
 *  1) rate_level FOLLOW IC at longer horizons (12..96h) IS/OOS.
 *  2) Rolling thirds (not just halves) to see if the edge is regime-concentrated.
 *  3) DETREND test: regress out the common trend. Is premium LEADING price, or are both
 *     just trending together (spurious)? Compare:
 *        (a) raw level -> fwd return  (what edge-scan did)
 *        (b) premium CHANGE vs price CHANGE contemporaneous corr (do they co-move same-bar?)
 *        (c) lead-lag: does premium_t correlate better with fwd return than with PAST return?
 *           If contemporaneous/past corr >> forward corr, premium lags price (no tradable lead).
 *  4) Quintile table (all 5 buckets) for rate_level @48h both halves — is the relationship
 *     directional even if not strictly monotone?
 *
 * Read-only.
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close as closePg } from '../../core/db';

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function spearman(x: (number | null)[], y: (number | null)[]): { ic: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } }
  const n = xs.length; if (n < 25) return { ic: NaN, n };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return { ic: num / Math.sqrt(dx * dy), n };
}
function fmt(v: number): string { return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN'; }
function fmtP(v: number): string { return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : ' NaN'; }

async function main() {
  const r = await cgGet<any>('/coinbase-premium-index', { interval: '4h', limit: 4500 });
  const raw: any[] = Array.isArray(r.data) ? r.data : [];
  const pts = raw.map(x => ({ ts: Number(x.time) * 1000, rate: Number(x.premium_rate) }))
    .filter(p => isFinite(p.ts) && isFinite(p.rate)).sort((a, b) => a.ts - b.ts);
  const bars = await loadBars('BTCUSDT', '240m', { fromTs: pts[0].ts - 1, toTs: pts[pts.length - 1].ts + 1 });
  const ciByTs = new Map<number, number>(); bars.forEach((b, i) => ciByTs.set(b.ts, i));
  const al: { ts: number; rate: number; close: number }[] = [];
  for (const p of pts) { const ci = ciByTs.get(p.ts); if (ci !== undefined) al.push({ ts: p.ts, rate: p.rate, close: bars[ci].close }); }
  const N = al.length;
  const rate = al.map(a => a.rate), close = al.map(a => a.close), ts = al.map(a => a.ts);
  const STEP = 4 * 3600 * 1000;
  const fwd = (K: number): (number | null)[] => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) if (ts[i + K] - ts[i] === K * STEP && close[i] > 0) o[i] = (close[i + K] - close[i]) / close[i]; return o; };
  const bwd = (K: number): (number | null)[] => { const o: (number | null)[] = new Array(N).fill(null); for (let i = K; i < N; i++) if (ts[i] - ts[i - K] === K * STEP && close[i - K] > 0) o[i] = (close[i] - close[i - K]) / close[i - K]; return o; };

  console.log(`aligned rows=${N}  span ${new Date(ts[0]).toISOString().slice(0,10)} .. ${new Date(ts[N-1]).toISOString().slice(0,10)}`);

  // (1) rate_level FOLLOW IC across horizons, halves
  const mid = Math.floor(N / 2);
  const half = (arr: (number | null)[], h: 'IS' | 'OOS') => arr.map((v, i) => (h === 'IS' ? i < mid : i >= mid) ? v : null);
  const rateArr = rate.map(v => v as number | null);
  console.log('\n(1) rate_level FOLLOW IC by horizon  [IS / OOS]');
  for (const K of [3, 6, 12, 18, 24]) {
    const f = fwd(K);
    const is = spearman(half(rateArr, 'IS'), f), oos = spearman(half(rateArr, 'OOS'), f);
    console.log(`  ${(K*4+'h').padEnd(5)} IC ${fmt(is.ic)} / ${fmt(oos.ic)}   (n ${is.n}/${oos.n})`);
  }

  // (2) rolling thirds @48h
  console.log('\n(2) rate_level @48h IC across thirds (regime-concentration check)');
  const t3 = Math.floor(N / 3);
  const f48 = fwd(12);
  for (let t = 0; t < 3; t++) {
    const lo = t * t3, hi = t === 2 ? N : (t + 1) * t3;
    const seg = rateArr.map((v, i) => i >= lo && i < hi ? v : null);
    const ic = spearman(seg, f48);
    console.log(`  third ${t+1} (${new Date(ts[lo]).toISOString().slice(0,10)}..${new Date(ts[hi-1]).toISOString().slice(0,10)}) IC ${fmt(ic.ic)} n ${ic.n}`);
  }

  // (3) lead-lag: corr(rate_t, fwd) vs corr(rate_t, past). If premium LEADS, fwd corr should
  //     be comparable to / stronger than past corr. If it merely LAGS price, past corr dominates.
  console.log('\n(3) lead-lag: rate_level vs FORWARD return  vs  rate_level vs PAST return  @ each K (full sample)');
  for (const K of [3, 6, 12]) {
    const f = fwd(K), b = bwd(K);
    const icF = spearman(rateArr, f), icB = spearman(rateArr, b);
    console.log(`  K=${(K*4)+'h'}: corr(rate, FWD) ${fmt(icF.ic)}   corr(rate, PAST) ${fmt(icB.ic)}   ${Math.abs(icB.ic) > Math.abs(icF.ic)*1.3 ? '<< premium LAGS price (past dominates)' : (Math.abs(icF.ic) > Math.abs(icB.ic)*1.1 ? '>> premium LEADS price' : '~ ambiguous')}`);
  }

  // (4) full quintile table @48h, both halves
  console.log('\n(4) rate_level @48h quintile mean fwd-return table');
  const quint = (sig: (number | null)[], f: (number | null)[], lbl: string) => {
    const pairs: { s: number; f: number }[] = [];
    for (let i = 0; i < sig.length; i++) { const a = sig[i], y = f[i]; if (a != null && y != null && isFinite(a) && isFinite(y)) pairs.push({ s: a, f: y }); }
    pairs.sort((a, b) => a.s - b.s);
    const n = pairs.length, qn = Math.floor(n / 5);
    const means: number[] = [];
    for (let q = 0; q < 5; q++) { const lo = q * qn, hi = q === 4 ? n : (q + 1) * qn; let sum = 0; for (let i = lo; i < hi; i++) sum += pairs[i].f; means.push((sum / (hi - lo)) * 100); }
    console.log(`  ${lbl} (n=${n}): Q1 ${fmtP(means[0])} Q2 ${fmtP(means[1])} Q3 ${fmtP(means[2])} Q4 ${fmtP(means[3])} Q5 ${fmtP(means[4])}  | Q5-Q1 ${fmtP(means[4]-means[0])}`);
  };
  quint(half(rateArr, 'IS'), f48, 'IS ');
  quint(half(rateArr, 'OOS'), f48, 'OOS');
  quint(rateArr, f48, 'ALL');

  // (5) common-trend control: does the OOS edge survive if we use premium CHANGE (stationary) instead of level?
  // And contemporaneous co-movement of rate-change vs price-return (same bar).
  console.log('\n(5) common-trend control');
  const dRate: (number | null)[] = new Array(N).fill(null); for (let i = 1; i < N; i++) dRate[i] = rate[i] - rate[i - 1];
  const ret1: (number | null)[] = new Array(N).fill(null); for (let i = 1; i < N; i++) if (close[i-1] > 0) ret1[i] = (close[i] - close[i - 1]) / close[i - 1];
  const cont = spearman(dRate, ret1);
  console.log(`  contemporaneous corr(Δrate, same-bar return) = ${fmt(cont.ic)}  (positive = premium & price co-move within the bar)`);
  // Δrate -> next-bar return (does a JUMP in premium lead next bar?)
  const f1 = fwd(1);
  const isd = spearman(half(dRate, 'IS'), f1), oosd = spearman(half(dRate, 'OOS'), f1);
  console.log(`  Δrate -> next-4h return IC: IS ${fmt(isd.ic)} / OOS ${fmt(oosd.ic)}`);

  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

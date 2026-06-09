/**
 * eth-relval-ratio — ANGLE 5: ETH/BTC relative-value (spread mean-reversion) EDA.
 *
 * Hypothesis: the ETH/BTC price RATIO mean-reverts even when neither leg has a
 * clean outright fade edge. We compute the ratio on aligned 4H closes (~5yr),
 * a rolling z-score (window 90 & 180 bars), and the Spearman rank-IC of the
 * z-score vs the FORWARD ratio change (12h/24h/48h), split IS (older half) /
 * OOS (recent half).
 *
 * Interpretation: NEGATIVE IC(z, fwd-ratio-change) ⇒ a high z-score (ETH rich vs
 * BTC) precedes the ratio FALLING ⇒ the spread mean-reverts ⇒ fade it (short ETH
 * / long BTC at high z). A real reversion edge needs SAME-sign (negative) IC in
 * BOTH halves at the SAME horizon.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/eth-relval-ratio.ts
 */
import { query, close as closePg } from '../../core/db';

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  for (let k = 0; k < idx.length; k++) r[idx[k][1]] = k + 1;
  return r;
}

function spearman(x: (number | null)[], y: (number | null)[]): { ic: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const n = xs.length;
  if (n < 30) return { ic: NaN, n };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return { ic: num / Math.sqrt(dx * dy), n };
}

// avg fwd value per quintile of signal (Q1 = lowest signal)
function quintileSpread(sig: (number | null)[], fwd: (number | null)[]): { q: number[]; spread: number; n: number } {
  const pairs: [number, number][] = [];
  for (let i = 0; i < sig.length; i++) {
    const a = sig[i], b = fwd[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) pairs.push([a, b]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const q: number[] = [];
  for (let bk = 0; bk < 5; bk++) {
    const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5);
    let s = 0; for (let i = lo; i < hi; i++) s += pairs[i][1];
    q.push(hi > lo ? (s / (hi - lo)) * 100 : NaN);
  }
  return { q, spread: q[4] - q[0], n };
}

async function loadCloses(symbol: string): Promise<Map<number, number>> {
  const { rows } = await query<any>(
    `SELECT ts, close::text AS c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [symbol]);
  const m = new Map<number, number>();
  for (const r of rows) { const c = parseFloat(r.c); if (isFinite(c) && c > 0) m.set(Number(r.ts), c); }
  return m;
}

function rollingZ(series: number[], win: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  for (let i = 0; i < series.length; i++) {
    if (i < win) continue;
    let s = 0, s2 = 0;
    for (let k = i - win; k < i; k++) { s += series[k]; s2 += series[k] * series[k]; }
    const mean = s / win;
    const varr = s2 / win - mean * mean;
    const sd = Math.sqrt(Math.max(varr, 1e-18));
    out[i] = sd > 0 ? (series[i] - mean) / sd : null;
  }
  return out;
}

async function main() {
  const ethM = await loadCloses('ETHUSDT');
  const btcM = await loadCloses('BTCUSDT');

  // aligned grid: timestamps present in BOTH
  const ts: number[] = [];
  for (const t of ethM.keys()) if (btcM.has(t)) ts.push(t);
  ts.sort((a, b) => a - b);

  const eth = ts.map(t => ethM.get(t)!);
  const btc = ts.map(t => btcM.get(t)!);
  const ratio = ts.map((_, i) => eth[i] / btc[i]);
  const N = ts.length;

  // rolling z-scores
  const z90 = rollingZ(ratio, 90);
  const z180 = rollingZ(ratio, 180);

  // forward RATIO change (relative): (ratio[i+K]-ratio[i])/ratio[i]
  const fwdRatio = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) out[i] = (ratio[i + K] - ratio[i]) / ratio[i];
    return out;
  };
  const fr12 = fwdRatio(3), fr24 = fwdRatio(6), fr48 = fwdRatio(12);

  // IS/OOS split at midpoint
  const midIdx = Math.floor(N / 2);
  const midTs = ts[midIdx];
  const split = (arr: (number | null)[], half: 'IS' | 'OOS') =>
    arr.map((v, i) => (half === 'IS' ? i < midIdx : i >= midIdx) ? v : null);

  console.log(`\n══ ETH/BTC RATIO REVERSION EDA ══`);
  console.log(`aligned 4H bars=${N}, range ${new Date(ts[0]).toISOString().slice(0,10)} → ${new Date(ts[N-1]).toISOString().slice(0,10)}`);
  console.log(`IS (older half) < ${new Date(midTs).toISOString().slice(0,10)} <= OOS (recent half)`);
  console.log(`ratio now=${ratio[N-1].toFixed(5)}  min=${Math.min(...ratio).toFixed(5)} max=${Math.max(...ratio).toFixed(5)}`);
  console.log(`IC = Spearman( z-score , forward ratio change ).  NEG ⇒ high z precedes ratio DROP ⇒ MEAN-REVERTS ⇒ fade spread.`);
  console.log(`Real reversion edge: SAME-SIGN(negative) IC in BOTH halves, |IC| ≳ 0.05.\n`);

  const zs: { name: string; vals: (number | null)[] }[] = [
    { name: 'z-score(win=90)', vals: z90 },
    { name: 'z-score(win=180)', vals: z180 },
  ];

  console.log('signal'.padEnd(18) + ' │  IC12h   IC24h   IC48h  (IS)  │  IC12h   IC24h   IC48h  (OOS) │ read(24h)');
  console.log('─'.repeat(98));
  for (const s of zs) {
    const isV = split(s.vals, 'IS'), oosV = split(s.vals, 'OOS');
    const ic = (sig: (number | null)[], f: (number | null)[]) => spearman(sig, f).ic;
    const i12 = ic(isV, fr12), i24 = ic(isV, fr24), i48 = ic(isV, fr48);
    const o12 = ic(oosV, fr12), o24 = ic(oosV, fr24), o48 = ic(oosV, fr48);
    let read = '—';
    if (isFinite(i24) && isFinite(o24) && Math.sign(i24) === Math.sign(o24) && Math.abs(i24) >= 0.05 && Math.abs(o24) >= 0.05) {
      read = i24 < 0 ? 'REVERTS (stable)' : 'TRENDS (stable)';
    } else if (isFinite(i24) && isFinite(o24) && Math.sign(i24) !== Math.sign(o24)) {
      read = 'flips IS<->OOS';
    }
    const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN').padStart(7);
    console.log(s.name.padEnd(18) + ' │ ' + f(i12) + ' ' + f(i24) + ' ' + f(i48) + '       │ ' + f(o12) + ' ' + f(o24) + ' ' + f(o48) + '      │ ' + read);
  }

  // Quintile spread of fwd-24h ratio change by z (both halves), win=180
  console.log(`\n── quintile fwd-24h ratio-change(%) by z180 (Q1=lowest z .. Q5=highest z) ──`);
  for (const half of ['IS', 'OOS'] as const) {
    const q = quintileSpread(split(z180, half), fr24);
    console.log(`${half}: ` + q.q.map((v,k)=>`Q${k+1} ${v>=0?'+':''}${v.toFixed(3)}`).join('  ') + `  | Q5-Q1 ${q.spread>=0?'+':''}${q.spread.toFixed(3)}% (n=${q.n})`);
  }

  // Also report the spread of z180 itself and how often it gets to |z|>=1.5/2
  let n15 = 0, n20 = 0, valid = 0;
  for (const v of z180) if (v != null) { valid++; if (Math.abs(v) >= 1.5) n15++; if (Math.abs(v) >= 2.0) n20++; }
  console.log(`\nz180 distribution: |z|>=1.5 in ${n15}/${valid} bars (${(100*n15/valid).toFixed(1)}%), |z|>=2.0 in ${n20} (${(100*n20/valid).toFixed(1)}%)`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

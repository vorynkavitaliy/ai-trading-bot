/**
 * cbp-edge-scan — does Coinbase Premium Index lead BTC?
 *
 * Read-only research probe. Fetches /coinbase-premium-index (4h, full ~360d history),
 * aligns each premium reading to the project's own BTCUSDT candle closes (the bars the
 * strategy trades), and computes:
 *   - Spearman rank-IC of signal_t -> forward return over H bars
 *   - top-vs-bottom quintile forward-return spread
 * split IS (older half) / OOS (recent half) at the midpoint of aligned history.
 *
 * Archetypes tested (signals derived from premium_rate):
 *   A) level         : premium_rate level (FOLLOW: high prem -> BTC rises)
 *   B) zscore        : rolling z-score of premium_rate (regime extreme)
 *   C) change(dN)    : N-bar change in premium_rate (momentum of premium)
 *   D) divergence    : premium_rate vs recent BTC return sign (mean-reversion archetype)
 *
 * For each we report IC at 12h/24h/48h for BOTH halves, plus quintile spread.
 * We report the sign honestly: positive IC = FOLLOW edge, negative = FADE edge.
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close as closePg } from '../../core/db';

type Pt = { ts: number; rate: number; premium: number };

// ---------- stats ----------
function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  // average ranks for ties
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
// top-vs-bottom quintile mean forward return (in %)
function quintileSpread(sig: (number | null)[], fwd: (number | null)[]): { spread: number; q1: number; q5: number; n: number; mono: boolean } {
  const pairs: { s: number; f: number }[] = [];
  for (let i = 0; i < sig.length; i++) { const a = sig[i], b = fwd[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) pairs.push({ s: a, f: b }); }
  const n = pairs.length;
  if (n < 25) return { spread: NaN, q1: NaN, q5: NaN, n, mono: false };
  pairs.sort((a, b) => a.s - b.s);
  const qn = Math.floor(n / 5);
  const means: number[] = [];
  for (let q = 0; q < 5; q++) {
    const lo = q * qn, hi = q === 4 ? n : (q + 1) * qn;
    let sum = 0; for (let i = lo; i < hi; i++) sum += pairs[i].f;
    means.push((sum / (hi - lo)) * 100);
  }
  const q1 = means[0], q5 = means[4];
  // monotone if strictly increasing or strictly decreasing across the 5 buckets
  let inc = true, dec = true;
  for (let q = 1; q < 5; q++) { if (means[q] <= means[q - 1]) inc = false; if (means[q] >= means[q - 1]) dec = false; }
  return { spread: q5 - q1, q1, q5, n, mono: inc || dec };
}

function fmt(v: number): string { return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN'; }
function fmtP(v: number): string { return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : ' NaN'; }

async function main() {
  // ---- fetch premium (4h) ----
  const r = await cgGet<any>('/coinbase-premium-index', { interval: '4h', limit: 4500 });
  const raw: any[] = Array.isArray(r.data) ? r.data : [];
  const pts: Pt[] = raw
    .map(x => ({ ts: Number(x.time) * 1000, rate: Number(x.premium_rate), premium: Number(x.premium) }))
    .filter(p => isFinite(p.ts) && isFinite(p.rate))
    .sort((a, b) => a.ts - b.ts);
  console.log(`premium 4h rows=${pts.length}  span ${new Date(pts[0].ts).toISOString().slice(0,10)} .. ${new Date(pts[pts.length-1].ts).toISOString().slice(0,10)}`);

  // ---- BTC candles 240m over the same span ----
  const bars = await loadBars('BTCUSDT', '240m', { fromTs: pts[0].ts - 1, toTs: pts[pts.length - 1].ts + 1 });
  console.log(`BTCUSDT 240m bars in span=${bars.length}`);

  // ---- align premium readings to candle close ts (exact match on 4h boundary) ----
  // Both are on 4h UTC boundaries. Build a map ts->close.
  const closeAt = new Map<number, number>();
  for (const b of bars) closeAt.set(b.ts, b.close);
  const barTsSorted = bars.map(b => b.ts);

  // Keep only premium points that have a matching candle close.
  const aligned: { ts: number; rate: number; premium: number; close: number; ci: number }[] = [];
  const ciByTs = new Map<number, number>();
  barTsSorted.forEach((t, i) => ciByTs.set(t, i));
  for (const p of pts) {
    const ci = ciByTs.get(p.ts);
    if (ci !== undefined) aligned.push({ ts: p.ts, rate: p.rate, premium: p.premium, close: bars[ci].close, ci });
  }
  console.log(`aligned premium<->candle rows=${aligned.length}\n`);
  if (aligned.length < 120) { console.log('DATA-INSUFFICIENT: <120 aligned rows for an IS/OOS split.'); await closePg(); return; }

  const N = aligned.length;
  const rateArr = aligned.map(a => a.rate);
  const closeArr = aligned.map(a => a.close);

  // forward return over K bars (using aligned-row index; aligned rows are contiguous 4h)
  // Guard: only use fwd when the K-ahead aligned row is exactly K*4h later (no gaps).
  const STEP = 4 * 3600 * 1000;
  const fwd = (K: number): (number | null)[] => {
    const o: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) {
      if (aligned[i + K].ts - aligned[i].ts === K * STEP && closeArr[i] > 0) {
        o[i] = (closeArr[i + K] - closeArr[i]) / closeArr[i];
      }
    }
    return o;
  };
  const fwd3 = fwd(3), fwd6 = fwd(6), fwd12 = fwd(12); // 12h / 24h / 48h

  // rolling z-score of rate (window W, causal: uses only past+current)
  const zscore = (W: number): (number | null)[] => {
    const o: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i < N; i++) {
      const lo = Math.max(0, i - W + 1);
      const win = rateArr.slice(lo, i + 1);
      if (win.length < Math.min(W, 20)) continue;
      const m = win.reduce((s, v) => s + v, 0) / win.length;
      const sd = Math.sqrt(win.reduce((s, v) => s + (v - m) * (v - m), 0) / win.length);
      o[i] = sd > 0 ? (rateArr[i] - m) / sd : 0;
    }
    return o;
  };
  // N-bar change in rate (momentum of premium)
  const change = (n: number): (number | null)[] => {
    const o: (number | null)[] = new Array(N).fill(null);
    for (let i = n; i < N; i++) o[i] = rateArr[i] - rateArr[i - n];
    return o;
  };
  // divergence: premium_rate level minus a scaled recent BTC return (z of each, premium minus price-momentum)
  // archetype: when premium is high but price has NOT risen (or fallen) -> price reverts toward premium.
  // signal = rate_z - priceMom_z over same lookback; high signal = premium leads, price lags.
  const divergence = (W: number, mom: number): (number | null)[] => {
    const z = zscore(W);
    // price momentum over `mom` bars, z-scored on window W
    const pm: number[] = new Array(N).fill(NaN);
    for (let i = mom; i < N; i++) pm[i] = (closeArr[i] - closeArr[i - mom]) / closeArr[i - mom];
    const pmz: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i < N; i++) {
      const lo = Math.max(0, i - W + 1);
      const win = pm.slice(lo, i + 1).filter(isFinite);
      if (win.length < Math.min(W, 20)) continue;
      const m = win.reduce((s, v) => s + v, 0) / win.length;
      const sd = Math.sqrt(win.reduce((s, v) => s + (v - m) * (v - m), 0) / win.length);
      pmz[i] = sd > 0 && isFinite(pm[i]) ? (pm[i] - m) / sd : null;
    }
    const o: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i < N; i++) { const a = z[i], b = pmz[i]; o[i] = (a != null && b != null) ? a - b : null; }
    return o;
  };

  const signals: { name: string; archetype: string; vals: (number | null)[] }[] = [
    { name: 'rate_level', archetype: 'spot-lead-follow', vals: rateArr.map(v => v) },
    { name: 'rate_z(W30)', archetype: 'premium-zscore-regime', vals: zscore(30) },
    { name: 'rate_z(W60)', archetype: 'premium-zscore-regime', vals: zscore(60) },
    { name: 'rate_chg(3)', archetype: 'premium-momentum', vals: change(3) },
    { name: 'rate_chg(6)', archetype: 'premium-momentum', vals: change(6) },
    { name: 'divergence(W30,m3)', archetype: 'premium-divergence', vals: divergence(30, 3) },
    { name: 'divergence(W30,m6)', archetype: 'premium-divergence', vals: divergence(30, 6) },
  ];

  // IS/OOS split at midpoint of aligned rows
  const midIdx = Math.floor(N / 2);
  const midTs = aligned[midIdx].ts;
  console.log(`IS/OOS split @ ${new Date(midTs).toISOString().slice(0,10)}  (IS rows=${midIdx}, OOS rows=${N - midIdx})\n`);
  const half = (arr: (number | null)[], h: 'IS' | 'OOS') => arr.map((v, i) => (h === 'IS' ? i < midIdx : i >= midIdx) ? v : null);

  const horizons: { lbl: string; fwd: (number | null)[] }[] = [
    { lbl: '12h', fwd: fwd3 }, { lbl: '24h', fwd: fwd6 }, { lbl: '48h', fwd: fwd12 },
  ];

  type Best = { sig: string; arche: string; hz: string; icIS: number; icOOS: number; spIS: number; spOOS: number; monoIS: boolean; monoOOS: boolean; robust: boolean };
  const robustHits: Best[] = [];

  for (const s of signals) {
    console.log(`── ${s.name}  [${s.archetype}] ──`);
    for (const h of horizons) {
      const isIC = spearman(half(s.vals, 'IS'), h.fwd);
      const oosIC = spearman(half(s.vals, 'OOS'), h.fwd);
      const isQ = quintileSpread(half(s.vals, 'IS'), h.fwd);
      const oosQ = quintileSpread(half(s.vals, 'OOS'), h.fwd);
      const sameSign = isFinite(isIC.ic) && isFinite(oosIC.ic) && Math.sign(isIC.ic) === Math.sign(oosIC.ic);
      const magOk = Math.abs(isIC.ic) >= 0.05 && Math.abs(oosIC.ic) >= 0.05;
      const icRobust = sameSign && magOk;
      const monoBoth = isQ.mono && oosQ.mono && Math.sign(isQ.spread) === Math.sign(oosQ.spread);
      const robust = icRobust || monoBoth;
      const reading = (isFinite(isIC.ic) && isIC.ic > 0) ? 'FOLLOW' : 'FADE';
      console.log(
        `  ${h.lbl.padEnd(4)} IC ${fmt(isIC.ic)}/${fmt(oosIC.ic)} (n ${isIC.n}/${oosIC.n})` +
        ` | quintile Δ ${fmtP(isQ.spread)}/${fmtP(oosQ.spread)} mono ${isQ.mono?'Y':'n'}/${oosQ.mono?'Y':'n'}` +
        ` | ${reading}${robust ? '  ◀ ROBUST' : ''}`,
      );
      if (robust) robustHits.push({ sig: s.name, arche: s.archetype, hz: h.lbl, icIS: isIC.ic, icOOS: oosIC.ic, spIS: isQ.spread, spOOS: oosQ.spread, monoIS: isQ.mono, monoOOS: oosQ.mono, robust });
    }
    console.log('');
  }

  console.log('══ ROBUST HITS (same-sign both halves & |IC|≥0.05, OR monotone both halves same-sign) ══');
  if (!robustHits.length) console.log('  NONE');
  for (const b of robustHits) {
    console.log(`  ${b.sig.padEnd(20)} ${b.hz.padEnd(4)} IC ${fmt(b.icIS)}/${fmt(b.icOOS)} qΔ ${fmtP(b.spIS)}/${fmtP(b.spOOS)} [${b.arche}]`);
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

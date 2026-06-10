/**
 * oi-momentum-divergence — does aggregated OI MOMENTUM (z-scored dOI) and/or
 * cross-exchange OI DIVERGENCE carry a real, OOS-robust, ORTHOGONAL directional
 * edge — distinct from the OI×price quadrant and the live funding_oi fade?
 *
 * TRACK A (4H, cg_oi_aggregated, ~382d): aggregated OI momentum.
 *   - dOI z-score over LB bars, z-scored on a rolling window (no look-ahead)
 *   - Spearman IC vs fwd 12/24/48h + quintile spread, IS/OOS split at midpoint
 *   - direction read: NEG IC = high-momentum precedes drop (fade), POS = follow
 *   - orthogonality: corr(best signal, funding_oi pct) and corr(best, trailing
 *     same-horizon price return) → is it lagged momentum repackaged?
 *
 * TRACK B (DAILY, per-exchange history-chart range=all, ~2200d): cross-exchange
 * OI divergence. For each venue build a z-scored dOI; divergence = (top-venue z)
 * minus (mean of other venues' z). Tests "one venue building OI vs others ->
 * directional". Horizons 1d/3d/7d, IS/OOS, orthogonality vs funding_oi & price.
 *
 * READ-ONLY. No DB writes, no live-path edits. Run:
 *   npx tsx src/tools/diagnostics/oi-momentum-divergence.ts
 */
import { query, close as closePg } from '../../core/db';
import { cgGet } from '../../core/coinglass';

// ---------- stats helpers ----------
function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  // average-rank ties
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
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 10) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = xs[i] - mx, ay = ys[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}
function spearman(x: (number | null)[], y: (number | null)[]): { ic: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const n = xs.length;
  if (n < 30) return { ic: NaN, n };
  return { ic: pearson(rank(xs), rank(ys)), n };
}
function spearmanAligned(a: (number | null)[], b: (number | null)[]): number {
  return spearman(a, b).ic;
}
function quintileSpread(sig: (number | null)[], fwd: (number | null)[]): number[] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < sig.length; i++) {
    const a = sig[i], c = fwd[i];
    if (a != null && c != null && isFinite(a) && isFinite(c)) pairs.push([a, c]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const q: number[] = [];
  for (let bk = 0; bk < 5; bk++) {
    const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5);
    let s = 0; for (let i = lo; i < hi; i++) s += pairs[i][1];
    q.push(hi > lo ? (s / (hi - lo)) * 100 : NaN);
  }
  return q; // q[4]-q[0] = spread
}

// latest value at-or-before each bar ts (no look-ahead)
function alignLatest(barTs: number[], series: { ts: number; val: number }[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) {
    while (j < series.length && series[j].ts <= barTs[i]) j++;
    out[i] = j > 0 ? series[j - 1].val : null;
  }
  return out;
}

// rolling z-score of a level series' LB-bar change (no look-ahead: stats use bars < i)
function zscoredDelta(level: (number | null)[], LB: number, ZW: number): (number | null)[] {
  const N = level.length;
  const d: (number | null)[] = new Array(N).fill(null);
  for (let i = LB; i < N; i++) {
    const a = level[i], b = level[i - LB];
    if (a != null && b != null && b !== 0) d[i] = (a - b) / Math.abs(b); // pct change
  }
  const z: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (d[i] == null) continue;
    const lo = Math.max(0, i - ZW);
    const win: number[] = [];
    for (let k = lo; k < i; k++) if (d[k] != null && isFinite(d[k]!)) win.push(d[k]!);
    if (win.length < 20) continue;
    const m = win.reduce((s, v) => s + v, 0) / win.length;
    const sd = Math.sqrt(win.reduce((s, v) => s + (v - m) * (v - m), 0) / win.length);
    if (sd > 0) z[i] = (d[i]! - m) / sd;
  }
  return z;
}

function fmt(v: number): string { return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN'; }
function fmt2(v: number): string { return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : 'NaN'; }
function stableRead(ic1: number, ic2: number): string {
  if (!isFinite(ic1) || !isFinite(ic2)) return '—';
  if (Math.sign(ic1) === Math.sign(ic2) && Math.abs(ic1) >= 0.05 && Math.abs(ic2) >= 0.05)
    return ic1 < 0 ? 'FADE (stable)' : 'FOLLOW (stable)';
  if (Math.sign(ic1) !== Math.sign(ic2) && (Math.abs(ic1) >= 0.05 || Math.abs(ic2) >= 0.05)) return 'flips IS<->OOS';
  return 'weak/none';
}

// ============ TRACK A: 4H aggregated OI momentum ============
async function trackA(pair: string) {
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');
  const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const barTs = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));
  const N = barTs.length;
  if (N < 200) { console.log(`  [A ${pair}] too few bars (${N})`); return null; }

  const oiRows = await query<any>(`SELECT ts, oi_close::text AS v FROM cg_oi_aggregated WHERE symbol=$1 ORDER BY ts`, [coin]);
  const oiSeries = oiRows.rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.v) })).filter((r: any) => isFinite(r.val));
  if (oiSeries.length < 200) { console.log(`  [A ${pair}] too little OI (${oiSeries.length})`); return null; }
  const aOi = alignLatest(barTs, oiSeries);

  const foRows = await query<any>(`SELECT ts, fr_close::text AS v FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const foSeries = foRows.rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.v) })).filter((r: any) => isFinite(r.val));
  const aFundOi = alignLatest(barTs, foSeries);

  // forward returns (K bars of 4H)
  const fwd = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) if (close[i] > 0) out[i] = (close[i + K] - close[i]) / close[i];
    return out;
  };
  const f12 = fwd(3), f24 = fwd(6), f48 = fwd(12);

  // trailing same-horizon price return (for lagged-momentum orthogonality)
  const trail = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = K; i < N; i++) if (close[i - K] > 0) out[i] = (close[i] - close[i - K]) / close[i - K];
    return out;
  };

  // funding_oi percentile (rolling 180-bar, the live fade reference)
  const PCTW = 180;
  const foPct: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (aFundOi[i] == null) continue;
    const lo = Math.max(0, i - PCTW);
    const win: number[] = [];
    for (let k = lo; k <= i; k++) if (aFundOi[k] != null) win.push(aFundOi[k]!);
    if (win.length < 30) continue;
    const below = win.filter(v => v < aFundOi[i]!).length;
    foPct[i] = below / win.length;
  }

  // signals: z-scored dOI at LB=3(12h) and LB=6(24h), z-window 180
  const ZW = 180;
  const zd12 = zscoredDelta(aOi, 3, ZW);
  const zd24 = zscoredDelta(aOi, 6, ZW);

  // IS/OOS split at midpoint of bars with OI
  const cgIdx = barTs.map((_, i) => i).filter(i => aOi[i] != null);
  const midTs = cgIdx.length ? barTs[cgIdx[Math.floor(cgIdx.length / 2)]] : barTs[Math.floor(N / 2)];
  const split = (arr: (number | null)[], half: 'IS' | 'OOS') =>
    arr.map((v, i) => ((half === 'IS' ? barTs[i] < midTs : barTs[i] >= midTs) ? v : null));

  const results: any[] = [];
  for (const [nm, sig, lbK] of [['zdOI_12h', zd12, 3], ['zdOI_24h', zd24, 6]] as [string, (number | null)[], number][]) {
    const isV = split(sig, 'IS'), oosV = split(sig, 'OOS');
    const row: any = { pair, signal: nm };
    row.ic_is = { h12: spearmanAligned(isV, f12), h24: spearmanAligned(isV, f24), h48: spearmanAligned(isV, f48) };
    row.ic_oos = { h12: spearmanAligned(oosV, f12), h24: spearmanAligned(oosV, f24), h48: spearmanAligned(oosV, f48) };
    row.q_is = quintileSpread(isV, f24); row.q_oos = quintileSpread(oosV, f24);
    // orthogonality (full sample): vs funding_oi pct & vs trailing return of matching horizon
    row.orth_fundOi = spearmanAligned(sig, foPct);
    row.orth_trail = spearmanAligned(sig, trail(lbK)); // trailing over the same lookback window
    results.push(row);
  }
  return { pair, midTs, nBars: cgIdx.length, results };
}

// ============ TRACK B: daily cross-exchange OI divergence ============
async function fetchPerExchange(coin: string): Promise<{ ts: number[]; price: number[]; venues: Record<string, (number | null)[]> } | null> {
  try {
    const r = await cgGet<any>('/futures/open-interest/exchange-history-chart', { symbol: coin, range: 'all' });
    const d = r.data;
    const tl: number[] = (d.time_list ?? []).map((t: any) => Number(t));
    const price: number[] = (d.price_list ?? []).map((p: any) => Number(p));
    const venues: Record<string, (number | null)[]> = {};
    for (const [ex, arr] of Object.entries(d.data_map ?? {})) {
      venues[ex] = (arr as any[]).map(v => (v == null || !isFinite(Number(v)) ? null : Number(v)));
    }
    return { ts: tl, price, venues };
  } catch (e: any) {
    console.log(`  [B ${coin}] fetch ERR ${(e?.message ?? String(e)).slice(0, 100)}`);
    return null;
  }
}

async function trackB(pair: string) {
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');
  const ex = await fetchPerExchange(coin);
  if (!ex) return null;
  const { ts, price, venues } = ex;
  const N = ts.length;
  if (N < 400) { console.log(`  [B ${pair}] too few daily bars (${N})`); return null; }

  // pick venues that are well-populated over the last ~half (recent OOS) AND overall
  const wellFilled: string[] = [];
  for (const [v, arr] of Object.entries(venues)) {
    const nonNull = arr.filter(x => x != null && x > 0).length;
    if (nonNull > N * 0.6) wellFilled.push(v);
  }
  if (wellFilled.length < 4) { console.log(`  [B ${pair}] only ${wellFilled.length} well-filled venues`); return null; }

  // per-venue z-scored daily dOI (LB=1 day, rolling 60-day z window)
  const ZW = 60;
  const venueZ: Record<string, (number | null)[]> = {};
  for (const v of wellFilled) venueZ[v] = zscoredDelta(venues[v], 1, ZW);

  // aggregated total OI (sum across well-filled venues) z-scored dOI (the "follow/fade" momentum at daily)
  const totalOi: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    let s = 0, ok = 0;
    for (const v of wellFilled) { const x = venues[v][i]; if (x != null && x > 0) { s += x; ok++; } }
    if (ok === wellFilled.length) totalOi[i] = s;
  }
  const aggZd = zscoredDelta(totalOi, 1, ZW);

  // divergence signal: for each bar, the venue z minus mean of other venues' z; take the MAX-abs venue
  // We test a continuous "dispersion-weighted lead" = (max venue z) - (mean of all venue z)
  const divLead: (number | null)[] = new Array(N).fill(null); // leading-venue building relative to pack
  for (let i = 0; i < N; i++) {
    const zs: number[] = [];
    for (const v of wellFilled) { const z = venueZ[v][i]; if (z != null && isFinite(z)) zs.push(z); }
    if (zs.length < wellFilled.length - 1) continue;
    const mean = zs.reduce((s, x) => s + x, 0) / zs.length;
    // leading venue = the one with max z; its excess over the pack mean = how concentrated the OI build is
    const maxZ = Math.max(...zs);
    divLead[i] = maxZ - mean; // always >=0; high = one venue building far ahead of pack
  }
  // signed divergence: leader excess times sign of aggregate momentum (build vs unwind)
  const divSigned: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (divLead[i] != null && aggZd[i] != null) divSigned[i] = divLead[i]! * Math.sign(aggZd[i]!);
  }

  // forward returns on daily price (1/3/7d)
  const fwd = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) if (price[i] > 0) out[i] = (price[i + K] - price[i]) / price[i];
    return out;
  };
  const trail = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = K; i < N; i++) if (price[i - K] > 0) out[i] = (price[i] - price[i - K]) / price[i - K];
    return out;
  };
  const f1 = fwd(1), f3 = fwd(3), f7 = fwd(7);

  // funding_oi pct on the daily grid (align the 4H funding series to daily ts)
  const foRows = await query<any>(`SELECT ts, fr_close::text AS v FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const foSeries = foRows.rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.v) })).filter((r: any) => isFinite(r.val));
  const aFundOi = alignLatest(ts, foSeries);
  const PCTW = 45;
  const foPct: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (aFundOi[i] == null) continue;
    const lo = Math.max(0, i - PCTW);
    const win: number[] = [];
    for (let k = lo; k <= i; k++) if (aFundOi[k] != null) win.push(aFundOi[k]!);
    if (win.length < 20) continue;
    foPct[i] = win.filter(v => v < aFundOi[i]!).length / win.length;
  }

  // IS/OOS split at midpoint of bars that have the divergence signal
  const sigIdx = ts.map((_, i) => i).filter(i => divSigned[i] != null);
  const midI = sigIdx.length ? sigIdx[Math.floor(sigIdx.length / 2)] : Math.floor(N / 2);
  const midTs = ts[midI];
  const split = (arr: (number | null)[], half: 'IS' | 'OOS') =>
    arr.map((v, i) => ((half === 'IS' ? ts[i] < midTs : ts[i] >= midTs) ? v : null));

  const results: any[] = [];
  for (const [nm, sig, isMom] of [
    ['agg_dOI_z (daily mom)', aggZd, true],
    ['divLead (max-mean z)', divLead, false],
    ['divSigned (lead*sign)', divSigned, false],
  ] as [string, (number | null)[], boolean][]) {
    const isV = split(sig, 'IS'), oosV = split(sig, 'OOS');
    const row: any = { pair, signal: nm };
    row.ic_is = { d1: spearmanAligned(isV, f1), d3: spearmanAligned(isV, f3), d7: spearmanAligned(isV, f7) };
    row.ic_oos = { d1: spearmanAligned(oosV, f1), d3: spearmanAligned(oosV, f3), d7: spearmanAligned(oosV, f7) };
    row.q_is = quintileSpread(isV, f3); row.q_oos = quintileSpread(oosV, f3);
    row.orth_fundOi = spearmanAligned(sig, foPct);
    row.orth_trail = spearmanAligned(sig, isMom ? trail(1) : trail(3));
    results.push(row);
  }
  return { pair, midTs, nBars: sigIdx.length, venues: wellFilled.length, results };
}

async function main() {
  const PAIRS = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT', 'ETHUSDT'];

  console.log('\n════════ TRACK A: aggregated OI MOMENTUM (4H, z-scored dOI) ════════');
  console.log('IC = Spearman(signal, fwd return). NEG=>fade (high mom precedes drop), POS=>follow.');
  console.log('Bar: same-sign BOTH halves & |IC|>=0.05 at a horizon. orth_fundOi/orth_trail near 0 => ORTHOGONAL.\n');
  const aAll: any[] = [];
  for (const p of PAIRS) {
    const a = await trackA(p);
    if (!a) continue;
    aAll.push(a);
    console.log(`── ${p}  (bars w/OI=${a.nBars}, IS<${new Date(a.midTs).toISOString().slice(0, 10)}<=OOS)`);
    console.log('  signal'.padEnd(14) + ' | IC IS  12h    24h    48h  | IC OOS 12h    24h    48h  | Q5-Q1 24h IS/OOS | orth_fOI orth_trail | read24h');
    for (const r of a.results) {
      const qis = r.q_is[4] - r.q_is[0], qoos = r.q_oos[4] - r.q_oos[0];
      console.log('  ' + r.signal.padEnd(12) +
        ' | ' + fmt(r.ic_is.h12) + ' ' + fmt(r.ic_is.h24) + ' ' + fmt(r.ic_is.h48) +
        ' | ' + fmt(r.ic_oos.h12) + ' ' + fmt(r.ic_oos.h24) + ' ' + fmt(r.ic_oos.h48) +
        ' | ' + fmt2(qis).padStart(6) + '/' + fmt2(qoos).padStart(6) +
        ' | ' + fmt(r.orth_fundOi) + ' ' + fmt(r.orth_trail) +
        ' | ' + stableRead(r.ic_is.h24, r.ic_oos.h24));
    }
  }

  console.log('\n════════ TRACK B: cross-exchange OI DIVERGENCE (DAILY, range=all) ════════');
  console.log('agg_dOI_z=daily OI momentum; divLead=leading-venue OI build vs pack; divSigned=lead*sign(agg mom).');
  console.log('IC vs fwd 1d/3d/7d. Bar: same-sign BOTH halves & |IC|>=0.05. orth near 0 => orthogonal.\n');
  const bAll: any[] = [];
  for (const p of PAIRS) {
    const b = await trackB(p);
    await new Promise(r => setTimeout(r, 350));
    if (!b) continue;
    bAll.push(b);
    console.log(`── ${p}  (daily bars w/sig=${b.nBars}, venues=${b.venues}, IS<${new Date(b.midTs).toISOString().slice(0, 10)}<=OOS)`);
    console.log('  signal'.padEnd(22) + ' | IC IS  1d     3d     7d   | IC OOS 1d     3d     7d   | Q5-Q1 3d IS/OOS | orth_fOI orth_trail | read3d');
    for (const r of b.results) {
      const qis = r.q_is[4] - r.q_is[0], qoos = r.q_oos[4] - r.q_oos[0];
      console.log('  ' + r.signal.padEnd(20) +
        ' | ' + fmt(r.ic_is.d1) + ' ' + fmt(r.ic_is.d3) + ' ' + fmt(r.ic_is.d7) +
        ' | ' + fmt(r.ic_oos.d1) + ' ' + fmt(r.ic_oos.d3) + ' ' + fmt(r.ic_oos.d7) +
        ' | ' + fmt2(qis).padStart(6) + '/' + fmt2(qoos).padStart(6) +
        ' | ' + fmt(r.orth_fundOi) + ' ' + fmt(r.orth_trail) +
        ' | ' + stableRead(r.ic_is.d3, r.ic_oos.d3));
    }
  }

  await closePg();
  process.exit(0);
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

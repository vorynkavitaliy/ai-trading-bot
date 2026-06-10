/**
 * Supply/liquidity-tide edge test (BTC, DAILY).
 *
 * Signals (all daily, slow):
 *   R1  = -dReserve_7d   : 7d change in total BTC exchange reserves, SIGN-FLIPPED so
 *                          falling reserves -> positive signal (archetype: supply squeeze bullish)
 *   R2  = -dReserve_14d
 *   R3  = reservePct      : 60d rolling percentile of reserve level, sign-flipped (low reserves bullish)
 *   S1  = dStable_7d / lvl : 7d % change in total stablecoin marketcap (rising = dry powder bullish)
 *   S2  = dStable_14d / lvl
 *   S3  = stablePct       : 60d rolling percentile of stablecoin mcap level (rising tide)
 *
 * Forward returns from BTC daily close (candles 1D): 3d / 7d / 14d log returns.
 * IS/OOS split at midpoint of the overlapping daily window.
 * Spearman IC per half + quintile spread (top-quintile mean fwd ret minus bottom).
 * Orthogonality: corr(best signal, funding_oi 60d pct) and corr(best signal, trailing same-horizon ret).
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY = 86400_000;

// ---- stats helpers ----
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
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }

function rollingPct(series: (number | null)[], idx: number, win: number): number | null {
  // percentile rank of series[idx] within trailing win values (inclusive), 0..1
  const lo = Math.max(0, idx - win + 1);
  const window: number[] = [];
  for (let i = lo; i <= idx; i++) { const v = series[i]; if (v != null && Number.isFinite(v)) window.push(v); }
  const cur = series[idx];
  if (cur == null || window.length < 10) return null;
  let below = 0; for (const v of window) if (v < cur) below++;
  return below / window.length;
}

function quintileSpread(sig: number[], fwd: number[]): { spread: number; topMean: number; botMean: number; monotone: boolean } {
  const pairs = sig.map((s, i) => [s, fwd[i]] as [number, number]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const qn = Math.floor(n / 5);
  if (qn < 3) return { spread: NaN, topMean: NaN, botMean: NaN, monotone: false };
  const means: number[] = [];
  for (let q = 0; q < 5; q++) {
    const lo = q === 0 ? 0 : q * qn;
    const hi = q === 4 ? n : (q + 1) * qn;
    let s = 0, c = 0; for (let i = lo; i < hi; i++) { s += pairs[i][1]; c++; }
    means.push(c ? s / c : NaN);
  }
  // monotone increasing across quintiles?
  let mono = true; for (let q = 1; q < 5; q++) if (means[q] < means[q - 1]) mono = false;
  let monoDec = true; for (let q = 1; q < 5; q++) if (means[q] > means[q - 1]) monoDec = false;
  return { spread: means[4] - means[0], topMean: means[4], botMean: means[0], monotone: mono || monoDec };
}

async function main() {
  // ---- fetch CG series ----
  const bal: any = await cgGet<any>('/exchange/balance/chart', { symbol: 'BTC' });
  const balTl = (bal.data.time_list as number[]).map(Number);
  const dataMap = bal.data.data_map as Record<string, (number | null)[]>;
  const exNames = Object.keys(dataMap);
  // total reserve per index = sum over all exchanges (treat null/NaN as 0)
  const reserveTotal: number[] = balTl.map((_, i) => {
    let s = 0; for (const ex of exNames) { const v = dataMap[ex][i]; if (typeof v === 'number' && Number.isFinite(v)) s += v; }
    return s;
  });

  const sc: any = await cgGet<any>('/index/stableCoin-marketCap-history', {});
  const scTl = (sc.data.time_list as number[]).map(Number);
  const scList = sc.data.data_list as Record<string, number>[];
  const stableTotal: number[] = scList.map(row => {
    let s = 0; for (const k of Object.keys(row)) { const v = row[k]; if (typeof v === 'number' && Number.isFinite(v)) s += v; }
    return s;
  });

  // ---- BTC daily candles ----
  const fromTs = Math.min(balTl[0], scTl[0]) - DAY;
  const c = await query<any>(
    `SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='1D' AND ts >= $1 ORDER BY ts ASC`, [fromTs]);
  const candTs = c.rows.map((r: any) => parseInt(r.ts, 10));
  const candClose = c.rows.map((r: any) => parseFloat(r.close));
  // map ts(day-floor) -> close
  const closeByDay = new Map<number, number>();
  for (let i = 0; i < candTs.length; i++) closeByDay.set(Math.floor(candTs[i] / DAY) * DAY, candClose[i]);
  function closeAt(dayTs: number): number | null {
    const v = closeByDay.get(Math.floor(dayTs / DAY) * DAY);
    return v == null ? null : v;
  }

  // ---- align to a common daily index using reserve timeline (the shorter, 673d) ----
  // round reserve ts to day floor
  const days = balTl.map(t => Math.floor(t / DAY) * DAY);
  // dedupe to one per day (last)
  const dayToResIdx = new Map<number, number>();
  for (let i = 0; i < days.length; i++) dayToResIdx.set(days[i], i);
  // stablecoin: map day -> total
  const stableByDay = new Map<number, number>();
  for (let i = 0; i < scTl.length; i++) stableByDay.set(Math.floor(scTl[i] / DAY) * DAY, stableTotal[i]);

  const uniqDays = Array.from(dayToResIdx.keys()).sort((a, b) => a - b);

  // Build aligned arrays
  interface Row { day: number; reserve: number; stable: number | null; close: number | null; }
  const rows: Row[] = [];
  for (const d of uniqDays) {
    const ri = dayToResIdx.get(d)!;
    rows.push({ day: d, reserve: reserveTotal[ri], stable: stableByDay.get(d) ?? null, close: closeAt(d) });
  }
  // require close present
  const usable = rows.filter(r => r.close != null);
  console.log(`aligned daily rows: ${rows.length}, with BTC close: ${usable.length}`);
  console.log(`range: ${new Date(usable[0].day).toISOString().slice(0,10)} .. ${new Date(usable[usable.length-1].day).toISOString().slice(0,10)}`);

  // reserve/stable series for percentile (over usable)
  const resSeries = usable.map(r => r.reserve);
  const stSeries = usable.map(r => (r.stable != null ? r.stable : null));

  // ---- funding_oi daily percentile (orthogonality) ----
  // pull funding fr_close for BTC, map to day (last per day)
  const f = await query<any>(`SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`, []);
  const fundByDay = new Map<number, number>();
  for (const r of f.rows) { const d = Math.floor(parseInt(r.ts,10)/DAY)*DAY; fundByDay.set(d, parseFloat(r.fr_close)); }
  const fundSeries: (number|null)[] = usable.map(r => fundByDay.get(r.day) ?? null);

  // ---- build signals + forward returns ----
  const N = usable.length;
  const horizons = [3, 7, 14];

  // signal builders return array aligned to usable index (NaN where undefined)
  function dReserveN(n: number): number[] {
    return usable.map((r, i) => i >= n ? -(resSeries[i] - resSeries[i - n]) : NaN); // sign-flip: falling reserve -> +
  }
  function dStableN(n: number): number[] {
    return usable.map((r, i) => {
      if (i < n) return NaN;
      const a = stSeries[i], b = stSeries[i - n];
      if (a == null || b == null || b === 0) return NaN;
      return (a - b) / b; // % change, rising = +
    });
  }
  function resPctFlip(): number[] {
    return usable.map((_, i) => { const p = rollingPct(resSeries, i, 60); return p == null ? NaN : -(p - 0.5); }); // low reserve pct -> +
  }
  function stPctSig(): number[] {
    return usable.map((_, i) => { const p = rollingPct(stSeries, i, 60); return p == null ? NaN : (p - 0.5); }); // high stable pct -> +
  }
  function fwdRet(h: number): number[] {
    return usable.map((r, i) => {
      if (i + h >= N) return NaN;
      const c0 = usable[i].close!, c1 = usable[i + h].close!;
      return Math.log(c1 / c0);
    });
  }
  function trailRet(h: number): number[] {
    return usable.map((r, i) => {
      if (i - h < 0) return NaN;
      const c0 = usable[i - h].close!, c1 = usable[i].close!;
      return Math.log(c1 / c0);
    });
  }
  function fundPct60(): number[] {
    return usable.map((_, i) => { const p = rollingPct(fundSeries, i, 60); return p == null ? NaN : p; });
  }

  const signals: Record<string, number[]> = {
    'R1 -dReserve7d': dReserveN(7),
    'R2 -dReserve14d': dReserveN(14),
    'R3 -reservePct60': resPctFlip(),
    'S1 dStable7d%': dStableN(7),
    'S2 dStable14d%': dStableN(14),
    'S3 stablePct60': stPctSig(),
  };

  const split = Math.floor(N / 2);
  console.log(`IS = idx[0..${split}) (${new Date(usable[0].day).toISOString().slice(0,10)}..${new Date(usable[split-1].day).toISOString().slice(0,10)}), OOS = idx[${split}..${N})\n`);

  function sub(arr: number[], lo: number, hi: number): number[] { return arr.slice(lo, hi); }
  function cleanPair(a: number[], b: number[]): [number[], number[]] {
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { x.push(a[i]); y.push(b[i]); }
    return [x, y];
  }

  console.log('signal'.padEnd(18), 'hor', 'IC_IS'.padEnd(9), 'IC_OOS'.padEnd(9), 'qSprd_IS'.padEnd(10), 'qSprd_OOS'.padEnd(10), 'sameSign', 'nIS/nOOS');
  const best: { key: string; h: number; icIS: number; icOOS: number; sig: number[]; same: boolean; absMin: number; qIS: any; qOOS: any }[] = [];
  for (const [name, sig] of Object.entries(signals)) {
    for (const h of horizons) {
      const fwd = fwdRet(h);
      const [aIS, bIS] = cleanPair(sub(sig, 0, split), sub(fwd, 0, split));
      const [aOOS, bOOS] = cleanPair(sub(sig, split, N), sub(fwd, split, N));
      const icIS = spearman(aIS, bIS);
      const icOOS = spearman(aOOS, bOOS);
      const qIS = quintileSpread(aIS, bIS);
      const qOOS = quintileSpread(aOOS, bOOS);
      const same = Number.isFinite(icIS) && Number.isFinite(icOOS) && Math.sign(icIS) === Math.sign(icOOS);
      console.log(
        name.padEnd(18), String(h).padEnd(3),
        (icIS).toFixed(4).padEnd(9), (icOOS).toFixed(4).padEnd(9),
        (qIS.spread).toFixed(4).padEnd(10), (qOOS.spread).toFixed(4).padEnd(10),
        String(same).padEnd(8), `${aIS.length}/${aOOS.length}`);
      best.push({ key: name, h, icIS, icOOS, sig, same, absMin: Math.min(Math.abs(icIS), Math.abs(icOOS)), qIS, qOOS });
    }
  }

  // ---- pick best by same-sign & min|IC| ----
  const robust = best.filter(b => b.same && Number.isFinite(b.icIS) && Number.isFinite(b.icOOS))
    .sort((a, b) => b.absMin - a.absMin);
  console.log('\n=== robust (same-sign both halves), sorted by min|IC| ===');
  for (const b of robust.slice(0, 6)) {
    console.log(`${b.key} h=${b.h}  IC_IS=${b.icIS.toFixed(4)} IC_OOS=${b.icOOS.toFixed(4)} min|IC|=${b.absMin.toFixed(4)} qSprdIS=${b.qIS.spread.toFixed(4)} qSprdOOS=${b.qOOS.spread.toFixed(4)} monoIS=${b.qIS.monotone} monoOOS=${b.qOOS.monotone}`);
  }

  // ---- orthogonality on the single best ----
  const top = robust[0];
  if (top) {
    const fp = fundPct60();
    const tr = trailRet(top.h);
    const [s1, f1] = cleanPair(top.sig, fp);
    const [s2, t1] = cleanPair(top.sig, tr);
    console.log(`\n=== ORTHOGONALITY of best: ${top.key} h=${top.h} ===`);
    console.log(`corr(signal, funding_oi 60d pct) Spearman = ${spearman(s1, f1).toFixed(4)} (n=${s1.length}, funding history limits overlap)`);
    console.log(`corr(signal, trailing ${top.h}d ret) Spearman = ${spearman(s2, t1).toFixed(4)} (n=${s2.length})  [<-- lagged-momentum check]`);
  } else {
    console.log('\nNo same-sign-both-halves signal found.');
  }

  process.exit(0);
}
main().catch(e => { console.error('ERR', e?.message ?? String(e)); console.error(e?.stack); process.exit(1); });

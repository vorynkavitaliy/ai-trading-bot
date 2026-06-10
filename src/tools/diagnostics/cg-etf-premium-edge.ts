/**
 * cg-etf-premium-edge — test whether ETF premium/discount LEVEL and AUM growth-rate
 * carry a real, OOS-robust, orthogonal edge on BTC forward returns.
 *
 * Signals tested (daily):
 *   A. premMean   — cross-ticker mean premium_discount_details (demand pressure / arb)
 *   B. premIBIT   — IBIT-only premium (dominant fund, cleanest coverage)
 *   C. aumGrowth1 — 1d AUM % growth rate
 *   D. aumGrowth5 — 5d AUM % growth rate
 *
 * Forward returns from project candles: aggregate 240m -> daily UTC close, horizons 1d/3d/7d.
 * IS/OOS split at midpoint of each signal's available aligned history.
 * Metrics: Spearman IC (signal vs fwd ret) per half + per horizon; quintile spread (Q5-Q1)
 *   per half. Direction tested both follow (sign+) and fade (sign-) — reported via IC sign.
 * Orthogonality: corr(best signal, funding_oi pct over same horizon window) and
 *   corr(best signal, trailing same-horizon price return) on the overlap.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/cg-etf-premium-edge.ts
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { query } from '../../core/db';

const DAY = 86400000;

// ---------- stats ----------
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
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }

// quintile spread: mean fwd ret of top quintile (by signal) minus bottom quintile
function quintileSpread(sig: number[], ret: number[]): { spread: number; q1: number; q5: number; n: number } {
  const pairs = sig.map((s, i) => [s, ret[i]] as [number, number]).filter(p => isFinite(p[0]) && isFinite(p[1]));
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  if (n < 25) return { spread: NaN, q1: NaN, q5: NaN, n };
  const q = Math.floor(n / 5);
  const bottom = pairs.slice(0, q).map(p => p[1]);
  const top = pairs.slice(n - q).map(p => p[1]);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const q1 = mean(bottom), q5 = mean(top);
  return { spread: q5 - q1, q1, q5, n };
}

function utcDayKey(ms: number): number { return Math.floor(ms / DAY) * DAY; }

// ---------- build daily close series from 240m candles ----------
async function buildDailyClose(symbol: string): Promise<Map<number, number>> {
  const bars = await loadBars(symbol, '240m', { fromTs: Date.UTC(2024, 0, 1), toTs: Date.now() });
  // daily UTC close = the close of the last 240m bar whose ts is within that UTC day
  const byDay = new Map<number, { ts: number; close: number }>();
  for (const b of bars) {
    const dk = utcDayKey(b.ts);
    const prev = byDay.get(dk);
    if (!prev || b.ts > prev.ts) byDay.set(dk, { ts: b.ts, close: b.close });
  }
  const out = new Map<number, number>();
  for (const [dk, v] of byDay) out.set(dk, v.close);
  return out;
}

// fwd return over h days from day d: close[d+h]/close[d]-1
function fwdRet(dailyClose: Map<number, number>, dayKey: number, h: number): number | null {
  const c0 = dailyClose.get(dayKey);
  const c1 = dailyClose.get(dayKey + h * DAY);
  if (c0 == null || c1 == null || c0 === 0) return null;
  return c1 / c0 - 1;
}
function trailRet(dailyClose: Map<number, number>, dayKey: number, h: number): number | null {
  const c0 = dailyClose.get(dayKey - h * DAY);
  const c1 = dailyClose.get(dayKey);
  if (c0 == null || c1 == null || c0 === 0) return null;
  return c1 / c0 - 1;
}

// ---------- fetch + align CG signals ----------
interface DailySignals { dayKey: number; premMean: number | null; premIBIT: number | null; aum: number | null; }

async function fetchSignals(): Promise<DailySignals[]> {
  const pd: any = await cgGet<any>('/etf/bitcoin/premium-discount/history', {});
  const pdRows = pd.data as Array<{ timestamp: number; list: Array<{ ticker: string; premium_discount_details: number }> }>;
  const aum: any = await cgGet<any>('/etf/bitcoin/aum', {});
  const aumRows = (aum.data as Array<{ time: number; aum_usd: number }>).filter(r => r.aum_usd && r.aum_usd > 0);

  const premByDay = new Map<number, { mean: number | null; ibit: number | null }>();
  for (const row of pdRows) {
    const dk = utcDayKey(row.timestamp);
    const vals: number[] = [];
    let ibit: number | null = null;
    for (const e of (row.list || [])) {
      if (typeof e.premium_discount_details === 'number' && isFinite(e.premium_discount_details)) {
        vals.push(e.premium_discount_details);
        if (e.ticker === 'IBIT') ibit = e.premium_discount_details;
      }
    }
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    premByDay.set(dk, { mean, ibit });
  }
  const aumByDay = new Map<number, number>();
  for (const r of aumRows) aumByDay.set(utcDayKey(r.time), r.aum_usd);

  // union of all day keys
  const keys = new Set<number>([...premByDay.keys(), ...aumByDay.keys()]);
  const out: DailySignals[] = [];
  for (const dk of [...keys].sort((a, b) => a - b)) {
    const p = premByDay.get(dk);
    out.push({ dayKey: dk, premMean: p?.mean ?? null, premIBIT: p?.ibit ?? null, aum: aumByDay.get(dk) ?? null });
  }
  return out;
}

// ---------- funding_oi percentile (orthogonality fade reference) ----------
async function fundingOiPctByDay(): Promise<Map<number, number>> {
  // pull 4h fr_close, compute rolling 180-bar (30d) percentile of current vs window, key by UTC day (last bar of day)
  const r = await query<any>(
    `SELECT ts::text AS ts, fr_close::text AS fr FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`);
  const rows = r.rows.map((x: any) => ({ ts: parseInt(x.ts, 10), fr: parseFloat(x.fr) }));
  const out = new Map<number, number>();
  const W = 180;
  for (let i = 0; i < rows.length; i++) {
    if (i < W) continue;
    const window = rows.slice(i - W, i).map(x => x.fr);
    const cur = rows[i].fr;
    const below = window.filter(v => v <= cur).length;
    const pct = below / window.length; // 0..1
    out.set(utcDayKey(rows[i].ts), pct); // last write per day = latest bar of day
  }
  return out;
}

interface ICResult { horizon: string; signal: string; n: number; icIS: number; icOOS: number; spIS: number; spOOS: number; nIS: number; nOOS: number; }

async function main() {
  console.log('=== ETF premium/discount + AUM growth edge test ===\n');
  const dailyClose = await buildDailyClose('BTCUSDT');
  console.log(`daily close days=${dailyClose.size} range=${new Date(Math.min(...dailyClose.keys())).toISOString().slice(0,10)}..${new Date(Math.max(...dailyClose.keys())).toISOString().slice(0,10)}`);

  const sigs = await fetchSignals();
  console.log(`signal days=${sigs.length} range=${new Date(sigs[0].dayKey).toISOString().slice(0,10)}..${new Date(sigs[sigs.length-1].dayKey).toISOString().slice(0,10)}`);

  // AUM growth rates (aligned to day keys, using prior available AUM value)
  // build a sorted aum array for growth
  const aumSeries = sigs.filter(s => s.aum != null).map(s => ({ dk: s.dayKey, aum: s.aum! }));
  const aumIdx = new Map<number, number>();
  aumSeries.forEach((v, i) => aumIdx.set(v.dk, i));
  function aumGrowth(dk: number, lag: number): number | null {
    const i = aumIdx.get(dk);
    if (i == null || i - lag < 0) return null;
    const a0 = aumSeries[i - lag].aum, a1 = aumSeries[i].aum;
    if (!a0) return null;
    return a1 / a0 - 1;
  }

  const horizons = [1, 3, 7];
  type SigName = 'premMean' | 'premIBIT' | 'aumGrowth1' | 'aumGrowth5';
  const sigNames: SigName[] = ['premMean', 'premIBIT', 'aumGrowth1', 'aumGrowth5'];

  function sigValue(s: DailySignals, name: SigName): number | null {
    switch (name) {
      case 'premMean': return s.premMean;
      case 'premIBIT': return s.premIBIT;
      case 'aumGrowth1': return aumGrowth(s.dayKey, 1);
      case 'aumGrowth5': return aumGrowth(s.dayKey, 5);
    }
  }

  const results: ICResult[] = [];
  // store the best signal arrays for orthogonality
  const allSeries: Record<string, { dk: number; sig: number }[]> = {};

  for (const name of sigNames) {
    for (const h of horizons) {
      const pairs: { dk: number; sig: number; ret: number }[] = [];
      for (const s of sigs) {
        const v = sigValue(s, name);
        if (v == null || !isFinite(v)) continue;
        const fr = fwdRet(dailyClose, s.dayKey, h);
        if (fr == null) continue;
        pairs.push({ dk: s.dayKey, sig: v, ret: fr });
      }
      if (pairs.length < 40) {
        results.push({ horizon: `${h}d`, signal: name, n: pairs.length, icIS: NaN, icOOS: NaN, spIS: NaN, spOOS: NaN, nIS: 0, nOOS: 0 });
        continue;
      }
      pairs.sort((a, b) => a.dk - b.dk);
      const mid = Math.floor(pairs.length / 2);
      const isP = pairs.slice(0, mid), oosP = pairs.slice(mid);
      const icIS = spearman(isP.map(p => p.sig), isP.map(p => p.ret));
      const icOOS = spearman(oosP.map(p => p.sig), oosP.map(p => p.ret));
      const spIS = quintileSpread(isP.map(p => p.sig), isP.map(p => p.ret)).spread;
      const spOOS = quintileSpread(oosP.map(p => p.sig), oosP.map(p => p.ret)).spread;
      results.push({ horizon: `${h}d`, signal: name, n: pairs.length, icIS, icOOS, spIS, spOOS, nIS: isP.length, nOOS: oosP.length });
      if (h === 1) allSeries[name] = pairs.map(p => ({ dk: p.dk, sig: p.sig }));
    }
  }

  console.log('\n=== Spearman IC + quintile spread (IS=older half, OOS=recent half) ===');
  console.log('signal'.padEnd(12), 'hz'.padEnd(4), 'n'.padEnd(5), 'icIS'.padEnd(9), 'icOOS'.padEnd(9), 'spreadIS'.padEnd(11), 'spreadOOS'.padEnd(11), 'nIS/nOOS');
  for (const r of results) {
    const f = (x: number) => isFinite(x) ? x.toFixed(4) : 'NA';
    const fp = (x: number) => isFinite(x) ? (x * 100).toFixed(2) + '%' : 'NA';
    console.log(
      r.signal.padEnd(12), r.horizon.padEnd(4), String(r.n).padEnd(5),
      f(r.icIS).padEnd(9), f(r.icOOS).padEnd(9), fp(r.spIS).padEnd(11), fp(r.spOOS).padEnd(11),
      `${r.nIS}/${r.nOOS}`);
  }

  // ---- pick best by min(|icIS|,|icOOS|) with same sign on both halves ----
  let best: ICResult | null = null;
  for (const r of results) {
    if (!isFinite(r.icIS) || !isFinite(r.icOOS)) continue;
    const sameSign = Math.sign(r.icIS) === Math.sign(r.icOOS);
    const minAbs = Math.min(Math.abs(r.icIS), Math.abs(r.icOOS));
    const score = (sameSign ? 1 : 0) * 1000 + minAbs;
    const prevScore = best ? ((Math.sign(best.icIS) === Math.sign(best.icOOS) ? 1 : 0) * 1000 + Math.min(Math.abs(best.icIS), Math.abs(best.icOOS))) : -1;
    if (score > prevScore) best = r;
  }
  console.log('\n=== Best candidate ===');
  if (best) {
    const sameSign = Math.sign(best.icIS) === Math.sign(best.icOOS);
    console.log(`${best.signal} @ ${best.horizon}: icIS=${best.icIS.toFixed(4)} icOOS=${best.icOOS.toFixed(4)} sameSign=${sameSign} dir=${best.icIS < 0 ? 'FADE(neg IC)' : 'FOLLOW(pos IC)'}`);
  } else {
    console.log('no finite-IC candidate');
  }

  // ---- Orthogonality on the best signal (1d series) ----
  if (best && allSeries[best.signal]) {
    const series = allSeries[best.signal]; // {dk,sig}
    // vs funding_oi percentile (overlap days only)
    const foi = await fundingOiPctByDay();
    const oa: number[] = [], ob: number[] = [];
    for (const s of series) { const f = foi.get(s.dk); if (f != null) { oa.push(s.sig); ob.push(f); } }
    const corrFoi = pearson(oa, ob);
    const corrFoiSp = spearman(oa, ob);
    // vs trailing same-horizon (1d) price return
    const ta: number[] = [], tb: number[] = [];
    for (const s of series) { const tr = trailRet(dailyClose, s.dk, 1); if (tr != null) { ta.push(s.sig); tb.push(tr); } }
    const corrTrail = pearson(ta, tb);
    const corrTrailSp = spearman(ta, tb);
    // also trailing 3d & 7d for the lagged-momentum check
    const trail3: { a: number[]; b: number[] } = { a: [], b: [] };
    const trail7: { a: number[]; b: number[] } = { a: [], b: [] };
    for (const s of series) {
      const t3 = trailRet(dailyClose, s.dk, 3); if (t3 != null) { trail3.a.push(s.sig); trail3.b.push(t3); }
      const t7 = trailRet(dailyClose, s.dk, 7); if (t7 != null) { trail7.a.push(s.sig); trail7.b.push(t7); }
    }
    console.log('\n=== Orthogonality of best signal ===');
    console.log(`vs funding_oi pct: pearson=${isFinite(corrFoi)?corrFoi.toFixed(4):'NA'} spearman=${isFinite(corrFoiSp)?corrFoiSp.toFixed(4):'NA'} (n=${oa.length} overlap days)`);
    console.log(`vs trailing 1d ret: pearson=${corrTrail.toFixed(4)} spearman=${corrTrailSp.toFixed(4)} (n=${ta.length})`);
    console.log(`vs trailing 3d ret: pearson=${pearson(trail3.a,trail3.b).toFixed(4)} (n=${trail3.a.length})`);
    console.log(`vs trailing 7d ret: pearson=${pearson(trail7.a,trail7.b).toFixed(4)} (n=${trail7.a.length})`);
  }

  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

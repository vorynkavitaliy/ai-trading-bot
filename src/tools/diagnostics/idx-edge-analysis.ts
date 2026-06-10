/**
 * idx-edge-analysis — does the CG proprietary index family (Whale Index, CGDI,
 * CDRI) carry a real, OOS-robust, ORTHOGONAL edge vs BTC forward return?
 *
 * Read-only. Fetches the three indices live from CG (verified v4 paths), loads
 * BTC daily candles from our own DB for forward returns, splits IS/OOS at the
 * midpoint of the common-overlap window, and computes:
 *   - Spearman IC (signal vs fwd return) at 1d / 3d / 7d, both halves
 *   - Monotone quintile spread (Q5 - Q1 mean fwd return), both halves
 *   - Orthogonality: corr(best signal, BTC funding_oi 30d-percentile) and
 *     corr(best signal, trailing same-horizon return)
 *
 * Signals tested per index: LEVEL (raw value, z-scored over rolling 60d) and
 * DELTA (1d change). Daily data -> daily horizons per the brief.
 *
 * Run: npx tsx src/tools/diagnostics/idx-edge-analysis.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

// ---------- stats helpers ----------
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // average rank (1-based)
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}
function spearman(a: number[], b: number[]): number {
  return pearson(rank(a), rank(b));
}
function quintileSpread(sig: number[], fwd: number[]): { q1: number; q5: number; spread: number; mono: boolean } {
  const pairs = sig.map((s, i) => [s, fwd[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const bins: number[][] = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    const q = Math.min(4, Math.floor((i / n) * 5));
    bins[q].push(pairs[i][1]);
  }
  const means = bins.map(b => b.length ? b.reduce((x, y) => x + y, 0) / b.length : NaN);
  // monotone if strictly increasing or strictly decreasing across quintiles
  let inc = true, dec = true;
  for (let q = 1; q < 5; q++) {
    if (!(means[q] > means[q - 1])) inc = false;
    if (!(means[q] < means[q - 1])) dec = false;
  }
  return { q1: means[0], q5: means[4], spread: means[4] - means[0], mono: inc || dec };
}

// ---------- data fetch ----------
interface IdxRow { time: number; value: number; }
async function fetchIndex(path: string, params: Record<string, any>, valKey: string): Promise<IdxRow[]> {
  const r = await cgGet<any>(path, params);
  const data = r.data as any[];
  return data
    .map(d => ({ time: typeof d.time === 'string' ? parseInt(d.time, 10) : d.time, value: Number(d[valKey]) }))
    .filter(d => Number.isFinite(d.time) && Number.isFinite(d.value))
    .sort((a, b) => a.time - b.time);
}

// snap a ms timestamp to UTC day start
function dayKey(ms: number): number {
  return Math.floor(ms / 86400000) * 86400000;
}

async function loadBtcDaily(): Promise<Map<number, number>> {
  // use 1D candles (close), keyed by UTC day start
  const r = await query<any>(
    `SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='1D' ORDER BY ts ASC`,
  );
  const m = new Map<number, number>();
  for (const row of r.rows) m.set(dayKey(parseInt(row.ts, 10)), parseFloat(row.close));
  return m;
}

async function loadFundingOiDaily(): Promise<Map<number, number>> {
  // BTC funding_oi_weighted close; collapse to daily (last value of the day)
  const r = await query<any>(
    `SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`,
  );
  const m = new Map<number, number>();
  for (const row of r.rows) m.set(dayKey(parseInt(row.ts, 10)), parseFloat(row.fr_close));
  return m;
}

// rolling percentile of x[i] within trailing window (inclusive), returns 0..1
function rollingPct(xs: number[], win: number): number[] {
  const out = new Array(xs.length).fill(NaN);
  for (let i = 0; i < xs.length; i++) {
    const lo = Math.max(0, i - win + 1);
    const w = xs.slice(lo, i + 1);
    const cur = xs[i];
    let le = 0;
    for (const v of w) if (v <= cur) le++;
    out[i] = le / w.length;
  }
  return out;
}
// rolling z-score
function rollingZ(xs: number[], win: number): number[] {
  const out = new Array(xs.length).fill(NaN);
  for (let i = 0; i < xs.length; i++) {
    const lo = Math.max(0, i - win + 1);
    const w = xs.slice(lo, i + 1);
    if (w.length < 5) { out[i] = NaN; continue; }
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) * (b - m), 0) / w.length);
    out[i] = sd === 0 ? 0 : (xs[i] - m) / sd;
  }
  return out;
}

interface Aligned {
  days: number[];        // UTC day starts (signal day)
  price: number[];       // BTC close on that day
  funding: number[];     // BTC funding_oi close that day (may be NaN if missing)
}

function buildAligned(idx: IdxRow[], price: Map<number, number>, funding: Map<number, number>): { days: number[]; idxVal: number[]; price: number[]; funding: number[] } {
  // collapse index to daily (last value of day)
  const byDay = new Map<number, number>();
  for (const r of idx) byDay.set(dayKey(r.time), r.value);
  const days: number[] = [];
  const idxVal: number[] = [];
  const px: number[] = [];
  const fnd: number[] = [];
  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);
  for (const d of sortedDays) {
    const p = price.get(d);
    if (p === undefined) continue; // need price for fwd return
    days.push(d);
    idxVal.push(byDay.get(d)!);
    px.push(p);
    fnd.push(funding.has(d) ? funding.get(d)! : NaN);
  }
  return { days, idxVal, price: px, funding: fnd };
}

function fwdReturn(price: number[], h: number): number[] {
  const out = new Array(price.length).fill(NaN);
  for (let i = 0; i + h < price.length; i++) out[i] = price[i + h] / price[i] - 1;
  return out;
}
function trailingReturn(price: number[], h: number): number[] {
  const out = new Array(price.length).fill(NaN);
  for (let i = h; i < price.length; i++) out[i] = price[i] / price[i - h] - 1;
  return out;
}

interface ICResult { signal: string; h: number; icIS: number; icOOS: number; nIS: number; nOOS: number; spreadIS: number; spreadOOS: number; monoIS: boolean; monoOOS: boolean; }

function clean(sig: number[], fwd: number[], mask: boolean[]): { s: number[]; f: number[] } {
  const s: number[] = [], f: number[] = [];
  for (let i = 0; i < sig.length; i++) {
    if (mask[i] && Number.isFinite(sig[i]) && Number.isFinite(fwd[i])) { s.push(sig[i]); f.push(fwd[i]); }
  }
  return { s, f };
}

const HORIZONS = [1, 3, 7];
const ROLL = 60; // 60d rolling for z / pct

async function analyzeIndex(name: string, idx: IdxRow[], price: Map<number, number>, funding: Map<number, number>): Promise<{ rows: ICResult[]; orth: any }> {
  const al = buildAligned(idx, price, funding);
  const n = al.days.length;
  console.log(`\n### ${name} — aligned daily rows with price: ${n}  (${new Date(al.days[0]).toISOString().slice(0,10)} .. ${new Date(al.days[n-1]).toISOString().slice(0,10)})`);

  // signals
  const level = al.idxVal.slice();
  const z = rollingZ(al.idxVal, ROLL);
  const pct = rollingPct(al.idxVal, ROLL);
  const delta = al.idxVal.map((v, i) => i === 0 ? NaN : v - al.idxVal[i - 1]);
  const signals: Record<string, number[]> = { level, z60: z, pct60: pct, delta1d: delta };

  // IS/OOS split at midpoint of rows
  const mid = Math.floor(n / 2);
  const isMask = al.days.map((_, i) => i < mid);
  const oosMask = al.days.map((_, i) => i >= mid);
  console.log(`     IS rows 0..${mid-1}  (${new Date(al.days[0]).toISOString().slice(0,10)} .. ${new Date(al.days[mid-1]).toISOString().slice(0,10)})`);
  console.log(`     OOS rows ${mid}..${n-1} (${new Date(al.days[mid]).toISOString().slice(0,10)} .. ${new Date(al.days[n-1]).toISOString().slice(0,10)})`);

  const results: ICResult[] = [];
  for (const [sname, sig] of Object.entries(signals)) {
    for (const h of HORIZONS) {
      const fwd = fwdReturn(al.price, h);
      const ci = clean(sig, fwd, isMask);
      const co = clean(sig, fwd, oosMask);
      const icIS = spearman(ci.s, ci.f);
      const icOOS = spearman(co.s, co.f);
      const qi = ci.s.length >= 25 ? quintileSpread(ci.s, ci.f) : { spread: NaN, mono: false } as any;
      const qo = co.s.length >= 25 ? quintileSpread(co.s, co.f) : { spread: NaN, mono: false } as any;
      results.push({ signal: sname, h, icIS, icOOS, nIS: ci.s.length, nOOS: co.s.length, spreadIS: qi.spread, spreadOOS: qo.spread, monoIS: qi.mono, monoOOS: qo.mono });
    }
  }

  // print
  console.log(`     ${'signal'.padEnd(9)} ${'h'.padStart(2)}  ${'IC_IS'.padStart(7)} ${'IC_OOS'.padStart(7)}  ${'sprdIS'.padStart(8)} ${'sprdOOS'.padStart(8)}  mono  same-sign&>=.05`);
  for (const r of results) {
    const sameSign = Number.isFinite(r.icIS) && Number.isFinite(r.icOOS) && Math.sign(r.icIS) === Math.sign(r.icOOS) && Math.abs(r.icIS) >= 0.05 && Math.abs(r.icOOS) >= 0.05;
    const fmt = (x: number) => Number.isFinite(x) ? x.toFixed(3) : '  NaN';
    const fmtp = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(2) + '%' : 'NaN';
    console.log(`     ${r.signal.padEnd(9)} ${String(r.h).padStart(2)}  ${fmt(r.icIS).padStart(7)} ${fmt(r.icOOS).padStart(7)}  ${fmtp(r.spreadIS).padStart(8)} ${fmtp(r.spreadOOS).padStart(8)}  ${(r.monoIS && r.monoOOS) ? 'Y' : ' '}     ${sameSign ? 'PASS' : ''}`);
  }

  // orthogonality vs funding_oi percentile + trailing return — use the strongest
  // (max |min(|icIS|,|icOOS|)|, same-sign) signal+horizon.
  let best: ICResult | null = null;
  for (const r of results) {
    if (!(Number.isFinite(r.icIS) && Number.isFinite(r.icOOS))) continue;
    if (Math.sign(r.icIS) !== Math.sign(r.icOOS)) continue;
    const strength = Math.min(Math.abs(r.icIS), Math.abs(r.icOOS));
    if (!best || strength > Math.min(Math.abs(best.icIS), Math.abs(best.icOOS))) best = r;
  }
  let orth: any = { best: null };
  if (best) {
    const sig = signals[best.signal];
    // funding percentile (30d rolling) aligned
    const fpct = rollingPct(al.funding.map(v => Number.isFinite(v) ? v : NaN), 30);
    // need to handle NaNs in funding: build masked arrays
    const trail = trailingReturn(al.price, best.h);
    const sA: number[] = [], fA: number[] = [], tA: number[] = [];
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(sig[i]) && Number.isFinite(fpct[i]) && Number.isFinite(al.funding[i])) { sA.push(sig[i]); fA.push(fpct[i]); }
    }
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(sig[i]) && Number.isFinite(trail[i])) { tA.push(0); } // placeholder, recompute below
    }
    // recompute trailing corr cleanly
    const sT: number[] = [], tT: number[] = [];
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(sig[i]) && Number.isFinite(trail[i])) { sT.push(sig[i]); tT.push(trail[i]); }
    }
    const corrFunding = sA.length >= 10 ? spearman(sA, fA) : NaN;
    const corrTrail = sT.length >= 10 ? spearman(sT, tT) : NaN;
    orth = { best: `${best.signal}@${best.h}d`, icIS: best.icIS, icOOS: best.icOOS, corrFunding, nFunding: sA.length, corrTrail, nTrail: sT.length };
    console.log(`     BEST same-sign signal: ${best.signal}@${best.h}d  IC_IS=${best.icIS.toFixed(3)} IC_OOS=${best.icOOS.toFixed(3)}`);
    console.log(`       orthogonality: corr(signal, BTC funding_oi 30d-pct)=${Number.isFinite(corrFunding)?corrFunding.toFixed(3):'NaN'} (n=${sA.length})   corr(signal, trailing ${best.h}d return)=${Number.isFinite(corrTrail)?corrTrail.toFixed(3):'NaN'} (n=${sT.length})`);
  } else {
    console.log(`     no same-sign signal across IS/OOS — orthogonality moot`);
  }

  return { rows: results, orth };
}

async function main() {
  console.log('\n========== CG INDEX FAMILY EDGE ANALYSIS (BTC daily fwd returns) ==========');
  const price = await loadBtcDaily();
  const funding = await loadFundingOiDaily();
  console.log(`BTC daily candles: ${price.size}   BTC funding_oi daily points: ${funding.size}`);

  const cgdi = await fetchIndex('/futures/cgdi-index/history', { interval: '1d', limit: 1000 }, 'cgdi_index_value');
  const cdri = await fetchIndex('/futures/cdri-index/history', { interval: '1d', limit: 1000 }, 'cdri_index_value');
  const whale = await fetchIndex('/futures/whale-index/history', { exchange: 'Binance', symbol: 'BTCUSDT', interval: '1d', limit: 1000 }, 'whale_index_value');
  console.log(`fetched: CGDI ${cgdi.length}, CDRI ${cdri.length}, Whale ${whale.length}`);

  await analyzeIndex('CGDI (cgdi_index_value)', cgdi, price, funding);
  await analyzeIndex('CDRI (cdri_index_value)', cdri, price, funding);
  await analyzeIndex('Whale Index (BTC Binance)', whale, price, funding);

  console.log('\n========== done ==========');
  process.exit(0);
}
main().catch(e => { console.error('CRASH', e?.message ?? e, e?.stack); process.exit(1); });

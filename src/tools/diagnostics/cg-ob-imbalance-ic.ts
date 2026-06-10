/**
 * cg-ob-imbalance-ic — IC study of order-book DEPTH IMBALANCE (±5% bids vs asks,
 * cg_orderbook_pair, 4h) against forward price returns, with IS/OOS split and
 * orthogonality checks. Read-only research.
 *
 * Signal variants (per 4h bar, per pair):
 *   imb       = (bids_usd - asks_usd)/(bids_usd + asks_usd)        [-1..1]
 *   imb_pct   = rolling percentile of imb over last 180 bars       [0..1]  (mirrors live fade)
 *   imb_z     = rolling z-score of imb over last 180 bars
 *   qty_imb   = (bids_qty - asks_qty)/(bids_qty + asks_qty)
 *
 * Horizons (4h granularity): 12h (3 bars), 24h (6), 48h (12).
 * Forward return = (close[t+h] - close[t]) / close[t].
 *
 * Direction tested = FOLLOW (more bid depth -> bullish). IC sign tells the real
 * direction; we report it. A negative IC means depth imbalance FADES (walls are
 * spoof/absorbed). Either is fine if same-sign on BOTH halves and |IC|>=0.05.
 *
 * Orthogonality:
 *   - corr(signal, funding_oi_pct)   [live fade overlap]
 *   - corr(signal, trailing_ret_h)   [lagged-momentum repackaging]
 *
 * Run: npx tsx src/tools/diagnostics/cg-ob-imbalance-ic.ts
 */
import { query, close } from '../../core/db';

const WINDOW = 180;             // rolling window for pct/z (30d at 4h)
const HORIZONS = [3, 6, 12];    // bars => 12h,24h,48h
const HLABEL: Record<number, string> = { 3: '12h', 6: '24h', 12: '48h' };

// pair -> funding_oi coin symbol
const PAIRS: { pair: string; coin: string }[] = [
  { pair: 'BTCUSDT', coin: 'BTC' },
  { pair: 'SOLUSDT', coin: 'SOL' },
  { pair: 'ETHUSDT', coin: 'ETH' },
  { pair: 'XRPUSDT', coin: 'XRP' },
  { pair: 'LTCUSDT', coin: 'LTC' },
  { pair: 'ARBUSDT', coin: 'ARB' },
  { pair: 'INJUSDT', coin: 'INJ' },
  { pair: 'ATOMUSDT', coin: 'ATOM' },
  { pair: 'BNBUSDT', coin: 'BNB' },
  { pair: 'LINKUSDT', coin: 'LINK' },
  { pair: 'ADAUSDT', coin: 'ADA' },
  { pair: 'DOGEUSDT', coin: 'DOGE' },
  { pair: 'TAOUSDT', coin: 'TAO' },
];

interface Row {
  ts: number;
  imb: number; qtyImb: number;
  imbPct: number; imbZ: number;
  fwd: Record<number, number | null>;     // forward return per horizon
  trail: Record<number, number | null>;   // trailing return per horizon (for orthogonality)
  fundPct: number | null;                 // funding_oi rolling percentile
  pair: string;
}

function spearman(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 10) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  return pearson(rx, ry);
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]; }
  const cov = sxy - sx * sy / n;
  const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
  if (vx <= 0 || vy <= 0) return NaN;
  return cov / Math.sqrt(vx * vy);
}

function rollingPct(arr: number[], i: number, win: number): number {
  const lo = Math.max(0, i - win + 1);
  const cur = arr[i];
  let le = 0, n = 0;
  for (let k = lo; k <= i; k++) { n++; if (arr[k] <= cur) le++; }
  return n > 1 ? le / n : 0.5;
}

function rollingZ(arr: number[], i: number, win: number): number {
  const lo = Math.max(0, i - win + 1);
  let s = 0, n = 0;
  for (let k = lo; k <= i; k++) { s += arr[k]; n++; }
  const m = s / n;
  let v = 0;
  for (let k = lo; k <= i; k++) v += (arr[k] - m) ** 2;
  const sd = Math.sqrt(v / Math.max(1, n - 1));
  return sd > 0 ? (arr[i] - m) / sd : 0;
}

// quintile spread: mean(fwd | top quintile of signal) - mean(fwd | bottom quintile)
function quintileSpread(sig: number[], fwd: number[]): { spread: number; q: number[] } {
  const pairs = sig.map((s, i) => [s, fwd[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const qn = Math.floor(n / 5);
  if (qn < 5) return { spread: NaN, q: [] };
  const means: number[] = [];
  for (let qi = 0; qi < 5; qi++) {
    const lo = qi * qn, hi = qi === 4 ? n : (qi + 1) * qn;
    let s = 0; for (let k = lo; k < hi; k++) s += pairs[k][1];
    means.push(s / (hi - lo));
  }
  return { spread: means[4] - means[0], q: means };
}

async function loadPair(pair: string, coin: string): Promise<Row[]> {
  const ob = await query<any>(
    `SELECT ts, bids_usd::float8 b, asks_usd::float8 a, bids_qty::float8 bq, asks_qty::float8 aq
     FROM cg_orderbook_pair WHERE pair=$1 ORDER BY ts ASC`, [pair]);
  const cd = await query<any>(
    `SELECT ts, close::float8 c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const fo = await query<any>(
    `SELECT ts, fr_close::float8 f FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts ASC`, [coin]);

  const cMap = new Map<number, number>();
  for (const r of cd.rows) cMap.set(Number(r.ts), r.c);
  const foArr: { ts: number; f: number }[] = fo.rows.map((r: any) => ({ ts: Number(r.ts), f: r.f }));
  const foMapIdx = new Map<number, number>();
  foArr.forEach((r, i) => foMapIdx.set(r.ts, i));

  // build aligned series on ob grid where candle exists
  const base = ob.rows
    .map((r: any) => ({ ts: Number(r.ts), b: r.b, a: r.a, bq: r.bq, aq: r.aq }))
    .filter((r: any) => cMap.has(r.ts));

  const imbSeries = base.map((r: any) => (r.b - r.a) / (r.b + r.a));
  const qtySeries = base.map((r: any) => (r.bq - r.aq) / (r.bq + r.aq));
  const fSeries = foArr.map(r => r.f);

  const rows: Row[] = [];
  for (let i = 0; i < base.length; i++) {
    const ts = base[i].ts;
    const close0 = cMap.get(ts)!;
    const fwd: Record<number, number | null> = {};
    const trail: Record<number, number | null> = {};
    for (const h of HORIZONS) {
      const fwdTs = ts + h * 4 * 3600 * 1000;
      const trailTs = ts - h * 4 * 3600 * 1000;
      const cf = cMap.get(fwdTs);
      const ct = cMap.get(trailTs);
      fwd[h] = cf != null ? (cf - close0) / close0 : null;
      trail[h] = ct != null ? (close0 - ct) / ct : null;
    }
    // funding pct: rolling percentile of fr over window, at this ts
    let fundPct: number | null = null;
    const fIdx = foMapIdx.get(ts);
    if (fIdx != null) fundPct = rollingPct(fSeries, fIdx, WINDOW);

    rows.push({
      ts, pair,
      imb: imbSeries[i], qtyImb: qtySeries[i],
      imbPct: rollingPct(imbSeries, i, WINDOW),
      imbZ: rollingZ(imbSeries, i, WINDOW),
      fwd, trail, fundPct,
    });
  }
  return rows;
}

function statBlock(label: string, rows: Row[], sigKey: 'imb' | 'imbPct' | 'imbZ' | 'qtyImb') {
  const out: string[] = [];
  for (const h of HORIZONS) {
    const sig: number[] = [], fwd: number[] = [];
    for (const r of rows) {
      const f = r.fwd[h];
      const s = (r as any)[sigKey];
      if (f != null && Number.isFinite(s)) { sig.push(s); fwd.push(f); }
    }
    if (sig.length < 30) { out.push(`${HLABEL[h]}: n=${sig.length} (insufficient)`); continue; }
    const ic = spearman(sig, fwd);
    const { spread, q } = quintileSpread(sig, fwd);
    out.push(`${HLABEL[h]}: n=${sig.length} IC=${ic.toFixed(4)} qSpread=${(spread * 100).toFixed(3)}% quintiles=[${q.map(v => (v * 100).toFixed(2)).join(',')}]`);
  }
  console.log(`  [${sigKey}] ${label}`);
  for (const l of out) console.log(`     ${l}`);
}

function orthoBlock(label: string, rows: Row[], sigKey: 'imb' | 'imbPct' | 'imbZ') {
  // corr vs funding pct
  const s1: number[] = [], f1: number[] = [];
  for (const r of rows) {
    const s = (r as any)[sigKey];
    if (Number.isFinite(s) && r.fundPct != null) { s1.push(s); f1.push(r.fundPct); }
  }
  const corrFund = spearman(s1, f1);
  // corr vs trailing return (per horizon)
  const corrTrail: string[] = [];
  for (const h of HORIZONS) {
    const a: number[] = [], b: number[] = [];
    for (const r of rows) {
      const s = (r as any)[sigKey];
      const t = r.trail[h];
      if (Number.isFinite(s) && t != null) { a.push(s); b.push(t); }
    }
    corrTrail.push(`${HLABEL[h]}=${spearman(a, b).toFixed(3)}`);
  }
  console.log(`  [${sigKey}] ${label} corr_vs_fundingPct=${corrFund.toFixed(3)}  corr_vs_trailingRet[${corrTrail.join(' ')}]`);
}

async function main() {
  console.log('=== ORDER-BOOK DEPTH IMBALANCE IC STUDY (cg_orderbook_pair ±5%, 4h) ===\n');
  console.log(`window=${WINDOW} bars  horizons=${HORIZONS.map(h => HLABEL[h]).join(',')}  pairs=${PAIRS.length}\n`);

  const perPairRows: Record<string, Row[]> = {};
  let allRows: Row[] = [];
  for (const { pair, coin } of PAIRS) {
    try {
      const rows = await loadPair(pair, coin);
      perPairRows[pair] = rows;
      allRows = allRows.concat(rows);
    } catch (e: any) {
      console.log(`load ${pair} failed: ${(e?.message ?? String(e)).slice(0, 120)}`);
    }
  }
  // sort pooled by ts for honest IS/OOS midpoint split
  allRows.sort((a, b) => a.ts - b.ts);
  const tsAll = allRows.map(r => r.ts);
  const midTs = tsAll[Math.floor(tsAll.length / 2)];
  const IS = allRows.filter(r => r.ts < midTs);   // older
  const OOS = allRows.filter(r => r.ts >= midTs);  // recent
  console.log(`pooled rows=${allRows.length}  midTs=${new Date(midTs).toISOString()}`);
  console.log(`IS(older) n=${IS.length}  OOS(recent) n=${OOS.length}\n`);

  // === POOLED (cross-pair) — per-pair normalized signals (imbPct, imbZ) are comparable ===
  for (const sk of ['imbPct', 'imbZ', 'imb', 'qtyImb'] as const) {
    console.log(`--- POOLED signal=${sk} ---`);
    statBlock('IS(older) ', IS, sk);
    statBlock('OOS(recent)', OOS, sk);
  }

  console.log('\n=== ORTHOGONALITY (pooled) ===');
  orthoBlock('FULL', allRows, 'imbPct');
  orthoBlock('FULL', allRows, 'imbZ');
  orthoBlock('FULL', allRows, 'imb');

  // === per-pair (BTC + SOL focus) for imbPct (live-mirror normalization) ===
  console.log('\n=== PER-PAIR (imbPct), IS vs OOS ===');
  for (const { pair } of PAIRS) {
    const rows = perPairRows[pair];
    if (!rows || rows.length < 100) { console.log(`${pair}: thin`); continue; }
    const mid = rows[Math.floor(rows.length / 2)].ts;
    const is = rows.filter(r => r.ts < mid), oos = rows.filter(r => r.ts >= mid);
    const line = (set: Row[]) => HORIZONS.map(h => {
      const s: number[] = [], f: number[] = [];
      for (const r of set) { const fv = r.fwd[h]; if (fv != null && Number.isFinite(r.imbPct)) { s.push(r.imbPct); f.push(fv); } }
      return s.length >= 30 ? `${HLABEL[h]}=${spearman(s, f).toFixed(3)}` : `${HLABEL[h]}=NA`;
    }).join(' ');
    console.log(`${pair.padEnd(9)} IS[${line(is)}]  OOS[${line(oos)}]`);
  }

  await close();
}
main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

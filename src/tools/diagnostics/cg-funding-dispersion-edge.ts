/**
 * cg-funding-dispersion-edge — research whether CROSS-EXCHANGE funding DISPERSION
 * (the spread/std of per-exchange funding rates, NOT the OI-weighted mean we fade)
 * carries a real, OOS-robust, orthogonal predictive edge on forward returns.
 *
 * Data:
 *   per-exchange funding history via /futures/funding-rate/history (4h closes)
 *   forward returns from our own `candles` table (tf=240m)
 *
 * Signals tested at each 4h ts (cross-exchange, over the exchanges that have a value):
 *   disp_std    = stdev of per-exchange funding close
 *   disp_range  = max - min of per-exchange funding close
 *   disp_z      = rolling z-score (window 180 = 30d) of disp_std
 *   range_z     = rolling z-score of disp_range
 * Plus orthogonality references:
 *   foi_pct     = rolling percentile (window 180) of OI-weighted funding (the live fade)
 *   trail_ret_h = trailing h-bar price return (lagged-momentum check)
 *
 * Metrics per (signal, horizon, half):
 *   Spearman IC of signal -> forward h-bar return
 *   monotone quintile spread (Q5 mean fwd ret - Q1 mean fwd ret)
 * Direction tested: dispersion HIGH -> stress/dislocation -> mean-reversion.
 *   "follow" = positive IC (high disp -> high fwd ret), "fade" = negative IC.
 *
 * Orthogonality: corr(best signal, foi_pct) and corr(best signal, trailing ret).
 *
 * Run: npx tsx src/tools/diagnostics/cg-funding-dispersion-edge.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const TF = '4h';
const LIMIT = 2160;
const PACE_MS = 320;
const ROLL = 180;        // 30 days of 4h bars for z-score / percentile
const HORIZONS_BARS = [3, 6, 12]; // 12h, 24h, 48h (4h bars)
const FOUR_H_MS = 4 * 3600 * 1000;

// Per-coin, per-exchange instrument symbol map (verified working via probe).
// We use exchanges that returned valid history for BTC; alts reuse the same conventions.
type ExMap = Record<string, string>; // exchange -> instrument symbol
function exMap(coin: string): ExMap {
  return {
    Binance:  `${coin}USDT`,
    Bybit:    `${coin}USDT`,
    OKX:      `${coin}-USDT-SWAP`,
    Bitget:   `${coin}USDT_UMCBL`,
    Gate:     `${coin}_USDT`,
    HTX:      `${coin}-USDT`,
    KuCoin:   `${coin}USDTM`,        // note: BTC special-cased below
    MEXC:     `${coin}_USDT`,
    dYdX:     `${coin}-USD`,
    Bitmex:   `${coin}USDT`,         // BTC special-cased below
  };
}
function instrument(coin: string, ex: string): string {
  if (coin === 'BTC') {
    if (ex === 'KuCoin') return 'XBTUSDTM';
    if (ex === 'Bitmex') return 'XBTUSDT';
    if (ex === 'Kraken') return 'PF_XBTUSD';
  }
  return exMap(coin)[ex];
}

const COINS: { coin: string; candleSym: string }[] = [
  { coin: 'BTC', candleSym: 'BTCUSDT' },
  { coin: 'ETH', candleSym: 'ETHUSDT' },
  { coin: 'SOL', candleSym: 'SOLUSDT' },
  { coin: 'XRP', candleSym: 'XRPUSDT' },
];

// ---------- stats helpers ----------
function mean(a: number[]): number { return a.reduce((s, x) => s + x, 0) / a.length; }
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function rank(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length).fill(0);
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
function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; num += a * b; dx += a * a; dy += b * b; }
  if (dx === 0 || dy === 0) return NaN;
  return num / Math.sqrt(dx * dy);
}
function spearman(x: number[], y: number[]): number {
  if (x.length < 3) return NaN;
  return pearson(rank(x), rank(y));
}
// quintile spread: mean fwd ret in top 20% of signal minus bottom 20%
function quintileSpread(sig: number[], fwd: number[]): { spread: number; q1: number; q5: number; monotone: boolean } {
  const pairs = sig.map((s, i) => [s, fwd[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const bins: number[][] = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    let b = Math.floor((i / n) * 5);
    if (b > 4) b = 4;
    bins[b].push(pairs[i][1]);
  }
  const means = bins.map(b => b.length ? mean(b) : NaN);
  const q1 = means[0], q5 = means[4];
  // monotone if means strictly increasing OR strictly decreasing across bins
  let inc = true, dec = true;
  for (let i = 1; i < 5; i++) {
    if (!(means[i] > means[i - 1])) inc = false;
    if (!(means[i] < means[i - 1])) dec = false;
  }
  return { spread: q5 - q1, q1, q5, monotone: inc || dec };
}

// ---------- data fetch ----------
interface ExSeries { ex: string; map: Map<number, number>; } // ts -> funding close

async function fetchExch(coin: string, ex: string): Promise<ExSeries | null> {
  const sym = instrument(coin, ex);
  if (!sym) return null;
  try {
    const r = await cgGet<any[]>('/futures/funding-rate/history', { exchange: ex, symbol: sym, interval: TF, limit: LIMIT });
    const data = (r as any).data ?? [];
    if (!Array.isArray(data) || data.length < 100) return null;
    const m = new Map<number, number>();
    for (const d of data) {
      const c = parseFloat(d.close);
      if (Number.isFinite(c)) m.set(d.time, c);
    }
    return { ex, map: m };
  } catch {
    return null;
  }
}

async function fetchOiWeighted(coin: string): Promise<Map<number, number>> {
  const r = await cgGet<any[]>('/futures/funding-rate/oi-weight-history', { symbol: coin, interval: TF, limit: LIMIT });
  const data = (r as any).data ?? [];
  const m = new Map<number, number>();
  for (const d of data) { const c = parseFloat(d.close); if (Number.isFinite(c)) m.set(d.time, c); }
  return m;
}

async function loadCandleCloses(sym: string, fromTs: number, toTs: number): Promise<Map<number, number>> {
  const r = await query<any>(
    `SELECT ts::text, close FROM candles WHERE symbol=$1 AND tf='240m' AND ts>=$2 AND ts<=$3 ORDER BY ts ASC`,
    [sym, fromTs, toTs]);
  const m = new Map<number, number>();
  for (const row of r.rows) m.set(parseInt(row.ts, 10), parseFloat(row.close));
  return m;
}

// rolling z-score using prior ROLL values (strictly causal: excludes current)
function rollingZ(vals: number[], win: number): number[] {
  const out: number[] = new Array(vals.length).fill(NaN);
  for (let i = 0; i < vals.length; i++) {
    if (i < win) continue;
    const w = vals.slice(i - win, i);
    const m = mean(w), s = std(w);
    out[i] = s > 0 ? (vals[i] - m) / s : NaN;
  }
  return out;
}
// rolling percentile of current value within prior ROLL (causal)
function rollingPct(vals: number[], win: number): number[] {
  const out: number[] = new Array(vals.length).fill(NaN);
  for (let i = 0; i < vals.length; i++) {
    if (i < win) continue;
    const w = vals.slice(i - win, i);
    let below = 0;
    for (const x of w) if (x < vals[i]) below++;
    out[i] = below / w.length;
  }
  return out;
}

interface ResultRow {
  coin: string; signal: string; horizonBars: number;
  half: 'IS' | 'OOS';
  n: number; ic: number; spread: number; monotone: boolean; q1: number; q5: number;
}

function fmt(x: number, d = 4): string { return Number.isFinite(x) ? x.toFixed(d) : 'NaN'; }

async function analyzeCoin(coin: string, candleSym: string): Promise<{ rows: ResultRow[]; ortho: string[] }> {
  const exNames = Object.keys(exMap(coin)).concat(coin === 'BTC' ? ['Kraken'] : []);
  const series: ExSeries[] = [];
  for (const ex of exNames) {
    const s = await fetchExch(coin, ex);
    if (s) series.push(s);
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  const oiMap = await fetchOiWeighted(coin);
  await new Promise(r => setTimeout(r, PACE_MS));

  // common timeline = union of timestamps that have >=4 exchanges
  const tsCount = new Map<number, number>();
  for (const s of series) for (const ts of s.map.keys()) tsCount.set(ts, (tsCount.get(ts) ?? 0) + 1);
  const allTs = Array.from(tsCount.entries()).filter(([, c]) => c >= 4).map(([ts]) => ts).sort((a, b) => a - b);
  if (allTs.length < 400) {
    console.log(`  ${coin}: insufficient cross-exchange timeline (${allTs.length} ts, ${series.length} exch) — skip`);
    return { rows: [], ortho: [] };
  }

  const fromTs = allTs[0] - FOUR_H_MS;
  const toTs = allTs[allTs.length - 1] + HORIZONS_BARS[HORIZONS_BARS.length - 1] * FOUR_H_MS + FOUR_H_MS;
  const closes = await loadCandleCloses(candleSym, fromTs, toTs);

  // Build aligned arrays over allTs
  const dispStd: number[] = [];
  const dispRange: number[] = [];
  const oiVal: number[] = [];
  const px: number[] = [];          // candle close at ts
  const validTs: number[] = [];
  for (const ts of allTs) {
    const vals: number[] = [];
    for (const s of series) { const v = s.map.get(ts); if (v !== undefined) vals.push(v); }
    if (vals.length < 4) continue;
    const c = closes.get(ts);
    if (c === undefined) continue;
    const oi = oiMap.get(ts);
    dispStd.push(std(vals));
    dispRange.push(Math.max(...vals) - Math.min(...vals));
    oiVal.push(oi ?? NaN);
    px.push(c);
    validTs.push(ts);
  }
  const N = validTs.length;
  if (N < 400) {
    console.log(`  ${coin}: only ${N} aligned bars — skip`);
    return { rows: [], ortho: [] };
  }

  const dispZ = rollingZ(dispStd, ROLL);
  const rangeZ = rollingZ(dispRange, ROLL);
  const foiPct = rollingPct(oiVal.map(v => Number.isFinite(v) ? v : 0), ROLL);

  // forward returns: need px at ts+h bars. Build ts->index, then look ahead in validTs only
  // (validTs is contiguous 4h since same source). Verify contiguity by index step.
  const fwd: Record<number, number[]> = {};
  for (const h of HORIZONS_BARS) {
    fwd[h] = new Array(N).fill(NaN);
    for (let i = 0; i + h < N; i++) {
      // require contiguous timestamps
      if (validTs[i + h] - validTs[i] === h * FOUR_H_MS) {
        fwd[h][i] = Math.log(px[i + h] / px[i]);
      }
    }
  }
  // trailing returns (for lagged-momentum orthogonality)
  const trail: Record<number, number[]> = {};
  for (const h of HORIZONS_BARS) {
    trail[h] = new Array(N).fill(NaN);
    for (let i = h; i < N; i++) {
      if (validTs[i] - validTs[i - h] === h * FOUR_H_MS) {
        trail[h][i] = Math.log(px[i] / px[i - h]);
      }
    }
  }

  const signals: { name: string; arr: number[] }[] = [
    { name: 'disp_std', arr: dispStd },
    { name: 'disp_range', arr: dispRange },
    { name: 'disp_z', arr: dispZ },
    { name: 'range_z', arr: rangeZ },
  ];

  const mid = Math.floor(N / 2);
  const rows: ResultRow[] = [];

  // collect best signal (by |IC| consistency) for orthogonality
  let bestKey = ''; let bestArr: number[] | null = null; let bestAbs = 0; let bestH = 0;

  for (const sig of signals) {
    for (const h of HORIZONS_BARS) {
      for (const half of ['IS', 'OOS'] as const) {
        const lo = half === 'IS' ? 0 : mid;
        const hi = half === 'IS' ? mid : N;
        const sx: number[] = [], fy: number[] = [];
        for (let i = lo; i < hi; i++) {
          if (Number.isFinite(sig.arr[i]) && Number.isFinite(fwd[h][i])) { sx.push(sig.arr[i]); fy.push(fwd[h][i]); }
        }
        const ic = spearman(sx, fy);
        const qs = sx.length >= 25 ? quintileSpread(sx, fy) : { spread: NaN, q1: NaN, q5: NaN, monotone: false };
        rows.push({ coin, signal: sig.name, horizonBars: h, half, n: sx.length, ic, spread: qs.spread, monotone: qs.monotone, q1: qs.q1, q5: qs.q5 });
      }
    }
  }

  // identify best signal/horizon by min(|IC_IS|,|IC_OOS|) with same sign
  for (const sig of signals) {
    for (const h of HORIZONS_BARS) {
      const isRow = rows.find(r => r.signal === sig.name && r.horizonBars === h && r.half === 'IS');
      const oosRow = rows.find(r => r.signal === sig.name && r.horizonBars === h && r.half === 'OOS');
      if (!isRow || !oosRow) continue;
      const sameSign = Number.isFinite(isRow.ic) && Number.isFinite(oosRow.ic) && Math.sign(isRow.ic) === Math.sign(oosRow.ic) && isRow.ic !== 0;
      const minAbs = Math.min(Math.abs(isRow.ic), Math.abs(oosRow.ic));
      if (sameSign && minAbs > bestAbs) {
        bestAbs = minAbs; bestKey = `${sig.name}@${h}b`; bestArr = sig.arr; bestH = h;
      }
    }
  }

  const ortho: string[] = [];
  if (bestArr) {
    // corr of best signal vs foi_pct and vs trailing return (full sample, finite pairs)
    const a1: number[] = [], b1: number[] = [];
    for (let i = 0; i < N; i++) if (Number.isFinite(bestArr[i]) && Number.isFinite(foiPct[i])) { a1.push(bestArr[i]); b1.push(foiPct[i]); }
    const a2: number[] = [], b2: number[] = [];
    for (let i = 0; i < N; i++) if (Number.isFinite(bestArr[i]) && Number.isFinite(trail[bestH][i])) { a2.push(bestArr[i]); b2.push(trail[bestH][i]); }
    const cFoi = spearman(a1, b1);
    const cTrail = spearman(a2, b2);
    ortho.push(`${coin} best=${bestKey} minIC=${fmt(bestAbs, 3)} | corr(signal,foi_pct)=${fmt(cFoi, 3)} corr(signal,trail_ret)=${fmt(cTrail, 3)}`);
  } else {
    ortho.push(`${coin}: no same-sign-both-halves signal found`);
  }

  console.log(`  ${coin}: N=${N} bars, exch=${series.length} (${series.map(s => s.ex).join(',')})`);
  return { rows, ortho };
}

async function main() {
  console.log('\n=== Funding cross-exchange DISPERSION edge research ===');
  console.log(`rolling=${ROLL} bars (30d), horizons(bars)=${HORIZONS_BARS.join(',')} (12/24/48h), IS/OOS split at midpoint\n`);

  const allRows: ResultRow[] = [];
  const allOrtho: string[] = [];
  for (const c of COINS) {
    const { rows, ortho } = await analyzeCoin(c.coin, c.candleSym);
    allRows.push(...rows);
    allOrtho.push(...ortho);
  }

  // ---- table ----
  console.log('\n=== IC + quintile-spread by coin/signal/horizon (IS vs OOS) ===');
  console.log('coin signal       h(b)  ICis     ICoos    sameSign  spreadIS  spreadOOS  monoIS monoOOS  nIS  nOOS');
  console.log('-'.repeat(108));
  const seen = new Set<string>();
  for (const r of allRows) {
    if (r.half !== 'IS') continue;
    const oos = allRows.find(x => x.coin === r.coin && x.signal === r.signal && x.horizonBars === r.horizonBars && x.half === 'OOS');
    if (!oos) continue;
    const key = `${r.coin}|${r.signal}|${r.horizonBars}`;
    if (seen.has(key)) continue; seen.add(key);
    const same = (Number.isFinite(r.ic) && Number.isFinite(oos.ic) && Math.sign(r.ic) === Math.sign(oos.ic)) ? 'YES' : 'no';
    console.log(
      `${r.coin.padEnd(4)} ${r.signal.padEnd(11)} ${String(r.horizonBars).padStart(3)}  ` +
      `${fmt(r.ic, 4).padStart(7)} ${fmt(oos.ic, 4).padStart(8)}  ${same.padEnd(8)}  ` +
      `${fmt(r.spread, 5).padStart(8)} ${fmt(oos.spread, 5).padStart(9)}  ` +
      `${(r.monotone ? 'Y' : 'n').padStart(5)} ${(oos.monotone ? 'Y' : 'n').padStart(6)}  ` +
      `${String(r.n).padStart(4)} ${String(oos.n).padStart(4)}`);
  }

  console.log('\n=== ORTHOGONALITY (best same-sign signal per coin) ===');
  for (const o of allOrtho) console.log('  ' + o);

  // ---- discipline-bar filter ----
  console.log('\n=== Discipline-bar PASSERS (sameSign both halves AND min|IC|>=0.05) ===');
  let any = false;
  for (const key of Array.from(seen)) {
    const [coin, signal, hb] = key.split('|');
    const isR = allRows.find(x => x.coin === coin && x.signal === signal && x.horizonBars === +hb && x.half === 'IS')!;
    const oosR = allRows.find(x => x.coin === coin && x.signal === signal && x.horizonBars === +hb && x.half === 'OOS')!;
    const same = Number.isFinite(isR.ic) && Number.isFinite(oosR.ic) && Math.sign(isR.ic) === Math.sign(oosR.ic);
    const minAbs = Math.min(Math.abs(isR.ic), Math.abs(oosR.ic));
    if (same && minAbs >= 0.05) {
      any = true;
      console.log(`  PASS ${coin} ${signal}@${hb}b  ICis=${fmt(isR.ic, 4)} ICoos=${fmt(oosR.ic, 4)} dir=${isR.ic > 0 ? 'follow' : 'fade'}`);
    }
  }
  if (!any) console.log('  none');

  process.exit(0);
}

main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });

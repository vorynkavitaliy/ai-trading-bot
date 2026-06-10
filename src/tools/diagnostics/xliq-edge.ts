/**
 * xliq-edge — disciplined IS/OOS edge test for the CROSS-EXCHANGE AGGREGATED
 * LIQUIDATION + TAKER/CVD family. NOT percentile-fade of funding/ls.
 *
 * Data: /futures/liquidation/aggregated-history  (time ms, agg long/short liq usd)
 *       /futures/aggregated-taker-buy-sell-volume/history (time ms, agg buy/sell vol usd)
 *   exchange_list = Binance,OKX,Bybit (ALL returns empty on Standard plan).
 *   ~2160 4h bars max (≈360d), ending now. time = bar OPEN ms (matches candle ts).
 *
 * Tradability: a 4h CG bar labelled open=T is only fully known at its close T+4h.
 *   So signal computed on bar i is tradable at bar i's CLOSE. Forward return is
 *   measured close[i] -> close[i + k] where k = H/4h bars. Uses PROJECT candles.
 *
 * Archetypes (NOT percentile-fade):
 *   A. liq-cascade-reversal: zscore of agg LONG-liq (vs trailing 30-bar) -> BOUNCE.
 *        signal = zLongLiq; FADE reading = long-liq spike -> price UP next.
 *      symmetric zShortLiq -> price DOWN (short-squeeze exhaustion) handled via
 *      a combined liq-cascade signal = zShortLiq - zLongLiq (FOLLOW: more short
 *      liq than long liq -> up).  We test both directions honestly via IC sign.
 *   B. liq-imbalance-continuation: liqImb = (long - short)/(long+short).
 *        more LONG liqs (longs forced out) -> price continues DOWN (FOLLOW = +imb -> -ret).
 *      Tested as raw IC of liqImb -> fwd ret (sign tells follow vs fade).
 *   C. CVD/order-flow delta: cvd = (buy - sell)/(buy+sell).
 *        FOLLOW (momentum): +cvd -> +ret.  ABSORPTION/FADE: +cvd -> -ret.
 *      Tested raw IC + a zscored variant (absorption: extreme buy delta -> revert).
 *
 * Metrics per (signal,horizon): Spearman rank-IC and top-vs-bottom quintile fwd-ret
 *   spread, split IS (older half) / OOS (recent half) at midpoint.
 *
 * PASS rule: same-sign IC on BOTH halves AND |IC|>=0.05 at some horizon, OR clear
 *   monotone quintile spread same-direction on BOTH halves.
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close } from '../../core/db';

const EX = 'Binance,OKX,Bybit';
const TF_MS = 4 * 3600 * 1000;
const HORIZONS_H = [12, 24, 48]; // hours
const ZWIN = 30; // trailing window for zscore (30 * 4h = 5 days)

interface CgRow { time: number; longLiq: number; shortLiq: number; buy: number; sell: number; }

async function fetchLiq(sym: string): Promise<Map<number, { longLiq: number; shortLiq: number }>> {
  const r = await cgGet<any[]>('/futures/liquidation/aggregated-history', { symbol: sym, exchange_list: EX, interval: '4h', limit: 4500 });
  const m = new Map<number, { longLiq: number; shortLiq: number }>();
  for (const row of r.data || []) {
    m.set(row.time, { longLiq: +row.aggregated_long_liquidation_usd, shortLiq: +row.aggregated_short_liquidation_usd });
  }
  return m;
}

async function fetchTaker(sym: string): Promise<Map<number, { buy: number; sell: number }>> {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', { symbol: sym, exchange_list: EX, interval: '4h', limit: 4500 });
  const m = new Map<number, { buy: number; sell: number }>();
  for (const row of r.data || []) {
    m.set(row.time, { buy: +row.aggregated_buy_volume_usd, sell: +row.aggregated_sell_volume_usd });
  }
  return m;
}

// Spearman rank correlation
function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 8) return NaN;
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  if (vx === 0 || vy === 0) return NaN;
  return cov / Math.sqrt(vx * vy);
}

// top-vs-bottom quintile mean fwd-ret spread (%), plus the 5 quintile means for monotonicity
function quintileSpread(xs: number[], ys: number[]): { spread: number; means: number[] } {
  const n = xs.length;
  const order = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
  const q = Math.floor(n / 5);
  if (q < 3) return { spread: NaN, means: [] };
  const means: number[] = [];
  for (let b = 0; b < 5; b++) {
    const lo = b * q, hi = b === 4 ? n : (b + 1) * q;
    let s = 0; for (let i = lo; i < hi; i++) s += ys[order[i]];
    means.push((s / (hi - lo)) * 100);
  }
  return { spread: means[4] - means[0], means };
}

function isMonotone(means: number[]): boolean {
  if (means.length !== 5) return false;
  let inc = true, dec = true;
  for (let i = 1; i < 5; i++) { if (means[i] < means[i - 1]) inc = false; if (means[i] > means[i - 1]) dec = false; }
  return inc || dec;
}

interface Signal { name: string; archetype: string; vals: number[]; }

async function runPair(sym: string, cgSym: string) {
  const bars = await loadBars(sym, '240m', { limit: 4500 });
  const liq = await fetchLiq(cgSym);
  const taker = await fetchTaker(cgSym);

  // align: iterate candle bars; only keep bars that have BOTH cg rows present.
  const closeByTs = new Map<number, number>();
  for (const b of bars) closeByTs.set(b.ts, b.close);
  const tsSorted = bars.map(b => b.ts).sort((a, b) => a - b);

  // Build aligned arrays over the intersection
  const A: { ts: number; close: number; longLiq: number; shortLiq: number; buy: number; sell: number }[] = [];
  for (const ts of tsSorted) {
    const l = liq.get(ts), t = taker.get(ts), c = closeByTs.get(ts);
    if (l && t && c !== undefined) A.push({ ts, close: c, longLiq: l.longLiq, shortLiq: l.shortLiq, buy: t.buy, sell: t.sell });
  }
  if (A.length < 200) { console.log(`  ${sym}: only ${A.length} aligned bars — skip`); return; }

  const span = `${new Date(A[0].ts).toISOString().slice(0,10)} -> ${new Date(A[A.length-1].ts).toISOString().slice(0,10)}`;
  console.log(`\n##### ${sym} (cg=${cgSym})  alignedBars=${A.length}  ${span}`);

  // helper: trailing zscore of series at index i (uses [i-ZWIN, i-1], excludes i to avoid leak of own value into mean? include i is fine for contemporaneous z)
  const z = (series: number[], i: number): number => {
    const lo = Math.max(0, i - ZWIN);
    const win = series.slice(lo, i); // strictly trailing, excludes current
    if (win.length < 10) return NaN;
    const m = win.reduce((a, b) => a + b, 0) / win.length;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length);
    if (sd === 0) return NaN;
    return (series[i] - m) / sd;
  };

  const longLiqArr = A.map(a => a.longLiq);
  const shortLiqArr = A.map(a => a.shortLiq);

  // Build candidate signals (raw, sign-honest). We compute IC of signal->fwd ret;
  // the SIGN tells follow vs fade. We describe each in a follow-frame.
  const signals: Signal[] = [];
  const N = A.length;

  // A1: zLongLiq (cascade) — high = big forced long-liquidation. FADE expectation: bounce (negative IC if follow-frame)
  signals.push({ name: 'zLongLiq', archetype: 'liq-cascade-reversal', vals: A.map((_, i) => z(longLiqArr, i)) });
  // A2: zShortLiq — big forced short-liquidation (short squeeze). expectation: exhaustion -> down.
  signals.push({ name: 'zShortLiq', archetype: 'liq-cascade-reversal', vals: A.map((_, i) => z(shortLiqArr, i)) });
  // A3: liqCascadeNet = zShortLiq - zLongLiq (FOLLOW: net short-liq dominance -> up momentum bounce after squeeze? sign honest)
  signals.push({ name: 'zShortLiq-zLongLiq', archetype: 'liq-cascade-reversal', vals: A.map((_, i) => z(shortLiqArr, i) - z(longLiqArr, i)) });

  // B: liqImbalance = (long - short)/(long+short).  FOLLOW-frame: +imb (more longs liquidated) -> ?  continuation says price keeps falling => negative IC.
  signals.push({ name: 'liqImbalance(long-short)/(sum)', archetype: 'liq-imbalance-continuation', vals: A.map(a => { const s = a.longLiq + a.shortLiq; return s > 0 ? (a.longLiq - a.shortLiq) / s : NaN; }) });
  // B2: total liq zscore (regime) — does a big total-liq bar mean anything directional? combine with sign of imbalance
  signals.push({ name: 'zTotalLiq*sign(imb)', archetype: 'liq-imbalance-continuation', vals: A.map((a, i) => { const tot = a.longLiq + a.shortLiq; const zt = z(A.map(x => x.longLiq + x.shortLiq), i); const s = tot > 0 ? Math.sign(a.longLiq - a.shortLiq) : 0; return zt * s; }) });

  // C: CVD delta = (buy - sell)/(buy+sell). FOLLOW (momentum): +cvd -> +ret.
  signals.push({ name: 'cvdDelta(buy-sell)/(sum)', archetype: 'cvd-orderflow', vals: A.map(a => { const s = a.buy + a.sell; return s > 0 ? (a.buy - a.sell) / s : NaN; }) });
  // C2: zCvdDelta (extreme order-flow -> absorption/revert). high z buy delta.
  const cvdRaw = A.map(a => { const s = a.buy + a.sell; return s > 0 ? (a.buy - a.sell) / s : 0; });
  signals.push({ name: 'zCvdDelta', archetype: 'cvd-orderflow', vals: A.map((_, i) => z(cvdRaw, i)) });
  // C3: cumulative CVD slope over last 6 bars (24h trend of order flow) — momentum
  signals.push({ name: 'cvdDelta_6barSum', archetype: 'cvd-orderflow', vals: A.map((a, i) => { let s = 0; for (let k = Math.max(0, i - 5); k <= i; k++) { const sum = A[k].buy + A[k].sell; s += sum > 0 ? (A[k].buy - A[k].sell) / sum : 0; } return s; }) });

  // forward returns per horizon
  const results: { sig: string; arch: string; H: number; icIS: number; icOOS: number; spIS: number; spOOS: number; monoIS: boolean; monoOOS: boolean; nIS: number; nOOS: number }[] = [];
  const mid = Math.floor(N / 2);

  for (const Hh of HORIZONS_H) {
    const k = Hh / 4; // bars ahead
    // fwd ret from close[i] to close[i+k]
    const fwd: number[] = A.map((a, i) => i + k < N ? (A[i + k].close - a.close) / a.close : NaN);

    for (const sg of signals) {
      // valid indices: signal finite, fwd finite, and i has a full trailing window where needed
      const idxAll: number[] = [];
      for (let i = ZWIN; i + k < N; i++) {
        if (Number.isFinite(sg.vals[i]) && Number.isFinite(fwd[i])) idxAll.push(i);
      }
      const isIdx = idxAll.filter(i => i < mid);
      const oosIdx = idxAll.filter(i => i >= mid);
      if (isIdx.length < 30 || oosIdx.length < 30) continue;
      const xIS = isIdx.map(i => sg.vals[i]), yIS = isIdx.map(i => fwd[i]);
      const xOOS = oosIdx.map(i => sg.vals[i]), yOOS = oosIdx.map(i => fwd[i]);
      const icIS = spearman(xIS, yIS), icOOS = spearman(xOOS, yOOS);
      const qIS = quintileSpread(xIS, yIS), qOOS = quintileSpread(xOOS, yOOS);
      results.push({ sig: sg.name, arch: sg.archetype, H: Hh, icIS, icOOS, spIS: qIS.spread, spOOS: qOOS.spread, monoIS: isMonotone(qIS.means), monoOOS: isMonotone(qOOS.means), nIS: isIdx.length, nOOS: oosIdx.length });
    }
  }

  // print
  console.log(`  ${'signal'.padEnd(32)} ${'arch'.padEnd(26)} H   icIS    icOOS   spIS%   spOOS%  mono  PASS`);
  for (const r of results) {
    const sameSign = Number.isFinite(r.icIS) && Number.isFinite(r.icOOS) && Math.sign(r.icIS) === Math.sign(r.icOOS);
    const icPass = sameSign && (Math.abs(r.icIS) >= 0.05 && Math.abs(r.icOOS) >= 0.05);
    const spSameSign = Number.isFinite(r.spIS) && Number.isFinite(r.spOOS) && Math.sign(r.spIS) === Math.sign(r.spOOS);
    const monoPass = r.monoIS && r.monoOOS && spSameSign;
    const pass = icPass || monoPass;
    const flag = pass ? (icPass ? 'IC*' : 'MONO*') : '';
    console.log(`  ${r.sig.padEnd(32)} ${r.arch.padEnd(26)} ${String(r.H).padStart(2)}  ${fmt(r.icIS)} ${fmt(r.icOOS)} ${fmtp(r.spIS)} ${fmtp(r.spOOS)}  ${r.monoIS?'Y':'.'}${r.monoOOS?'Y':'.'}   ${flag}`);
  }
}

function fmt(x: number): string { return (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '  NaN ').padStart(7); }
function fmtp(x: number): string { return (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : ' NaN ').padStart(7); }

async function main() {
  const pairs: [string, string][] = [['BTCUSDT', 'BTC'], ['SOLUSDT', 'SOL'], ['ADAUSDT', 'ADA'], ['LINKUSDT', 'LINK']];
  for (const [sym, cgSym] of pairs) {
    try { await runPair(sym, cgSym); } catch (e: any) { console.log(`  ${sym} ERR ${e?.message}`); }
  }
  await close();
}

main().catch(async e => { console.error('crashed', e?.message ?? String(e)); await close(); process.exit(1); });

/**
 * macro-regime-edge — read-only OOS-discipline test of MACRO REGIME signals:
 *   (A) Fear&Greed  (daily)  -> BTC fwd return    : regime-gate + fng momentum/MR
 *   (B) BTC dominance (3-day) -> BTC fwd return    : dominance-trend directional
 *   (C) BTC dominance (3-day) -> BTC-minus-alt fwd : dominance relative signal
 *
 * Forward returns are computed from the PROJECT'S OWN 1D candles (tradable),
 * not the CG price field. CG timestamps are 00:00 UTC; we anchor each CG point
 * to the BTC 1D candle close at that day and measure fwd return over H days.
 *
 * Metric: Spearman rank-IC (signal_t -> fwd_ret) + top/bottom quintile spread.
 * Split: IS = older half, OOS = recent half, at the midpoint of in-window points.
 * Report sign honestly for BOTH follow and fade readings (IC sign carries it).
 */
import { query } from '../../core/db';
import { cgGet } from '../../core/coinglass';

const ALTS = ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'ATOMUSDT', 'ARBUSDT', 'INJUSDT'];
const DAY = 86400000;

interface DayClose { ts: number; close: number; }

async function loadDailyCloses(symbol: string): Promise<Map<number, number>> {
  const r = await query<any>(
    `SELECT ts, close FROM candles WHERE symbol=$1 AND tf='1D' ORDER BY ts ASC`,
    [symbol],
  );
  const m = new Map<number, number>();
  for (const row of r.rows) {
    // normalise to 00:00 UTC day key
    const d = new Date(Number(row.ts));
    const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    m.set(key, parseFloat(row.close));
  }
  return m;
}

function dayKey(tsMs: number): number {
  const d = new Date(tsMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Spearman rank-IC between x and y (paired). Returns NaN if <8 pairs.
function spearman(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 8) return NaN;
  const rank = (a: number[]): number[] => {
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
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return NaN;
  return num / Math.sqrt(dx * dy);
}

// top-quintile mean fwd minus bottom-quintile mean fwd (in pct, * 100)
function quintileSpread(sig: number[], fwd: number[]): { spread: number; topMean: number; botMean: number; nq: number } {
  const n = sig.length;
  const idx = sig.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
  const q = Math.floor(n / 5);
  if (q < 2) return { spread: NaN, topMean: NaN, botMean: NaN, nq: q };
  const bot = idx.slice(0, q).map(([, i]) => fwd[i]);
  const top = idx.slice(n - q).map(([, i]) => fwd[i]);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const tm = mean(top), bm = mean(bot);
  return { spread: (tm - bm) * 100, topMean: tm * 100, botMean: bm * 100, nq: q };
}

interface Pt { ts: number; sig: number; }

// build aligned (signal, fwdRet over H days) pairs from a daily-close map
function buildPairs(pts: Pt[], closes: Map<number, number>, horizonDays: number): { x: number[]; fwd: number[]; ts: number[] } {
  const x: number[] = [], fwd: number[] = [], ts: number[] = [];
  for (const p of pts) {
    const k0 = dayKey(p.ts);
    const c0 = closes.get(k0);
    const c1 = closes.get(k0 + horizonDays * DAY);
    if (c0 === undefined || c1 === undefined || c0 <= 0) continue;
    x.push(p.sig);
    fwd.push(c1 / c0 - 1);
    ts.push(p.ts);
  }
  return { x, fwd, ts };
}

// relative fwd: BTC fwd minus equal-weight alt fwd
function buildRelPairs(pts: Pt[], btc: Map<number, number>, alts: Map<number, number>[], horizonDays: number): { x: number[]; fwd: number[] } {
  const x: number[] = [], fwd: number[] = [];
  for (const p of pts) {
    const k0 = dayKey(p.ts);
    const b0 = btc.get(k0), b1 = btc.get(k0 + horizonDays * DAY);
    if (b0 === undefined || b1 === undefined || b0 <= 0) continue;
    const btcRet = b1 / b0 - 1;
    const altRets: number[] = [];
    for (const m of alts) {
      const a0 = m.get(k0), a1 = m.get(k0 + horizonDays * DAY);
      if (a0 !== undefined && a1 !== undefined && a0 > 0) altRets.push(a1 / a0 - 1);
    }
    if (altRets.length < 3) continue;
    const altMean = altRets.reduce((s, v) => s + v, 0) / altRets.length;
    x.push(p.sig);
    fwd.push(btcRet - altMean);
  }
  return { x, fwd };
}

function report(label: string, x: number[], fwd: number[], ts: number[]) {
  // split IS/OOS at midpoint of available (sorted by ts) pairs
  const order = ts.map((t, i) => [t, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const mid = Math.floor(order.length / 2);
  const isIdx = order.slice(0, mid).map(([, i]) => i);
  const oosIdx = order.slice(mid).map(([, i]) => i);
  const sub = (idx: number[]) => ({ x: idx.map((i) => x[i]), fwd: idx.map((i) => fwd[i]) });
  const A = sub(isIdx), B = sub(oosIdx);
  const icAll = spearman(x, fwd);
  const icIS = spearman(A.x, A.fwd);
  const icOOS = spearman(B.x, B.fwd);
  const qIS = quintileSpread(A.x, A.fwd);
  const qOOS = quintileSpread(B.x, B.fwd);
  const fmt = (v: number) => (Number.isNaN(v) ? 'NaN' : v.toFixed(4));
  const fmtP = (v: number) => (Number.isNaN(v) ? 'NaN' : v.toFixed(2) + '%');
  console.log(`\n--- ${label} (n=${x.length}, IS=${isIdx.length}/OOS=${oosIdx.length}) ---`);
  console.log(`  IC all=${fmt(icAll)}  IS=${fmt(icIS)}  OOS=${fmt(icOOS)}`);
  console.log(`  quintile spread(top-bot) IS=${fmtP(qIS.spread)} [top ${fmtP(qIS.topMean)} bot ${fmtP(qIS.botMean)} nq=${qIS.nq}]`);
  console.log(`  quintile spread(top-bot) OOS=${fmtP(qOOS.spread)} [top ${fmtP(qOOS.topMean)} bot ${fmtP(qOOS.botMean)} nq=${qOOS.nq}]`);
  const sameSignIC = !Number.isNaN(icIS) && !Number.isNaN(icOOS) && Math.sign(icIS) === Math.sign(icOOS) && Math.min(Math.abs(icIS), Math.abs(icOOS)) >= 0.05;
  const sameSignQ = !Number.isNaN(qIS.spread) && !Number.isNaN(qOOS.spread) && Math.sign(qIS.spread) === Math.sign(qOOS.spread);
  console.log(`  ROBUST(IC same-sign & both|IC|>=.05)=${sameSignIC}  Q-spread-same-sign=${sameSignQ}`);
}

async function main() {
  const winStart = Date.parse('2024-05-25T00:00:00Z');
  const btcCloses = await loadDailyCloses('BTCUSDT');
  const altClosesArr = await Promise.all(ALTS.map((s) => loadDailyCloses(s)));

  // ---------- (A) Fear & Greed (daily) ----------
  const fng = await cgGet<any>('/index/fear-greed-history', {});
  const fTs: number[] = (fng.data as any).time_list.map((t: any) => Number(t));
  const fVal: number[] = (fng.data as any).data_list.map((v: any) => Number(v));
  const fngPts: Pt[] = [];
  for (let i = 0; i < fTs.length; i++) {
    if (fTs[i] >= winStart) fngPts.push({ ts: fTs[i], sig: fVal[i] });
  }
  console.log(`\n========== (A) FEAR & GREED -> BTC fwd return (daily, ${fngPts.length} pts in window) ==========`);
  console.log('Signal = raw FnG index (0..100). Positive IC => high greed precedes UP (follow/momentum). Negative IC => high greed precedes DOWN (contrarian fade works).');
  for (const H of [3, 5, 7]) {
    const { x, fwd, ts } = buildPairs(fngPts, btcCloses, H);
    report(`FnG raw -> BTC ${H}d`, x, fwd, ts);
  }
  // fng momentum: 5d change in FnG
  const fngMom: Pt[] = [];
  for (let i = 5; i < fngPts.length; i++) {
    if (fngPts[i].ts - fngPts[i - 5].ts <= 6 * DAY) fngMom.push({ ts: fngPts[i].ts, sig: fngPts[i].sig - fngPts[i - 5].sig });
  }
  console.log('\n  [FnG 5d-momentum signal]');
  for (const H of [3, 5, 7]) {
    const { x, fwd, ts } = buildPairs(fngMom, btcCloses, H);
    report(`FnG 5d-mom -> BTC ${H}d`, x, fwd, ts);
  }

  // ---------- (B) BTC dominance (3-day) directional ----------
  const dom = await cgGet<any>('/index/bitcoin-dominance', {});
  const domRows = (dom.data as any[]).map((r) => ({ ts: Number(r.timestamp), dom: Number(r.bitcoin_dominance) }))
    .filter((r) => r.ts >= winStart).sort((a, b) => a.ts - b.ts);
  // level signal
  const domLevel: Pt[] = domRows.map((r) => ({ ts: r.ts, sig: r.dom }));
  // trend signal: change over prior step (3d) and over 3 steps (9d)
  const domTrend1: Pt[] = [];
  const domTrend3: Pt[] = [];
  for (let i = 1; i < domRows.length; i++) domTrend1.push({ ts: domRows[i].ts, sig: domRows[i].dom - domRows[i - 1].dom });
  for (let i = 3; i < domRows.length; i++) domTrend3.push({ ts: domRows[i].ts, sig: domRows[i].dom - domRows[i - 3].dom });

  console.log(`\n========== (B) BTC DOMINANCE -> BTC fwd return (3-day series, ${domRows.length} pts in window) ==========`);
  console.log('Signal = dominance level / change. Positive IC(level)=>high dom precedes BTC UP. Trend>0 = rising dominance.');
  for (const H of [3, 6, 9]) {
    const { x, fwd, ts } = buildPairs(domLevel, btcCloses, H);
    report(`DomLevel -> BTC ${H}d`, x, fwd, ts);
  }
  console.log('\n  [Dominance 3d-trend signal]');
  for (const H of [3, 6, 9]) {
    const { x, fwd, ts } = buildPairs(domTrend1, btcCloses, H);
    report(`DomTrend(3d) -> BTC ${H}d`, x, fwd, ts);
  }
  console.log('\n  [Dominance 9d-trend signal]');
  for (const H of [3, 6, 9]) {
    const { x, fwd, ts } = buildPairs(domTrend3, btcCloses, H);
    report(`DomTrend(9d) -> BTC ${H}d`, x, fwd, ts);
  }

  // ---------- (C) BTC dominance -> BTC-minus-alt relative ----------
  console.log(`\n========== (C) BTC DOMINANCE -> (BTC minus equal-wt ALT) fwd return ==========`);
  console.log('Thesis: rising dominance => BTC outperforms alts (relative fwd > 0). Positive IC on trend => thesis holds.');
  for (const H of [3, 6, 9]) {
    // need ts for split: reuse domTrend1 ts
    const pts = domTrend1;
    const rel = buildRelPairs(pts, btcCloses, altClosesArr, H);
    // build ts in same filtering order as buildRelPairs (replicate filter)
    const tsArr: number[] = [];
    for (const p of pts) {
      const k0 = dayKey(p.ts);
      const b0 = btcCloses.get(k0), b1 = btcCloses.get(k0 + H * DAY);
      if (b0 === undefined || b1 === undefined || b0 <= 0) continue;
      const altRets: number[] = [];
      for (const m of altClosesArr) {
        const a0 = m.get(k0), a1 = m.get(k0 + H * DAY);
        if (a0 !== undefined && a1 !== undefined && a0 > 0) altRets.push(1);
      }
      if (altRets.length < 3) continue;
      tsArr.push(p.ts);
    }
    report(`DomTrend(3d) -> BTC-minus-alt ${H}d`, rel.x, rel.fwd, tsArr);
  }
  // dominance level -> relative
  console.log('\n  [Dominance LEVEL -> BTC-minus-alt relative]');
  for (const H of [3, 6, 9]) {
    const pts = domLevel;
    const rel = buildRelPairs(pts, btcCloses, altClosesArr, H);
    const tsArr: number[] = [];
    for (const p of pts) {
      const k0 = dayKey(p.ts);
      const b0 = btcCloses.get(k0), b1 = btcCloses.get(k0 + H * DAY);
      if (b0 === undefined || b1 === undefined || b0 <= 0) continue;
      const altRets: number[] = [];
      for (const m of altClosesArr) {
        const a0 = m.get(k0), a1 = m.get(k0 + H * DAY);
        if (a0 !== undefined && a1 !== undefined && a0 > 0) altRets.push(1);
      }
      if (altRets.length < 3) continue;
      tsArr.push(p.ts);
    }
    report(`DomLevel -> BTC-minus-alt ${H}d`, rel.x, rel.fwd, tsArr);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });

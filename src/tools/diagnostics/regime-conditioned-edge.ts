/**
 * regime-conditioned-edge — ANGLE: does the CG fade edge concentrate in a market REGIME?
 *
 * For each pair + each candidate fade signal (funding_oi, funding_vol, ls_top_position),
 * we split the (signal, forward-return) population by two regime definitions and report
 * Spearman rank-IC separately for IS (older half) and OOS (recent half) WITHIN each bucket:
 *   (a) ADX(14) on 4H:  ranging (ADX < 20) vs trending (ADX > 25)  [20-25 = grey, dropped]
 *   (b) BTC trend:      BTC 4H EMA20 > EMA50 (up) vs EMA20 < EMA50 (down)
 *
 * Hypothesis tests:
 *   - Fade IC (negative) should be STRONGER (more negative) in RANGING than TRENDING.
 *   - FOLLOW (positive IC) might emerge in TRENDING.
 *   - Fade may differ between BTC-up vs BTC-down regimes.
 *
 * A bucket-conditioned edge is "robust" only if SAME-SIGN and |IC|>=~0.06 on BOTH IS and OOS
 * within that bucket, AND the bucket has enough samples (n>=120 each half) to not be noise.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/regime-conditioned-edge.ts
 */
import { query, close as closePg } from '../../core/db';

type Row = { ts: number; val: number };

function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) {
    while (j < series.length && series[j].ts <= barTs[i]) j++;
    out[i] = j > 0 ? series[j - 1].val : null;
  }
  return out;
}

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

async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}

// Wilder ADX(14) over an OHLC series, returns array aligned to bars (null until warmed up).
function computeADX(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  const N = high.length;
  const out: (number | null)[] = new Array(N).fill(null);
  if (N < period * 2) return out;
  const tr: number[] = new Array(N).fill(0);
  const plusDM: number[] = new Array(N).fill(0);
  const minusDM: number[] = new Array(N).fill(0);
  for (let i = 1; i < N; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  // Wilder smoothing
  let atr = 0, sPlus = 0, sMinus = 0;
  for (let i = 1; i <= period; i++) { atr += tr[i]; sPlus += plusDM[i]; sMinus += minusDM[i]; }
  const dxArr: number[] = [];
  const dxIdx: number[] = [];
  for (let i = period + 1; i < N; i++) {
    atr = atr - atr / period + tr[i];
    sPlus = sPlus - sPlus / period + plusDM[i];
    sMinus = sMinus - sMinus / period + minusDM[i];
    if (atr === 0) continue;
    const pdi = 100 * sPlus / atr;
    const mdi = 100 * sMinus / atr;
    const denom = pdi + mdi;
    const dx = denom === 0 ? 0 : 100 * Math.abs(pdi - mdi) / denom;
    dxArr.push(dx);
    dxIdx.push(i);
  }
  // ADX = Wilder average of DX over period
  if (dxArr.length < period) return out;
  let adx = 0;
  for (let k = 0; k < period; k++) adx += dxArr[k];
  adx /= period;
  out[dxIdx[period - 1]] = adx;
  for (let k = period; k < dxArr.length; k++) {
    adx = (adx * (period - 1) + dxArr[k]) / period;
    out[dxIdx[k]] = adx;
  }
  return out;
}

// rolling EMA series aligned to closes
function emaSeries(values: number[], period: number): (number | null)[] {
  const N = values.length;
  const out: (number | null)[] = new Array(N).fill(null);
  if (N < period) return out;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  out[period - 1] = e;
  for (let i = period; i < N; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

// Spearman restricted to indices where mask[i] is true
function spearmanMasked(sig: (number | null)[], fwd: (number | null)[], mask: boolean[]): { ic: number; n: number } {
  const s: (number | null)[] = sig.map((v, i) => (mask[i] ? v : null));
  const f: (number | null)[] = fwd.map((v, i) => (mask[i] ? v : null));
  return spearman(s, f);
}

const PAIRS = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'ARBUSDT', 'INJUSDT', 'XRPUSDT'];
const ADX_RANGE = 20;   // ADX < 20 => ranging
const ADX_TREND = 25;   // ADX > 25 => trending
const MIN_N = 120;      // per half-bucket minimum to count
const IC_THRESH = 0.06; // |IC| threshold for "meaningful"

async function main() {
  // Preload BTC 4H closes for BTC-trend regime (shared across pairs)
  const btcCndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const btcTs = btcCndl.rows.map((r: any) => Number(r.ts));
  const btcClose = btcCndl.rows.map((r: any) => parseFloat(r.close));
  const btcEma20 = emaSeries(btcClose, 20);
  const btcEma50 = emaSeries(btcClose, 50);
  // map ts -> btc up(true)/down(false)/null
  const btcUpByTs = new Map<number, boolean | null>();
  for (let i = 0; i < btcTs.length; i++) {
    const e20 = btcEma20[i], e50 = btcEma50[i];
    btcUpByTs.set(btcTs[i], e20 != null && e50 != null ? e20 > e50 : null);
  }

  for (const pair of PAIRS) {
    const coin = pair.replace(/USDT$/, '');
    const cndl = await query<any>(`SELECT ts, open::text, high::text, low::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
    const barTs = cndl.rows.map((r: any) => Number(r.ts));
    const high = cndl.rows.map((r: any) => parseFloat(r.high));
    const low = cndl.rows.map((r: any) => parseFloat(r.low));
    const close = cndl.rows.map((r: any) => parseFloat(r.close));
    const N = barTs.length;

    const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
    const fundVol = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_vol_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
    const lsPos = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);

    const aFundOi = alignLatest(barTs, fundOi);
    const aFundVol = alignLatest(barTs, fundVol);
    const aLsPos = alignLatest(barTs, lsPos);

    const adx = computeADX(high, low, close, 14);

    // forward returns
    const fwd = (K: number): (number | null)[] => {
      const out: (number | null)[] = new Array(N).fill(null);
      for (let i = 0; i + K < N; i++) if (close[i] > 0) out[i] = (close[i + K] - close[i]) / close[i];
      return out;
    };
    const fwd24 = fwd(6), fwd48 = fwd(12);

    // IS/OOS split at midpoint of CG-covered bars
    const cgIdx = barTs.map((_, i) => i).filter(i => aFundOi[i] != null || aLsPos[i] != null);
    const midTs = cgIdx.length ? barTs[cgIdx[Math.floor(cgIdx.length / 2)]] : barTs[Math.floor(N / 2)];
    const isHalf = barTs.map(t => t < midTs);

    // BTC trend at each bar of this pair
    const btcUp: (boolean | null)[] = barTs.map(t => btcUpByTs.has(t) ? btcUpByTs.get(t)! : null);

    const SIGNALS: { name: string; vals: (number | null)[] }[] = [
      { name: 'funding_oi', vals: aFundOi },
      { name: 'funding_vol', vals: aFundVol },
      { name: 'ls_top_position', vals: aLsPos },
    ];

    console.log(`\n══════ ${pair} ══════  bars=${N}, CG-bars=${cgIdx.length}, IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
    console.log(`ADX ranging<${ADX_RANGE} / trending>${ADX_TREND}. IC vs fwd-24h & fwd-48h (Spearman). NEG=fade works.`);
    // adx distribution sanity
    const adxVals = adx.filter(v => v != null) as number[];
    const pRange = adxVals.length ? adxVals.filter(v => v < ADX_RANGE).length / adxVals.length : 0;
    const pTrend = adxVals.length ? adxVals.filter(v => v > ADX_TREND).length / adxVals.length : 0;
    console.log(`ADX coverage: ranging ${(pRange * 100).toFixed(0)}% / trending ${(pTrend * 100).toFixed(0)}% of bars.`);
    console.log('sig'.padEnd(16) + 'regime'.padEnd(16) + ' │  IS IC24 (n)        │  OOS IC24 (n)       │  IS IC48 / OOS IC48  │ robust?');
    console.log('─'.repeat(120));

    const fmtIc = (r: { ic: number; n: number }) =>
      (isFinite(r.ic) ? (r.ic >= 0 ? '+' : '') + r.ic.toFixed(3) : ' NaN').padStart(6) + ' (' + String(r.n).padStart(4) + ')';

    for (const s of SIGNALS) {
      const buckets: { label: string; mask: boolean[] }[] = [
        { label: 'RANGING(adx<20)', mask: adx.map(v => v != null && v < ADX_RANGE) },
        { label: 'TRENDING(adx>25)', mask: adx.map(v => v != null && v > ADX_TREND) },
        { label: 'BTC-UP', mask: btcUp.map(v => v === true) },
        { label: 'BTC-DOWN', mask: btcUp.map(v => v === false) },
        { label: 'ALL', mask: barTs.map(() => true) },
      ];
      for (const b of buckets) {
        const maskIS = b.mask.map((m, i) => m && isHalf[i]);
        const maskOOS = b.mask.map((m, i) => m && !isHalf[i]);
        const isr24 = spearmanMasked(s.vals, fwd24, maskIS);
        const oosr24 = spearmanMasked(s.vals, fwd24, maskOOS);
        const isr48 = spearmanMasked(s.vals, fwd48, maskIS);
        const oosr48 = spearmanMasked(s.vals, fwd48, maskOOS);
        // robust on 24h: same sign, both |IC|>=thresh, both n>=MIN_N
        let robust = '';
        if (isFinite(isr24.ic) && isFinite(oosr24.ic) && isr24.n >= MIN_N && oosr24.n >= MIN_N
            && Math.sign(isr24.ic) === Math.sign(oosr24.ic)
            && Math.abs(isr24.ic) >= IC_THRESH && Math.abs(oosr24.ic) >= IC_THRESH) {
          robust = isr24.ic < 0 ? '✓ FADE robust' : '✓ FOLLOW robust';
        } else if (isFinite(isr24.ic) && isFinite(oosr24.ic) && Math.sign(isr24.ic) !== Math.sign(oosr24.ic)
            && (Math.abs(isr24.ic) >= IC_THRESH || Math.abs(oosr24.ic) >= IC_THRESH) && isr24.n >= MIN_N && oosr24.n >= MIN_N) {
          robust = '⚠ flips';
        } else if ((isr24.n < MIN_N || oosr24.n < MIN_N)) {
          robust = 'thin-n';
        }
        const ic48s = (isFinite(isr48.ic) ? (isr48.ic >= 0 ? '+' : '') + isr48.ic.toFixed(3) : 'NaN')
          + ' / ' + (isFinite(oosr48.ic) ? (oosr48.ic >= 0 ? '+' : '') + oosr48.ic.toFixed(3) : 'NaN');
        console.log(
          (b.label === buckets[0].label ? s.name : '').padEnd(16) +
          b.label.padEnd(16) + ' │ ' + fmtIc(isr24) + '      │ ' + fmtIc(oosr24) + '      │ ' +
          ic48s.padEnd(18) + '   │ ' + robust,
        );
      }
      console.log('');
    }
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

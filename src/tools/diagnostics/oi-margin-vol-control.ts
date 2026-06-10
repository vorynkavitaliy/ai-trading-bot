/**
 * oi-margin-vol-control — the only stable signal from oi-margin-edge was
 * coin_share → forward realized vol / drawdown (both halves). This checks whether
 * that survives controlling for vol-clustering: does coin_share predict forward
 * vol BEYOND trailing realized vol? If trailing-vol already explains it, coin_share
 * adds nothing (mechanical leverage→vol, not new info).
 *
 * Compares: IC(coin_share, fwdVol) vs IC(trailing_realized_vol, fwdVol), plus the
 * residual: rank-regress coin_share on trailing-vol & trailing-return, take residual,
 * re-IC vs fwdVol. Read-only daily BTC.
 * Run: npx tsx src/tools/diagnostics/oi-margin-vol-control.ts
 */
import { cgGet } from '../../core/coinglass';
import { query, close as closePg } from '../../core/db';

const EX = 'Binance,OKX,Bybit,Bitget,Gate,Huobi,Deribit,dYdX,Bitmex,CoinEx';
const COIN_PATH = '/futures/open-interest/aggregated-coin-margin-history';
const STABLE_PATH = '/futures/open-interest/aggregated-stablecoin-history';
const INTERVAL = '1d';

type Row = { ts: number; val: number };
async function fetchSeries(path: string): Promise<Row[]> {
  const r = await cgGet<any>(path, { symbol: 'BTC', interval: INTERVAL, exchange_list: EX, limit: 100000 });
  return (r.data as any[]).map(x => ({ ts: Number(x.time), val: Number(x.close) })).filter(x => isFinite(x.ts) && isFinite(x.val)).sort((a, b) => a.ts - b.ts);
}
function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function spearman(x: (number | null)[], y: (number | null)[]) {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } }
  const n = xs.length; if (n < 25) return { ic: NaN, n };
  const rx = rank(xs), ry = rank(ys); const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return { ic: dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN, n };
}
function alignLatest(targetTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(targetTs.length).fill(null); let j = 0;
  for (let i = 0; i < targetTs.length; i++) { while (j < series.length && series[j].ts <= targetTs[i]) j++; out[i] = j > 0 ? series[j - 1].val : null; }
  return out;
}
// OLS residual of y on [predictors] (on overlapping non-null rows), returned aligned to input length (null where any missing).
function residualize(y: (number | null)[], preds: (number | null)[][]): (number | null)[] {
  const idx: number[] = [];
  for (let i = 0; i < y.length; i++) { if (y[i] != null && preds.every(p => p[i] != null)) idx.push(i); }
  const m = idx.length, k = preds.length + 1;
  // design matrix
  const X: number[][] = idx.map(i => [1, ...preds.map(p => p[i]!)]);
  const Y = idx.map(i => y[i]!);
  // normal equations XtX b = XtY (k small)
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const XtY = new Array(k).fill(0);
  for (let r = 0; r < m; r++) { for (let a = 0; a < k; a++) { XtY[a] += X[r][a] * Y[r]; for (let b = 0; b < k; b++) XtX[a][b] += X[r][a] * X[r][b]; } }
  // gaussian elimination
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(XtX[r][c]) > Math.abs(XtX[piv][c])) piv = r;
    [XtX[c], XtX[piv]] = [XtX[piv], XtX[c]]; [XtY[c], XtY[piv]] = [XtY[piv], XtY[c]];
    const d = XtX[c][c] || 1e-12;
    for (let r = 0; r < k; r++) { if (r === c) continue; const f = XtX[r][c] / d; for (let b = 0; b < k; b++) XtX[r][b] -= f * XtX[c][b]; XtY[r] -= f * XtY[c]; }
  }
  const beta = XtY.map((v, i) => v / (XtX[i][i] || 1e-12));
  const out: (number | null)[] = new Array(y.length).fill(null);
  for (let r = 0; r < m; r++) { let pred = beta[0]; for (let p = 0; p < preds.length; p++) pred += beta[p + 1] * X[r][p + 1]; out[idx[r]] = Y[r] - pred; }
  return out;
}

async function main() {
  const coin = await fetchSeries(COIN_PATH), stableBtc = await fetchSeries(STABLE_PATH);
  const ts = coin.map(r => r.ts);
  const stableA = alignLatest(ts, stableBtc);
  const cndl = await query<any>(`SELECT ts, close::text c, low::text l FROM candles WHERE symbol='BTCUSDT' AND tf='1D' ORDER BY ts ASC`, []);
  const pr = cndl.rows.map((r: any) => ({ ts: Number(r.ts), c: parseFloat(r.c), l: parseFloat(r.l) }));
  const N = ts.length; const close: (number | null)[] = new Array(N).fill(null); const low: (number | null)[] = new Array(N).fill(null);
  { let j = 0; for (let i = 0; i < N; i++) { while (j < pr.length && pr[j].ts <= ts[i]) j++; if (j > 0) { close[i] = pr[j - 1].c; low[i] = pr[j - 1].l; } } }

  const coinShare: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) { const p = close[i]; if (p != null && stableA[i] != null) { const su = stableA[i]! * p; const cu = coin[i].val; if (cu + su > 0) coinShare[i] = cu / (cu + su); } }

  // trailing realized vol (7d) and trailing return (7d)
  const trailVol7: (number | null)[] = new Array(N).fill(null);
  const trailRet7: (number | null)[] = new Array(N).fill(null);
  for (let i = 7; i < N; i++) {
    const rs: number[] = []; let ok = true;
    for (let k = 0; k < 7; k++) { const a = close[i - 7 + k], b = close[i - 6 + k]; if (a == null || b == null || a <= 0 || b <= 0) { ok = false; break; } rs.push(Math.log(b / a)); }
    if (ok && rs.length > 1) { const m = rs.reduce((s, v) => s + v, 0) / rs.length; trailVol7[i] = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (rs.length - 1)); }
    const a = close[i - 7], b = close[i]; if (a != null && b != null && a > 0) trailRet7[i] = (b - a) / a;
  }
  // forward vol7 & forward maxDD7
  const fwdVol7: (number | null)[] = new Array(N).fill(null), fwdDD7: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i + 7 < N; i++) {
    const rs: number[] = []; let ok = true;
    for (let k = 1; k <= 7; k++) { const a = close[i + k - 1], b = close[i + k]; if (a == null || b == null || a <= 0 || b <= 0) { ok = false; break; } rs.push(Math.log(b / a)); }
    if (ok) { const m = rs.reduce((s, v) => s + v, 0) / rs.length; fwdVol7[i] = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (rs.length - 1)); }
    const base = close[i]; if (base != null && base > 0) { let w = 0, ok2 = true; for (let k = 1; k <= 7; k++) { const lo = low[i + k]; if (lo == null) { ok2 = false; break; } w = Math.min(w, (lo - base) / base); } if (ok2) fwdDD7[i] = w; }
  }

  // residualize coin_share on trailing vol + trailing return (remove vol-clustering & momentum)
  const shareResid = residualize(coinShare, [trailVol7, trailRet7]);

  const priceValidIdx = ts.map((_, i) => i).filter(i => close[i] != null);
  const midIdx = priceValidIdx[Math.floor(priceValidIdx.length / 2)];
  const isV = (a: (number | null)[]) => a.map((v, i) => i < midIdx ? v : null);
  const oosV = (a: (number | null)[]) => a.map((v, i) => i >= midIdx ? v : null);
  const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : ' NaN').padStart(7);

  console.log(`\n══ VOL-CONTROL: does coin_share add info beyond vol-clustering / momentum? ══`);
  console.log(`N=${N}, split @ idx ${midIdx} (${new Date(ts[midIdx]).toISOString().slice(0,10)})\n`);
  console.log('predictor → target'.padEnd(46) + 'IC_IS    IC_OOS');
  const tests: [string, (number|null)[], (number|null)[]][] = [
    ['coin_share → fwdVol7', coinShare, fwdVol7],
    ['trailing_vol7 → fwdVol7 (clustering bench)', trailVol7, fwdVol7],
    ['coin_share RESID(vol,ret) → fwdVol7', shareResid, fwdVol7],
    ['coin_share → fwdMaxDD7', coinShare, fwdDD7],
    ['trailing_vol7 → fwdMaxDD7 (bench)', trailVol7, fwdDD7],
    ['coin_share RESID(vol,ret) → fwdMaxDD7', shareResid, fwdDD7],
  ];
  for (const [name, sig, tgt] of tests) {
    const iIs = spearman(isV(sig), isV(tgt)).ic, iOos = spearman(oosV(sig), oosV(tgt)).ic;
    console.log(name.padEnd(46) + f(iIs) + '  ' + f(iOos));
  }
  console.log(`\n(If RESID IC collapses toward 0 → coin_share's vol/DD signal is just vol-clustering + momentum, not new info.)`);
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * oi-mcap-saturation — LEVERAGE-SATURATION family edge test.
 *
 * Archetype: total futures OI (USD) divided by total stablecoin marketcap = how
 * "leveraged-up" the whole market is relative to the dry-powder stablecoin base.
 * Extreme high ratio -> over-leveraged -> fragility -> fade (predicts DROP / deeper
 * fwd drawdown / more fwd vol). Also tests stablecoin-margin OI SHARE *trend*
 * (stable_share and its 7d change), the second leg of the family.
 *
 * This is DISTINCT from oi-margin-edge.ts which tested coin-margin vs stablecoin
 * COMPOSITION share. Here the headline signal is OI / stablecoin-MCAP saturation.
 *
 * Data (Coinglass v4, Standard key, all confirmed 200-ok daily, ~999d 2023-09→2026-06):
 *   total OI (USD):       /futures/open-interest/aggregated-history            close=USD
 *   coin-margin OI (USD): /futures/open-interest/aggregated-coin-margin-history close=USD
 *   stablecoin OI (BTC):  /futures/open-interest/aggregated-stablecoin-history  close=BTC units
 *   stablecoin MCAP:      /index/stableCoin-marketCap-history (daily, data_list per-coin USD, sum across coins)
 * BTC daily candles from our own `candles` table (24/7) for fwd returns/vol/DD + price-proxy controls.
 *
 * Discipline bar (per prompt): same-sign IS & OOS with |Spearman IC| >= 0.05 at some
 * horizon OR a clean monotone quintile spread both halves; AND orthogonal to
 * funding_oi pct (live fade) and trailing same-horizon price return (lagged momentum).
 * Daily data -> 1d/3d/7d horizons. IS/OOS split at midpoint of price-valid rows.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/oi-mcap-saturation.ts
 */
import { cgGet } from '../../core/coinglass';
import { query, close as closePg } from '../../core/db';

const EX = 'Binance,OKX,Bybit,Bitget,Gate,Huobi,Deribit,dYdX,Bitmex,CoinEx';
const INTERVAL = '1d';

type Row = { ts: number; val: number };

// OHLC-close series fetcher for OI endpoints (close key, USD or coin units)
async function fetchOi(path: string): Promise<Row[]> {
  const r = await cgGet<any>(path, { symbol: 'BTC', interval: INTERVAL, exchange_list: EX, limit: 4500 });
  const d = r.data as any[];
  return d.map(x => ({ ts: Number(x.time), val: Number(x.close) }))
          .filter(x => isFinite(x.ts) && isFinite(x.val))
          .sort((a, b) => a.ts - b.ts);
}

// stablecoin MCAP: sum of per-coin marketcaps in data_list, aligned to time_list (ms)
async function fetchStableMcap(): Promise<Row[]> {
  const r = await cgGet<any>('/index/stableCoin-marketCap-history', {});
  const dl = r.data.data_list as Record<string, number>[];
  const tl = r.data.time_list as (number | string)[];
  const out: Row[] = [];
  for (let i = 0; i < tl.length; i++) {
    const obj = dl[i] || {};
    let sum = 0;
    for (const k of Object.keys(obj)) { const v = Number(obj[k]); if (isFinite(v)) sum += v; }
    const ts = Number(tl[i]);
    if (isFinite(ts) && sum > 0) out.push({ ts: ts < 1e12 ? ts * 1000 : ts, val: sum });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// ---- stats ----
function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function spearman(x: (number | null)[], y: (number | null)[]): { ic: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } }
  const n = xs.length; if (n < 25) return { ic: NaN, n };
  const rx = rank(xs), ry = rank(ys); const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return { ic: dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN, n };
}
function quintiles(sig: (number | null)[], fwd: (number | null)[]): { q: number[]; spread: number; monotone: boolean } {
  const pairs: [number, number][] = [];
  for (let i = 0; i < sig.length; i++) { const a = sig[i], b = fwd[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) pairs.push([a, b]); }
  pairs.sort((a, b) => a[0] - b[0]); const n = pairs.length; const q: number[] = [];
  for (let bk = 0; bk < 5; bk++) { const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5); let s = 0; for (let i = lo; i < hi; i++) s += pairs[i][1]; q.push(hi > lo ? (s / (hi - lo)) : NaN); }
  let mono = true; const inc = q[4] > q[0];
  for (let k = 1; k < 5; k++) if (inc ? q[k] < q[k - 1] : q[k] > q[k - 1]) { mono = false; break; }
  return { q, spread: q[4] - q[0], monotone: mono };
}
function alignLatest(targetTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(targetTs.length).fill(null); let j = 0;
  for (let i = 0; i < targetTs.length; i++) { while (j < series.length && series[j].ts <= targetTs[i]) j++; out[i] = j > 0 ? series[j - 1].val : null; }
  return out;
}

// rolling-window percentile of a series (level-based extreme detector) — null until window filled
function rollPct(arr: (number | null)[], W: number, minN = 20): (number | null)[] {
  const out: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    const win: number[] = [];
    for (let k = Math.max(0, i - W + 1); k <= i; k++) if (arr[k] != null) win.push(arr[k]!);
    if (win.length < minN) continue;
    const lt = win.filter(v => v < arr[i]!).length;
    out[i] = lt / win.length;
  }
  return out;
}

async function main() {
  const totalOi = await fetchOi('/futures/open-interest/aggregated-history');     // USD
  const coinOi = await fetchOi('/futures/open-interest/aggregated-coin-margin-history'); // USD
  const stableOiBtc = await fetchOi('/futures/open-interest/aggregated-stablecoin-history'); // BTC units
  const stableMcap = await fetchStableMcap(); // USD sum
  console.log(`totalOI n=${totalOi.length}  coinOI n=${coinOi.length}  stableOI(BTC) n=${stableOiBtc.length}  stableMCAP n=${stableMcap.length}`);

  // unified daily grid = totalOi grid
  const ts = totalOi.map(r => r.ts);
  const N = ts.length;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

  const coinA = alignLatest(ts, coinOi);
  const stableBtcA = alignLatest(ts, stableOiBtc);
  const mcapA = alignLatest(ts, stableMcap);
  const totalA = totalOi.map(r => r.val);

  // BTC daily close/high/low from our candles (24/7)
  const cndl = await query<any>(`SELECT ts, close::text AS c, high::text AS h, low::text AS l FROM candles WHERE symbol='BTCUSDT' AND tf='1D' ORDER BY ts ASC`, []);
  const pr: { ts: number; c: number; h: number; l: number }[] = cndl.rows.map((r: any) => ({ ts: Number(r.ts), c: parseFloat(r.c), h: parseFloat(r.h), l: parseFloat(r.l) }));
  const close: (number | null)[] = new Array(N).fill(null), low: (number | null)[] = new Array(N).fill(null);
  { let j = 0; for (let i = 0; i < N; i++) { while (j < pr.length && pr[j].ts <= ts[i]) j++; if (j > 0) { close[i] = pr[j - 1].c; low[i] = pr[j - 1].l; } } }
  console.log(`candles BTCUSDT 1D: n=${pr.length}  ${pr.length ? iso(pr[0].ts) + '→' + iso(pr[pr.length-1].ts) : 'EMPTY'}`);

  // ---- derived signals ----
  // total OI USD: prefer agg-history close; cross-check with coinUSD + stableBTC*price
  const totalOiRecon: (number | null)[] = new Array(N).fill(null);   // reconstructed total (USD)
  const satTotal: (number | null)[] = new Array(N).fill(null);       // total OI USD / stablecoin MCAP
  const satRecon: (number | null)[] = new Array(N).fill(null);       // reconstructed OI USD / MCAP
  const stableShare: (number | null)[] = new Array(N).fill(null);    // stablecoin-margin OI USD / total OI USD
  for (let i = 0; i < N; i++) {
    const p = close[i];
    if (p != null && stableBtcA[i] != null && coinA[i] != null) {
      const stableUsd = stableBtcA[i]! * p;
      const recon = coinA[i]! + stableUsd;
      totalOiRecon[i] = recon;
      if (recon > 0) stableShare[i] = stableUsd / recon;
      if (mcapA[i] != null && mcapA[i]! > 0) satRecon[i] = recon / mcapA[i]!;
    }
    if (mcapA[i] != null && mcapA[i]! > 0 && totalA[i] != null) satTotal[i] = totalA[i]! / mcapA[i]!;
  }
  // 7d change in stable_share (composition trend) and in saturation ratio
  const LB = 7;
  const stableShareChg: (number | null)[] = new Array(N).fill(null);
  const satTotalChg: (number | null)[] = new Array(N).fill(null);
  for (let i = LB; i < N; i++) {
    if (stableShare[i] != null && stableShare[i - LB] != null) stableShareChg[i] = stableShare[i]! - stableShare[i - LB]!;
    if (satTotal[i] != null && satTotal[i - LB] != null && satTotal[i - LB]! > 0) satTotalChg[i] = satTotal[i]! / satTotal[i - LB]! - 1;
  }
  // rolling-percentile EXTREME detectors (30d and 60d) on the saturation ratio (the live-style fade signal shape)
  const satPct30 = rollPct(satTotal, 30);
  const satPct60 = rollPct(satTotal, 60);

  // ---- forward targets ----
  const fwdRet = (K: number) => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) { const a = close[i], b = close[i + K]; if (a != null && b != null && a > 0) o[i] = (b - a) / a; } return o; };
  const fwdVol = (K: number) => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) { const rs: number[] = []; let ok = true; for (let k = 1; k <= K; k++) { const a = close[i + k - 1], b = close[i + k]; if (a == null || b == null || a <= 0 || b <= 0) { ok = false; break; } rs.push(Math.log(b / a)); } if (!ok || rs.length < 2) continue; const m = rs.reduce((s, v) => s + v, 0) / rs.length; o[i] = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (rs.length - 1)); } return o; };
  const fwdDD = (K: number) => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) { const base = close[i]; if (base == null || base <= 0) continue; let w = 0, ok = true; for (let k = 1; k <= K; k++) { const lo = low[i + k]; if (lo == null) { ok = false; break; } w = Math.min(w, (lo - base) / base); } if (ok) o[i] = w; } return o; };
  const trailRet = (K: number) => { const o: (number | null)[] = new Array(N).fill(null); for (let i = K; i < N; i++) { const a = close[i - K], b = close[i]; if (a != null && b != null && a > 0) o[i] = (b - a) / a; } return o; };

  const fr1 = fwdRet(1), fr3 = fwdRet(3), fr7 = fwdRet(7);
  const fv3 = fwdVol(3), fv7 = fwdVol(7);
  const fd3 = fwdDD(3), fd7 = fwdDD(7);
  const tr3 = trailRet(3), tr7 = trailRet(7);

  // funding_oi percentile (live fade) for orthogonality
  const fund = await query<any>(`SELECT ts, fr_close::text AS v FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`, []);
  const fundSeries: Row[] = fund.rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.v) })).filter((r: Row) => isFinite(r.val));
  const fundA = alignLatest(ts, fundSeries);
  const fundPct = rollPct(fundA, 30);

  // ---- IS/OOS split at midpoint of price-valid rows ----
  const validIdx = ts.map((_, i) => i).filter(i => close[i] != null);
  const midIdx = validIdx.length ? validIdx[Math.floor(validIdx.length / 2)] : Math.floor(N / 2);
  const midTs = ts[midIdx];
  const splitArr = (arr: (number | null)[], half: 'IS' | 'OOS') => arr.map((v, i) => ((half === 'IS' ? i < midIdx : i >= midIdx) ? v : null));
  const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : ' NaN').padStart(7);

  console.log(`\n══ LEVERAGE-SATURATION EDGE: BTC daily ══`);
  console.log(`grid n=${N}: ${iso(ts[0])} → ${iso(ts[N-1])}   split @ ${iso(midTs)} (IS<mid<=OOS, ${midIdx}/${N-midIdx})`);
  console.log(`sat_total today = OI_USD/stable_MCAP = ${(satTotal[N-1] ?? NaN).toFixed(4)}   stable_share today = ${(stableShare[N-1] ?? NaN).toFixed(4)}`);
  // sanity: recon-vs-direct total OI correlation
  console.log(`sanity totalOi(direct) vs recon(coin+stable*px) full-sample IC = ${f(spearman(totalA, totalOiRecon).ic)}`);
  console.log(`IC = Spearman(signal,target). Returns: NEG = high-signal precedes DROP (fade). Vol/DD: POS vol / NEG DD = high-signal precedes more vol/deeper DD.`);

  const SIGNALS: { name: string; vals: (number | null)[] }[] = [
    { name: 'sat_total (OI_USD/MCAP)', vals: satTotal },
    { name: 'sat_recon (reconOI/MCAP)', vals: satRecon },
    { name: 'sat_total_chg7d', vals: satTotalChg },
    { name: 'sat_pct30 (rolling extreme)', vals: satPct30 },
    { name: 'sat_pct60 (rolling extreme)', vals: satPct60 },
    { name: 'stable_share (OI USD)', vals: stableShare },
    { name: 'stable_share_chg7d', vals: stableShareChg },
  ];

  console.log(`\n--- FORWARD RETURN (Spearman IC, IS | OOS) ---`);
  console.log('signal'.padEnd(30) + ' │  r1_IS  r3_IS  r7_IS │  r1_OOS r3_OOS r7_OOS │ Q5-Q1 r7d% IS/OOS │ read(7d)');
  for (const s of SIGNALS) {
    const is = (h: (number|null)[]) => spearman(splitArr(s.vals, 'IS'), h).ic;
    const oo = (h: (number|null)[]) => spearman(splitArr(s.vals, 'OOS'), h).ic;
    const i1 = is(fr1), i3 = is(fr3), i7 = is(fr7), o1 = oo(fr1), o3 = oo(fr3), o7 = oo(fr7);
    const qis = quintiles(splitArr(s.vals, 'IS'), fr7), qoos = quintiles(splitArr(s.vals, 'OOS'), fr7);
    let read = '—';
    if (isFinite(i7) && isFinite(o7) && Math.sign(i7) === Math.sign(o7) && Math.abs(i7) >= 0.05 && Math.abs(o7) >= 0.05) read = i7 < 0 ? 'FADE (drop)' : 'FOLLOW';
    else if (isFinite(i7) && isFinite(o7) && Math.sign(i7) !== Math.sign(o7) && (Math.abs(i7) >= 0.05 || Math.abs(o7) >= 0.05)) read = 'FLIPS IS<->OOS';
    console.log(s.name.padEnd(30) + ' │ ' + f(i1) + ' ' + f(i3) + ' ' + f(i7) + ' │ ' + f(o1) + ' ' + f(o3) + ' ' + f(o7) + ' │ ' + ((qis.spread*100).toFixed(2)).padStart(7) + '/' + ((qoos.spread*100).toFixed(2)).padStart(7) + ' │ ' + read);
  }

  console.log(`\n--- FORWARD REALIZED VOL (Spearman IC, IS | OOS) ---`);
  console.log('signal'.padEnd(30) + ' │ vol3_IS vol7_IS │ vol3_OO vol7_OO │ read(vol7)');
  for (const s of SIGNALS) {
    const is = (h: (number|null)[]) => spearman(splitArr(s.vals, 'IS'), h).ic;
    const oo = (h: (number|null)[]) => spearman(splitArr(s.vals, 'OOS'), h).ic;
    const i3 = is(fv3), i7 = is(fv7), o3 = oo(fv3), o7 = oo(fv7);
    let read = '—';
    if (isFinite(i7) && isFinite(o7) && Math.sign(i7) === Math.sign(o7) && Math.abs(i7) >= 0.05 && Math.abs(o7) >= 0.05) read = i7 > 0 ? 'predicts MORE vol' : 'predicts LESS vol';
    console.log(s.name.padEnd(30) + ' │ ' + f(i3) + ' ' + f(i7) + ' │ ' + f(o3) + ' ' + f(o7) + ' │ ' + read);
  }

  console.log(`\n--- FORWARD MAX DRAWDOWN (Spearman IC; DD<=0 so NEG IC = high-signal precedes DEEPER DD) ---`);
  console.log('signal'.padEnd(30) + ' │ dd3_IS  dd7_IS │ dd3_OO  dd7_OO │ read(dd7)');
  for (const s of SIGNALS) {
    const is = (h: (number|null)[]) => spearman(splitArr(s.vals, 'IS'), h).ic;
    const oo = (h: (number|null)[]) => spearman(splitArr(s.vals, 'OOS'), h).ic;
    const i3 = is(fd3), i7 = is(fd7), o3 = oo(fd3), o7 = oo(fd7);
    let read = '—';
    if (isFinite(i7) && isFinite(o7) && Math.sign(i7) === Math.sign(o7) && Math.abs(i7) >= 0.05 && Math.abs(o7) >= 0.05) read = i7 < 0 ? 'predicts DEEPER DD' : 'predicts SHALLOWER DD';
    console.log(s.name.padEnd(30) + ' │ ' + f(i3) + ' ' + f(i7) + ' │ ' + f(o3) + ' ' + f(o7) + ' │ ' + read);
  }

  console.log(`\n--- ORTHOGONALITY (full-sample Spearman) ---`);
  console.log('signal'.padEnd(30) + ' vs funding_oi_pct │ vs trail_ret3 │ vs trail_ret7 │ vs BTC price level');
  for (const s of SIGNALS) {
    const vf = spearman(s.vals, fundPct).ic, v3 = spearman(s.vals, tr3).ic, v7 = spearman(s.vals, tr7).ic, vp = spearman(s.vals, close).ic;
    console.log(s.name.padEnd(30) + '   ' + f(vf) + '       │   ' + f(v3) + '   │   ' + f(v7) + '   │   ' + f(vp));
  }
  console.log(`(High |corr| vs price level => the signal is mostly a price proxy. High |corr| vs trail_ret => lagged momentum repackaging.)`);

  // ---- RESIDUAL CONTROL: does sat_total predict fwd return BEYOND price level + trailing return? ----
  // OLS residual of sat_total on [log(price), trail_ret7]; re-IC residual vs fwd return, both halves.
  function residualize(y: (number | null)[], preds: (number | null)[][]): (number | null)[] {
    const idx: number[] = [];
    for (let i = 0; i < y.length; i++) if (y[i] != null && preds.every(p => p[i] != null)) idx.push(i);
    const m = idx.length, k = preds.length + 1;
    const X = idx.map(i => [1, ...preds.map(p => p[i]!)]);
    const Y = idx.map(i => y[i]!);
    const XtX = Array.from({ length: k }, () => new Array(k).fill(0)); const XtY = new Array(k).fill(0);
    for (let r = 0; r < m; r++) for (let a = 0; a < k; a++) { XtY[a] += X[r][a] * Y[r]; for (let b = 0; b < k; b++) XtX[a][b] += X[r][a] * X[r][b]; }
    for (let c = 0; c < k; c++) { let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(XtX[r][c]) > Math.abs(XtX[piv][c])) piv = r; [XtX[c], XtX[piv]] = [XtX[piv], XtX[c]]; [XtY[c], XtY[piv]] = [XtY[piv], XtY[c]]; const d = XtX[c][c] || 1e-12; for (let r = 0; r < k; r++) { if (r === c) continue; const ff = XtX[r][c] / d; for (let b = 0; b < k; b++) XtX[r][b] -= ff * XtX[c][b]; XtY[r] -= ff * XtY[c]; } }
    const beta = XtY.map((v, i) => v / (XtX[i][i] || 1e-12));
    const out: (number | null)[] = new Array(y.length).fill(null);
    for (let r = 0; r < m; r++) { let pred = beta[0]; for (let p = 0; p < preds.length; p++) pred += beta[p + 1] * X[r][p + 1]; out[idx[r]] = Y[r] - pred; }
    return out;
  }
  const logPx = close.map(c => c != null && c > 0 ? Math.log(c) : null);
  const satResidPxMom = residualize(satTotal, [logPx, tr7]);
  console.log(`\n--- RESIDUAL CONTROL: sat_total residualized on [log(price), trail_ret7] → fwd return ---`);
  for (const [nm, tgt] of [['fr3', fr3], ['fr7', fr7]] as [string, (number|null)[]][]) {
    const iIs = spearman(splitArr(satResidPxMom, 'IS'), tgt).ic, iOos = spearman(splitArr(satResidPxMom, 'OOS'), tgt).ic;
    console.log(`sat_total_RESID(px,mom) → ${nm}:  IS ${f(iIs)}  OOS ${f(iOos)}`);
  }
  console.log(`(If residual IC collapses toward 0 / flips => sat_total's return signal was just price-level + momentum, not new info.)`);

  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

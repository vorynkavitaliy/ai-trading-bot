/**
 * oi-margin-edge — does coin-margined vs stablecoin-margined OI structure predict
 * BTC forward return / forward realized-vol / forward drawdown?
 *
 * Archetype: reflexive leverage. Coin-margined positions are collateralized in the
 * coin itself, so coin-margin liquidations feed back into price (down-spirals). A
 * rising coin-margin SHARE should mark fragility/regime → test fwd return + fwd
 * realized-vol/drawdown conditional on the ratio.
 *
 * Data (Coinglass v4, Standard key, confirmed 200-ok):
 *   coin-margin OI (USD):  /futures/open-interest/aggregated-coin-margin-history
 *   stablecoin OI (BTC):   /futures/open-interest/aggregated-stablecoin-history
 * Daily interval gives ~999d (2023-09 → 2026-06) — enough for IS/OOS.
 * Units differ: coin = USD, stable = BTC → convert stable to USD via BTC close.
 *
 * Forward windows: daily data → 1d / 3d / 7d horizons.
 * Discipline bar: same-sign IS & OOS, |Spearman IC| ≥ 0.05 at some horizon, OR a
 * clean monotone quintile spread both halves; AND orthogonal to funding_oi pct and
 * to trailing same-horizon price return (not lagged momentum).
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/oi-margin-edge.ts
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
  const d = r.data as any[];
  return d.map(x => ({ ts: Number(x.time), val: Number(x.close) }))
          .filter(x => isFinite(x.ts) && isFinite(x.val))
          .sort((a, b) => a.ts - b.ts);
}

// ----- stats helpers (Spearman rank-IC, quintile spread) -----
function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  // average ranks for ties
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(x: (number | null)[], y: (number | null)[]): { ic: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const n = xs.length;
  if (n < 25) return { ic: NaN, n };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return { ic: dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN, n };
}
function quintiles(sig: (number | null)[], fwd: (number | null)[]): { q: number[]; spread: number; monotone: boolean } {
  const pairs: [number, number][] = [];
  for (let i = 0; i < sig.length; i++) {
    const a = sig[i], b = fwd[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) pairs.push([a, b]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const q: number[] = [];
  for (let bk = 0; bk < 5; bk++) {
    const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5);
    let s = 0; for (let i = lo; i < hi; i++) s += pairs[i][1];
    q.push(hi > lo ? (s / (hi - lo)) : NaN);
  }
  let mono = true;
  const inc = q[4] > q[0];
  for (let k = 1; k < 5; k++) if (inc ? q[k] < q[k - 1] : q[k] > q[k - 1]) { mono = false; break; }
  return { q, spread: q[4] - q[0], monotone: mono };
}

// align a series onto a target ts grid: latest val at ts' <= target (no look-ahead)
function alignLatest(targetTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(targetTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < targetTs.length; i++) {
    while (j < series.length && series[j].ts <= targetTs[i]) j++;
    out[i] = j > 0 ? series[j - 1].val : null;
  }
  return out;
}

async function main() {
  const coin = await fetchSeries(COIN_PATH);     // USD
  const stableBtc = await fetchSeries(STABLE_PATH); // BTC units
  console.log(`coin n=${coin.length}  stable n=${stableBtc.length}`);

  // Build a unified daily ts grid = coin's grid (both share the same daily timestamps)
  const ts = coin.map(r => r.ts);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

  // align stable onto coin grid
  const stableA = alignLatest(ts, stableBtc);

  // BTC daily close from our own candles table (24/7). Daily tf='1D'.
  const cndl = await query<any>(
    `SELECT ts, close::text AS c, high::text AS h, low::text AS l FROM candles WHERE symbol='BTCUSDT' AND tf='1D' ORDER BY ts ASC`, []);
  const priceRows: { ts: number; c: number; h: number; l: number }[] = cndl.rows.map((r: any) => ({
    ts: Number(r.ts), c: parseFloat(r.c), h: parseFloat(r.h), l: parseFloat(r.l),
  }));
  // align close/high/low onto the OI grid (latest bar at-or-before each OI ts)
  const closeA: (number | null)[] = new Array(ts.length).fill(null);
  const highA: (number | null)[] = new Array(ts.length).fill(null);
  const lowA: (number | null)[] = new Array(ts.length).fill(null);
  {
    let j = 0;
    for (let i = 0; i < ts.length; i++) {
      while (j < priceRows.length && priceRows[j].ts <= ts[i]) j++;
      if (j > 0) { closeA[i] = priceRows[j - 1].c; highA[i] = priceRows[j - 1].h; lowA[i] = priceRows[j - 1].l; }
    }
  }

  const N = ts.length;
  const close = closeA;

  // ---- derived signals ----
  // coin-margin share in USD: coinUSD / (coinUSD + stableBTC*price)
  const coinUsd = coin.map(r => r.val);
  const stableUsd: (number | null)[] = new Array(N).fill(null);
  const coinShare: (number | null)[] = new Array(N).fill(null);
  const rawRatio: (number | null)[] = new Array(N).fill(null);      // coinUSD / stableBTC (unit-mixed, archetype literal)
  const rawRatioUsd: (number | null)[] = new Array(N).fill(null);   // coinUSD / stableUSD (unit-consistent)
  for (let i = 0; i < N; i++) {
    const p = close[i];
    if (p != null && stableA[i] != null) { stableUsd[i] = stableA[i]! * p; }
    if (stableUsd[i] != null && coinUsd[i] != null && (coinUsd[i]! + stableUsd[i]!) > 0) {
      coinShare[i] = coinUsd[i]! / (coinUsd[i]! + stableUsd[i]!);
      rawRatioUsd[i] = coinUsd[i]! / stableUsd[i]!;
    }
    if (stableA[i] != null && stableA[i]! > 0 && coinUsd[i] != null) rawRatio[i] = coinUsd[i]! / stableA[i]!;
  }
  // 7d change in coin-share (regime shift, not level)
  const LB = 7;
  const coinShareChg: (number | null)[] = new Array(N).fill(null);
  for (let i = LB; i < N; i++) if (coinShare[i] != null && coinShare[i - LB] != null) coinShareChg[i] = coinShare[i]! - coinShare[i - LB]!;

  // ---- forward targets ----
  function fwdRet(K: number): (number | null)[] {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) { const a = close[i], b = close[i + K]; if (a != null && b != null && a > 0) out[i] = (b - a) / a; }
    return out;
  }
  // forward realized vol: stdev of daily log returns over next K days
  function fwdVol(K: number): (number | null)[] {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) {
      const rs: number[] = [];
      let ok = true;
      for (let k = 1; k <= K; k++) { const a = close[i + k - 1], b = close[i + k]; if (a == null || b == null || a <= 0 || b <= 0) { ok = false; break; } rs.push(Math.log(b / a)); }
      if (!ok || rs.length < 2) continue;
      const m = rs.reduce((s, v) => s + v, 0) / rs.length;
      const v = rs.reduce((s, x) => s + (x - m) * (x - m), 0) / (rs.length - 1);
      out[i] = Math.sqrt(v);
    }
    return out;
  }
  // forward max drawdown over next K days (as positive magnitude): min((low_j - close_i)/close_i)
  function fwdMaxDD(K: number): (number | null)[] {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) {
      const base = close[i]; if (base == null || base <= 0) continue;
      let worst = 0; let ok = true;
      for (let k = 1; k <= K; k++) { const lo = lowA[i + k]; if (lo == null) { ok = false; break; } worst = Math.min(worst, (lo - base) / base); }
      if (ok) out[i] = worst; // <= 0
    }
    return out;
  }

  const fwdRet1 = fwdRet(1), fwdRet3 = fwdRet(3), fwdRet7 = fwdRet(7);
  const fwdVol3 = fwdVol(3), fwdVol7 = fwdVol(7);
  const fwdDD3 = fwdMaxDD(3), fwdDD7 = fwdMaxDD(7);

  // trailing same-horizon price return (lagged-momentum control)
  function trailRet(K: number): (number | null)[] {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = K; i < N; i++) { const a = close[i - K], b = close[i]; if (a != null && b != null && a > 0) out[i] = (b - a) / a; }
    return out;
  }
  const trail3 = trailRet(3), trail7 = trailRet(7);

  // ---- funding_oi percentile (the live fade) for orthogonality ----
  // cg_funding_oi_weighted is in the project DB; build a 30d-rolling percentile on its own daily-ish series, aligned to OI grid.
  const fund = await query<any>(`SELECT ts, fr_close::text AS v FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`, []);
  const fundSeries: Row[] = fund.rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.v) })).filter((r: Row) => isFinite(r.val));
  const fundA = alignLatest(ts, fundSeries);
  // rolling percentile (180-bar window on daily ≈ but fund is 4h; we just rank within trailing window of aligned values)
  const fundPct: (number | null)[] = new Array(N).fill(null);
  const W = 30;
  for (let i = 0; i < N; i++) {
    if (fundA[i] == null) continue;
    const win: number[] = [];
    for (let k = Math.max(0, i - W + 1); k <= i; k++) if (fundA[k] != null) win.push(fundA[k]!);
    if (win.length < 10) continue;
    const lt = win.filter(v => v < fundA[i]!).length;
    fundPct[i] = lt / win.length;
  }

  // ---- IS/OOS split at midpoint of rows that actually have price (daily candles
  // start 2024-05-25, well after OI history starts 2023-09) so both halves are
  // populated. Compute the median ts among price-valid OI rows. ----
  const priceValidIdx = ts.map((_, i) => i).filter(i => close[i] != null);
  const midIdx = priceValidIdx.length ? priceValidIdx[Math.floor(priceValidIdx.length / 2)] : Math.floor(N / 2);
  const midTs = ts[midIdx];
  const splitMask = (half: 'IS' | 'OOS') => (i: number) => half === 'IS' ? i < midIdx : i >= midIdx;
  const splitArr = (arr: (number | null)[], half: 'IS' | 'OOS') => arr.map((v, i) => (splitMask(half)(i) ? v : null));

  console.log(`\n══ OI MARGIN-TYPE EDGE: BTC daily ══`);
  console.log(`OI grid n=${N}: ${iso(ts[0])} → ${iso(ts[N - 1])}   split @ ${iso(midTs)} (IS<mid<=OOS, ${midIdx}/${N - midIdx})`);
  console.log(`coinShare today=${(coinShare[N - 1] ?? NaN).toFixed(4)}  (USD coin / (coin+stable))`);
  console.log(`IC = Spearman(signal, target). For returns: NEG=high-signal precedes DROP. For vol/DD: POS=high-signal precedes more vol / deeper DD.`);

  const SIGNALS: { name: string; vals: (number | null)[] }[] = [
    { name: 'coin_share', vals: coinShare },
    { name: 'coin_share_chg7d', vals: coinShareChg },
    { name: 'raw_ratio_coinUSD/stableUSD', vals: rawRatioUsd },
    { name: 'raw_ratio_coinUSD/stableBTC', vals: rawRatio },
  ];

  // ===== forward RETURN table =====
  console.log(`\n--- FORWARD RETURN (Spearman IC, IS | OOS) ---`);
  console.log('signal'.padEnd(30) + ' │  r1d_IS  r3d_IS  r7d_IS │  r1d_OOS r3d_OOS r7d_OOS │ Q5-Q1 r7d% IS/OOS  │ read(7d)');
  const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : ' NaN').padStart(7);
  for (const s of SIGNALS) {
    const is = (h: (number|null)[]) => spearman(splitArr(s.vals, 'IS'), h).ic;
    const oo = (h: (number|null)[]) => spearman(splitArr(s.vals, 'OOS'), h).ic;
    const i1 = is(fwdRet1), i3 = is(fwdRet3), i7 = is(fwdRet7);
    const o1 = oo(fwdRet1), o3 = oo(fwdRet3), o7 = oo(fwdRet7);
    const qis = quintiles(splitArr(s.vals, 'IS'), fwdRet7);
    const qoos = quintiles(splitArr(s.vals, 'OOS'), fwdRet7);
    let read = '—';
    if (isFinite(i7) && isFinite(o7) && Math.sign(i7) === Math.sign(o7) && Math.abs(i7) >= 0.05 && Math.abs(o7) >= 0.05)
      read = i7 < 0 ? 'FADE stable' : 'FOLLOW stable';
    else if (isFinite(i7) && isFinite(o7) && Math.sign(i7) !== Math.sign(o7) && (Math.abs(i7) >= 0.05 || Math.abs(o7) >= 0.05))
      read = 'flips IS<->OOS';
    console.log(s.name.padEnd(30) + ' │ ' + f(i1) + ' ' + f(i3) + ' ' + f(i7) + ' │ ' + f(o1) + ' ' + f(o3) + ' ' + f(o7) +
      ' │ ' + ((qis.spread * 100).toFixed(2)).padStart(7) + '/' + ((qoos.spread * 100).toFixed(2)).padStart(7) + ' │ ' + read);
  }

  // ===== forward VOL table =====
  console.log(`\n--- FORWARD REALIZED VOL (Spearman IC, IS | OOS) ---`);
  console.log('signal'.padEnd(30) + ' │ vol3_IS vol7_IS │ vol3_OOS vol7_OOS │ Q5-Q1 vol7(bps) IS/OOS │ read(vol7)');
  for (const s of SIGNALS) {
    const is = (h: (number|null)[]) => spearman(splitArr(s.vals, 'IS'), h).ic;
    const oo = (h: (number|null)[]) => spearman(splitArr(s.vals, 'OOS'), h).ic;
    const i3 = is(fwdVol3), i7 = is(fwdVol7), o3 = oo(fwdVol3), o7 = oo(fwdVol7);
    const qis = quintiles(splitArr(s.vals, 'IS'), fwdVol7);
    const qoos = quintiles(splitArr(s.vals, 'OOS'), fwdVol7);
    let read = '—';
    if (isFinite(i7) && isFinite(o7) && Math.sign(i7) === Math.sign(o7) && Math.abs(i7) >= 0.05 && Math.abs(o7) >= 0.05)
      read = i7 > 0 ? 'predicts MORE vol' : 'predicts LESS vol';
    console.log(s.name.padEnd(30) + ' │ ' + f(i3) + ' ' + f(i7) + ' │ ' + f(o3) + ' ' + f(o7) +
      ' │ ' + ((qis.spread * 1e4).toFixed(1)).padStart(8) + '/' + ((qoos.spread * 1e4).toFixed(1)).padStart(8) + ' │ ' + read);
  }

  // ===== forward DRAWDOWN table =====
  console.log(`\n--- FORWARD MAX DRAWDOWN (Spearman IC, IS | OOS; DD<=0 so NEG IC = high-signal precedes DEEPER DD) ---`);
  console.log('signal'.padEnd(30) + ' │ dd3_IS  dd7_IS │ dd3_OOS dd7_OOS │ read(dd7)');
  for (const s of SIGNALS) {
    const is = (h: (number|null)[]) => spearman(splitArr(s.vals, 'IS'), h).ic;
    const oo = (h: (number|null)[]) => spearman(splitArr(s.vals, 'OOS'), h).ic;
    const i3 = is(fwdDD3), i7 = is(fwdDD7), o3 = oo(fwdDD3), o7 = oo(fwdDD7);
    let read = '—';
    if (isFinite(i7) && isFinite(o7) && Math.sign(i7) === Math.sign(o7) && Math.abs(i7) >= 0.05 && Math.abs(o7) >= 0.05)
      read = i7 < 0 ? 'predicts DEEPER DD' : 'predicts SHALLOWER DD';
    console.log(s.name.padEnd(30) + ' │ ' + f(i3) + ' ' + f(i7) + ' │ ' + f(o3) + ' ' + f(o7) + ' │ ' + read);
  }

  // ===== ORTHOGONALITY: best return-signal (coin_share & coin_share_chg7d) vs funding_oi pct & trailing return =====
  console.log(`\n--- ORTHOGONALITY (full-sample Spearman) ---`);
  for (const s of SIGNALS) {
    const vsFund = spearman(s.vals, fundPct);
    const vsTrail3 = spearman(s.vals, trail3);
    const vsTrail7 = spearman(s.vals, trail7);
    console.log(`${s.name.padEnd(30)}  vs funding_oi_pct: ${f(vsFund.ic)} (n=${vsFund.n})   vs trail_ret3: ${f(vsTrail3.ic)}   vs trail_ret7: ${f(vsTrail7.ic)}`);
  }

  // contemporaneous corr of signal with current price level (is share just price-driven?)
  const vsPrice = spearman(coinShare, close);
  console.log(`\ncoin_share vs BTC price level (contemporaneous): ${f(vsPrice.ic)} (n=${vsPrice.n})  [high corr = share is a price proxy]`);

  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

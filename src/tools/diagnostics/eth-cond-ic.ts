/**
 * eth-cond-ic — ANGLE 1 conditional-IC diagnostic.
 *
 * Hypothesis: ETH CG signals have ~noise unconditional IC because the panel
 * AVERAGES two opposing regimes (fade works when BTC ranges, fails when BTC
 * trends). Conditioning on regime may reveal a stable same-sign edge.
 *
 * For the 3 best raw signals (funding_oi, ls_top_position, ls_top_account) and a
 * 2-signal CONFLUENCE, recompute IS/OOS Spearman IC vs fwd 24h/48h ETH return,
 * CONDITIONAL ON:
 *   (a) BTC 4H trend up vs down  (EMA20 vs EMA50 on BTCUSDT 240m)
 *   (b) ETH realized-vol regime  (ATR14 percentile high vs low half, rolling 180-bar)
 *
 * A real conditional edge = SAME-SIGN |IC|>=0.05 in BOTH halves within a bucket.
 *
 * Run: npx tsx src/tools/diagnostics/eth-cond-ic.ts
 */
import { query, close as closePg } from '../../core/db';
import { ema, atr } from '../../core/indicators';

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

// Spearman over the subset of indices `mask` where both x,y finite.
function spearmanMasked(x: (number | null)[], y: (number | null)[], mask: boolean[]): { ic: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (!mask[i]) continue;
    const a = x[i], b = y[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const n = xs.length;
  if (n < 25) return { ic: NaN, n };
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

async function load4h(symbol: string) {
  const c = await query<any>(`SELECT ts, high::text AS h, low::text AS l, close::text AS c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [symbol]);
  return {
    ts: c.rows.map((r: any) => Number(r.ts)),
    high: c.rows.map((r: any) => parseFloat(r.h)),
    low: c.rows.map((r: any) => parseFloat(r.l)),
    close: c.rows.map((r: any) => parseFloat(r.c)),
  };
}

// Rolling EMA20/50 trend on a close series → boolean[] (true=up). null-safe via false.
function rollingTrendUp(close: number[], fast = 20, slow = 50): (boolean | null)[] {
  const out: (boolean | null)[] = new Array(close.length).fill(null);
  for (let i = slow; i < close.length; i++) {
    const win = close.slice(0, i + 1);
    const eF = ema(win, fast), eS = ema(win, slow);
    out[i] = (eF == null || eS == null) ? null : eF > eS;
  }
  return out;
}

// Rolling ATR14 percentile within trailing 180-bar window → 'high'|'low'|null
function rollingVolBucket(high: number[], low: number[], close: number[], period = 14, win = 180): ('high' | 'low' | null)[] {
  const N = close.length;
  const atrSeries: (number | null)[] = new Array(N).fill(null);
  for (let i = period; i < N; i++) {
    const bars = [];
    for (let k = i - period; k <= i; k++) bars.push({ high: high[k], low: low[k], close: close[k] });
    atrSeries[i] = atr(bars, period);
  }
  const out: ('high' | 'low' | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const cur = atrSeries[i];
    if (cur == null) continue;
    const lo = Math.max(0, i - win);
    const hist: number[] = [];
    for (let k = lo; k < i; k++) if (atrSeries[k] != null) hist.push(atrSeries[k]!);
    if (hist.length < 30) continue;
    const med = hist.slice().sort((a, b) => a - b)[Math.floor(hist.length / 2)];
    out[i] = cur >= med ? 'high' : 'low';
  }
  return out;
}

// rolling percentile of a raw signal within trailing 180-bar window
function rollingPct(vals: (number | null)[], win = 180): (number | null)[] {
  const N = vals.length;
  const out: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const cur = vals[i];
    if (cur == null) continue;
    const lo = Math.max(0, i - win);
    const hist: number[] = [];
    for (let k = lo; k < i; k++) if (vals[k] != null) hist.push(vals[k]!);
    if (hist.length < 30) continue;
    let cnt = 0; for (const v of hist) if (v <= cur) cnt++;
    out[i] = cnt / hist.length;
  }
  return out;
}

const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN').padStart(7);

async function main() {
  const pair = 'ETHUSDT';
  const coin = 'ETH';

  const eth = await load4h(pair);
  const btc = await load4h('BTCUSDT');
  const barTs = eth.ts;
  const N = barTs.length;
  const close = eth.close;

  // signals
  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const lsPos = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const lsAcc = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);

  const aFundOi = alignLatest(barTs, fundOi);
  const aLsPos = alignLatest(barTs, lsPos);
  const aLsAcc = alignLatest(barTs, lsAcc);

  // BTC trend aligned to ETH bar grid (BTC 4H trend at each ETH bar ts)
  const btcTrendOwn = rollingTrendUp(btc.close);
  // map BTC bar ts -> trend, then alignLatest to ETH grid
  const btcTrendSeries: Row[] = [];
  for (let i = 0; i < btc.ts.length; i++) if (btcTrendOwn[i] != null) btcTrendSeries.push({ ts: btc.ts[i], val: btcTrendOwn[i] ? 1 : 0 });
  const aBtcTrend = alignLatest(barTs, btcTrendSeries); // 1=up 0=down

  // ETH vol bucket on its own grid
  const volBucket = rollingVolBucket(eth.high, eth.low, close);

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
  const oosHalf = barTs.map(t => t >= midTs);
  const hasCg = barTs.map((_, i) => aFundOi[i] != null || aLsPos[i] != null);

  console.log(`\n══ ETH CONDITIONAL-IC (ANGLE 1) ══`);
  console.log(`bars=${N}, with-CG=${cgIdx.length}, IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
  console.log(`IC = Spearman(signal, fwd ETH return). NEG = high signal precedes DROP = FADE works.`);
  console.log(`Edge bar: SAME-SIGN |IC|>=0.05 in BOTH halves within the same bucket.\n`);

  const SIGNALS: { name: string; vals: (number | null)[] }[] = [
    { name: 'funding_oi', vals: aFundOi },
    { name: 'ls_top_position', vals: aLsPos },
    { name: 'ls_top_account', vals: aLsAcc },
  ];

  // ── (0) Baseline unconditional (CG-covered bars only) ─────────────────────
  console.log('── (0) UNCONDITIONAL (CG bars) ──');
  console.log('signal'.padEnd(18) + ' │  IS24h   IS48h  │  OOS24h  OOS48h │ verdict');
  for (const s of SIGNALS) {
    const maskIS = hasCg.map((c, i) => c && isHalf[i]);
    const maskOOS = hasCg.map((c, i) => c && oosHalf[i]);
    const is24 = spearmanMasked(s.vals, fwd24, maskIS).ic, is48 = spearmanMasked(s.vals, fwd48, maskIS).ic;
    const oo24 = spearmanMasked(s.vals, fwd24, maskOOS).ic, oo48 = spearmanMasked(s.vals, fwd48, maskOOS).ic;
    const stable = isFinite(is24) && isFinite(oo24) && Math.sign(is24) === Math.sign(oo24) && Math.abs(is24) >= 0.05 && Math.abs(oo24) >= 0.05;
    console.log(s.name.padEnd(18) + ' │ ' + f(is24) + ' ' + f(is48) + ' │ ' + f(oo24) + ' ' + f(oo48) + ' │ ' + (stable ? 'STABLE' : 'flip/weak'));
  }

  // ── (a) Conditional on BTC trend ──────────────────────────────────────────
  for (const trendVal of [1, 0]) {
    const label = trendVal === 1 ? 'BTC TREND UP' : 'BTC TREND DOWN';
    console.log(`\n── (a) CONDITIONAL: ${label} ──`);
    console.log('signal'.padEnd(18) + ' │  IS24h   IS48h  (n) │  OOS24h  OOS48h (n) │ verdict');
    for (const s of SIGNALS) {
      const maskIS = barTs.map((_, i) => hasCg[i] && isHalf[i] && aBtcTrend[i] === trendVal);
      const maskOOS = barTs.map((_, i) => hasCg[i] && oosHalf[i] && aBtcTrend[i] === trendVal);
      const r24is = spearmanMasked(s.vals, fwd24, maskIS), r48is = spearmanMasked(s.vals, fwd48, maskIS);
      const r24oo = spearmanMasked(s.vals, fwd24, maskOOS), r48oo = spearmanMasked(s.vals, fwd48, maskOOS);
      const stable = isFinite(r24is.ic) && isFinite(r24oo.ic) && Math.sign(r24is.ic) === Math.sign(r24oo.ic) && Math.abs(r24is.ic) >= 0.05 && Math.abs(r24oo.ic) >= 0.05;
      const stable48 = isFinite(r48is.ic) && isFinite(r48oo.ic) && Math.sign(r48is.ic) === Math.sign(r48oo.ic) && Math.abs(r48is.ic) >= 0.05 && Math.abs(r48oo.ic) >= 0.05;
      const v = stable ? 'STABLE-24h' : stable48 ? 'STABLE-48h' : 'flip/weak';
      console.log(s.name.padEnd(18) + ' │ ' + f(r24is.ic) + ' ' + f(r48is.ic) + ` (${String(r24is.n).padStart(3)}) │ ` + f(r24oo.ic) + ' ' + f(r48oo.ic) + ` (${String(r24oo.n).padStart(3)}) │ ` + v);
    }
  }

  // ── (b) Conditional on ETH vol regime ─────────────────────────────────────
  for (const volVal of ['high', 'low'] as const) {
    console.log(`\n── (b) CONDITIONAL: ETH VOL ${volVal.toUpperCase()} ──`);
    console.log('signal'.padEnd(18) + ' │  IS24h   IS48h  (n) │  OOS24h  OOS48h (n) │ verdict');
    for (const s of SIGNALS) {
      const maskIS = barTs.map((_, i) => hasCg[i] && isHalf[i] && volBucket[i] === volVal);
      const maskOOS = barTs.map((_, i) => hasCg[i] && oosHalf[i] && volBucket[i] === volVal);
      const r24is = spearmanMasked(s.vals, fwd24, maskIS), r48is = spearmanMasked(s.vals, fwd48, maskIS);
      const r24oo = spearmanMasked(s.vals, fwd24, maskOOS), r48oo = spearmanMasked(s.vals, fwd48, maskOOS);
      const stable = isFinite(r24is.ic) && isFinite(r24oo.ic) && Math.sign(r24is.ic) === Math.sign(r24oo.ic) && Math.abs(r24is.ic) >= 0.05 && Math.abs(r24oo.ic) >= 0.05;
      const stable48 = isFinite(r48is.ic) && isFinite(r48oo.ic) && Math.sign(r48is.ic) === Math.sign(r48oo.ic) && Math.abs(r48is.ic) >= 0.05 && Math.abs(r48oo.ic) >= 0.05;
      const v = stable ? 'STABLE-24h' : stable48 ? 'STABLE-48h' : 'flip/weak';
      console.log(s.name.padEnd(18) + ' │ ' + f(r24is.ic) + ' ' + f(r48is.ic) + ` (${String(r24is.n).padStart(3)}) │ ` + f(r24oo.ic) + ' ' + f(r48oo.ic) + ` (${String(r24oo.n).padStart(3)}) │ ` + v);
    }
  }

  // ── (c) 2-signal CONFLUENCE: funding+ls_top_position extreme same dir ─────
  // Build a confluence "score": +1 when both pct>=0.7 (crowd long → fade short),
  // -1 when both pct<=0.3 (crowd short → fade long), else 0. Then IC of score vs
  // fwd return; expect NEG (high score = crowd long = precedes drop). Also report
  // the realized fwd return mean in each confluence bucket.
  const pctFund = rollingPct(aFundOi);
  const pctPos = rollingPct(aLsPos);
  const confl: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const pf = pctFund[i], pp = pctPos[i];
    if (pf == null || pp == null) { confl[i] = null; continue; }
    if (pf >= 0.7 && pp >= 0.7) confl[i] = 1;       // crowd long → expect drop
    else if (pf <= 0.3 && pp <= 0.3) confl[i] = -1; // crowd short → expect rise
    else confl[i] = 0;
  }
  console.log(`\n── (c) CONFLUENCE funding+ls_top_position (pct>=.7 both / <=.3 both) ──`);
  const conflMaskIS = barTs.map((_, i) => hasCg[i] && isHalf[i] && confl[i] != null);
  const conflMaskOOS = barTs.map((_, i) => hasCg[i] && oosHalf[i] && confl[i] != null);
  const c24is = spearmanMasked(confl, fwd24, conflMaskIS), c48is = spearmanMasked(confl, fwd48, conflMaskIS);
  const c24oo = spearmanMasked(confl, fwd24, conflMaskOOS), c48oo = spearmanMasked(confl, fwd48, conflMaskOOS);
  console.log('confl score IC    │ ' + f(c24is.ic) + ' (24h IS) ' + f(c48is.ic) + ' (48h IS) │ ' + f(c24oo.ic) + ' (24h OOS) ' + f(c48oo.ic) + ' (48h OOS)');

  // bucket means of fwd48 by confluence value, per half
  const bucketStats = (half: boolean[]) => {
    const m: Record<string, { sum: number; n: number }> = { '1': { sum: 0, n: 0 }, '-1': { sum: 0, n: 0 } };
    for (let i = 0; i < N; i++) {
      if (!hasCg[i] || !half[i]) continue;
      const c = confl[i], r = fwd48[i];
      if (c == null || r == null || !isFinite(r)) continue;
      if (c === 1 || c === -1) { m[String(c)].sum += r; m[String(c)].n++; }
    }
    return m;
  };
  const sIS = bucketStats(isHalf), sOO = bucketStats(oosHalf);
  const pm = (o: { sum: number; n: number }) => o.n ? `${(o.sum / o.n * 100).toFixed(2)}% (n=${o.n})` : 'n=0';
  console.log(`  confl=+1 (crowd LONG, expect DROP) fwd48h:  IS ${pm(sIS['1'])}  │  OOS ${pm(sOO['1'])}`);
  console.log(`  confl=-1 (crowd SHORT, expect RISE) fwd48h:  IS ${pm(sIS['-1'])}  │  OOS ${pm(sOO['-1'])}`);
  console.log(`  (FADE edge if confl=+1 mean<0 AND confl=-1 mean>0 in BOTH halves.)`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * cross-asset-scan — read-only EDA. Does conditioning an ALT's CG-fade on BTC's
 * state beat the unconditioned single-pair fade?
 *
 * For a given ALT we take its strongest fade signals (funding_oi, ls_top_position)
 * and recompute the Spearman IC vs forward 24h/48h returns, but SPLIT by BTC state:
 *   (A) correlated-crowd : BTC funding also extreme (|btc funding pct| in top tercile) vs BTC calm
 *   (B) trend-agreement  : BTC 4H EMA20>EMA50 (up) vs down
 *   (C) BTC-leads-alt    : does lagged BTC price-mom / BTC funding predict ALT fwd return
 *
 * Everything is split IS (older half) / OOS (recent half). A conditioning rule is
 * only "real" if it is SAME-SIGN and |IC| meaningfully BIGGER than unconditioned on
 * BOTH halves. Default conclusion is "no help".
 *
 * Run: npx tsx src/tools/diagnostics/cross-asset-scan.ts SOLUSDT
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

// align a BTC series defined on BTC's own bar grid onto the alt bar grid by ts.
function alignByTs(altTs: number[], btcTs: number[], btcVal: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(altTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < altTs.length; i++) {
    while (j < btcTs.length && btcTs[j] <= altTs[i]) j++;
    out[i] = j > 0 ? btcVal[j - 1] : null;
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
  if (n < 40) return { ic: NaN, n };
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

// rolling percentile of a series over a lookback window (no look-ahead). 0..1.
function rollingPct(vals: (number | null)[], lb: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const cur = vals[i];
    if (cur == null || !isFinite(cur)) continue;
    let cnt = 0, le = 0;
    for (let k = Math.max(0, i - lb + 1); k <= i; k++) {
      const v = vals[k];
      if (v == null || !isFinite(v)) continue;
      cnt++; if (v <= cur) le++;
    }
    if (cnt >= 20) out[i] = le / cnt;
  }
  return out;
}

function ema(vals: number[], period: number): number[] {
  const out = new Array(vals.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = vals[0];
  out[0] = prev;
  for (let i = 1; i < vals.length; i++) { prev = vals[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

async function loadPair(pair: string) {
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');
  const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const ts = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));
  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const lsPos = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const aFundOi = alignLatest(ts, fundOi);
  const aLsPos = alignLatest(ts, lsPos);
  return { coin, ts, close, aFundOi, aLsPos };
}

function f(v: number) { return (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN').padStart(6); }

async function main() {
  const altPair = process.argv[2];
  if (!altPair) { console.error('usage: cross-asset-scan.ts <ALTPAIR>'); process.exit(1); }

  const alt = await loadPair(altPair);
  const btc = await loadPair('BTCUSDT');

  const N = alt.ts.length;
  // forward returns on alt
  const fwd = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) if (alt.close[i] > 0) out[i] = (alt.close[i + K] - alt.close[i]) / alt.close[i];
    return out;
  };
  const fwd24 = fwd(6), fwd48 = fwd(12);

  // BTC state aligned to alt grid
  const btcEma20 = ema(btc.close, 20), btcEma50 = ema(btc.close, 50);
  const btcTrendUp: (number | null)[] = btc.close.map((_, i) => (isFinite(btcEma20[i]) && isFinite(btcEma50[i]) ? (btcEma20[i] > btcEma50[i] ? 1 : 0) : null));
  const btcFundPct = rollingPct(btc.aFundOi, 180); // 30d rolling pct of BTC funding
  const btcLsPct = rollingPct(btc.aLsPos, 180);
  const btcPriceMom6: (number | null)[] = btc.close.map((c, i) => (i >= 6 && btc.close[i - 6] > 0 ? (c - btc.close[i - 6]) / btc.close[i - 6] : null));

  const aBtcTrendUp = alignByTs(alt.ts, btc.ts, btcTrendUp);
  const aBtcFundPct = alignByTs(alt.ts, btc.ts, btcFundPct);
  const aBtcLsPct = alignByTs(alt.ts, btc.ts, btcLsPct);
  const aBtcPriceMom6 = alignByTs(alt.ts, btc.ts, btcPriceMom6);
  const aBtcFundRaw = alignByTs(alt.ts, btc.ts, btc.aFundOi);

  // IS/OOS split at midpoint of bars that have CG data (same convention as signal-edge-scan)
  const cgIdx = alt.ts.map((_, i) => i).filter(i => alt.aFundOi[i] != null || alt.aLsPos[i] != null);
  const midTs = cgIdx.length ? alt.ts[cgIdx[Math.floor(cgIdx.length / 2)]] : alt.ts[Math.floor(N / 2)];
  const inHalf = (i: number, half: 'IS' | 'OOS') => (half === 'IS' ? alt.ts[i] < midTs : alt.ts[i] >= midTs);

  // helper: masked IC. keep alt signal only where mask(i) true (and in given half), IC vs fwd.
  const condIC = (sig: (number | null)[], fwdRet: (number | null)[], mask: (i: number) => boolean, half: 'IS' | 'OOS') => {
    const s = sig.map((v, i) => (inHalf(i, half) && mask(i) ? v : null));
    return spearman(s, fwdRet);
  };

  console.log(`\n══ CROSS-ASSET CONDITIONING SCAN: ${altPair} conditioned on BTC ══`);
  console.log(`alt bars=${N}, IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
  console.log(`IC = Spearman(alt signal, alt forward return). NEG = fade works. Goal: conditioning makes |IC| BIGGER same-sign on BOTH halves.\n`);

  const altSignals: { name: string; vals: (number | null)[] }[] = [
    { name: 'alt funding_oi', vals: alt.aFundOi },
    { name: 'alt ls_top_position', vals: alt.aLsPos },
  ];
  const horizons: { name: string; f: (number | null)[] }[] = [
    { name: 'fwd24h', f: fwd24 },
    { name: 'fwd48h', f: fwd48 },
  ];

  for (const sig of altSignals) {
    for (const hz of horizons) {
      console.log(`── ${sig.name}  vs  ${hz.name} ──`);
      const head = (label: string, isIC: { ic: number; n: number }, oosIC: { ic: number; n: number }) => {
        const stable = isFinite(isIC.ic) && isFinite(oosIC.ic) && Math.sign(isIC.ic) === Math.sign(oosIC.ic) && Math.abs(isIC.ic) >= 0.05 && Math.abs(oosIC.ic) >= 0.05;
        console.log(
          '  ' + label.padEnd(34) +
          ' IS ' + f(isIC.ic) + ` (n=${String(isIC.n).padStart(4)})` +
          '   OOS ' + f(oosIC.ic) + ` (n=${String(oosIC.n).padStart(4)})` +
          (stable ? '   ✓stable' : ''),
        );
      };
      // unconditioned baseline
      head('baseline (all bars)', condIC(sig.vals, hz.f, () => true, 'IS'), condIC(sig.vals, hz.f, () => true, 'OOS'));
      // A: correlated-crowd — BTC funding extreme (top/bottom tercile) vs middle
      head('A1 BTC funding EXTREME (pct≥.7|≤.3)', condIC(sig.vals, hz.f, i => aBtcFundPct[i] != null && (aBtcFundPct[i]! >= 0.7 || aBtcFundPct[i]! <= 0.3), 'IS'), condIC(sig.vals, hz.f, i => aBtcFundPct[i] != null && (aBtcFundPct[i]! >= 0.7 || aBtcFundPct[i]! <= 0.3), 'OOS'));
      head('A2 BTC funding CALM (.3<pct<.7)', condIC(sig.vals, hz.f, i => aBtcFundPct[i] != null && aBtcFundPct[i]! > 0.3 && aBtcFundPct[i]! < 0.7, 'IS'), condIC(sig.vals, hz.f, i => aBtcFundPct[i] != null && aBtcFundPct[i]! > 0.3 && aBtcFundPct[i]! < 0.7, 'OOS'));
      head('A3 BTC ls_pos EXTREME (pct≥.7|≤.3)', condIC(sig.vals, hz.f, i => aBtcLsPct[i] != null && (aBtcLsPct[i]! >= 0.7 || aBtcLsPct[i]! <= 0.3), 'IS'), condIC(sig.vals, hz.f, i => aBtcLsPct[i] != null && (aBtcLsPct[i]! >= 0.7 || aBtcLsPct[i]! <= 0.3), 'OOS'));
      // B: trend agreement
      head('B1 BTC trend UP (ema20>ema50)', condIC(sig.vals, hz.f, i => aBtcTrendUp[i] === 1, 'IS'), condIC(sig.vals, hz.f, i => aBtcTrendUp[i] === 1, 'OOS'));
      head('B2 BTC trend DOWN', condIC(sig.vals, hz.f, i => aBtcTrendUp[i] === 0, 'IS'), condIC(sig.vals, hz.f, i => aBtcTrendUp[i] === 0, 'OOS'));
      console.log('');
    }
  }

  // C: does BTC's own move LEAD the alt? lagged BTC predictors vs alt fwd return
  console.log(`── C: BTC LEADS ALT?  (BTC predictor at t  vs  ${altPair} forward return) ──`);
  const btcPreds: { name: string; vals: (number | null)[] }[] = [
    { name: 'BTC price_mom_24h', vals: aBtcPriceMom6 },
    { name: 'BTC funding_oi (raw)', vals: aBtcFundRaw },
    { name: 'BTC funding pct(30d)', vals: aBtcFundPct },
    { name: 'BTC ls_pos pct(30d)', vals: aBtcLsPct },
  ];
  for (const hz of horizons) {
    for (const p of btcPreds) {
      const isIC = condIC(p.vals, hz.f, () => true, 'IS');
      const oosIC = condIC(p.vals, hz.f, () => true, 'OOS');
      const stable = isFinite(isIC.ic) && isFinite(oosIC.ic) && Math.sign(isIC.ic) === Math.sign(oosIC.ic) && Math.abs(isIC.ic) >= 0.05 && Math.abs(oosIC.ic) >= 0.05;
      console.log('  ' + (p.name + ' → ' + hz.name).padEnd(36) + ' IS ' + f(isIC.ic) + '   OOS ' + f(oosIC.ic) + (stable ? '   ✓stable' : ''));
    }
  }

  console.log('');
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

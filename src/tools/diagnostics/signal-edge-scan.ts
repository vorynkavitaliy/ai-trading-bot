/**
 * signal-edge-scan — EDA: does any CG signal predict a pair's forward 4H→48h return,
 * and in which direction (FADE the extreme vs FOLLOW it)? For each signal computes
 * Spearman rank-IC vs forward returns (12h/24h/48h) and a quintile fwd-return spread
 * (Q5−Q1), split IS (older half) / OOS (recent half) so we see if the pattern is
 * STABLE or just in-sample noise. Sign of IC: negative = high-signal precedes a DROP
 * → fading works; positive = high-signal precedes a RISE → following works.
 *
 * Run: npx tsx src/tools/diagnostics/signal-edge-scan.ts ETHUSDT
 *      npx tsx src/tools/diagnostics/signal-edge-scan.ts BTCUSDT
 */
import { query, close as closePg } from '../../core/db';

type Row = { ts: number; val: number };

// For each bar ts, take the latest signal value at ts' <= ts (no look-ahead).
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

// Mean forward-return (%) in each of 5 quintiles of the signal (Q1 = lowest signal).
function quintileSpread(sig: (number | null)[], fwd: (number | null)[]): { q: number[]; spread: number } {
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
    q.push(hi > lo ? (s / (hi - lo)) * 100 : NaN);
  }
  return { q, spread: q[4] - q[0] };
}

async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}

async function main() {
  const pair = process.argv[2];
  if (!pair) { console.error('usage: signal-edge-scan.ts <PAIR>'); process.exit(1); }
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');

  // 4H candles
  const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const barTs = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));

  // Bulk-load CG signal series
  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const fundVol = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_vol_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const lsPos = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const lsAcc = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const lsGlob = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_global_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const oi = await loadSeries(`SELECT ts, oi_close::text AS val FROM cg_oi_aggregated WHERE symbol=$1 ORDER BY ts`, [coin]);
  const takerBuy = await loadSeries(`SELECT ts, buy_usd::text AS val FROM cg_taker_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const takerSell = await loadSeries(`SELECT ts, sell_usd::text AS val FROM cg_taker_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const liqLong = await loadSeries(`SELECT ts, long_liq_usd::text AS val FROM cg_liq_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const liqShort = await loadSeries(`SELECT ts, short_liq_usd::text AS val FROM cg_liq_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);

  // Align everything to the 4H candle grid
  const aFundOi = alignLatest(barTs, fundOi);
  const aFundVol = alignLatest(barTs, fundVol);
  const aLsPos = alignLatest(barTs, lsPos);
  const aLsAcc = alignLatest(barTs, lsAcc);
  const aLsGlob = alignLatest(barTs, lsGlob);
  const aOi = alignLatest(barTs, oi);
  const aTakerBuy = alignLatest(barTs, takerBuy);
  const aTakerSell = alignLatest(barTs, takerSell);
  const aLiqLong = alignLatest(barTs, liqLong);
  const aLiqShort = alignLatest(barTs, liqShort);

  const N = barTs.length;
  const LB = 6; // 24h lookback for change features
  const nz = (v: number | null) => (v == null || !isFinite(v) ? null : v);

  // Derived signals
  const oiPct: (number | null)[] = new Array(N).fill(null);
  const priceMom: (number | null)[] = new Array(N).fill(null);
  const takerDelta: (number | null)[] = new Array(N).fill(null);
  const liqImb: (number | null)[] = new Array(N).fill(null);
  const whaleRetail: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (i >= LB && aOi[i] != null && aOi[i - LB] != null && aOi[i - LB]! > 0) oiPct[i] = (aOi[i]! - aOi[i - LB]!) / aOi[i - LB]! * 100;
    if (i >= LB && close[i - LB] > 0) priceMom[i] = (close[i] - close[i - LB]) / close[i - LB] * 100;
    const tb = aTakerBuy[i], ts2 = aTakerSell[i];
    if (tb != null && ts2 != null && tb + ts2 > 0) takerDelta[i] = (tb - ts2) / (tb + ts2);
    const ll = aLiqLong[i], sl = aLiqShort[i];
    if (ll != null && sl != null && ll + sl > 0) liqImb[i] = (ll - sl) / (ll + sl);
    if (aLsAcc[i] != null && aLsGlob[i] != null) whaleRetail[i] = aLsAcc[i]! - aLsGlob[i]!;
  }

  // Forward returns
  const fwd = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) if (close[i] > 0) out[i] = (close[i + K] - close[i]) / close[i];
    return out;
  };
  const fwd12 = fwd(3), fwd24 = fwd(6), fwd48 = fwd(12);

  // IS/OOS split at midpoint of bars that have CG data
  const cgIdx = barTs.map((_, i) => i).filter(i => aFundOi[i] != null || aLsPos[i] != null);
  const midTs = cgIdx.length ? barTs[cgIdx[Math.floor(cgIdx.length / 2)]] : barTs[Math.floor(N / 2)];
  const split = (arr: (number | null)[], half: 'IS' | 'OOS') =>
    arr.map((v, i) => (half === 'IS' ? barTs[i] < midTs : barTs[i] >= midTs) ? v : null);

  const SIGNALS: { name: string; vals: (number | null)[] }[] = [
    { name: 'funding_oi', vals: aFundOi },
    { name: 'funding_vol', vals: aFundVol },
    { name: 'ls_top_position', vals: aLsPos },
    { name: 'ls_top_account', vals: aLsAcc },
    { name: 'ls_global_acct', vals: aLsGlob },
    { name: 'whale−retail(acc-glob)', vals: whaleRetail },
    { name: 'oi_pct_chg_24h', vals: oiPct },
    { name: 'taker_delta', vals: takerDelta },
    { name: 'liq_imbalance', vals: liqImb },
    { name: 'price_mom_24h', vals: priceMom },
  ];

  console.log(`\n══ SIGNAL-EDGE SCAN: ${pair} (coin ${coin}) ══`);
  console.log(`bars=${N}, with-CG=${cgIdx.length}, IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
  console.log(`IC = Spearman rank-corr(signal, forward return). NEG ⇒ high signal precedes DROP ⇒ FADE. POS ⇒ FOLLOW.`);
  console.log(`A real edge needs SAME-SIGN IS & OOS and |IC|≳0.05.\n`);
  console.log('signal'.padEnd(22) + ' │ IC12h  IC24h  IC48h  (IS)   │ IC12h  IC24h  IC48h  (OOS)  │ Q5−Q1 fwd24h%  IS/OOS │ read');
  console.log('─'.repeat(125));

  for (const s of SIGNALS) {
    const isV = split(s.vals, 'IS'), oosV = split(s.vals, 'OOS');
    const ic = (sig: (number | null)[], f: (number | null)[]) => spearman(sig, f).ic;
    const i12 = ic(isV, fwd12), i24 = ic(isV, fwd24), i48 = ic(isV, fwd48);
    const o12 = ic(oosV, fwd12), o24 = ic(oosV, fwd24), o48 = ic(oosV, fwd48);
    const qis = quintileSpread(isV, fwd24).spread * 1;
    const qoos = quintileSpread(oosV, fwd24).spread * 1;
    // read: stable sign on 24h with |IC|>=0.05 both halves
    let read = '—';
    if (isFinite(i24) && isFinite(o24) && Math.sign(i24) === Math.sign(o24) && Math.abs(i24) >= 0.05 && Math.abs(o24) >= 0.05) {
      read = i24 < 0 ? '🔻 FADE (stable)' : '🔺 FOLLOW (stable)';
    } else if (isFinite(i24) && isFinite(o24) && Math.sign(i24) !== Math.sign(o24) && (Math.abs(i24) >= 0.05 || Math.abs(o24) >= 0.05)) {
      read = '⚠ flips IS↔OOS';
    }
    const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : '  NaN').padStart(6);
    console.log(
      s.name.padEnd(22) + ' │ ' + f(i12) + ' ' + f(i24) + ' ' + f(i48) + '        │ ' +
      f(o12) + ' ' + f(o24) + ' ' + f(o48) + '        │ ' +
      (isFinite(qis) ? (qis >= 0 ? '+' : '') + qis.toFixed(2) : 'NaN').padStart(7) + ' / ' +
      (isFinite(qoos) ? (qoos >= 0 ? '+' : '') + qoos.toFixed(2) : 'NaN').padStart(7) + ' │ ' + read,
    );
  }
  console.log('\n(Q5−Q1 = avg fwd-24h return of the highest-signal quintile minus the lowest. Big negative = fade; big positive = follow.)');
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

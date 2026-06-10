/**
 * ensemble-fade-scan — OVERLAY E test (orthogonal equal-weight ensemble).
 *
 * Question: combine the three ORTHOGONAL fade signals (established earlier as
 * pairwise low-corr) into ONE equal-weight composite z-score and ask whether the
 * composite fade is MORE STABLE than any single component, on BOTH IS (older) and
 * OOS (recent) halves.
 *
 * Orthogonal set:
 *   - funding_oi   : the live fade signal (cg_funding_oi_weighted.fr_close)
 *   - liqImbDir    : directional liq imbalance (long_liq - short_liq)/(sum), cg_liq_pair
 *   - cvdDelta     : aggregated taker CVD delta (buy - sell)/(sum), cg_taker_pair
 *
 * Method (cheap signal-level, no engine):
 *   - rolling z-score of each signal over 180×4h window (no look-ahead).
 *   - sign-align each z to FADE direction (so a positive aligned-z predicts a DROP).
 *     We flip each component by the SIGN OF ITS OWN IS-half IC (in-sample only — the
 *     orientation is learned on IS, never on OOS, so OOS is honest). For funding/ls
 *     this is the established fade sign (neg IC). NO weights are fitted — equal weight.
 *   - composite = mean(alignedZ_funding, alignedZ_liq, alignedZ_cvd).
 *   - measure each component's and the composite's fade IC + quintile spread vs the
 *     forward 24h/48h return, split IS/OOS.
 *
 * "Survives" only if the composite CLEARLY beats the best single component on BOTH
 * halves (stronger |IC| same sign, bigger directional quintile spread). Default = no.
 *
 * Run: npx tsx src/tools/diagnostics/ensemble-fade-scan.ts BTCUSDT SOLUSDT ADAUSDT
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

async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) }))
    .filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}

// rolling z-score over lookback window (no look-ahead). Needs >=30 valid points.
function rollingZ(vals: (number | null)[], W: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const cur = vals[i];
    if (cur == null || !isFinite(cur)) continue;
    const win: number[] = [];
    for (let k = Math.max(0, i - W + 1); k <= i; k++) {
      const v = vals[k];
      if (v != null && isFinite(v)) win.push(v);
    }
    if (win.length < 30) continue;
    const m = win.reduce((s, v) => s + v, 0) / win.length;
    const sd = Math.sqrt(win.reduce((s, v) => s + (v - m) ** 2, 0) / (win.length - 1));
    if (!(sd > 0)) continue;
    out[i] = (cur - m) / sd;
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

// Pearson corr of two aligned signal arrays (for the orthogonality check).
function pearson(x: (number | null)[], y: (number | null)[]): number {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const n = xs.length;
  if (n < 30) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = xs[i] - mx, ay = ys[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return num / Math.sqrt(dx * dy);
}

// directional quintile spread on a FADE-ALIGNED signal: split into quintiles of the
// aligned-z (Q5 = strongest "expect drop"). Because aligned-z predicts a DROP, a
// working fade gives Q1 fwd-return HIGH (no drop) and Q5 LOW (drop) → spread Q1−Q5 > 0
// is "fade pays". We report the DIRECTIONAL fade spread = (Q1 − Q5) fwd-return %.
function fadeQuintileSpread(alignedZ: (number | null)[], fwd: (number | null)[]): { spread: number; n: number } {
  const pairs: [number, number][] = [];
  for (let i = 0; i < alignedZ.length; i++) {
    const a = alignedZ[i], b = fwd[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) pairs.push([a, b]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  if (n < 50) return { spread: NaN, n };
  const qMean = (bk: number) => {
    const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5);
    let s = 0; for (let i = lo; i < hi; i++) s += pairs[i][1];
    return hi > lo ? s / (hi - lo) : NaN;
  };
  const q1 = qMean(0), q5 = qMean(4);
  // Q1 = lowest aligned-z (expect rise), Q5 = highest aligned-z (expect drop).
  // fade pays when low-z bars rise and high-z bars drop: (q1 - q5) positive.
  return { spread: (q1 - q5) * 100, n };
}

const ROLL = 180, FUNDING_HORIZON_NOTE = '24h/48h';

interface Component { name: string; raw: (number | null)[]; }

async function analyzePair(pair: string) {
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');
  const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const barTs = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));
  const N = barTs.length;
  if (N < 400) { console.log(`${pair}: too few bars (${N})`); return null; }

  // raw signals
  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const liqLong = await loadSeries(`SELECT ts, long_liq_usd::text AS val FROM cg_liq_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const liqShort = await loadSeries(`SELECT ts, short_liq_usd::text AS val FROM cg_liq_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const takerBuy = await loadSeries(`SELECT ts, buy_usd::text AS val FROM cg_taker_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const takerSell = await loadSeries(`SELECT ts, sell_usd::text AS val FROM cg_taker_pair WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);

  const aFund = alignLatest(barTs, fundOi);
  const aLiqL = alignLatest(barTs, liqLong);
  const aLiqS = alignLatest(barTs, liqShort);
  const aTakB = alignLatest(barTs, takerBuy);
  const aTakS = alignLatest(barTs, takerSell);

  // derived directional ratios
  const liqImb: (number | null)[] = new Array(N).fill(null);
  const cvdDelta: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const ll = aLiqL[i], sl = aLiqS[i];
    if (ll != null && sl != null && ll + sl > 0) liqImb[i] = (ll - sl) / (ll + sl);
    const tb = aTakB[i], ts2 = aTakS[i];
    if (tb != null && ts2 != null && tb + ts2 > 0) cvdDelta[i] = (tb - ts2) / (tb + ts2);
  }

  // forward returns
  const fwd = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) if (close[i] > 0) out[i] = (close[i + K] - close[i]) / close[i];
    return out;
  };
  const fwd24 = fwd(6), fwd48 = fwd(12);

  // rolling z of each raw component
  const zFund = rollingZ(aFund, ROLL);
  const zLiq = rollingZ(liqImb, ROLL);
  const zCvd = rollingZ(cvdDelta, ROLL);

  // IS/OOS split at midpoint of bars that have all three z + fwd
  const usable = barTs.map((_, i) => i).filter(i => zFund[i] != null && zLiq[i] != null && zCvd[i] != null && fwd24[i] != null);
  if (usable.length < 100) { console.log(`${pair}: too few usable (${usable.length})`); return null; }
  const midTs = barTs[usable[Math.floor(usable.length / 2)]];
  const isMask = (i: number) => barTs[i] < midTs;
  const split = (arr: (number | null)[], half: 'IS' | 'OOS') =>
    arr.map((v, i) => ((half === 'IS' ? isMask(i) : !isMask(i)) ? v : null));

  // Learn fade orientation on IS only: sign of IS-half IC of raw z vs fwd24.
  // alignedZ = -sign(IS_IC) * z  → aligned so that positive alignedZ predicts a DROP.
  const orient = (z: (number | null)[]) => {
    const isIC = spearman(split(z, 'IS'), fwd24).ic;
    const s = isFinite(isIC) ? Math.sign(isIC) : 0;
    // if IS_IC negative (fade), -sign = +1 → keep z; positive alignedZ = high signal = expect drop. good.
    // Define alignedZ = -s * z so that higher alignedZ ⇒ predicted drop.
    return { aligned: z.map(v => (v == null ? null : -s * v)), isIC: isIC };
  };
  const oFund = orient(zFund), oLiq = orient(zLiq), oCvd = orient(zCvd);

  // equal-weight composite of aligned z (no fitted weights)
  const composite: (number | null)[] = new Array(N).fill(null);
  const compFL: (number | null)[] = new Array(N).fill(null); // charitable 2-signal: drop dead cvd
  for (let i = 0; i < N; i++) {
    const a = oFund.aligned[i], b = oLiq.aligned[i], c = oCvd.aligned[i];
    if (a != null && b != null && c != null) composite[i] = (a + b + c) / 3;
    if (a != null && b != null) compFL[i] = (a + b) / 2;
  }

  // orthogonality check (aligned-z pairwise corr over usable bars)
  const uz = (z: (number | null)[]) => z.map((v, i) => (usable.includes(i) ? v : null));
  // build usable set once for speed
  const uset = new Set(usable);
  const restrict = (z: (number | null)[]) => z.map((v, i) => (uset.has(i) ? v : null));
  const rf = restrict(oFund.aligned), rl = restrict(oLiq.aligned), rc = restrict(oCvd.aligned);
  const corrFL = pearson(rf, rl), corrFC = pearson(rf, rc), corrLC = pearson(rl, rc);

  // Components + composite to evaluate. For fade reading we measure IC of ALIGNED z
  // vs fwd: positive alignedZ predicts drop, so a working fade gives NEGATIVE IC
  // (high alignedZ → low fwd return). We report IC and the directional fade quintile
  // spread (Q1−Q5), where higher spread = stronger fade.
  const comps: { name: string; aligned: (number | null)[] }[] = [
    { name: 'funding_oi (live)', aligned: oFund.aligned },
    { name: 'liqImbDir', aligned: oLiq.aligned },
    { name: 'cvdDelta', aligned: oCvd.aligned },
    { name: 'COMPOSITE(eq-wt)', aligned: composite },
    { name: 'COMPOSITE(fund+liq)', aligned: compFL },
  ];

  console.log(`\n══ ${pair} ══ usable=${usable.length}  IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS  (horizons ${FUNDING_HORIZON_NOTE})`);
  console.log(`   orientation learned on IS: funding IC_is=${oFund.isIC.toFixed(3)} liq IC_is=${oLiq.isIC.toFixed(3)} cvd IC_is=${oCvd.isIC.toFixed(3)}`);
  console.log(`   aligned-z pairwise corr (orthogonality): fund·liq=${corrFL.toFixed(3)} fund·cvd=${corrFC.toFixed(3)} liq·cvd=${corrLC.toFixed(3)}`);
  console.log(`   ${'component'.padEnd(20)}│ IC24 IS   IC24 OOS │ IC48 IS   IC48 OOS │ fadeQ(Q1-Q5)24h% IS / OOS`);
  console.log('   ' + '─'.repeat(92));

  const fmt = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : 'NaN').padStart(7);
  const out: Record<string, { ic24is: number; ic24oos: number; ic48is: number; ic48oos: number; q24is: number; q24oos: number; q48is?: number; q48oos?: number }> = {};

  for (const c of comps) {
    const isV = split(c.aligned, 'IS'), oosV = split(c.aligned, 'OOS');
    const ic24is = spearman(isV, fwd24).ic, ic24oos = spearman(oosV, fwd24).ic;
    const ic48is = spearman(isV, fwd48).ic, ic48oos = spearman(oosV, fwd48).ic;
    const q24is = fadeQuintileSpread(isV, fwd24).spread, q24oos = fadeQuintileSpread(oosV, fwd24).spread;
    out[c.name] = { ic24is, ic24oos, ic48is, ic48oos, q24is, q24oos };
    console.log(
      '   ' + c.name.padEnd(20) + '│ ' + fmt(ic24is) + '  ' + fmt(ic24oos) + ' │ ' +
      fmt(ic48is) + '  ' + fmt(ic48oos) + ' │ ' +
      (isFinite(q24is) ? (q24is >= 0 ? '+' : '') + q24is.toFixed(2) : 'NaN').padStart(8) + ' / ' +
      (isFinite(q24oos) ? (q24oos >= 0 ? '+' : '') + q24oos.toFixed(2) : 'NaN').padStart(8),
    );
  }

  // Verdict per pair: composite beats best single component on BOTH halves?
  // Fade strength = -IC24 (more negative IC = stronger fade) AND fade quintile spread (Q1-Q5).
  const singles = ['funding_oi (live)', 'liqImbDir', 'cvdDelta'];
  const fadeStrengthIC = (m: any, half: 'is' | 'oos') => -(half === 'is' ? m.ic24is : m.ic24oos); // bigger = better fade
  const bestSingleIS = Math.max(...singles.map(s => fadeStrengthIC(out[s], 'is')));
  const bestSingleOOS = Math.max(...singles.map(s => fadeStrengthIC(out[s], 'oos')));
  const compIS = fadeStrengthIC(out['COMPOSITE(eq-wt)'], 'is');
  const compOOS = fadeStrengthIC(out['COMPOSITE(eq-wt)'], 'oos');
  const bestQis = Math.max(...singles.map(s => out[s].q24is));
  const bestQoos = Math.max(...singles.map(s => out[s].q24oos));
  const compQis = out['COMPOSITE(eq-wt)'].q24is, compQoos = out['COMPOSITE(eq-wt)'].q24oos;

  const beatsIC_both = compIS > bestSingleIS && compOOS > bestSingleOOS;
  const beatsQ_both = compQis > bestQis && compQoos > bestQoos;
  console.log(`   verdict: composite fade-IC beats best single on BOTH halves? ${beatsIC_both ? 'YES' : 'no'}  (compIS ${compIS.toFixed(3)} vs best ${bestSingleIS.toFixed(3)}; compOOS ${compOOS.toFixed(3)} vs best ${bestSingleOOS.toFixed(3)})`);
  console.log(`            composite fade-Q  beats best single on BOTH halves? ${beatsQ_both ? 'YES' : 'no'}   (compIS ${compQis.toFixed(2)} vs best ${bestQis.toFixed(2)}; compOOS ${compQoos.toFixed(2)} vs best ${bestQoos.toFixed(2)})`);

  return { pair, out, corr: { corrFL, corrFC, corrLC }, beatsIC_both, beatsQ_both, midTs };
}

async function main() {
  const args = process.argv.slice(2);
  const pairs = args.length ? args : ['BTCUSDT', 'SOLUSDT', 'ADAUSDT'];
  const results: any[] = [];
  for (const p of pairs) {
    try { const r = await analyzePair(p); if (r) results.push(r); }
    catch (e: any) { console.log(`${p}: ERR ${e?.message}`); }
  }

  console.log(`\n\n══ SUMMARY (OVERLAY E orthogonal equal-weight ensemble) ══`);
  console.log(`Survives ONLY if COMPOSITE clearly beats best single on BOTH halves (IC and/or quintile spread).`);
  let icBoth = 0, qBoth = 0;
  for (const r of results) {
    if (r.beatsIC_both) icBoth++;
    if (r.beatsQ_both) qBoth++;
    console.log(`  ${r.pair}: IC-both=${r.beatsIC_both ? 'YES' : 'no'}  Q-both=${r.beatsQ_both ? 'YES' : 'no'}`);
  }
  console.log(`  composite beats best single on BOTH halves (IC):  ${icBoth}/${results.length} pairs`);
  console.log(`  composite beats best single on BOTH halves (Q):   ${qBoth}/${results.length} pairs`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

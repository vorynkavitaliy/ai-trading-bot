/**
 * confluence-scan — ANGLE: multi-signal CONFLUENCE beyond single-signal CG-fade.
 *
 * Hypothesis: one CG signal is noisy, but when 2-3 INDEPENDENT signals are
 * simultaneously at the SAME-direction extreme, forward predictiveness is
 * stronger and more robust than any single signal.
 *
 * Method:
 *   - Build 4 base "fade-able" signals (funding_oi, ls_top_position,
 *     ls_top_account, oi_pct_chg_24h), aligned to the 4H grid (no look-ahead).
 *   - For each, compute its rolling-percentile rank over the WHOLE in-half /
 *     out-half separately is wrong (look-ahead within half); instead we use a
 *     trailing 180-bar (30d) rolling percentile — same as live cg-fade.
 *   - A signal "votes SHORT" if its rolling pct >= 0.80, "votes LONG" if <= 0.20.
 *   - Composite agreement = count of signals voting the SAME side. We separately
 *     track SHORT-agreement and LONG-agreement.
 *   - We expect FADE: high crowd-long (SHORT vote) precedes DROP, so a SHORT
 *     composite should have NEGATIVE forward return; LONG composite POSITIVE.
 *   - Directional fade return = (-fwd if SHORT-composite, +fwd if LONG-composite).
 *     A real fade edge => POSITIVE directional return that GROWS with agreement,
 *     and holds on BOTH IS and OOS halves.
 *
 * Reports, per pair, mean forward-fade-return (bps) by agreement level (1/2/3/4),
 * sample counts, and IS vs OOS. Also a "best single signal" baseline = agreement>=1
 * on funding_oi alone, for comparison.
 *
 * Run: npx tsx src/tools/diagnostics/confluence-scan.ts            (default basket)
 *      npx tsx src/tools/diagnostics/confluence-scan.ts BTCUSDT SOLUSDT ...
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
  return rows
    .map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) }))
    .filter((r) => isFinite(r.val))
    .sort((a, b) => a.ts - b.ts);
}

// trailing rolling percentile rank of vals[i] within window [i-W+1 .. i]
function rollingPct(vals: (number | null)[], W: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const cur = vals[i];
    if (cur == null || !isFinite(cur)) continue;
    let cnt = 0;
    let le = 0;
    for (let k = Math.max(0, i - W + 1); k <= i; k++) {
      const v = vals[k];
      if (v == null || !isFinite(v)) continue;
      cnt++;
      if (v <= cur) le++;
    }
    if (cnt >= 30) out[i] = le / cnt;
  }
  return out;
}

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}
function std(a: number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
// t-stat of mean vs 0
function tstat(a: number[]): number {
  if (a.length < 2) return NaN;
  return mean(a) / (std(a) / Math.sqrt(a.length));
}

const PCT_HI = 0.8;
const PCT_LO = 0.2;
const ROLL = 180; // 30d in 4H bars, same as live cg-fade
const HORIZON = 6; // 24h forward (6 × 4H)

async function analyzePair(pair: string) {
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');

  const cndl = await query<any>(
    `SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`,
    [pair],
  );
  const barTs = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));
  const N = barTs.length;
  if (N < 400) {
    console.log(`\n${pair}: too few 4H bars (${N}) — skip`);
    return null;
  }

  const fundOi = await loadSeries(
    `SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`,
    [coin],
  );
  const lsPos = await loadSeries(
    `SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`,
    [pair],
  );
  const lsAcc = await loadSeries(
    `SELECT ts, ratio::text AS val FROM cg_ls_top_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`,
    [pair],
  );
  const oi = await loadSeries(
    `SELECT ts, oi_close::text AS val FROM cg_oi_aggregated WHERE symbol=$1 ORDER BY ts`,
    [coin],
  );

  const aFundOi = alignLatest(barTs, fundOi);
  const aLsPos = alignLatest(barTs, lsPos);
  const aLsAcc = alignLatest(barTs, lsAcc);
  const aOi = alignLatest(barTs, oi);

  // derived: oi pct change over 24h (6 bars)
  const LB = 6;
  const oiPct: (number | null)[] = new Array(N).fill(null);
  for (let i = LB; i < N; i++) {
    if (aOi[i] != null && aOi[i - LB] != null && aOi[i - LB]! > 0)
      oiPct[i] = ((aOi[i]! - aOi[i - LB]!) / aOi[i - LB]!) * 100;
  }

  // rolling percentile for each base signal
  const pFundOi = rollingPct(aFundOi, ROLL);
  const pLsPos = rollingPct(aLsPos, ROLL);
  const pLsAcc = rollingPct(aLsAcc, ROLL);
  const pOiPct = rollingPct(oiPct, ROLL);

  const signals = [pFundOi, pLsPos, pLsAcc, pOiPct];
  const sigNames = ['funding_oi', 'ls_top_position', 'ls_top_account', 'oi_pct_chg'];

  // forward 24h return
  const fwd: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i + HORIZON < N; i++) if (close[i] > 0) fwd[i] = (close[i + HORIZON] - close[i]) / close[i];

  // IS/OOS split at midpoint of bars that have a composite computable
  const usable = barTs
    .map((_, i) => i)
    .filter((i) => signals.every((s) => s[i] != null) && fwd[i] != null);
  if (usable.length < 100) {
    console.log(`\n${pair}: too few usable bars (${usable.length}) — skip`);
    return null;
  }
  const midTs = barTs[usable[Math.floor(usable.length / 2)]];

  // For each usable bar, count SHORT votes (pct>=HI) and LONG votes (pct<=LO).
  // Composite side = the side with strictly more votes; agreement = that count.
  // Directional fade return = SHORT ? -fwd : LONG ? +fwd.
  type Obs = { agree: number; dret: number; half: 'IS' | 'OOS' };
  const obs: Obs[] = [];
  // single-signal baseline: funding_oi extreme alone (fade)
  const single: { dret: number; half: 'IS' | 'OOS' }[] = [];

  for (const i of usable) {
    let shortVotes = 0;
    let longVotes = 0;
    for (const s of signals) {
      const p = s[i]!;
      if (p >= PCT_HI) shortVotes++;
      else if (p <= PCT_LO) longVotes++;
    }
    const half: 'IS' | 'OOS' = barTs[i] < midTs ? 'IS' : 'OOS';
    const f = fwd[i]!;
    if (shortVotes > longVotes && shortVotes >= 1) obs.push({ agree: shortVotes, dret: -f, half });
    else if (longVotes > shortVotes && longVotes >= 1) obs.push({ agree: longVotes, dret: f, half });
    // baseline: funding_oi alone
    const pf = pFundOi[i]!;
    if (pf >= PCT_HI) single.push({ dret: -f, half });
    else if (pf <= PCT_LO) single.push({ dret: f, half });
  }

  // aggregate by agreement level × half
  const summary: Record<string, { is: number[]; oos: number[] }> = {
    '1': { is: [], oos: [] },
    '2': { is: [], oos: [] },
    '3+': { is: [], oos: [] },
  };
  for (const o of obs) {
    const key = o.agree >= 3 ? '3+' : String(o.agree);
    (o.half === 'IS' ? summary[key].is : summary[key].oos).push(o.dret);
  }
  const baseIs = single.filter((s) => s.half === 'IS').map((s) => s.dret);
  const baseOos = single.filter((s) => s.half === 'OOS').map((s) => s.dret);

  console.log(`\n══ CONFLUENCE: ${pair} ══  bars=${N} usable=${usable.length}  IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
  console.log(`(directional fade return = mean fwd-24h aligned so positive = fade worked. roll-pct ${ROLL}b, HI${PCT_HI}/LO${PCT_LO})`);
  console.log('level'.padEnd(8) + ' │  IS n   IS mean(bps)  t  │  OOS n  OOS mean(bps)  t  │ robust?');
  console.log('─'.repeat(86));
  const fmt = (arr: number[]) => {
    const m = mean(arr) * 10000;
    const t = tstat(arr);
    return { m, t, n: arr.length };
  };
  const printRow = (label: string, is: number[], oos: number[]) => {
    const a = fmt(is), b = fmt(oos);
    const robust =
      isFinite(a.m) && isFinite(b.m) && a.m > 0 && b.m > 0 && a.n >= 20 && b.n >= 20 ? 'YES' : '';
    console.log(
      label.padEnd(8) +
        ' │ ' +
        String(a.n).padStart(5) +
        '  ' +
        (isFinite(a.m) ? (a.m >= 0 ? '+' : '') + a.m.toFixed(1) : 'NaN').padStart(9) +
        '  ' +
        (isFinite(a.t) ? a.t.toFixed(2) : 'NaN').padStart(5) +
        '  │ ' +
        String(b.n).padStart(5) +
        '  ' +
        (isFinite(b.m) ? (b.m >= 0 ? '+' : '') + b.m.toFixed(1) : 'NaN').padStart(9) +
        '  ' +
        (isFinite(b.t) ? b.t.toFixed(2) : 'NaN').padStart(5) +
        '  │ ' +
        robust,
    );
  };
  printRow('single', baseIs, baseOos);
  printRow('agree=1', summary['1'].is, summary['1'].oos);
  printRow('agree=2', summary['2'].is, summary['2'].oos);
  printRow('agree>=3', summary['3+'].is, summary['3+'].oos);

  // return structured metrics for verdict
  const s2 = { is: fmt(summary['2'].is), oos: fmt(summary['2'].oos) };
  const s3 = { is: fmt(summary['3+'].is), oos: fmt(summary['3+'].oos) };
  const sb = { is: fmt(baseIs), oos: fmt(baseOos) };
  return { pair, single: sb, agree2: s2, agree3: s3 };
}

async function main() {
  const args = process.argv.slice(2);
  const pairs = args.length ? args : ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'INJUSDT', 'ARBUSDT', 'XRPUSDT'];
  const results: any[] = [];
  for (const p of pairs) {
    try {
      const r = await analyzePair(p);
      if (r) results.push(r);
    } catch (e: any) {
      console.log(`\n${p}: ERROR ${e?.message || e}`);
    }
  }

  // ROLL-UP: pool directional returns across pairs (z-style: just concat means weighted by n)
  console.log(`\n\n══ POOLED VERDICT (across ${results.length} pairs) ══`);
  console.log('Compares mean directional-fade-return (bps) at each level, IS vs OOS.');
  console.log('A confluence edge is real only if BOTH IS & OOS are positive AND agree>=2 beats single on OOS.\n');
  const poolLevel = (sel: (r: any) => { is: any; oos: any }) => {
    let isN = 0, isSum = 0, oosN = 0, oosSum = 0;
    for (const r of results) {
      const x = sel(r);
      if (isFinite(x.is.m)) { isSum += x.is.m * x.is.n; isN += x.is.n; }
      if (isFinite(x.oos.m)) { oosSum += x.oos.m * x.oos.n; oosN += x.oos.n; }
    }
    return { isMean: isN ? isSum / isN : NaN, isN, oosMean: oosN ? oosSum / oosN : NaN, oosN };
  };
  const pl = [
    ['single(fund_oi)', poolLevel((r) => ({ is: r.single.is, oos: r.single.oos }))],
    ['agree>=2', poolLevel((r) => ({ is: r.agree2.is, oos: r.agree2.oos }))],
    ['agree>=3', poolLevel((r) => ({ is: r.agree3.is, oos: r.agree3.oos }))],
  ] as const;
  console.log('level'.padEnd(16) + ' │ IS n     IS mean(bps) │ OOS n    OOS mean(bps)');
  console.log('─'.repeat(70));
  for (const [name, p] of pl) {
    console.log(
      name.padEnd(16) +
        ' │ ' +
        String(p.isN).padStart(5) +
        '   ' +
        (isFinite(p.isMean) ? (p.isMean >= 0 ? '+' : '') + p.isMean.toFixed(1) : 'NaN').padStart(9) +
        '   │ ' +
        String(p.oosN).padStart(5) +
        '   ' +
        (isFinite(p.oosMean) ? (p.oosMean >= 0 ? '+' : '') + p.oosMean.toFixed(1) : 'NaN').padStart(9),
    );
  }

  await closePg();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await closePg();
  } catch {}
  process.exit(1);
});

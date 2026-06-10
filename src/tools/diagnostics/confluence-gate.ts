/**
 * confluence-gate — RIGOROUS follow-up to confluence-scan.
 *
 * Two questions the basic scan can't answer cleanly:
 *  (1) MONOTONICITY: does directional-fade-return actually GROW with the number
 *      of agreeing signals, on BOTH IS and OOS, pair-by-pair? (Confluence claim.)
 *  (2) INCREMENTAL VALUE: holding the PRIMARY fade signal (funding_oi) fixed at
 *      its extreme, does requiring CONFIRMATION from >=1 of the other 3 signals
 *      improve the trade vs taking funding_oi alone? This isolates "does adding a
 *      second independent vote help" from "funding_oi alone is good".
 *
 * For (2) we partition every funding_oi-extreme bar into:
 *      CONFIRMED  = >=1 other signal agrees same side
 *      LONE       = no other signal agrees
 * and compare directional-fade-return CONFIRMED vs LONE, IS and OOS.
 * If confluence is real: CONFIRMED > LONE on BOTH halves, most pairs.
 *
 * Run: npx tsx src/tools/diagnostics/confluence-gate.ts [PAIR ...]
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
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter((r) => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}
function rollingPct(vals: (number | null)[], W: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const cur = vals[i];
    if (cur == null || !isFinite(cur)) continue;
    let cnt = 0, le = 0;
    for (let k = Math.max(0, i - W + 1); k <= i; k++) {
      const v = vals[k];
      if (v == null || !isFinite(v)) continue;
      cnt++; if (v <= cur) le++;
    }
    if (cnt >= 30) out[i] = le / cnt;
  }
  return out;
}
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const std = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const tstat = (a: number[]) => (a.length < 2 ? NaN : mean(a) / (std(a) / Math.sqrt(a.length)));
// Welch t for diff of two means
function welch(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return NaN;
  const va = std(a) ** 2 / a.length, vb = std(b) ** 2 / b.length;
  return (mean(a) - mean(b)) / Math.sqrt(va + vb);
}

const PCT_HI = 0.8, PCT_LO = 0.2, ROLL = 180, HORIZON = 6;

async function analyzePair(pair: string) {
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');
  const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const barTs = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));
  const N = barTs.length;
  if (N < 400) return null;

  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const lsPos = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const lsAcc = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const oi = await loadSeries(`SELECT ts, oi_close::text AS val FROM cg_oi_aggregated WHERE symbol=$1 ORDER BY ts`, [coin]);

  const aFundOi = alignLatest(barTs, fundOi);
  const aLsPos = alignLatest(barTs, lsPos);
  const aLsAcc = alignLatest(barTs, lsAcc);
  const aOi = alignLatest(barTs, oi);
  const oiPct: (number | null)[] = new Array(N).fill(null);
  for (let i = 6; i < N; i++) if (aOi[i] != null && aOi[i - 6] != null && aOi[i - 6]! > 0) oiPct[i] = ((aOi[i]! - aOi[i - 6]!) / aOi[i - 6]!) * 100;

  const pF = rollingPct(aFundOi, ROLL);
  const others = [rollingPct(aLsPos, ROLL), rollingPct(aLsAcc, ROLL), rollingPct(oiPct, ROLL)];

  const fwd: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i + HORIZON < N; i++) if (close[i] > 0) fwd[i] = (close[i + HORIZON] - close[i]) / close[i];

  const usable = barTs.map((_, i) => i).filter((i) => pF[i] != null && others.every((o) => o[i] != null) && fwd[i] != null);
  if (usable.length < 100) return null;
  const midTs = barTs[usable[Math.floor(usable.length / 2)]];

  // (1) monotonicity by total agreement count on the chosen side
  const byAgree: Record<string, { is: number[]; oos: number[] }> = { '1': { is: [], oos: [] }, '2': { is: [], oos: [] }, '3': { is: [], oos: [] }, '4': { is: [], oos: [] } };
  // (2) funding_oi-extreme partition
  const conf: { is: number[]; oos: number[] } = { is: [], oos: [] };
  const lone: { is: number[]; oos: number[] } = { is: [], oos: [] };

  for (const i of usable) {
    const half: 'IS' | 'OOS' = barTs[i] < midTs ? 'IS' : 'OOS';
    const f = fwd[i]!;
    const hk = half === 'IS' ? 'is' : 'oos';
    const all = [pF[i]!, ...others.map((o) => o[i]!)];
    let sV = 0, lV = 0;
    for (const p of all) { if (p >= PCT_HI) sV++; else if (p <= PCT_LO) lV++; }
    if (sV > lV && sV >= 1) byAgree[String(sV)][hk].push(-f);
    else if (lV > sV && lV >= 1) byAgree[String(lV)][hk].push(f);

    // partition on funding_oi
    const pf = pF[i]!;
    if (pf >= PCT_HI || pf <= PCT_LO) {
      const side = pf >= PCT_HI ? 'S' : 'L';
      const dret = side === 'S' ? -f : f;
      // do any OTHER signal agree same side?
      let agreeOther = false;
      for (const o of others) {
        const po = o[i]!;
        if (side === 'S' && po >= PCT_HI) agreeOther = true;
        if (side === 'L' && po <= PCT_LO) agreeOther = true;
      }
      (agreeOther ? conf : lone)[hk].push(dret);
    }
  }

  console.log(`\n══ ${pair} ══ usable=${usable.length} IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
  console.log('  monotonicity (dir-fade bps by total agreement):');
  const fmt = (a: number[]) => (isFinite(mean(a)) ? (mean(a) * 10000 >= 0 ? '+' : '') + (mean(a) * 10000).toFixed(1) : 'NaN').padStart(8) + `(n${a.length})`;
  for (const k of ['1', '2', '3', '4']) {
    console.log(`    agree=${k}  IS ${fmt(byAgree[k].is)}   OOS ${fmt(byAgree[k].oos)}`);
  }
  console.log('  funding_oi-extreme partition (does confirmation add value?):');
  console.log(`    CONFIRMED  IS ${fmt(conf.is)} t${tstat(conf.is).toFixed(2)}   OOS ${fmt(conf.oos)} t${tstat(conf.oos).toFixed(2)}`);
  console.log(`    LONE       IS ${fmt(lone.is)} t${tstat(lone.is).toFixed(2)}   OOS ${fmt(lone.oos)} t${tstat(lone.oos).toFixed(2)}`);
  console.log(`    CONF−LONE  IS Δ${((mean(conf.is) - mean(lone.is)) * 10000).toFixed(1)}bps welch_t${welch(conf.is, lone.is).toFixed(2)}   OOS Δ${((mean(conf.oos) - mean(lone.oos)) * 10000).toFixed(1)}bps welch_t${welch(conf.oos, lone.oos).toFixed(2)}`);

  return {
    pair,
    conf: { is: conf.is.slice(), oos: conf.oos.slice() },
    lone: { is: lone.is.slice(), oos: lone.oos.slice() },
    byAgree: { '1': byAgree['1'], '2': byAgree['2'], '3': byAgree['3'], '4': byAgree['4'] },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const pairs = args.length ? args : ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'INJUSDT', 'ARBUSDT', 'XRPUSDT', 'LINKUSDT', 'ATOMUSDT', 'BNBUSDT', 'ETHUSDT'];
  const res: any[] = [];
  for (const p of pairs) { try { const r = await analyzePair(p); if (r) res.push(r); } catch (e: any) { console.log(`${p}: ERR ${e?.message}`); } }

  // POOLED confirmation test
  const pool = (sel: (r: any) => number[], half: 'is' | 'oos') => res.flatMap((r) => sel(r));
  const confIs = res.flatMap((r) => r.conf.is), confOos = res.flatMap((r) => r.conf.oos);
  const loneIs = res.flatMap((r) => r.lone.is), loneOos = res.flatMap((r) => r.lone.oos);
  console.log(`\n\n══ POOLED CONFIRMATION TEST (${res.length} pairs) ══`);
  const f = (a: number[]) => `${(mean(a) * 10000 >= 0 ? '+' : '') + (mean(a) * 10000).toFixed(1)}bps (n${a.length}, t${tstat(a).toFixed(2)})`;
  console.log(`CONFIRMED  IS ${f(confIs)}   OOS ${f(confOos)}`);
  console.log(`LONE       IS ${f(loneIs)}   OOS ${f(loneOos)}`);
  console.log(`CONF−LONE  IS Δ${((mean(confIs) - mean(loneIs)) * 10000).toFixed(1)}bps welch_t${welch(confIs, loneIs).toFixed(2)}   OOS Δ${((mean(confOos) - mean(loneOos)) * 10000).toFixed(1)}bps welch_t${welch(confOos, loneOos).toFixed(2)}`);

  // POOLED monotonicity
  console.log(`\n══ POOLED MONOTONICITY (dir-fade bps by agreement) ══`);
  for (const k of ['1', '2', '3', '4']) {
    const is = res.flatMap((r) => r.byAgree[k].is), oos = res.flatMap((r) => r.byAgree[k].oos);
    console.log(`agree=${k}  IS ${f(is)}   OOS ${f(oos)}`);
  }

  // Per-pair confirmation winner tally (OOS)
  let confWinsOos = 0, loneWinsOos = 0, confWinsIs = 0;
  for (const r of res) {
    if (mean(r.conf.oos) > mean(r.lone.oos)) confWinsOos++; else loneWinsOos++;
    if (mean(r.conf.is) > mean(r.lone.is)) confWinsIs++;
  }
  console.log(`\nPer-pair: CONFIRMED beats LONE on OOS in ${confWinsOos}/${res.length} pairs (IS ${confWinsIs}/${res.length}).`);
  await closePg();
}
main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

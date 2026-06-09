/**
 * lever-cadence-l2flatten — A/B the DECISION CADENCE lever (Lever-2) on the LIVE
 * 4-pair flatten book (BTC ls_pos 1.25 + SOL funding 0.875 + ADA funding 0.875 +
 * LINK S4 0.6). Question: does the ARMED DD-flatten on the narrow 4-pair book now
 * absorb the +3 Hyro MTM days that blocked L2 on the old cap-6 8-pair book?
 *
 *   L1 = DEPLOYED LIVE cadence: hourly cron decisions + 4H-close price anchor
 *        (DECISION_CADENCE=60m ANCHOR_4H=1). This is what live actually runs.
 *   L2 = LEVER: decide ONLY on the closed 4H boundary + 1h cronRealistic entry
 *        defer (DECISION_CADENCE=240m). Anti-churn: avoids hourly re-decision in chop.
 *
 * Live-faithful harness (= validate-book.ts): cap4, entry-cap 6/12h, cooldown-on-
 * commit, flatten 4.3% armed (kills off in tandem), market entries, slip 0.05.
 *
 * Robustness battery: full year + 2 halves (TRAIN/TEST) + 4-window rolling WF,
 * long/short split per cadence, Hyro −5% breach counts (MTM + balance basis) WITH
 * flatten on. Also a flatten-off row to isolate whether flatten is what absorbs.
 *
 * Run: npx tsx src/backtest/cli/lever-cadence-l2flatten.ts [days=340]
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const START_EQ = 200_000;
const RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: 0.6 };
const riskOf = (s: string) => RISK[s] ?? 0.6;
const BOOK = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];

function cfg(pair: string): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.BTCUSDT });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.SOLUSDT });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.ADAUSDT });
    case 'LINKUSDT': return fundingTaConfluence({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.LINKUSDT });
    default: throw new Error(`no cfg ${pair}`);
  }
}

function stats(t: ClosedTrade[]) {
  let eq = START_EQ, peak = eq, maxDD = 0, w = 0, l = 0, usd = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = x.pnlR * (riskOf(x.symbol) / 100 * START_EQ);
    eq += pnl; usd += pnl; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
  }
  const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  const sumR = t.reduce((s, x) => s + x.pnlR, 0);
  return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, maxDD, ret: usd / START_EQ * 100, sumR };
}

// cadence: 'L1' (hourly + 4H anchor, deployed live) | 'L2' (4H-only cadence lever)
async function run(pairs: string[], cad: 'L1' | 'L2', startTs: number, endTs: number, slip: number, flat: number | undefined) {
  if (cad === 'L1') { process.env.DECISION_CADENCE = '60m'; process.env.ANCHOR_4H = '1'; }
  else { process.env.DECISION_CADENCE = '240m'; delete process.env.ANCHOR_4H; }
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = pairs.map((p, i) => ({ symbol: p, strategy: cfg(p), priority: i }));
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: slip, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: pairs.length, maxEntriesPerWindow: 6, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: flat,
  });
  return { S: stats(r.trades), dd: r.dailyDd, trades: r.trades, flattenDays: r.guard.flattenDays };
}

const ann = (ret: number, days: number) => ret * 365 / days;
const row = (label: string, x: { S: any; dd: any; flattenDays: number }, days: number) => {
  const surv = x.dd.daysBreach5 === 0 && x.dd.balDaysBreach5 === 0;
  return `  ${label.padEnd(14)} ${((x.S.ret >= 0 ? '+' : '') + x.S.ret.toFixed(1) + '%').padStart(7)} (${(ann(x.S.ret, days) >= 0 ? '+' : '') + ann(x.S.ret, days).toFixed(0)}%/yr) · PF ${x.S.pf.toFixed(2)} · sumR ${x.S.sumR.toFixed(1).padStart(6)} · MaxDD ${x.S.maxDD.toFixed(1).padStart(4)}% · Hyro(MTM/bal) ${x.dd.daysBreach5}/${x.dd.balDaysBreach5} ${surv ? 'OK' : 'BREACH'} · flat ${x.flattenDays}d · n=${x.S.n}`;
};

async function main() {
  const days = parseFloat(process.argv[2] ?? '340');
  const now = Date.now(), D = days * 24 * 3600_000, half = Math.round(days / 2);
  console.log(`\nLEVER CADENCE L2 vs L1 — LIVE 4-pair flatten book (BTC1.25+SOL0.875+ADA0.875+LINK0.6)`);
  console.log(`(L1 = deployed: hourly cron + 4H anchor | L2 = lever: 4H-only cadence + 1h defer)`);
  console.log(`flatten 4.3% ARMED · slip 0.05% · cap4 · entry-cap 6/12h · cooldown-commit · ${days}d\n`);

  console.log(`── 1) FULL YEAR + HALVES (flatten ON, slip 0.05) ──`);
  for (const [lbl, s, e, d] of [['YEAR', now - D, now, days], ['OLD half', now - D, now - D / 2, half], ['RECENT half', now - D / 2, now, half]] as [string, number, number, number][]) {
    const l1 = await run(BOOK, 'L1', s, e, 0.05, 4.3), l2 = await run(BOOK, 'L2', s, e, 0.05, 4.3);
    console.log(`  [${lbl}]`);
    console.log(row('  L1 (live)', l1, d));
    console.log(row('  L2 (lever)', l2, d));
    console.log(`    Δ L2−L1: ret ${(l2.S.ret - l1.S.ret >= 0 ? '+' : '') + (l2.S.ret - l1.S.ret).toFixed(1)}pp · ann ${(ann(l2.S.ret, d) - ann(l1.S.ret, d) >= 0 ? '+' : '') + (ann(l2.S.ret, d) - ann(l1.S.ret, d)).toFixed(0)}pp/yr · MaxDD ${(l2.S.maxDD - l1.S.maxDD >= 0 ? '+' : '') + (l2.S.maxDD - l1.S.maxDD).toFixed(1)}pp · ΔHyro ${(l2.dd.daysBreach5 - l1.dd.daysBreach5)}/${(l2.dd.balDaysBreach5 - l1.dd.balDaysBreach5)}`);
  }

  console.log(`\n── 2) 4-WINDOW ROLLING WALK-FORWARD (flatten ON, slip 0.05) ──`);
  const wlen = Math.floor(days / 4);
  let l1wins = 0, l2wins = 0;
  for (let i = 0; i < 4; i++) {
    const e = now - (3 - i) * wlen * 24 * 3600_000;
    const s = e - wlen * 24 * 3600_000;
    const l1 = await run(BOOK, 'L1', s, e, 0.05, 4.3), l2 = await run(BOOK, 'L2', s, e, 0.05, 4.3);
    const win = l2.S.ret > l1.S.ret ? 'L2' : 'L1';
    if (win === 'L2') l2wins++; else l1wins++;
    console.log(`  W${i + 1} (${wlen}d, ${new Date(s).toISOString().slice(0, 10)}→${new Date(e).toISOString().slice(0, 10)}):`);
    console.log(row('    L1', l1, wlen));
    console.log(row('    L2', l2, wlen));
    console.log(`     → ${win} wins · Δret ${(l2.S.ret - l1.S.ret >= 0 ? '+' : '') + (l2.S.ret - l1.S.ret).toFixed(1)}pp · ΔMaxDD ${(l2.S.maxDD - l1.S.maxDD >= 0 ? '+' : '') + (l2.S.maxDD - l1.S.maxDD).toFixed(1)}pp · L2 Hyro ${l2.dd.daysBreach5}/${l2.dd.balDaysBreach5} vs L1 ${l1.dd.daysBreach5}/${l1.dd.balDaysBreach5}`);
  }
  console.log(`  ROLLING TALLY: L2 wins ${l2wins}/4 · L1 wins ${l1wins}/4 (need L2 ≥3/4 for robust)`);

  console.log(`\n── 3) LONG/SHORT SPLIT (full year, flatten ON, slip 0.05) ──`);
  for (const cad of ['L1', 'L2'] as const) {
    const r = await run(BOOK, cad, now - D, now, 0.05, 4.3);
    const lo = stats(r.trades.filter(t => String((t as any).side) === 'long'));
    const sh = stats(r.trades.filter(t => String((t as any).side) === 'short'));
    console.log(`  ${cad}: long n=${lo.n} sumR ${lo.sumR.toFixed(1)} (ret ${(lo.ret >= 0 ? '+' : '') + lo.ret.toFixed(1)}%) | short n=${sh.n} sumR ${sh.sumR.toFixed(1)} (ret ${(sh.ret >= 0 ? '+' : '') + sh.ret.toFixed(1)}%)`);
  }

  console.log(`\n── 4) FLATTEN ON vs OFF (full year, slip 0.05) — does flatten absorb L2 breaches? ──`);
  for (const cad of ['L1', 'L2'] as const) {
    const on = await run(BOOK, cad, now - D, now, 0.05, 4.3);
    const off = await run(BOOK, cad, now - D, now, 0.05, undefined);
    console.log(`  ${cad} flatten ON :`);
    console.log(row(`    ${cad} ON`, on, days));
    console.log(`  ${cad} flatten OFF:`);
    console.log(row(`    ${cad} OFF`, off, days));
  }

  console.log(`\n── 5) SLIP SENSITIVITY of L2 (full year, flatten ON) ──`);
  for (const slip of [0.05, 0.10, 0.25]) {
    const l2 = await run(BOOK, 'L2', now - D, now, slip, 4.3);
    console.log(row(`  L2 slip ${slip.toFixed(2)}%`, l2, days));
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

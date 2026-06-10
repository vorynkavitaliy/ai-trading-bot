/**
 * btc-regime-pnl — focused 3-config BTC standalone P&L comparison for the
 * "BTC-trend regime gate on funding fade" finding. Single pair (cap never binds),
 * HONEST cron-realistic, IS(older 183d)/OOS(recent 183d) halves.
 *
 *   A = LIVE config: ls_pos .85/.15, useBtcTrend:true  (regime gate ON)
 *   B = same but useBtcTrend:FALSE                       (regime gate OFF — what the gate adds)
 *   C = FINDING: funding .70/.30, useBtcTrend:true       (funding signal, BTC-down gated)
 *
 * Matches LIVE BTC exactly: slAtrMult 2.0, tpAtrMult 2.0, maxHoldBars 12, riskPct 1.25.
 * (live: src/runtime/pair-strategies.ts BTCUSDT block.) Same sl/risk on B & C for
 * apples-to-apples. sumR reported alongside ret% (sumR is risk-invariant).
 *
 * Run: npx tsx src/backtest/cli/btc-regime-pnl.ts
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const PAIR = 'BTCUSDT';
const RISK = 1.25; // LIVE_RISK_PCT_BTC

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 668_000,
  slippagePct: 0.25,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  cronRealistic: true,
};

interface V { key: string; label: string; strat: Strategy }
const VARIANTS: V[] = [
  { key: 'A', label: 'A LIVE  ls_pos .85/.15 btcTrend ON ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK }) },
  { key: 'B', label: 'B GATE  ls_pos .85/.15 btcTrend OFF', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: false, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK }) },
  { key: 'C', label: 'C FIND  funding .70/.30 btcTrend ON', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: true,  slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK }) },
];

async function runHalf(strat: Strategy, skipDays: number) {
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const r = await runBacktest(strat, { symbol: PAIR, startTs, endTs, ...COMMON });
  const m = r.metrics;
  return { n: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct };
}

async function main() {
  console.log(`\n== BTC REGIME-GATE / FUNDING vs LS_POS — single pair, HONEST, IS(older)/OOS(recent) 183d, risk ${RISK}% ==\n`);
  console.log('cfg                                   | half | n  WR    PF    sumR   ret%   DD%');
  console.log('-'.repeat(86));
  for (const v of VARIANTS) {
    const oos = await runHalf(v.strat, 0);
    const is = await runHalf(v.strat, 183);
    const fmt = (m: any) => `${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${m.pf.toFixed(2).padStart(6)} ${m.sumR.toFixed(2).padStart(7)} ${m.ret.toFixed(2).padStart(7)} ${m.maxDD.toFixed(2).padStart(6)}`;
    console.log(`${v.label} | OOS  | ${fmt(oos)}`);
    console.log(`${' '.repeat(v.label.length)} | IS   | ${fmt(is)}`);
    console.log(`ROW ${v.key} OOS ${oos.n} ${oos.wr.toFixed(1)} ${oos.pf.toFixed(3)} ${oos.sumR.toFixed(3)} ${oos.ret.toFixed(3)} ${oos.maxDD.toFixed(3)}`);
    console.log(`ROW ${v.key} IS  ${is.n} ${is.wr.toFixed(1)} ${is.pf.toFixed(3)} ${is.sumR.toFixed(3)} ${is.ret.toFixed(3)} ${is.maxDD.toFixed(3)}`);
    console.log('-'.repeat(86));
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

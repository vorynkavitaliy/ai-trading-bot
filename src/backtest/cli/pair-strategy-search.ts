/**
 * pair-strategy-search — find the BEST standalone strategy for ONE pair. Tests a
 * curated set of principled single-entry (no DCA) variants spanning ls_top_position
 * fade, funding fade, and the two confluences, with stop/hold/threshold tuning, on
 * BOTH OOS halves (IS=older 183d, OOS=recent 183d), HONEST cron-realistic. Judge by
 * BOTH-HALVES robustness, NOT max-of-N.
 *
 * Run (bg ~30min): npx tsx src/backtest/cli/pair-strategy-search.ts ETHUSDT
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence, lsTopPositionFundingConfluence } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const PAIR = process.argv[2];
if (!PAIR) { console.error('usage: pair-strategy-search.ts <PAIR>'); process.exit(1); }

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 668_000, slippagePct: 0.25, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
  cronRealistic: true,
};

interface V { label: string; strat: Strategy }
const VARIANTS: V[] = [
  // ls_top_position family (BTC's signal — control for ETH)
  { label: 'lspos .85/.15 btcTr sl1.5    ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'lspos .85/.15 btcTr sl2.0    ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  // funding family (ETH's signal)
  { label: 'funding .75/.25 bothTr sl1.5 ', strat: fundingFade({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'funding .75/.25 bothTr sl2.0 ', strat: fundingFade({ slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'funding .75/.25 NOtrend sl1.5', strat: fundingFade({ usePairTrend: false, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'funding .70/.30 bothTr sl1.5 ', strat: fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'funding .80/.20 bothTr sl1.5 ', strat: fundingFade({ pctHi: .80, pctLo: .20, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'funding .75/.25 sl2.0 hold18 ', strat: fundingFade({ slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 18, riskPct: .5 }) },
  { label: 'funding .75/.25 bothTr tp1.5 ', strat: fundingFade({ slAtrMult: 1.5, tpAtrMult: 1.5, maxHoldBars: 12, riskPct: .5 }) },
  // confluences
  { label: 'S4 F+TopAcct .70/.30 sl1.5   ', strat: fundingTaConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'S4 F+TopAcct .70/.30 sl2.0   ', strat: fundingTaConfluence({ slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'S5 F+TopPos .80/.20 sl1.5    ', strat: lsTopPositionFundingConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'funding .70/.30 sl2.0        ', strat: fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
];

async function runHalf(strat: Strategy, skipDays: number) {
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const r = await runBacktest(strat, { symbol: PAIR, startTs, endTs, ...COMMON });
  const m = r.metrics;
  return { n: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct };
}

async function main() {
  console.log(`\n══ ${PAIR} STANDALONE STRATEGY SEARCH — single entry, HONEST, IS/OOS 183d halves ══\n`);
  console.log('variant                       │ OOS:  n  WR    PF   sumR  ret%  DD%  │ IS:   n  WR    PF   sumR  ret%  DD%  │ verdict');
  console.log('─'.repeat(135));
  const rows: Array<{ label: string; oos: any; is: any; combined: number; bothPos: boolean }> = [];
  for (const v of VARIANTS) {
    const oos = await runHalf(v.strat, 0);
    const is = await runHalf(v.strat, 183);
    const bothPos = oos.sumR > 0 && is.sumR > 0;
    rows.push({ label: v.label, oos, is, combined: oos.sumR + is.sumR, bothPos });
    const fmt = (m: any) => `${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${m.pf.toFixed(2).padStart(5)} ${m.sumR.toFixed(1).padStart(5)} ${m.ret.toFixed(1).padStart(5)} ${m.maxDD.toFixed(1).padStart(4)}`;
    const verdict = !bothPos ? (oos.sumR > 0 ? 'OOS+ only' : is.sumR > 0 ? 'IS+ only' : '✗ both−')
      : (oos.pf >= 1.4 && is.pf >= 1.4 ? '✓✓ both PF≥1.4' : '✓ both+');
    console.log(`${v.label} │ ${fmt(oos)} │ ${fmt(is)} │ ${verdict}`);
  }
  console.log(`\n=== RANKED (both-halves-positive, by combined sumR) ===`);
  for (const r of rows.filter(r => r.bothPos).sort((a, b) => b.combined - a.combined)) {
    console.log(`  ${r.label.trim().padEnd(30)} combined ${r.combined.toFixed(1).padStart(6)}R | OOS ${r.oos.sumR.toFixed(1)}/PF${r.oos.pf.toFixed(2)} IS ${r.is.sumR.toFixed(1)}/PF${r.is.pf.toFixed(2)} maxDD ${Math.max(r.oos.maxDD, r.is.maxDD).toFixed(1)}%`);
  }
  const failed = rows.filter(r => !r.bothPos).map(r => r.label.trim());
  if (failed.length) console.log(`\n  (failed both-halves: ${failed.length}/${rows.length})`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

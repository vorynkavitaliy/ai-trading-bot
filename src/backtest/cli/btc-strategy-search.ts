/**
 * btc-strategy-search — focused hunt for the BEST standalone BTC strategy. Tests a
 * CURATED set of principled single-entry (no DCA) variants on BOTH OOS halves (IS=older
 * 183d, OOS=recent 183d), HONEST cron-realistic. Judge by BOTH-HALVES robustness, NOT
 * max-of-N (that's the grid trap). Variants motivated by the signal EDA: BTC's stable
 * fade signals are ls_top_position + funding + OI; edge peaks at the 48h horizon.
 *
 * Run (background ~25min): npx tsx src/backtest/cli/btc-strategy-search.ts
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, lsTopPositionFundingConfluence } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const PAIR = 'BTCUSDT';
const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 668_000,
  slippagePct: 0.25,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,   // 4H cadence (= L2: decide on the closed 4H bar)
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  cronRealistic: true,
};

interface V { label: string; strat: Strategy }
const VARIANTS: V[] = [
  // Reference — the known both-halves winner (S2 ls_pos fade, BTC trend)
  { label: 'R1 ls_pos .85/.15 btcTrend (ref)', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'R2 ls_pos .85/.15 pairTrend     ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'R3 ls_pos .85/.15 NO trend      ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  // Confluence (S5: funding + ls_top_position) — the BTC-designed high-conviction variant
  { label: 'C1 S5 confluence .80/.20 pairTr ', strat: lsTopPositionFundingConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'C2 S5 confluence .80/.20 NO trnd', strat: lsTopPositionFundingConfluence({ usePairTrend: false, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'C3 S5 confluence .85/.15 pairTr ', strat: lsTopPositionFundingConfluence({ pctHi: .85, pctLo: .15, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  // Threshold tuning on the reference
  { label: 'T1 ls_pos .90/.10 btcTrend      ', strat: lsTopPositionFade({ pctHi: .90, pctLo: .10, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'T2 ls_pos .80/.20 btcTrend      ', strat: lsTopPositionFade({ pctHi: .80, pctLo: .20, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  // Horizon/exit tuning — EDA: BTC edge peaks at 48h
  { label: 'H1 ls_pos hold18 (72h)          ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 18, riskPct: .5 }) },
  { label: 'H2 ls_pos tp1.5 (tighter target)', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 1.5, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'H3 ls_pos tp2.5 hold18 (run)    ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.5, maxHoldBars: 18, riskPct: .5 }) },
  { label: 'H4 ls_pos sl2.0 (wider stop)    ', strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  // ── Funding-fade variants — scan says funding_oi is BTC's STRONGEST stable signal (OOS IC −0.17),
  //    stronger than ls_top_position (OOS −0.11). BTC currently trades the weaker ls_pos. ──
  { label: 'F1 funding .70/.30 btcTrend     ', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'F2 funding .75/.25 btcTrend     ', strat: fundingFade({ pctHi: .75, pctLo: .25, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'F3 funding .70/.30 NO trend     ', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'F4 funding .80/.20 btcTrend     ', strat: fundingFade({ pctHi: .80, pctLo: .20, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'F5 funding .70/.30 btcTrend sl2 ', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
];

async function runHalf(strat: Strategy, skipDays: number) {
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const r = await runBacktest(strat, { symbol: PAIR, startTs, endTs, ...COMMON });
  const m = r.metrics;
  return { n: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct };
}

async function main() {
  console.log(`\n══ BTC STANDALONE STRATEGY SEARCH — single entry, HONEST, IS(older)/OOS(recent) 183d halves ══\n`);
  console.log('variant                          │ OOS:  n  WR    PF   sumR   ret%  DD%  │ IS:   n  WR    PF   sumR   ret%  DD%  │ verdict');
  console.log('─'.repeat(140));

  const rows: Array<{ label: string; oos: any; is: any; combined: number; bothPos: boolean }> = [];
  for (const v of VARIANTS) {
    const oos = await runHalf(v.strat, 0);
    const is = await runHalf(v.strat, 183);
    const bothPos = oos.sumR > 0 && is.sumR > 0;
    const combined = oos.sumR + is.sumR;
    rows.push({ label: v.label, oos, is, combined, bothPos });
    const fmt = (m: any) => `${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${m.pf.toFixed(2).padStart(5)} ${m.sumR.toFixed(1).padStart(6)} ${m.ret.toFixed(1).padStart(5)} ${m.maxDD.toFixed(1).padStart(4)}`;
    const verdict = !bothPos ? (oos.sumR > 0 ? 'OOS+ only' : is.sumR > 0 ? 'IS+ only' : '✗ both−')
      : (oos.pf >= 1.4 && is.pf >= 1.4 ? '✓✓ both PF≥1.4' : '✓ both+');
    console.log(`${v.label} │ ${fmt(oos)} │ ${fmt(is)} │ ${verdict}`);
  }

  console.log('\n=== RANKED (both-halves-positive only, by combined sumR) ===');
  for (const r of rows.filter(r => r.bothPos).sort((a, b) => b.combined - a.combined)) {
    console.log(`  ${r.label.trim().padEnd(34)} combined ${r.combined.toFixed(1).padStart(6)}R  | OOS ${r.oos.sumR.toFixed(1)}/PF${r.oos.pf.toFixed(2)}  IS ${r.is.sumR.toFixed(1)}/PF${r.is.pf.toFixed(2)}  maxDD ${Math.max(r.oos.maxDD, r.is.maxDD).toFixed(1)}%`);
  }
  const failed = rows.filter(r => !r.bothPos).map(r => r.label.trim().split(' ')[0]);
  if (failed.length) console.log(`\n  (failed both-halves: ${failed.join(', ')})`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

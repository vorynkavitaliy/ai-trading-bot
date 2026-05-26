/**
 * Standalone BTC backtest: BASELINE vs SCALED-IN at the engine level.
 * Diagnoses why real-engine scaled-in produced worse BTC results than post-hoc
 * simulation predicted. Pinpoints whether the extra trades are the culprit.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000,
  slippagePct: 0.05,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;

  // BASELINE
  const baseStrategy = lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 });
  console.log('Running BASELINE…');
  const rB = await runBacktest(baseStrategy, { symbol: 'BTCUSDT', startTs, endTs: now, ...COMMON });

  // SCALED-IN sweep over TP
  const tpCandidates = [0.8, 1.2, 1.5, 2.0, 2.5];
  console.log(`Running SCALED-IN variants over TP ${tpCandidates.join(', ')}…`);
  const variants: Array<{ tp: number; trades: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number }> = [];
  for (const tp of tpCandidates) {
    const siStrategy = lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: tp } });
    const r = await runBacktest(siStrategy, { symbol: 'BTCUSDT', startTs, endTs: now, ...COMMON });
    variants.push({ tp, trades: r.metrics.trades, wr: r.metrics.winRate*100, pf: r.metrics.profitFactor, sumR: r.metrics.totalR, maxDD: r.metrics.maxDDPct, ret: r.metrics.netPnlPct });
  }
  // Re-use rS to keep downstream prints working (TP 2.0 variant)
  const siStrategy = lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0 } });
  const rS = await runBacktest(siStrategy, { symbol: 'BTCUSDT', startTs, endTs: now, ...COMMON });

  console.log('\n=== TP SWEEP ===');
  console.log('TP  | trades  WR    PF    sumR    MaxDD  return');
  for (const v of variants) {
    console.log(`${v.tp.toString().padStart(3)}  |  ${String(v.trades).padStart(4)}   ${v.wr.toFixed(1)}%  ${v.pf.toFixed(2)}  ${v.sumR.toFixed(2).padStart(6)}  ${v.maxDD.toFixed(2)}%   ${v.ret.toFixed(2)}%`);
  }

  console.log('\n=== METRICS COMPARISON ===');
  console.log(`baseline:  trades=${rB.metrics.trades} WR=${(rB.metrics.winRate*100).toFixed(1)}% PF=${rB.metrics.profitFactor.toFixed(2)} sumR=${rB.metrics.totalR.toFixed(2)} MaxDD=${rB.metrics.maxDDPct.toFixed(2)}% return=${rB.metrics.netPnlPct.toFixed(2)}%`);
  console.log(`scaled-in: trades=${rS.metrics.trades} WR=${(rS.metrics.winRate*100).toFixed(1)}% PF=${rS.metrics.profitFactor.toFixed(2)} sumR=${rS.metrics.totalR.toFixed(2)} MaxDD=${rS.metrics.maxDDPct.toFixed(2)}% return=${rS.metrics.netPnlPct.toFixed(2)}%`);

  // Exit reason breakdown
  const baselineExits: Record<string, number> = {};
  for (const t of rB.trades) baselineExits[t.exitReason] = (baselineExits[t.exitReason] ?? 0) + 1;
  const scaledExits: Record<string, number> = {};
  for (const t of rS.trades) scaledExits[t.exitReason] = (scaledExits[t.exitReason] ?? 0) + 1;
  console.log(`\nbaseline exits: ${JSON.stringify(baselineExits)}`);
  console.log(`scaled exits:   ${JSON.stringify(scaledExits)}`);

  // Duration distribution
  const durations = (arr: typeof rB.trades) => arr.map(t => (t.exitTs - t.entryTs) / 3600_000).sort((a, b) => a - b);
  const med = (a: number[]) => a[Math.floor(a.length / 2)];
  const bD = durations(rB.trades); const sD = durations(rS.trades);
  console.log(`\nbaseline duration: min=${bD[0].toFixed(1)}h med=${med(bD).toFixed(1)}h max=${bD[bD.length-1].toFixed(1)}h`);
  console.log(`scaled   duration: min=${sD[0].toFixed(1)}h med=${med(sD).toFixed(1)}h max=${sD[sD.length-1].toFixed(1)}h`);

  // Trades only in scaled (extra) by entryTs — those that fall in windows where baseline had open position
  const baselineWindows = rB.trades.map(t => ({ start: t.entryTs, end: t.exitTs }));
  const extraScaled = rS.trades.filter(t => {
    const inAnyBaselineWindow = baselineWindows.some(w => t.entryTs >= w.start && t.entryTs <= w.end);
    return inAnyBaselineWindow;
  });
  console.log(`\nExtra scaled-in trades that started while baseline had open position: ${extraScaled.length}/${rS.trades.length}`);
  const extraWins = extraScaled.filter(t => t.pnlR > 0.05).length;
  const extraSumR = extraScaled.reduce((s, t) => s + t.pnlR, 0);
  console.log(`  extras stats: wins=${extraWins} (${(extraWins/extraScaled.length*100).toFixed(1)}%) sumR=${extraSumR.toFixed(2)}`);

  // Compare baseline trades to corresponding scaled-in (trades whose entryTs overlaps)
  // Find scaled trades whose entryTs is near a baseline trade (within 1h)
  const aligned = rB.trades.map(b => {
    const matched = rS.trades.find(s => Math.abs(s.entryTs - b.entryTs) < 3600_000);
    return matched ? { baselinePnlR: b.pnlR, scaledPnlR: matched.pnlR } : null;
  }).filter(x => x);
  console.log(`\nAligned pairs (baseline↔scaled, |Δentry|<1h): ${aligned.length}`);
  if (aligned.length) {
    const bSum = aligned.reduce((s, x) => s + x!.baselinePnlR, 0);
    const sSum = aligned.reduce((s, x) => s + x!.scaledPnlR, 0);
    console.log(`  aligned baseline sumR: ${bSum.toFixed(2)}`);
    console.log(`  aligned scaled  sumR: ${sSum.toFixed(2)}`);
    console.log(`  Δ on aligned trades:  ${(sSum - bSum).toFixed(2)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

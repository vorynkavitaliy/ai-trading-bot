/**
 * RESEARCH: walk-forward validation of TAOUSDT with S1 (lsTopPositionFade +
 * pair trend) scaled-in FIXED — candidate for universe addition.
 *
 * In-sample sweep (sweep-new-pair.ts, 2026-05-27): TAO S1 scaled-in gave
 * sumR 15.21, WR 68.2%, PF 2.72, +9.48% — strongest of 4 READY candidates,
 * on par with ETH (15.65). Old memory benched TAO as "marginal/0R" but that
 * was on S3 funding, not S1 L/S-top-position.
 *
 * Gate to add to universe (same as the 9 current pairs):
 *   - Both TRAIN and TEST halves positive
 *   - TRAIN→TEST degradation gap < ~0.20 on avgR (not a cliff)
 *   - TEST PF > 1.3, WR > 50%
 *
 * Read-only. Does NOT modify pair-strategies.ts — that's a separate step IF this passes.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN = { nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0, sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5, tpRecomputeOnFill: false };

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000, slippagePct: 0.05, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

// S1: L/S Top Position fade + pair trend (same params as ETH in v5)
function makeS1() {
  return lsTopPositionFade({
    pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false,
    slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN,
  });
}

interface Stats { n: number; wr: number; pf: number; sumR: number; avgR: number; maxDD: number; }
function stats(trades: ClosedTrade[]): Stats {
  if (trades.length === 0) return { n: 0, wr: 0, pf: 0, sumR: 0, avgR: 0, maxDD: 0 };
  const fixedRiskUsd = COMMON.startEquity * (COMMON.riskPctBase / 100);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  for (const t of trades) {
    equity += t.pnlR * fixedRiskUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  return {
    n: trades.length, wr: total > 0 ? wins / total * 100 : 0,
    pf: lossR > 0 ? winR / lossR : (winR > 0 ? Infinity : 0),
    sumR, avgR: sumR / trades.length, maxDD,
  };
}

function fmt(s: Stats): string {
  return `n=${String(s.n).padStart(3)} WR=${s.wr.toFixed(1).padStart(5)}% PF=${s.pf.toFixed(2).padStart(5)} sumR=${s.sumR.toFixed(2).padStart(7)} avgR=${s.avgR.toFixed(3)} DD=${s.maxDD.toFixed(2)}%`;
}

async function main() {
  const now = Date.now();
  const days = 365;
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  TAOUSDT — S1 (LS-TopPos fade + pair trend) scaled-in — WALK-FORWARD');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  resetCgFadeCooldownState();
  const full = await runBacktest(makeS1(), { symbol: 'TAOUSDT', startTs, endTs: now, ...COMMON });
  resetCgFadeCooldownState();
  const train = await runBacktest(makeS1(), { symbol: 'TAOUSDT', startTs, endTs: splitTs, ...COMMON });
  resetCgFadeCooldownState();
  const test = await runBacktest(makeS1(), { symbol: 'TAOUSDT', startTs: splitTs, endTs: now, ...COMMON });

  const sFull = stats(full.trades);
  const sTrain = stats(train.trades);
  const sTest = stats(test.trades);

  console.log(`  FULL   ${fmt(sFull)}`);
  console.log(`  TRAIN  ${fmt(sTrain)}  (${new Date(startTs).toISOString().slice(0,10)} → ${new Date(splitTs).toISOString().slice(0,10)})`);
  console.log(`  TEST   ${fmt(sTest)}  (${new Date(splitTs).toISOString().slice(0,10)} → ${new Date(now).toISOString().slice(0,10)})`);

  // Direction breakdown on full
  const longs = full.trades.filter(t => t.side === 'long');
  const shorts = full.trades.filter(t => t.side === 'short');
  console.log(`\n  FULL LONG   ${fmt(stats(longs))}`);
  console.log(`  FULL SHORT  ${fmt(stats(shorts))}`);

  // Verdict
  console.log('\n--- VERDICT ---');
  const gap = sTrain.avgR - sTest.avgR;
  const bothPositive = sTrain.sumR > 0 && sTest.sumR > 0;
  const testHealthy = sTest.pf > 1.3 && sTest.wr > 50;
  const smallGap = Math.abs(gap) < 0.25;

  console.log(`  Both halves positive: ${bothPositive ? '✓' : '✗'} (train sumR ${sTrain.sumR.toFixed(2)}, test sumR ${sTest.sumR.toFixed(2)})`);
  console.log(`  TEST healthy (PF>1.3 WR>50): ${testHealthy ? '✓' : '✗'} (PF ${sTest.pf.toFixed(2)}, WR ${sTest.wr.toFixed(1)}%)`);
  console.log(`  Train→Test gap small (<0.25 avgR): ${smallGap ? '✓' : '✗'} (gap ${gap.toFixed(3)})`);

  if (bothPositive && testHealthy && smallGap) {
    console.log('\n  🟢 PASS — TAO S1 scaled-in qualifies for universe addition.');
  } else if (bothPositive && (testHealthy || smallGap)) {
    console.log('\n  🟡 MARGINAL — positive both halves but one quality check failed. Operator judgment.');
  } else {
    console.log('\n  🔴 FAIL — does not generalize OOS. Keep TAO out (memory was right).');
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

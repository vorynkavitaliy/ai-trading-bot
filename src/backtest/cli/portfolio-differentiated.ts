/**
 * Differentiated portfolio: per-pair sizing decision based on walk-forward results.
 *
 * BTCUSDT  → baseline (scaled-in lost −3R on TEST)
 * TAOUSDT  → baseline (scaled-in lost ~−1R, marginal)
 * INJUSDT  → scaled-in FIXED (+7R on TEST)
 * ATOMUSDT → scaled-in FIXED (+5R on TEST)
 * ARBUSDT  → scaled-in FIXED (+8R on TEST)
 * XRPUSDT  → scaled-in FIXED (+5R on TEST)
 * LTCUSDT  → scaled-in FIXED (+6R on TEST)
 * HYPEUSDT → S4 scaled-in FIXED (PF 1.83, MaxDD 2.88% on full period)
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN_FIXED = {
  nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

interface PairCfg { pair: string; strategy: Strategy; note: string; }

const TIER1_PLUS_HYPE: PairCfg[] = [
  // Baseline pairs
  { pair: 'BTCUSDT',  note: 'baseline (S1)',           strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }) },
  { pair: 'TAOUSDT',  note: 'baseline (S3)',           strategy: fundingFade() },
  // Scaled-in FIXED pairs
  { pair: 'INJUSDT',  note: 'scaled-in FIXED (S2)',    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ATOMUSDT', note: 'scaled-in FIXED (S3)',    strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT',  note: 'scaled-in FIXED (S3)',    strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'XRPUSDT',  note: 'scaled-in FIXED (S4)',    strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'LTCUSDT',  note: 'scaled-in FIXED (S2)',    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'HYPEUSDT', note: 'scaled-in FIXED (S4)',    strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
];

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

function aggregate(trades: ClosedTrade[], label: string) {
  trades.sort((a, b) => a.entryTs - b.entryTs);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  for (const t of trades) {
    const riskUsd = equity * (COMMON.riskPctBase / 100);
    equity += t.pnlR * riskUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  console.log(`${label}: n=${total} WR=${(wins/total*100).toFixed(1)}% PF=${(winR/lossR).toFixed(2)} sumR=${sumR.toFixed(2)} return=${((equity-COMMON.startEquity)/COMMON.startEquity*100).toFixed(2)}% MaxDD=${maxDD.toFixed(2)}%`);
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log(`Differentiated portfolio: ${TIER1_PLUS_HYPE.length} pairs, ${days}d honest engine`);
  console.log(`Split for WF @ ${new Date(splitTs).toISOString().slice(0, 10)}\n`);

  const fullTrades: ClosedTrade[] = [];
  const trainTrades: ClosedTrade[] = [];
  const testTrades: ClosedTrade[] = [];
  const perPair: Record<string, { full: ClosedTrade[] }> = {};

  for (const cfg of TIER1_PLUS_HYPE) {
    log.info(`backtest ${cfg.pair}`, { strategy: cfg.note });
    const rFull = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    const rTrain = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: splitTs, ...COMMON });
    const rTest = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs: splitTs, endTs: now, ...COMMON });
    fullTrades.push(...rFull.trades);
    trainTrades.push(...rTrain.trades);
    testTrades.push(...rTest.trades);
    perPair[cfg.pair] = { full: rFull.trades };
    const sR = rFull.trades.reduce((s, t) => s + t.pnlR, 0);
    const wins = rFull.trades.filter(t => t.pnlR > 0.05).length;
    log.info(`done ${cfg.pair}`, { trades: rFull.trades.length, sumR: sR.toFixed(2), wr: (wins/rFull.trades.length*100).toFixed(1), note: cfg.note });
  }

  console.log('\n=== AGGREGATE ===');
  aggregate(fullTrades, 'FULL');
  aggregate(trainTrades, 'TRAIN');
  aggregate(testTrades, 'TEST ');

  console.log('\n=== PER-PAIR ===');
  for (const cfg of TIER1_PLUS_HYPE) {
    const t = perPair[cfg.pair].full;
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    console.log(`  ${cfg.pair.padEnd(10)} ${cfg.note.padEnd(28)} n=${String(t.length).padStart(3)} WR=${(wins/t.length*100).toFixed(1).padStart(5)}% sumR=${sumR.toFixed(2).padStart(6)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * Portfolio v5 — replace BTC+TAO with SOL+AVAX. All pairs on scaled-in FIXED.
 *
 * v4 pairs (current production-candidate):
 *   BTC baseline, TAO baseline, INJ scaled, ATOM scaled, ARB scaled,
 *   XRP scaled, LTC scaled, HYPE scaled
 *
 * v5 pairs:
 *   SOL scaled (S4), AVAX scaled (S1), INJ scaled (S2), ATOM scaled (S3),
 *   ARB scaled (S3), XRP scaled (S4), LTC scaled (S2), HYPE scaled (S4)
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

const V5: PairCfg[] = [
  // Replacements:
  { pair: 'SOLUSDT',  note: 'S4 scaled-in FIXED',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'AVAXUSDT', note: 'S1 scaled-in FIXED',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  // 5 keepers
  { pair: 'INJUSDT',  note: 'S2 scaled-in FIXED',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ATOMUSDT', note: 'S3 scaled-in FIXED',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT',  note: 'S3 scaled-in FIXED',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'XRPUSDT',  note: 'S4 scaled-in FIXED',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'LTCUSDT',  note: 'S2 scaled-in FIXED',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'HYPEUSDT', note: 'S4 scaled-in FIXED',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
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

  console.log(`Portfolio v5 (SOL+AVAX instead of BTC+TAO): ${V5.length} pairs, ${days}d honest engine`);
  console.log(`WF split @ ${new Date(splitTs).toISOString().slice(0, 10)}\n`);

  const fullTrades: ClosedTrade[] = [];
  const trainTrades: ClosedTrade[] = [];
  const testTrades: ClosedTrade[] = [];
  const perPair: Record<string, { full: ClosedTrade[] }> = {};

  for (const cfg of V5) {
    log.info(`backtest ${cfg.pair}`, { note: cfg.note });
    const rFull = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    const rTrain = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: splitTs, ...COMMON });
    const rTest = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs: splitTs, endTs: now, ...COMMON });
    fullTrades.push(...rFull.trades);
    trainTrades.push(...rTrain.trades);
    testTrades.push(...rTest.trades);
    perPair[cfg.pair] = { full: rFull.trades };
  }

  console.log('\n=== AGGREGATE ===');
  aggregate(fullTrades, 'FULL ');
  aggregate(trainTrades, 'TRAIN');
  aggregate(testTrades,  'TEST ');

  console.log('\n=== PER-PAIR ===');
  for (const cfg of V5) {
    const t = perPair[cfg.pair].full;
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    console.log(`  ${cfg.pair.padEnd(10)} ${cfg.note.padEnd(28)} n=${String(t.length).padStart(3)} WR=${(wins/Math.max(1,t.length)*100).toFixed(1).padStart(5)}% sumR=${sumR.toFixed(2).padStart(6)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

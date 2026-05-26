/**
 * Honest portfolio with scaled-in TP FIXED mode (TP locked at signal+2*ATR).
 * Compares vs avg-mode scaled-in to see which works better on honest engine.
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

interface PairCfg { pair: string; strategy: Strategy; }

const TIER1: PairCfg[] = [
  { pair: 'BTCUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'TAOUSDT',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'INJUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ATOMUSDT', strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'XRPUSDT',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'LTCUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
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

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const startTs = Date.now() - days * 24 * 3600_000;
  const endTs = Date.now();

  console.log(`Tier-1 SCALED-IN FIXED — ${days}d honest engine`);
  const allTrades: ClosedTrade[] = [];
  const perPair: Record<string, { trades: ClosedTrade[]; sumR: number; wins: number }> = {};

  for (const cfg of TIER1) {
    const r = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs, ...COMMON });
    log.info(`${cfg.pair}`, { trades: r.metrics.trades, totalR: r.metrics.totalR.toFixed(2), pf: r.metrics.profitFactor });
    allTrades.push(...r.trades);
    perPair[cfg.pair] = {
      trades: r.trades,
      sumR: r.trades.reduce((s, t) => s + t.pnlR, 0),
      wins: r.trades.filter(t => t.pnlR > 0.05).length,
    };
  }

  allTrades.sort((a, b) => a.entryTs - b.entryTs);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0;
  let sumR = 0;
  for (const t of allTrades) {
    const riskUsd = equity * (COMMON.riskPctBase / 100);
    equity += t.pnlR * riskUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = allTrades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(allTrades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));

  console.log(`\nAggregate: trades=${total} WR=${(wins/total*100).toFixed(1)}% PF=${(winR/lossR).toFixed(2)} sumR=${sumR.toFixed(2)} return=${((equity-COMMON.startEquity)/COMMON.startEquity*100).toFixed(2)}% MaxDD=${maxDD.toFixed(2)}%`);
  console.log(`\nPer-pair:`);
  for (const cfg of TIER1) {
    const s = perPair[cfg.pair];
    const n = s.trades.length;
    console.log(`  ${cfg.pair.padEnd(10)} n=${String(n).padStart(3)} wins=${String(s.wins).padStart(3)} WR=${(s.wins/n*100).toFixed(1).padStart(4)}% sumR=${s.sumR.toFixed(2).padStart(6)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * RESEARCH: long vs short decomposition on v5 portfolio backtest (12 months).
 * Read-only — uses prod strategies, same config as portfolio-v5-final.
 */
import { runBacktest } from '../engine';
import {
  lsTopPositionFade, fundingFade, fundingTaConfluence,
  resetCgFadeCooldownState,
} from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN = { nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0, sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5, tpRecomputeOnFill: false };

interface PairCfg { pair: string; build: () => Strategy; }
const PORTFOLIO: PairCfg[] = [
  { pair: 'SOLUSDT',  build: () => fundingTaConfluence({ scaledIn: SCALED_IN }) },
  { pair: 'INJUSDT',  build: () => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN }) },
  { pair: 'ATOMUSDT', build: () => fundingFade({ scaledIn: SCALED_IN }) },
  { pair: 'ARBUSDT',  build: () => fundingFade({ scaledIn: SCALED_IN }) },
  { pair: 'XRPUSDT',  build: () => fundingTaConfluence({ scaledIn: SCALED_IN }) },
  { pair: 'LTCUSDT',  build: () => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN }) },
  { pair: 'HYPEUSDT', build: () => fundingTaConfluence({ scaledIn: SCALED_IN }) },
  { pair: 'ETHUSDT',  build: () => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN }) },
  { pair: 'BNBUSDT',  build: () => fundingFade({ scaledIn: SCALED_IN }) },
];

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000, slippagePct: 0.05, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

function stats(trades: ClosedTrade[]) {
  if (trades.length === 0) return { n: 0, wr: 0, pf: 0, sumR: 0, avgR: 0 };
  let wins = 0, losses = 0, sumR = 0;
  for (const t of trades) {
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  return {
    n: trades.length, wr: total > 0 ? wins / total * 100 : 0,
    pf: lossR > 0 ? winR / lossR : 0,
    sumR, avgR: sumR / trades.length,
  };
}

function fmt(s: ReturnType<typeof stats>): string {
  return `n=${String(s.n).padStart(3)} WR=${s.wr.toFixed(1).padStart(5)}% PF=${s.pf.toFixed(2).padStart(5)} sumR=${s.sumR.toFixed(2).padStart(7)} avgR=${s.avgR.toFixed(3)}`;
}

async function main() {
  const now = Date.now();
  const day = 24 * 3600_000;
  const startTs = now - 360 * day;

  console.log('\nV5 portfolio — 12mo backtest decomposed by LONG vs SHORT\n');
  console.log(`Pairs: ${PORTFOLIO.map(c => c.pair).join(', ')}\n`);

  const allTrades: ClosedTrade[] = [];
  const perPair: Record<string, ClosedTrade[]> = {};

  for (const cfg of PORTFOLIO) {
    resetCgFadeCooldownState();
    const r = await runBacktest(cfg.build(), { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    allTrades.push(...r.trades);
    perPair[cfg.pair] = r.trades;
  }

  // === Overall ===
  const longs = allTrades.filter(t => t.side === 'long');
  const shorts = allTrades.filter(t => t.side === 'short');
  console.log('=== TOTAL (12mo, all pairs) ===');
  console.log(`  ALL    ${fmt(stats(allTrades))}`);
  console.log(`  LONG   ${fmt(stats(longs))}`);
  console.log(`  SHORT  ${fmt(stats(shorts))}`);
  console.log(`  Long share: ${(longs.length / allTrades.length * 100).toFixed(1)}%`);

  // === Per-pair ===
  console.log('\n=== PER-PAIR ===');
  console.log('Pair        ALL                                   | LONG                                  | SHORT');
  console.log('-----------+--------------------------------------+---------------------------------------+---------------------------------------');
  for (const cfg of PORTFOLIO) {
    const t = perPair[cfg.pair];
    const tl = t.filter(x => x.side === 'long');
    const ts = t.filter(x => x.side === 'short');
    console.log(`  ${cfg.pair.padEnd(9)} ${fmt(stats(t)).padEnd(38)} | ${fmt(stats(tl)).padEnd(37)} | ${fmt(stats(ts))}`);
  }

  // === Exit reason by side ===
  console.log('\n=== EXIT REASON BY SIDE ===');
  const exitReasons = ['tp1', 'tp1_then_sl_be', 'tp2', 'sl', 'time_stop', 'strategy_exit'];
  console.log('Reason          | LONG count | LONG sumR | SHORT count | SHORT sumR');
  for (const reason of exitReasons) {
    const lr = longs.filter(t => t.exitReason === reason);
    const sr = shorts.filter(t => t.exitReason === reason);
    if (lr.length === 0 && sr.length === 0) continue;
    const lSumR = lr.reduce((s, t) => s + t.pnlR, 0);
    const sSumR = sr.reduce((s, t) => s + t.pnlR, 0);
    console.log(`  ${reason.padEnd(15)} | ${String(lr.length).padStart(10)} | ${lSumR.toFixed(2).padStart(9)} | ${String(sr.length).padStart(11)} | ${sSumR.toFixed(2).padStart(10)}`);
  }

  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

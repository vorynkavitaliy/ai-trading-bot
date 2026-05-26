/**
 * Generic baseline-extract for any pair × strategy. Mirrors btc-extract-trades.ts
 * but takes pair and strategy from args, writing to /tmp/<pair>-trades.json.
 */
import { writeFileSync } from 'node:fs';
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';
import { Strategy } from '../types';

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

function makeStrategy(name: string): Strategy {
  switch (name) {
    case 'lsTopPosition_pair': return lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false });
    case 'lsTopPosition_btc': return lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true });
    case 'funding': return fundingFade();
    case 'funding_ta': return fundingTaConfluence();
    default: throw new Error(`Unknown strategy: ${name}`);
  }
}

async function main() {
  const pair = process.argv[2];
  const strategyName = process.argv[3];
  const days = parseFloat(process.argv[4] ?? '365');
  if (!pair || !strategyName) {
    console.error('usage: pair-extract-trades.ts <PAIR> <STRATEGY> [days=365]');
    console.error('strategies: lsTopPosition_pair, lsTopPosition_btc, funding, funding_ta');
    process.exit(1);
  }

  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const strategy = makeStrategy(strategyName);

  console.log(`Extracting ${pair} trades — strategy=${strategy.name}`);
  const r = await runBacktest(strategy, { symbol: pair, startTs, endTs: now, ...COMMON });
  console.log(`done: ${r.trades.length} trades, totalR=${r.metrics.totalR.toFixed(2)}, WR=${(r.metrics.winRate * 100).toFixed(1)}%, PF=${r.metrics.profitFactor.toFixed(2)}`);

  const lite = r.trades.map(t => ({
    entryTs: t.entryTs, exitTs: t.exitTs,
    side: t.side, entry: t.entry, exit: t.exit, sl: t.sl, tp1: t.tp1, tp2: t.tp2 ?? null,
    pnlR: Number(t.pnlR.toFixed(3)), exitReason: t.exitReason,
    win: t.pnlR > 0.05,
  }));

  const out = {
    meta: { symbol: pair, strategy: strategy.name, lookbackDays: days, startTs, endTs: now },
    metrics: {
      trades: r.metrics.trades, wins: r.metrics.wins, losses: r.metrics.losses,
      winRate: Number((r.metrics.winRate * 100).toFixed(1)),
      profitFactor: Number(r.metrics.profitFactor.toFixed(2)),
      totalR: Number(r.metrics.totalR.toFixed(2)),
      maxDDPct: Number(r.metrics.maxDDPct.toFixed(2)),
    },
    trades: lite,
  };

  const path = `/tmp/${pair}-trades.json`;
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`wrote ${path}`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * Step 1 of BTC WR-uplift research (2026-05-24).
 *
 * Runs BTC S1 strategy (lsTopPositionFade pair-trend) via engine.ts for 365d
 * and dumps every closed trade to /tmp/btc-trades.json with full context:
 *   entryTs, side, entry, exit, sl, tp1/tp2, exitReason, pnlR, holdMs, rationale
 *
 * Purpose: feed a post-hoc analyzer that loads CG features at entryTs (strict
 * less-than to avoid look-ahead) and tests filter hypotheses without re-running
 * the engine. No look-ahead risk in the extraction itself — engine already
 * enforces tf-aware boundaries.
 */
import { writeFileSync } from 'node:fs';
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

  const strategy = lsTopPositionFade({
    pctHi: 0.85, pctLo: 0.15,
    usePairTrend: true, useBtcTrend: false,
    slAtrMult: 1.5, tpAtrMult: 2.0,
    maxHoldBars: 12, riskPct: 0.5,
  });

  console.log(`Extracting BTC trades — ${days}d, strategy=${strategy.name}`);
  const r = await runBacktest(strategy, {
    symbol: 'BTCUSDT', startTs, endTs: now, ...COMMON,
  });
  console.log(`engine done: ${r.trades.length} trades, totalR=${r.metrics.totalR.toFixed(2)}, WR=${(r.metrics.winRate * 100).toFixed(1)}%, PF=${r.metrics.profitFactor.toFixed(2)}`);

  const lite = r.trades.map(t => ({
    entryTs: t.entryTs,
    entryIso: new Date(t.entryTs).toISOString(),
    exitTs: t.exitTs,
    exitIso: new Date(t.exitTs).toISOString(),
    holdHrs: Number(((t.exitTs - t.entryTs) / 3600_000).toFixed(2)),
    side: t.side,
    entry: t.entry,
    exit: t.exit,
    sl: t.sl,
    tp1: t.tp1,
    tp2: t.tp2 ?? null,
    pnlR: Number(t.pnlR.toFixed(3)),
    pnlUsd: Math.round(t.pnlUsd),
    feesUsd: Math.round(t.feesUsd),
    exitReason: t.exitReason,
    rationale: t.rationale,
    win: t.pnlR > 0.05,
  }));

  const out = {
    meta: {
      symbol: 'BTCUSDT',
      strategy: strategy.name,
      lookbackDays: days,
      startTs, endTs: now,
      generated: new Date().toISOString(),
    },
    metrics: {
      trades: r.metrics.trades,
      wins: r.metrics.wins,
      losses: r.metrics.losses,
      winRate: Number((r.metrics.winRate * 100).toFixed(1)),
      profitFactor: Number(r.metrics.profitFactor.toFixed(2)),
      totalR: Number(r.metrics.totalR.toFixed(2)),
      maxDDPct: Number(r.metrics.maxDDPct.toFixed(2)),
    },
    trades: lite,
  };

  writeFileSync('/tmp/btc-trades.json', JSON.stringify(out, null, 2));
  console.log(`wrote /tmp/btc-trades.json — ${lite.length} trades`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

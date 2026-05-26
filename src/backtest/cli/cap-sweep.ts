/**
 * Cap-concurrent-positions sweep on v5 9-pair portfolio.
 *
 * Per-pair backtest is INDEPENDENT of portfolio cap — cap only matters in
 * post-hoc applyPortfolioKills event simulation. So we run per-pair once,
 * then iterate cap values applying kill-switch event sim to the same trade set.
 * Cheap: 27 backtests (9 pairs × 3 slices) + N cap-iterations of pure filtering.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN_FIXED = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

interface PairCfg { pair: string; strategy: Strategy; }
const PAIRS: PairCfg[] = [
  { pair: 'SOLUSDT',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'INJUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ATOMUSDT', strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'XRPUSDT',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'LTCUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'HYPEUSDT', strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ETHUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'BNBUSDT',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
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

function applyKillsWithCap(trades: ClosedTrade[], startEquity: number, riskPct: number, cap: number) {
  if (trades.length === 0) return { keep: [], dropped: 0 };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
  events.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : (a.kind === 'entry' ? -1 : 1)));
  const dropped = new Set<ClosedTrade>();
  let equity = startEquity;
  let dailyOpen = { day: new Date(events[0].ts).toISOString().slice(0, 10), equity: startEquity };
  let openCount = 0;
  for (const ev of events) {
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    if (day !== dailyOpen.day) dailyOpen = { day, equity };
    if (ev.kind === 'entry') {
      const totalPnlPct = (equity - startEquity) / startEquity * 100;
      const dailyPnlPct = (equity - dailyOpen.equity) / dailyOpen.equity * 100;
      if (totalPnlPct <= -8.0 || dailyPnlPct <= -4.0 || dailyPnlPct <= -2.5) dropped.add(ev.trade);
      else if (openCount >= cap) dropped.add(ev.trade);
      else openCount++;
    } else {
      if (!dropped.has(ev.trade)) {
        const pnlUsd = ev.trade.pnlR * (startEquity * riskPct / 100);
        equity += pnlUsd;
        openCount--;
      }
    }
  }
  return { keep: trades.filter(t => !dropped.has(t)), dropped: dropped.size };
}

function aggregate(trades: ClosedTrade[], startEquity: number, riskPct: number) {
  trades.sort((a, b) => a.entryTs - b.entryTs);
  const fixedRiskUsd = startEquity * (riskPct / 100);
  let equity = startEquity, peak = equity, maxDD = 0;
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
  const pf = lossR > 0 ? winR / lossR : Infinity;
  return {
    n: total, wr: total ? wins / total * 100 : 0, pf, sumR,
    return: (equity - startEquity) / startEquity * 100,
    maxDD,
  };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log(`Collecting per-pair trades on ${PAIRS.length} pairs, 365d honest engine...`);
  const fullTrades: ClosedTrade[] = [];
  const trainTrades: ClosedTrade[] = [];
  const testTrades: ClosedTrade[] = [];

  for (const cfg of PAIRS) {
    resetCgFadeCooldownState();
    const rFull = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    resetCgFadeCooldownState();
    const rTr = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: splitTs, ...COMMON });
    resetCgFadeCooldownState();
    const rTe = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs: splitTs, endTs: now, ...COMMON });
    log.info(`${cfg.pair} done`, { n: rFull.trades.length });
    fullTrades.push(...rFull.trades);
    trainTrades.push(...rTr.trades);
    testTrades.push(...rTe.trades);
  }
  console.log(`Total raw trades: FULL=${fullTrades.length} TRAIN=${trainTrades.length} TEST=${testTrades.length}\n`);

  const caps = [3, 4, 5, 6, 7, 8, 999];
  console.log('cap | FULL: n / WR / PF / sumR / ret% / MaxDD   |  TEST: n / WR / PF / ret% / MaxDD');
  console.log('─'.repeat(110));
  for (const cap of caps) {
    const fKeep = applyKillsWithCap(fullTrades, COMMON.startEquity, COMMON.riskPctBase, cap);
    const tKeep = applyKillsWithCap(testTrades, COMMON.startEquity, COMMON.riskPctBase, cap);
    const f = aggregate(fKeep.keep, COMMON.startEquity, COMMON.riskPctBase);
    const t = aggregate(tKeep.keep, COMMON.startEquity, COMMON.riskPctBase);
    const capLabel = cap >= 999 ? '∞' : String(cap);
    console.log(
      `${capLabel.padStart(3)} | ${String(f.n).padStart(3)} ${f.wr.toFixed(1).padStart(5)}% ${f.pf.toFixed(2).padStart(4)} ${f.sumR.toFixed(2).padStart(7)} ${f.return.toFixed(2).padStart(6)}% ${f.maxDD.toFixed(2).padStart(5)}%  |  ${String(t.n).padStart(3)} ${t.wr.toFixed(1).padStart(5)}% ${t.pf.toFixed(2).padStart(4)} ${t.return.toFixed(2).padStart(6)}% ${t.maxDD.toFixed(2).padStart(5)}%   dropped=${fKeep.dropped}/${tKeep.dropped}`
    );
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

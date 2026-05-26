/**
 * Compare scaled-in sizing schemes on v5 9-pair portfolio:
 *   A) dca_boost decay 0.5  → slot weights [1.0, 0.5, 0.25] (current)
 *   B) custom_weights [0.17, 0.17, 0.34] (operator's scheme — thin entry, heavy deep DCA)
 *
 * Both: spacing 0.5·ATR, TP locked 2.0·ATR, max 6 concurrent.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
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

const MAX_CONCURRENT = 6;

function makePairs(scaledIn: any) {
  return [
    { pair: 'SOLUSDT',  strategy: fundingTaConfluence({ scaledIn }) },
    { pair: 'INJUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn }) },
    { pair: 'ATOMUSDT', strategy: fundingFade({ scaledIn }) },
    { pair: 'ARBUSDT',  strategy: fundingFade({ scaledIn }) },
    { pair: 'XRPUSDT',  strategy: fundingTaConfluence({ scaledIn }) },
    { pair: 'LTCUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn }) },
    { pair: 'HYPEUSDT', strategy: fundingTaConfluence({ scaledIn }) },
    { pair: 'ETHUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn }) },
    { pair: 'BNBUSDT',  strategy: fundingFade({ scaledIn }) },
  ];
}

const SCHEMES = {
  'A: dca_boost decay 0.5 (current)': {
    nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
    sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5,
    tpRecomputeOnFill: false,
  },
  'B: custom [0.17, 0.17, 0.34]': {
    nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
    sizingMode: 'custom_weights' as const,
    customWeights: [0.17, 0.17, 0.34],
    tpRecomputeOnFill: false,
  },
};

function applyKills(trades: ClosedTrade[], startEquity: number, riskPct: number, cap: number) {
  if (trades.length === 0) return { keep: [], dropped: 0 };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
  events.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : (a.kind === 'entry' ? -1 : 1)));
  const dropped = new Set<ClosedTrade>();
  let equity = startEquity, openCount = 0;
  let dailyOpen = { day: new Date(events[0].ts).toISOString().slice(0, 10), equity: startEquity };
  for (const ev of events) {
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    if (day !== dailyOpen.day) dailyOpen = { day, equity };
    if (ev.kind === 'entry') {
      const totalPnl = (equity - startEquity) / startEquity * 100;
      const dailyPnl = (equity - dailyOpen.equity) / dailyOpen.equity * 100;
      if (totalPnl <= -8 || dailyPnl <= -4 || dailyPnl <= -2.5) dropped.add(ev.trade);
      else if (openCount >= cap) dropped.add(ev.trade);
      else openCount++;
    } else {
      if (!dropped.has(ev.trade)) {
        equity += ev.trade.pnlR * (startEquity * riskPct / 100);
        openCount--;
      }
    }
  }
  return { keep: trades.filter(t => !dropped.has(t)), dropped: dropped.size };
}

function aggregate(trades: ClosedTrade[]) {
  trades.sort((a, b) => a.entryTs - b.entryTs);
  const fixed = COMMON.startEquity * (COMMON.riskPctBase / 100);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  for (const t of trades) {
    equity += t.pnlR * fixed;
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
    n: total, wr: total ? wins / total * 100 : 0,
    pf: lossR > 0 ? winR / lossR : Infinity,
    sumR, ret: (equity - COMMON.startEquity) / COMMON.startEquity * 100, maxDD,
  };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  const allResults: Record<string, { full: any; train: any; test: any; perPair: Record<string, number> }> = {};

  for (const [schemeName, scaledIn] of Object.entries(SCHEMES)) {
    console.log(`\n========== ${schemeName} ==========`);
    const pairs = makePairs(scaledIn);
    const fullTrades: ClosedTrade[] = [];
    const trainTrades: ClosedTrade[] = [];
    const testTrades: ClosedTrade[] = [];
    const perPair: Record<string, number> = {};

    for (const cfg of pairs) {
      resetCgFadeCooldownState();
      const rFull = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
      resetCgFadeCooldownState();
      const rTr = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: splitTs, ...COMMON });
      resetCgFadeCooldownState();
      const rTe = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs: splitTs, endTs: now, ...COMMON });
      fullTrades.push(...rFull.trades);
      trainTrades.push(...rTr.trades);
      testTrades.push(...rTe.trades);
      perPair[cfg.pair] = rFull.trades.reduce((s, t) => s + t.pnlR, 0);
      log.info(`${cfg.pair} done`, { n: rFull.trades.length });
    }

    const fK = applyKills(fullTrades, COMMON.startEquity, COMMON.riskPctBase, MAX_CONCURRENT);
    const trK = applyKills(trainTrades, COMMON.startEquity, COMMON.riskPctBase, MAX_CONCURRENT);
    const teK = applyKills(testTrades, COMMON.startEquity, COMMON.riskPctBase, MAX_CONCURRENT);
    const f = aggregate(fK.keep);
    const tr = aggregate(trK.keep);
    const te = aggregate(teK.keep);
    allResults[schemeName] = { full: f, train: tr, test: te, perPair };

    console.log(`  FULL : n=${f.n} WR=${f.wr.toFixed(1)}% PF=${f.pf.toFixed(2)} sumR=${f.sumR.toFixed(2)} return=${f.ret.toFixed(2)}% MaxDD=${f.maxDD.toFixed(2)}%`);
    console.log(`  TRAIN: n=${tr.n} WR=${tr.wr.toFixed(1)}% PF=${tr.pf.toFixed(2)} sumR=${tr.sumR.toFixed(2)} return=${tr.ret.toFixed(2)}% MaxDD=${tr.maxDD.toFixed(2)}%`);
    console.log(`  TEST : n=${te.n} WR=${te.wr.toFixed(1)}% PF=${te.pf.toFixed(2)} sumR=${te.sumR.toFixed(2)} return=${te.ret.toFixed(2)}% MaxDD=${te.maxDD.toFixed(2)}%`);
  }

  console.log('\n========== COMPARISON ==========');
  console.log('scheme                                 |  FULL ret  / MaxDD |  TEST ret  / MaxDD  |  sumR');
  console.log('─'.repeat(110));
  for (const [name, r] of Object.entries(allResults)) {
    console.log(`${name.padEnd(40)} |  ${r.full.ret.toFixed(2).padStart(6)}%  / ${r.full.maxDD.toFixed(2).padStart(5)}%  |  ${r.test.ret.toFixed(2).padStart(6)}%  / ${r.test.maxDD.toFixed(2).padStart(5)}%   |  ${r.full.sumR.toFixed(2)}`);
  }

  console.log('\n========== PER-PAIR sumR ==========');
  console.log('pair      | A: dca_boost  | B: custom    | Δ (B−A)');
  for (const pair of Object.keys(allResults['A: dca_boost decay 0.5 (current)'].perPair)) {
    const a = allResults['A: dca_boost decay 0.5 (current)'].perPair[pair];
    const b = allResults['B: custom [0.17, 0.17, 0.34]'].perPair[pair];
    console.log(`${pair.padEnd(10)} | ${a.toFixed(2).padStart(8)}      | ${b.toFixed(2).padStart(8)}    | ${(b - a).toFixed(2).padStart(7)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

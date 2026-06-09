/**
 * LIVE-CRON-MIRROR — то же что live-mirror-backtest, но с cronRealistic=true.
 *
 * Эмулирует реальную задержку live: entry откладывается до следующего HH:00
 * после funding window. Подходит для прямого сравнения с фактическим live
 * исполнением — entry price берётся в момент cron-tick, не на закрытии 4H бара.
 *
 * Usage: npx tsx src/backtest/cli/live-cron-mirror.ts [days=365] [SLIP=0.25]
 *        SLIP=0.05 npx tsx src/backtest/cli/live-cron-mirror.ts 5
 */
import { runBacktest } from '../engine';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

// ═══════════════════════════════════════════════════════════════════════
//   LIVE PARAMETERS (зашитые — то же что live-mirror)
// ═══════════════════════════════════════════════════════════════════════

const LIVE_RISK_PCT = 0.5;
const LIVE_LEVERAGE = 10;
const LIVE_MAX_PARALLEL = 6;

const LIVE_SCALED_IN_FIXED = {
  nEntries: 3,
  spacingAtr: 0.5,
  tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const,
  dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

const LIVE_BACKTEST_KNOBS = {
  startEquity: 668_000,
  slippagePct: parseFloat(process.env.SLIP ?? '0.25'),
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  leverage: LIVE_LEVERAGE,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  riskPctBase: LIVE_RISK_PCT,
  cronRealistic: true,             // ← КЛЮЧЕВОЕ ОТЛИЧИЕ от live-mirror
};

// ═══════════════════════════════════════════════════════════════════════
//   LIVE UNIVERSE (тот же что live-mirror)
// ═══════════════════════════════════════════════════════════════════════

interface LivePair {
  symbol: string;
  family: string;
  strategy: Strategy;
}

const LIVE_PAIRS: LivePair[] = [
  { symbol: 'SOLUSDT',  family: 'S4',
    strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'INJUSDT', family: 'S2',
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: false, useBtcTrend: true,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'ATOMUSDT', family: 'S3',
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'ARBUSDT',  family: 'S3',
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'XRPUSDT',  family: 'S4',
    strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'LTCUSDT',  family: 'S2',
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: false, useBtcTrend: true,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'HYPEUSDT', family: 'S4',
    strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'ETHUSDT',  family: 'S1',
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: true, useBtcTrend: false,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'BNBUSDT',  family: 'S3',
    strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'TAOUSDT',  family: 'S1',
    strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
      usePairTrend: true, useBtcTrend: false,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
];

function applyPortfolioKills(
  trades: ClosedTrade[],
  startEquity: number,
  riskPct: number,
  maxParallel: number,
): { keep: ClosedTrade[]; dropped: number } {
  if (trades.length === 0) return { keep: [], dropped: 0 };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs,  kind: 'exit',  trade: t });
  }
  events.sort((a, b) => a.ts !== b.ts ? a.ts - b.ts : (a.kind === 'entry' ? -1 : 1));
  const dropped = new Set<ClosedTrade>();
  let equity = startEquity;
  let dailyOpen = { day: new Date(events[0].ts).toISOString().slice(0, 10), equity: startEquity };
  let openCount = 0;
  for (const ev of events) {
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    if (day !== dailyOpen.day) dailyOpen = { day, equity };
    if (ev.kind === 'entry') {
      const totalPct = (equity - startEquity) / startEquity * 100;
      const dailyPct = (equity - dailyOpen.equity) / dailyOpen.equity * 100;
      if (totalPct <= -8.0 || dailyPct <= -4.0 || dailyPct <= -2.5) dropped.add(ev.trade);
      else if (openCount >= maxParallel) dropped.add(ev.trade);
      else openCount++;
    } else {
      if (!dropped.has(ev.trade)) { equity += ev.trade.pnlR * (startEquity * riskPct / 100); openCount--; }
    }
  }
  return { keep: trades.filter(t => !dropped.has(t)), dropped: dropped.size };
}

function aggregate(trades: ClosedTrade[], label: string, startEquity: number, riskPct: number) {
  const fixedRiskUsd = startEquity * (riskPct / 100);
  let equity = startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  const monthly: Record<string, number> = {};
  const sortedByExit = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  let dailyPeak = startEquity;
  let dailyMin = startEquity;
  let dailyDay = new Date(sortedByExit[0]?.exitTs ?? Date.now()).toISOString().slice(0, 10);
  let worstDailyDdPct = 0;
  let worstDailyDay = '';
  for (const t of sortedByExit) {
    const day = new Date(t.exitTs).toISOString().slice(0, 10);
    if (day !== dailyDay) {
      const dd = (dailyMin - dailyPeak) / dailyPeak * 100;
      if (dd < worstDailyDdPct) { worstDailyDdPct = dd; worstDailyDay = dailyDay; }
      dailyDay = day; dailyPeak = equity; dailyMin = equity;
    }
    const pnlUsd = t.pnlR * fixedRiskUsd;
    equity += pnlUsd;
    if (equity > peak) peak = equity;
    if (equity > dailyPeak) dailyPeak = equity;
    if (equity < dailyMin) dailyMin = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
    const m = new Date(t.entryTs).toISOString().slice(0, 7);
    monthly[m] = (monthly[m] ?? 0) + pnlUsd;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const ret = (equity - startEquity) / startEquity * 100;
  console.log(`${label}: n=${total} WR=${(wins/Math.max(1,total)*100).toFixed(1)}% PF=${(winR/Math.max(0.01,lossR)).toFixed(2)} sumR=${sumR.toFixed(2)} return=${ret.toFixed(2)}%  MaxDD=${maxDD.toFixed(2)}%  worstDailyDDD=${worstDailyDdPct.toFixed(2)}%@${worstDailyDay}`);
  return { equity, monthly, ret, maxDD, worstDailyDdPct };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  LIVE-CRON-MIRROR BACKTEST (cronRealistic=true)');
  console.log(`  Entry: НЕ на закрытии 4H, а на следующем HH:00 cron-tick после funding window`);
  console.log(`  Universe (${LIVE_PAIRS.length} пар): ${LIVE_PAIRS.map(p => p.symbol).join(', ')}`);
  console.log(`  Risk per slot: ${LIVE_RISK_PCT}%  |  cap parallel: ${LIVE_MAX_PARALLEL}  |  startEq: $${LIVE_BACKTEST_KNOBS.startEquity.toLocaleString()}`);
  console.log(`  Slip: ${LIVE_BACKTEST_KNOBS.slippagePct}%  |  Period: ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(now).toISOString().slice(0,10)} (${days}d)`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const fullTrades: ClosedTrade[] = [];
  const trainTrades: ClosedTrade[] = [];
  const testTrades: ClosedTrade[] = [];
  const perPair: Record<string, ClosedTrade[]> = {};

  for (const pair of LIVE_PAIRS) {
    log.info(`backtest ${pair.symbol}`);
    resetCgFadeCooldownState();
    const rFull  = await runBacktest(pair.strategy, { symbol: pair.symbol, startTs, endTs: now,        ...LIVE_BACKTEST_KNOBS });
    resetCgFadeCooldownState();
    const rTrain = await runBacktest(pair.strategy, { symbol: pair.symbol, startTs, endTs: splitTs,    ...LIVE_BACKTEST_KNOBS });
    resetCgFadeCooldownState();
    const rTest  = await runBacktest(pair.strategy, { symbol: pair.symbol, startTs: splitTs, endTs: now, ...LIVE_BACKTEST_KNOBS });
    fullTrades.push(...rFull.trades);
    trainTrades.push(...rTrain.trades);
    testTrades.push(...rTest.trades);
    perPair[pair.symbol] = rFull.trades;
  }

  const fullKilled  = applyPortfolioKills(fullTrades,  LIVE_BACKTEST_KNOBS.startEquity, LIVE_RISK_PCT, LIVE_MAX_PARALLEL);
  const trainKilled = applyPortfolioKills(trainTrades, LIVE_BACKTEST_KNOBS.startEquity, LIVE_RISK_PCT, LIVE_MAX_PARALLEL);
  const testKilled  = applyPortfolioKills(testTrades,  LIVE_BACKTEST_KNOBS.startEquity, LIVE_RISK_PCT, LIVE_MAX_PARALLEL);
  console.log(`\n=== PORTFOLIO KILLS APPLIED ===`);
  console.log(`  FULL  dropped ${fullKilled.dropped}/${fullTrades.length}`);
  console.log(`  TRAIN dropped ${trainKilled.dropped}/${trainTrades.length}`);
  console.log(`  TEST  dropped ${testKilled.dropped}/${testTrades.length}\n`);

  console.log('=== AGGREGATE ===');
  const fullAgg  = aggregate(fullKilled.keep,  'FULL ', LIVE_BACKTEST_KNOBS.startEquity, LIVE_RISK_PCT);
  aggregate(trainKilled.keep, 'TRAIN', LIVE_BACKTEST_KNOBS.startEquity, LIVE_RISK_PCT);
  aggregate(testKilled.keep,  'TEST ', LIVE_BACKTEST_KNOBS.startEquity, LIVE_RISK_PCT);

  console.log('\n=== PER-PAIR (full window) ===');
  const sorted = [...LIVE_PAIRS].sort((a, b) => {
    const sa = perPair[a.symbol].reduce((s, t) => s + t.pnlR, 0);
    const sb = perPair[b.symbol].reduce((s, t) => s + t.pnlR, 0);
    return sb - sa;
  });
  for (const pair of sorted) {
    const t = perPair[pair.symbol];
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const losses = t.filter(x => x.pnlR < -0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : 0;
    console.log(`  ${pair.family} ${pair.symbol.padEnd(9)} n=${String(t.length).padStart(3)} WR=${(wins/Math.max(1,wins+losses)*100).toFixed(1).padStart(5)}% PF=${pf.toFixed(2).padStart(5)} sumR=${sumR.toFixed(2).padStart(7)}`);
  }

  const annualRet = fullAgg.ret * (365 / days);
  console.log(`\n=== HEADLINE ===`);
  console.log(`  FULL  ${days}d return: ${fullAgg.ret.toFixed(2)}%  (annualized ~${annualRet.toFixed(1)}%)  MaxDD ${fullAgg.maxDD.toFixed(2)}%`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

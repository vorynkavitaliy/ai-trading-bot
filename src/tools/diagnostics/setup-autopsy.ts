// Setup quality autopsy: what differs between WINNERS and LOSERS based on
// strategy-internal features (rrTp2, stop distance, time-of-day, dayOfWeek, etc.)?
//
// Hypothesis: VP-SMC has a class of setups that systematically lose, identifiable
// by internal mechanics — not by external CG data which we proved doesn't help.
//
// Walk-forward: train/test split. Demand ≥0.15R Δ on OOS to consider it real.

import { query, close as closePg } from '../../core/db';
import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','LTCUSDT','ATOMUSDT','TONUSDT','DOGEUSDT','APTUSDT','ARBUSDT','TAOUSDT','INJUSDT'];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT: { maxStopAtrPct: 4.5 }, SOLUSDT: { maxStopAtrPct: 5.5 }, XRPUSDT: { maxStopAtrPct: 5.5 },
  BNBUSDT: { maxStopAtrPct: 4.0 }, LTCUSDT: { maxStopAtrPct: 4.5 }, ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT: { maxStopAtrPct: 5.0 }, DOGEUSDT: { maxStopAtrPct: 5.5 }, APTUSDT: { maxStopAtrPct: 5.0 },
  ARBUSDT: { maxStopAtrPct: 5.0 }, TAOUSDT: { maxStopAtrPct: 5.0 }, INJUSDT: { maxStopAtrPct: 5.0 },
};

const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055, makerFeeRate: 0.0002, slippagePct: 0.25,
  riskPctBase: 0.6, leverage: 10,
  tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

interface Features {
  pair: string;
  side: 'long' | 'short';
  pnlR: number;
  rrTp1: number;
  rrTp2: number;
  stopDistPct: number;
  tp1DistPct: number;
  tpSpreadPct: number;
  hourUtc: number;
  dayOfWeek: number;   // 0=Sun..6=Sat
  isWeekend: boolean;
  holdHours: number;
}

function extract(t: ClosedTrade): Features {
  const stopDist = Math.abs(t.entry - t.sl);
  const tp1Dist = Math.abs(t.tp1 - t.entry);
  const tp2Dist = t.tp2 !== undefined ? Math.abs(t.tp2 - t.entry) : tp1Dist;
  const d = new Date(t.entryTs);
  return {
    pair: t.symbol,
    side: t.side,
    pnlR: t.pnlR,
    rrTp1: stopDist > 0 ? tp1Dist / stopDist : 0,
    rrTp2: stopDist > 0 ? tp2Dist / stopDist : 0,
    stopDistPct: (stopDist / t.entry) * 100,
    tp1DistPct: (tp1Dist / t.entry) * 100,
    tpSpreadPct: t.tp2 !== undefined ? (Math.abs(t.tp2 - t.tp1) / t.entry) * 100 : 0,
    hourUtc: d.getUTCHours(),
    dayOfWeek: d.getUTCDay(),
    isWeekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
    holdHours: (t.exitTs - t.entryTs) / 3_600_000,
  };
}

function bucketByQuantile(feats: Features[], featName: keyof Features, nBuckets: number): { lo: number; hi: number; trades: Features[] }[] {
  const sorted = [...feats].sort((a, b) => (a[featName] as number) - (b[featName] as number));
  const result: { lo: number; hi: number; trades: Features[] }[] = [];
  for (let i = 0; i < nBuckets; i++) {
    const lo = Math.floor(sorted.length * i / nBuckets);
    const hi = Math.floor(sorted.length * (i + 1) / nBuckets);
    const slice = sorted.slice(lo, hi);
    result.push({
      lo: slice[0][featName] as number,
      hi: slice[slice.length - 1][featName] as number,
      trades: slice,
    });
  }
  return result;
}

function metrics(trades: Features[]) {
  if (trades.length === 0) return { n: 0, wr: 0, avgR: 0, sumR: 0 };
  const wins = trades.filter(t => t.pnlR > 0).length;
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  return { n: trades.length, wr: wins / trades.length * 100, avgR: sumR / trades.length, sumR };
}

function compareWinLoss(feats: Features[], featName: keyof Features) {
  const wins = feats.filter(t => t.pnlR > 0);
  const losses = feats.filter(t => t.pnlR < 0);
  const winMean = wins.reduce((s, t) => s + (t[featName] as number), 0) / Math.max(wins.length, 1);
  const lossMean = losses.reduce((s, t) => s + (t[featName] as number), 0) / Math.max(losses.length, 1);
  return { winMean, lossMean, diff: winMean - lossMean };
}

async function main() {
  const now = Date.now();
  const startTs = now - 365 * 24 * 60 * 60_000;
  const endTs = now;

  console.log('Running 13-pair × 365d backtest...');
  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const r = await runBacktest(btcVpSmc(params), { symbol, startTs, endTs, ...COMMON });
    allTrades.push(...r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length}\n`);
  }
  console.log(`\nTotal: ${allTrades.length} trades`);
  if (allTrades.length === 0) { await closePg(); return; }

  const feats = allTrades.map(extract);

  // === Win/Loss feature comparison ===
  console.log('\n=== WINNER vs LOSER feature means (FULL) ===');
  console.log('feature           win_mean    loss_mean   diff (>0 = good_for_filter)');
  for (const f of ['rrTp1','rrTp2','stopDistPct','tp1DistPct','tpSpreadPct','hourUtc','holdHours'] as const) {
    const c = compareWinLoss(feats, f);
    const flag = Math.abs(c.diff) > 0.05 * Math.max(Math.abs(c.winMean), Math.abs(c.lossMean), 1) ? '*' : ' ';
    console.log(`${f.padEnd(16)}  ${c.winMean.toFixed(3).padStart(8)}    ${c.lossMean.toFixed(3).padStart(8)}    ${c.diff.toFixed(3).padStart(8)} ${flag}`);
  }

  // Train/test split for OOS validation
  feats.sort((a, b) => allTrades[feats.indexOf(a)].entryTs - allTrades[feats.indexOf(b)].entryTs);
  // Actually use original entryTs - rewrite:
  const withTs = feats.map((f, i) => ({ ...f, _ts: allTrades[i].entryTs }));
  withTs.sort((a, b) => a._ts - b._ts);
  const splitIdx = Math.floor(withTs.length * 0.75);
  const train = withTs.slice(0, splitIdx);
  const test = withTs.slice(splitIdx);
  console.log(`\nTrain: ${train.length}, Test: ${test.length}`);

  // === Quintile analysis on key features ===
  for (const featName of ['rrTp2','stopDistPct','tp1DistPct'] as const) {
    console.log(`\n=== ${featName} quintiles (TRAIN, n=${train.length}) ===`);
    console.log('quintile   range            n    WR     avgR    sumR');
    const buckets = bucketByQuantile(train, featName, 5);
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const m = metrics(b.trades);
      console.log(`  Q${i+1}  ${b.lo.toFixed(2).padStart(7)}..${b.hi.toFixed(2).padStart(7)}  ${String(m.n).padStart(4)}  ${m.wr.toFixed(1).padStart(4)}%  ${m.avgR.toFixed(3).padStart(6)}  ${m.sumR.toFixed(2).padStart(6)}`);
    }
    // Same buckets applied to test
    console.log(`     ${featName} quintiles (TEST OOS, n=${test.length}) — apply same boundaries:`);
    for (let i = 0; i < buckets.length; i++) {
      const lo = buckets[i].lo;
      const hi = i === buckets.length - 1 ? Infinity : buckets[i + 1].lo;
      const testInB = test.filter(t => (t[featName] as number) >= lo && (t[featName] as number) < hi);
      const m = metrics(testInB);
      console.log(`  Q${i+1}  range[${lo.toFixed(2)}..${hi === Infinity ? '∞' : hi.toFixed(2)})    n=${String(m.n).padStart(4)}  WR=${m.wr.toFixed(1)}%  avgR=${m.avgR.toFixed(3)}  sumR=${m.sumR.toFixed(2)}`);
    }
  }

  // Per-pair × side breakdown
  console.log('\n=== Per-pair WR/avgR ===');
  const byPair = new Map<string, Features[]>();
  for (const f of feats) {
    if (!byPair.has(f.pair)) byPair.set(f.pair, []);
    byPair.get(f.pair)!.push(f);
  }
  for (const [pair, arr] of byPair) {
    const m = metrics(arr);
    console.log(`  ${pair.padEnd(10)} n=${String(m.n).padStart(3)}  WR=${m.wr.toFixed(1).padStart(4)}%  avgR=${m.avgR.toFixed(3).padStart(6)}`);
  }

  // Hour-of-day breakdown
  console.log('\n=== Hour-of-day (UTC) ===');
  for (let h = 0; h < 24; h++) {
    const inH = feats.filter(f => f.hourUtc === h);
    if (inH.length < 10) continue;
    const m = metrics(inH);
    const bar = '#'.repeat(Math.max(0, Math.round(m.avgR * 50)));
    console.log(`  H${String(h).padStart(2,'0')}  n=${String(m.n).padStart(3)}  WR=${m.wr.toFixed(1).padStart(4)}%  avgR=${m.avgR.toFixed(3)}  ${bar}`);
  }

  console.log('\n=== Day-of-week ===');
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let d = 0; d < 7; d++) {
    const inD = feats.filter(f => f.dayOfWeek === d);
    const m = metrics(inD);
    console.log(`  ${dayNames[d]}  n=${String(m.n).padStart(3)}  WR=${m.wr.toFixed(1).padStart(4)}%  avgR=${m.avgR.toFixed(3)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

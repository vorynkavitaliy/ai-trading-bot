// Analyze: does Coinglass orderbook imbalance at entry predict trade outcome?
//
// Method:
//   1) Re-run VP-SMC backtest 14-pair × 365d (in-process, mirrors portfolio.ts)
//   2) For each closed trade, find latest cg_orderbook_pair snapshot with ts ≤ entryTs (within 6h)
//   3) Compute imbalance = (bids_usd - asks_usd) / (bids_usd + asks_usd)  ∈ [-1,+1]
//   4) Bucket by side and imbalance, report avgR / WR / count
//   5) Walk-forward split: train 9mo / test 4mo — does the pattern survive OOS?
//
// Reads NOTHING from production. Pure research script.

import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';
import { close as closePg, query } from '../../core/db';

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','LTCUSDT','ATOMUSDT','TONUSDT','DOGEUSDT','APTUSDT','ARBUSDT','TAOUSDT','INJUSDT'];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT:  { maxStopAtrPct: 5.0 },
  DOGEUSDT: { maxStopAtrPct: 5.5 },
  APTUSDT:  { maxStopAtrPct: 5.0 },
  ARBUSDT:  { maxStopAtrPct: 5.0 },
  TAOUSDT:  { maxStopAtrPct: 5.0 },
  INJUSDT:  { maxStopAtrPct: 5.0 },
};

const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: 0.25,
  riskPctBase: 0.6,
  leverage: 10,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

const MAX_LOOKBACK_MS = 6 * 60 * 60 * 1000;  // 6h — orderbook is 4h cadence

interface EnrichedTrade {
  symbol: string;
  side: 'long' | 'short';
  entryTs: number;
  pnlR: number;
  imbalance: number | null;  // null if no snapshot found within lookback
  bidsUsd: number | null;
  asksUsd: number | null;
}

async function fetchOrderbookForTrades(trades: ClosedTrade[]): Promise<EnrichedTrade[]> {
  // For each pair, batch-load orderbook history once.
  // Then for each trade, binary-search the closest snapshot ≤ entryTs.
  const obByPair = new Map<string, { ts: number; bids: number; asks: number }[]>();
  for (const pair of new Set(trades.map(t => t.symbol))) {
    const r = await query<{ ts: string; bids_usd: string; asks_usd: string }>(
      `SELECT ts::text, bids_usd::text, asks_usd::text FROM cg_orderbook_pair
       WHERE pair = $1 ORDER BY ts`, [pair]
    );
    obByPair.set(pair, r.rows.map(row => ({
      ts: Number(row.ts), bids: Number(row.bids_usd), asks: Number(row.asks_usd),
    })));
  }

  const result: EnrichedTrade[] = [];
  for (const t of trades) {
    const series = obByPair.get(t.symbol) ?? [];
    // Binary search: largest ts ≤ entryTs
    let lo = 0, hi = series.length - 1, found = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (series[m].ts <= t.entryTs) { found = m; lo = m + 1; } else hi = m - 1;
    }
    const snap = found >= 0 ? series[found] : null;
    const within = snap && (t.entryTs - snap.ts) <= MAX_LOOKBACK_MS;
    const imbalance = within ? (snap.bids - snap.asks) / (snap.bids + snap.asks) : null;
    result.push({
      symbol: t.symbol, side: t.side, entryTs: t.entryTs, pnlR: t.pnlR,
      imbalance, bidsUsd: within ? snap!.bids : null, asksUsd: within ? snap!.asks : null,
    });
  }
  return result;
}

function reportBuckets(label: string, trades: EnrichedTrade[]) {
  console.log(`\n=== ${label} (n=${trades.length}) ===`);
  const matched = trades.filter(t => t.imbalance !== null);
  const unmatched = trades.length - matched.length;
  console.log(`matched: ${matched.length}, no snapshot: ${unmatched}`);

  // Bucket boundaries on imbalance: [-1,-0.2,-0.05,0.05,0.2,+1]
  const buckets: { lo: number; hi: number; label: string }[] = [
    { lo: -1.01, hi: -0.20, label: '<-0.20 (ask-dom strong)' },
    { lo: -0.20, hi: -0.05, label: '-0.20..-0.05 (ask-dom mild)' },
    { lo: -0.05, hi: +0.05, label: '-0.05..+0.05 (neutral)' },
    { lo: +0.05, hi: +0.20, label: '+0.05..+0.20 (bid-dom mild)' },
    { lo: +0.20, hi: +1.01, label: '>+0.20 (bid-dom strong)' },
  ];

  for (const side of ['long', 'short'] as const) {
    console.log(`\n--- ${side.toUpperCase()} trades ---`);
    console.log('bucket                          n     wr     avgR    medR    sumR');
    const sideTrades = matched.filter(t => t.side === side);
    for (const b of buckets) {
      const inBucket = sideTrades.filter(t => t.imbalance! >= b.lo && t.imbalance! < b.hi);
      if (inBucket.length === 0) {
        console.log(`${b.label.padEnd(32)} ${'0'.padStart(4)}    n/a    n/a     n/a     n/a`);
        continue;
      }
      const wins = inBucket.filter(t => t.pnlR > 0).length;
      const wr = (wins / inBucket.length * 100).toFixed(1);
      const avgR = (inBucket.reduce((s,t) => s + t.pnlR, 0) / inBucket.length);
      const sorted = inBucket.map(t => t.pnlR).sort((a,b)=>a-b);
      const medR = sorted[Math.floor(sorted.length/2)];
      const sumR = inBucket.reduce((s,t) => s + t.pnlR, 0);
      console.log(
        `${b.label.padEnd(32)} ${String(inBucket.length).padStart(4)}   ${wr.padStart(4)}%  ${avgR.toFixed(3).padStart(6)}  ${medR.toFixed(3).padStart(6)}  ${sumR.toFixed(2).padStart(6)}`
      );
    }
    // Also overall (no-bucket) for reference
    const wins = sideTrades.filter(t => t.pnlR > 0).length;
    const wr = sideTrades.length > 0 ? (wins / sideTrades.length * 100).toFixed(1) : 'n/a';
    const avgR = sideTrades.length > 0 ? (sideTrades.reduce((s,t) => s + t.pnlR, 0) / sideTrades.length).toFixed(3) : 'n/a';
    const sumR = sideTrades.reduce((s,t) => s + t.pnlR, 0).toFixed(2);
    console.log(`${'BASELINE (all)'.padEnd(32)} ${String(sideTrades.length).padStart(4)}   ${wr.toString().padStart(4)}%  ${avgR.toString().padStart(6)}  ${'-'.padStart(6)}  ${sumR.padStart(6)}`);
  }
}

async function main() {
  const now = Date.now();
  const startTs = now - 365 * 24 * 60 * 60_000;
  const endTs = now;

  console.log(`== running 13-pair backtest (in-process), ${SYMBOLS.length} pairs, 365d ==`);
  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allTrades.push(...r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length} trades\n`);
  }
  console.log(`\ntotal trades (pre-portfolio-cap): ${allTrades.length}`);

  console.log('\n== joining with cg_orderbook_pair snapshots ==');
  const enriched = await fetchOrderbookForTrades(allTrades);

  // Time split: train = first 75%, test = last 25%
  enriched.sort((a, b) => a.entryTs - b.entryTs);
  const splitIdx = Math.floor(enriched.length * 0.75);
  const train = enriched.slice(0, splitIdx);
  const test  = enriched.slice(splitIdx);
  const trainSplitTs = train.length > 0 ? train[train.length - 1].entryTs : 0;
  console.log(`\ntrain: ${train.length} trades, test: ${test.length} trades`);
  console.log(`train period: ${new Date(train[0]?.entryTs ?? startTs).toISOString().slice(0,10)} → ${new Date(trainSplitTs).toISOString().slice(0,10)}`);
  console.log(`test period:  ${new Date(test[0]?.entryTs ?? trainSplitTs).toISOString().slice(0,10)} → ${new Date(test[test.length-1]?.entryTs ?? endTs).toISOString().slice(0,10)}`);

  reportBuckets('FULL (all 365d)', enriched);
  reportBuckets('TRAIN (first 75%)', train);
  reportBuckets('TEST (last 25%, OOS)', test);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

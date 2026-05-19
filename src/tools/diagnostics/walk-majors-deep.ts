// Multi-year walk-forward on BTC/ETH/SOL/XRP. 6-month non-overlapping windows
// over each pair's full Bybit history. Critical test: does +120% bt result
// hold across diverse market regimes (bull, bear, choppy, sideways)?
//
// Output: per-window metrics + summary on regime diversity.

import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { close as closePg } from '../../core/db';

const PAIRS_WITH_START: { symbol: string; startMs: number; params: Partial<BtcVpSmcParams> }[] = [
  { symbol: 'BTCUSDT', startMs: Date.parse('2020-04-01T00:00:00Z'), params: {} },
  { symbol: 'ETHUSDT', startMs: Date.parse('2021-04-01T00:00:00Z'), params: { maxStopAtrPct: 4.5 } },
  { symbol: 'SOLUSDT', startMs: Date.parse('2021-11-01T00:00:00Z'), params: { maxStopAtrPct: 5.5 } },
  { symbol: 'XRPUSDT', startMs: Date.parse('2021-06-01T00:00:00Z'), params: { maxStopAtrPct: 5.5 } },
];

const COMMON = {
  startEquity: 50_000, takerFeeRate: 0.00055, makerFeeRate: 0.0002,
  slippagePct: 0.25, riskPctBase: 0.6, leverage: 10,
  tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

const WINDOW_DAYS = 90;  // 3 months per window — more granular than 6mo

interface WindowMetrics {
  pair: string;
  windowFromIso: string;
  windowToIso: string;
  trades: number;
  WR: number;
  avgR: number;
  totalR: number;
  PF: number;
  maxDD: number;
}

async function main() {
  const now = Date.now();
  const windowMs = WINDOW_DAYS * 86400_000;
  const results: WindowMetrics[] = [];

  for (const { symbol, startMs, params } of PAIRS_WITH_START) {
    console.log(`\n=== ${symbol} (starting ${new Date(startMs).toISOString().slice(0,10)}) ===`);
    let cursor = startMs;
    let winIdx = 0;
    const strategy = btcVpSmc({ ...DEFAULT_BTC_VP_SMC, ...params });

    while (cursor + windowMs <= now) {
      const fromTs = cursor;
      const toTs = cursor + windowMs;
      const r = await runBacktest(strategy, { symbol, startTs: fromTs, endTs: toTs, ...COMMON });
      const m = r.metrics;
      results.push({
        pair: symbol,
        windowFromIso: new Date(fromTs).toISOString().slice(0,10),
        windowToIso: new Date(toTs).toISOString().slice(0,10),
        trades: m.trades,
        WR: m.winRate * 100,
        avgR: m.avgR,
        totalR: m.totalR,
        PF: m.profitFactor,
        maxDD: m.maxDDPct,
      });
      winIdx++;
      cursor = toTs;
      process.stdout.write(`  W${String(winIdx).padStart(2)} ${new Date(fromTs).toISOString().slice(0,10)} → ${new Date(toTs).toISOString().slice(0,10)}: n=${m.trades}, totalR=${m.totalR.toFixed(2)}, avgR=${m.avgR.toFixed(2)}\n`);
    }
  }

  console.log('\n\n================================================================');
  console.log('SUMMARY (90-day windows, gates-off strategy)');
  console.log('================================================================');
  console.log('pair      window-start  trades   WR    avgR    totalR    PF    MaxDD');
  console.log('---------------------------------------------------------------------');
  for (const r of results) {
    const pf = r.PF === Infinity ? '∞' : r.PF.toFixed(2);
    console.log(
      `${r.pair.padEnd(9)} ${r.windowFromIso}  ${String(r.trades).padStart(5)}  ${r.WR.toFixed(0).padStart(3)}%  ${r.avgR.toFixed(2).padStart(6)}  ${r.totalR.toFixed(2).padStart(7)}  ${pf.padStart(5)}  ${r.maxDD.toFixed(2)}%`
    );
  }

  console.log('\n=== Per-pair aggregate ===');
  const byPair = new Map<string, WindowMetrics[]>();
  for (const r of results) {
    if (!byPair.has(r.pair)) byPair.set(r.pair, []);
    byPair.get(r.pair)!.push(r);
  }
  for (const [pair, arr] of byPair) {
    const positive = arr.filter(w => w.totalR > 0).length;
    const negative = arr.filter(w => w.totalR < 0).length;
    const totalTrades = arr.reduce((s, w) => s + w.trades, 0);
    const totalR = arr.reduce((s, w) => s + w.totalR, 0);
    const totalWins = arr.reduce((s, w) => s + (w.trades * w.WR / 100), 0);
    const cumWR = totalTrades > 0 ? totalWins / totalTrades * 100 : 0;
    const avgRoverall = totalTrades > 0 ? totalR / totalTrades : 0;
    const profitableWindows = positive / arr.length * 100;
    console.log(
      `${pair.padEnd(10)} ${arr.length} windows | ${profitableWindows.toFixed(0)}% profitable | total trades=${totalTrades} | cumWR=${cumWR.toFixed(1)}% | avgR=${avgRoverall.toFixed(3)} | totalR=${totalR.toFixed(2)}`
    );
  }

  // Overall summary
  const allTrades = results.reduce((s, w) => s + w.trades, 0);
  const allTotalR = results.reduce((s, w) => s + w.totalR, 0);
  const allWins = results.reduce((s, w) => s + (w.trades * w.WR / 100), 0);
  const profitableWindows = results.filter(w => w.totalR > 0).length;
  console.log(`\nOVERALL: ${results.length} windows | ${(profitableWindows/results.length*100).toFixed(0)}% profitable | trades=${allTrades} | cumWR=${(allWins/allTrades*100).toFixed(1)}% | avgR=${(allTotalR/allTrades).toFixed(3)} | totalR=${allTotalR.toFixed(2)}`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

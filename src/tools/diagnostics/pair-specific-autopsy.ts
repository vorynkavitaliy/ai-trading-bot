// Pair-specific feature autopsy. Maybe BTC behaves differently than DOGE,
// and aggregated quintile analysis hides per-pair signals.
//
// For each pair, compute feature distributions of WIN vs LOSS trades.
// Looking for pair-level features with strong separation that aggregate-level
// analysis missed.

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
  startEquity: 50_000, takerFeeRate: 0.00055, makerFeeRate: 0.0002,
  slippagePct: 0.25, riskPctBase: 0.6, leverage: 10,
  tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

async function main() {
  const now = Date.now();
  const startTs = now - 365 * 24 * 60 * 60_000;
  const endTs = now;

  console.log('Running 13-pair backtest...');
  const tradesByPair = new Map<string, ClosedTrade[]>();
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    tradesByPair.set(symbol, r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length}\n`);
  }

  console.log('\n========== Per-pair Win/Loss feature comparison ==========');
  console.log('pair        n   WR    avgR   | feature        winMean  lossMean  diff   |Δ|');

  for (const [pair, trades] of tradesByPair) {
    const wins = trades.filter(t => t.pnlR > 0);
    const losses = trades.filter(t => t.pnlR < 0);
    if (losses.length < 3) {
      console.log(`${pair.padEnd(10)} ${String(trades.length).padStart(3)}  too few losses (${losses.length})`);
      continue;
    }
    const wr = wins.length / trades.length * 100;
    const avgR = trades.reduce((s, t) => s + t.pnlR, 0) / trades.length;

    // Compute simple features
    const features: Record<string, (t: ClosedTrade) => number> = {
      rrTp2: t => {
        const sd = Math.abs(t.entry - t.sl);
        const tp2d = t.tp2 ? Math.abs(t.tp2 - t.entry) : 0;
        return sd > 0 ? tp2d / sd : 0;
      },
      stopDistPct: t => Math.abs(t.entry - t.sl) / t.entry * 100,
      tp1DistPct: t => Math.abs(t.tp1 - t.entry) / t.entry * 100,
      hourUtc: t => new Date(t.entryTs).getUTCHours(),
      holdHours: t => (t.exitTs - t.entryTs) / 3_600_000,
    };

    console.log(`\n${pair.padEnd(10)} ${String(trades.length).padStart(3)}  ${wr.toFixed(0)}%  ${avgR.toFixed(2)}`);
    for (const [name, fn] of Object.entries(features)) {
      const winMean = wins.reduce((s, t) => s + fn(t), 0) / wins.length;
      const lossMean = losses.reduce((s, t) => s + fn(t), 0) / losses.length;
      const diff = winMean - lossMean;
      const norm = Math.max(Math.abs(winMean), Math.abs(lossMean), 1);
      const flag = Math.abs(diff) / norm > 0.15 ? '*' : ' ';
      console.log(`           ${name.padEnd(14)} ${winMean.toFixed(3).padStart(7)}  ${lossMean.toFixed(3).padStart(8)}  ${diff.toFixed(3).padStart(6)} ${flag}`);
    }

    // Per-hour analysis (only if pair has enough trades)
    if (trades.length >= 30) {
      const byHour = new Map<number, ClosedTrade[]>();
      for (const t of trades) {
        const h = new Date(t.entryTs).getUTCHours();
        if (!byHour.has(h)) byHour.set(h, []);
        byHour.get(h)!.push(t);
      }
      // Find the WORST hour bucket
      let worstHour: { h: number; avgR: number; n: number } | null = null;
      for (const [h, arr] of byHour) {
        if (arr.length < 5) continue;
        const a = arr.reduce((s, t) => s + t.pnlR, 0) / arr.length;
        if (!worstHour || a < worstHour.avgR) worstHour = { h, avgR: a, n: arr.length };
      }
      if (worstHour && worstHour.avgR < 0) {
        console.log(`           ⚠ worst hour: H${String(worstHour.h).padStart(2,'0')} n=${worstHour.n} avgR=${worstHour.avgR.toFixed(3)}`);
      }
    }
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

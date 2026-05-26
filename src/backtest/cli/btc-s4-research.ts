/**
 * Step 7 of BTC WR-uplift research (2026-05-24).
 *
 * Tries S4 (FundingTaConfluence) on BTC, vs S1 (current production). Sweeps
 * pct cutoff and trend filters, runs each config 365d via engine.ts, prints
 * trades/WR/PF/sumR/MaxDD.
 *
 * Looking for an S4 config that:
 *   - WR >= 65% (target uplift from S1's 57%)
 *   - n >= 25 trades/year (enough volume to be statistically meaningful)
 *   - PF >= 1.8
 *   - MaxDD <= S1's level (~2.8%)
 *
 * The promising configs then go to walk-forward in the next step.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy } from '../types';
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

interface Cfg { label: string; strategy: Strategy; }

async function runOne(c: Cfg, startTs: number, endTs: number) {
  const r = await runBacktest(c.strategy, { symbol: 'BTCUSDT', startTs, endTs, ...COMMON });
  return {
    label: c.label,
    trades: r.metrics.trades,
    WR: r.metrics.winRate * 100,
    PF: r.metrics.profitFactor,
    totalR: r.metrics.totalR,
    avgR: r.metrics.avgR,
    expR: r.metrics.expectancyR,
    maxDD: r.metrics.maxDDPct,
    netPnlPct: r.metrics.netPnlPct,
    rawTrades: r.trades,
  };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const endTs = now;

  const configs: Cfg[] = [
    // S1 baseline
    { label: 'S1 baseline (production)', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }) },

    // S4 default
    { label: 'S4 default (pct 0.70, both trends)', strategy: fundingTaConfluence() },

    // S4 sweeps: pct cutoff
    { label: 'S4 pct 0.65, both trends', strategy: fundingTaConfluence({ pctHi: 0.65, pctLo: 0.35 }) },
    { label: 'S4 pct 0.75, both trends', strategy: fundingTaConfluence({ pctHi: 0.75, pctLo: 0.25 }) },
    { label: 'S4 pct 0.80, both trends', strategy: fundingTaConfluence({ pctHi: 0.80, pctLo: 0.20 }) },
    { label: 'S4 pct 0.85, both trends', strategy: fundingTaConfluence({ pctHi: 0.85, pctLo: 0.15 }) },
    { label: 'S4 pct 0.90, both trends', strategy: fundingTaConfluence({ pctHi: 0.90, pctLo: 0.10 }) },

    // S4 trend filter variants (at default 0.70 pct)
    { label: 'S4 pct 0.70, NO TRENDS', strategy: fundingTaConfluence({ usePairTrend: false, useBtcTrend: false }) },
    { label: 'S4 pct 0.70, pair only', strategy: fundingTaConfluence({ usePairTrend: true, useBtcTrend: false }) },
    { label: 'S4 pct 0.70, BTC only',  strategy: fundingTaConfluence({ usePairTrend: false, useBtcTrend: true }) },

    // S4 best-of: maybe tighter ATR is better for high-conviction
    { label: 'S4 pct 0.75, SL1.0 TP2.5, pair', strategy: fundingTaConfluence({ pctHi: 0.75, pctLo: 0.25, slAtrMult: 1.0, tpAtrMult: 2.5, usePairTrend: true, useBtcTrend: false }) },
    { label: 'S4 pct 0.80, SL1.2 TP2.5, pair', strategy: fundingTaConfluence({ pctHi: 0.80, pctLo: 0.20, slAtrMult: 1.2, tpAtrMult: 2.5, usePairTrend: true, useBtcTrend: false }) },
  ];

  console.log('label                                              | trades  WR%     PF     sumR   avgR   expR   MaxDD%  net%');
  console.log('─'.repeat(120));
  const rows: Awaited<ReturnType<typeof runOne>>[] = [];
  for (const c of configs) {
    const r = await runOne(c, startTs, endTs);
    rows.push(r);
    console.log(
      r.label.padEnd(50) + '| ' +
      String(r.trades).padStart(5) + '  ' +
      r.WR.toFixed(1).padStart(5) + '%  ' +
      r.PF.toFixed(2).padStart(5) + '  ' +
      r.totalR.toFixed(2).padStart(6) + '  ' +
      r.avgR.toFixed(2).padStart(5) + '  ' +
      r.expR.toFixed(2).padStart(5) + '  ' +
      r.maxDD.toFixed(2).padStart(5) + '%  ' +
      r.netPnlPct.toFixed(1).padStart(5) + '%'
    );
  }

  // For top candidate, dump trades for walk-forward downstream
  const ranked = rows
    .filter(r => r.label.startsWith('S4') && r.trades >= 20)
    .sort((a, b) => (b.WR + b.PF * 5) - (a.WR + a.PF * 5));
  console.log('\nTop S4 candidates by WR + 5×PF:');
  for (let i = 0; i < Math.min(3, ranked.length); i++) {
    const r = ranked[i];
    console.log(`  #${i + 1}: ${r.label} — WR ${r.WR.toFixed(1)}% PF ${r.PF.toFixed(2)} n=${r.trades} sumR=${r.totalR.toFixed(2)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

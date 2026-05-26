/**
 * Step 8 of BTC WR-uplift research (2026-05-24).
 *
 * Custom S5: confluence of L/S Top Position (which works on BTC, as proven by
 * S1) AND funding rate. Hypothesis: requiring BOTH signals to be at the same
 * extreme should sharply reduce trade count but raise WR significantly.
 *
 * Sweeps:
 *   - pct cutoff: 0.65 / 0.70 / 0.75 / 0.80 / 0.85 / 0.90
 *   - trend filter: none, pair, BTC, both
 *   - SL/TP variations on the top candidate
 *
 * Looking for an S5 config that on full 365d gives:
 *   WR >= 65%, n >= 25, PF >= 1.8, MaxDD <= 3%
 *
 * If found → walk-forward 50/50 split next.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, lsTopPositionFundingConfluence } from '../../strategies/cg-fade';
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
    { label: 'S1 baseline (production)', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false }) },

    // S5 pct sweep with default trend (pair only)
    { label: 'S5 pct 0.65, pair', strategy: lsTopPositionFundingConfluence({ pctHi: 0.65, pctLo: 0.35 }) },
    { label: 'S5 pct 0.70, pair', strategy: lsTopPositionFundingConfluence({ pctHi: 0.70, pctLo: 0.30 }) },
    { label: 'S5 pct 0.75, pair', strategy: lsTopPositionFundingConfluence({ pctHi: 0.75, pctLo: 0.25 }) },
    { label: 'S5 pct 0.80, pair (default)', strategy: lsTopPositionFundingConfluence() },
    { label: 'S5 pct 0.85, pair', strategy: lsTopPositionFundingConfluence({ pctHi: 0.85, pctLo: 0.15 }) },
    { label: 'S5 pct 0.90, pair', strategy: lsTopPositionFundingConfluence({ pctHi: 0.90, pctLo: 0.10 }) },

    // Trend filter variants at default pct
    { label: 'S5 pct 0.80, NO TRENDS', strategy: lsTopPositionFundingConfluence({ usePairTrend: false, useBtcTrend: false }) },
    { label: 'S5 pct 0.80, BTC only', strategy: lsTopPositionFundingConfluence({ usePairTrend: false, useBtcTrend: true }) },
    { label: 'S5 pct 0.80, both', strategy: lsTopPositionFundingConfluence({ usePairTrend: true, useBtcTrend: true }) },

    // SL/TP variants on the top candidate
    { label: 'S5 pct 0.85 SL1.0/TP2.5', strategy: lsTopPositionFundingConfluence({ pctHi: 0.85, pctLo: 0.15, slAtrMult: 1.0, tpAtrMult: 2.5 }) },
    { label: 'S5 pct 0.85 SL2.0/TP2.5', strategy: lsTopPositionFundingConfluence({ pctHi: 0.85, pctLo: 0.15, slAtrMult: 2.0, tpAtrMult: 2.5 }) },
    { label: 'S5 pct 0.85 SL1.5/TP3.0', strategy: lsTopPositionFundingConfluence({ pctHi: 0.85, pctLo: 0.15, slAtrMult: 1.5, tpAtrMult: 3.0 }) },
  ];

  console.log('label                                              | trades  WR%     PF     sumR   expR   MaxDD%  net%');
  console.log('─'.repeat(115));
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
      r.expR.toFixed(2).padStart(5) + '  ' +
      r.maxDD.toFixed(2).padStart(5) + '%  ' +
      r.netPnlPct.toFixed(1).padStart(5) + '%'
    );
  }

  const ranked = rows
    .filter(r => r.label.startsWith('S5') && r.trades >= 20)
    .sort((a, b) => (b.WR + b.PF * 5) - (a.WR + a.PF * 5));
  console.log('\nTop S5 candidates by WR + 5×PF:');
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    const r = ranked[i];
    console.log(`  #${i + 1}: ${r.label} — WR ${r.WR.toFixed(1)}% PF ${r.PF.toFixed(2)} n=${r.trades} sumR=${r.totalR.toFixed(2)} MaxDD=${r.maxDD.toFixed(2)}%`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

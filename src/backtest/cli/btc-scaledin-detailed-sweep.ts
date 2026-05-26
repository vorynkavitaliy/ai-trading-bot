/**
 * Detailed sweep — BTC scaled-in with two sizing modes and cooldown-after-TP.
 *
 * Goal: find a config where scaled-in BEATS baseline on BTC standalone
 * (sumR ≥ +30, MaxDD ≤ 3%, WR ≥ 60%).
 *
 * Matrix:
 *   sizingMode: equal_r, dca_boost (decay 0.5)
 *   cooldownAfterTpHours: 0, 4, 8, 12, 24
 *   spacing: 0.4, 0.6, 0.9 ATR
 *   tpAtrMult: 0.8, 1.5, 2.0
 *
 * Total: 2 × 5 × 3 × 3 = 90 backtests. With ~25s per backtest on BTC = ~40min.
 * That's too long — narrow to most promising:
 *   - dca_boost is mathematically motivated (single-fill = baseline R)
 *   - equal_r as control
 *   - cooldownAfterTp 8h (operator's suggestion) and 12h (more aggressive)
 *   - spacing 0.6 (sweet spot earlier)
 *   - all 3 TPs
 *
 * Reduced: 2 × 2 × 1 × 3 = 12 configs ≈ 5min.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';
import { Strategy } from '../types';

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
    sumR: r.metrics.totalR,
    maxDD: r.metrics.maxDDPct,
    netPnlPct: r.metrics.netPnlPct,
  };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const endTs = now;

  const baseParams = {
    pctHi: 0.85, pctLo: 0.15,
    usePairTrend: true, useBtcTrend: false,
    slAtrMult: 1.5, tpAtrMult: 2.0,
    maxHoldBars: 12, riskPct: 0.5,
  };

  const cfgs: Cfg[] = [];
  cfgs.push({ label: 'BASELINE                     ', strategy: lsTopPositionFade(baseParams) });

  // Decay sweep (only dca_boost mode — equal_r already covered separately)
  for (const tp of [1.5, 2.0, 2.5] as const) {
    for (const cd of [0, 8, 12] as const) {
      for (const decay of [0.5, 0.7, 0.8, 1.0] as const) {
        const label = `sp0.6 TP${tp} cd${cd}h decay${decay}`;
        cfgs.push({
          label,
          strategy: lsTopPositionFade({
            ...baseParams,
            cooldownAfterTpHours: cd,
            scaledIn: {
              nEntries: 3, spacingAtr: 0.6, tpAtrMult: tp,
              sizingMode: 'dca_boost',
              dcaBoostDecay: decay,
            },
          }),
        });
      }
    }
  }

  console.log(`Total configs: ${cfgs.length}`);
  console.log('label                              | trades  WR     PF    sumR    MaxDD  return');
  console.log('─'.repeat(95));

  const rows = [];
  for (const c of cfgs) {
    const r = await runOne(c, startTs, endTs);
    rows.push(r);
    const marker = (r.sumR > 30 && r.maxDD < 4) ? ' ⭐' : '';
    console.log(
      r.label.padEnd(35) + '| ' +
      String(r.trades).padStart(4) + '   ' +
      r.WR.toFixed(1).padStart(5) + '  ' +
      r.PF.toFixed(2).padStart(4) + '  ' +
      r.sumR.toFixed(2).padStart(7) + '  ' +
      r.maxDD.toFixed(2).padStart(5) + '%  ' +
      r.netPnlPct.toFixed(2).padStart(6) + '%' + marker
    );
  }

  // Top by combined score: sumR penalised by MaxDD
  const ranked = rows.slice(1).sort((a, b) => (b.sumR - 2 * b.maxDD) - (a.sumR - 2 * a.maxDD));
  console.log('\nTop 5 by (sumR − 2×MaxDD):');
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    const r = ranked[i];
    console.log(`  #${i + 1}: ${r.label.trim()} — sumR ${r.sumR.toFixed(2)} WR ${r.WR.toFixed(1)}% PF ${r.PF.toFixed(2)} MaxDD ${r.maxDD.toFixed(2)}%`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

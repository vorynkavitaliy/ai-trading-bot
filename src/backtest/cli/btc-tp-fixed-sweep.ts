/**
 * BTC sweep: TP fixed mode (tpRecomputeOnFill: false) vs avg mode (default).
 * Both modes × decay {0.5, 0.7} × cooldown {0, 8} × TP {1.5, 2.0, 2.5}.
 * Plus baseline for reference.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade } from '../../strategies/cg-fade';
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

const BASE = {
  pctHi: 0.85, pctLo: 0.15,
  usePairTrend: true, useBtcTrend: false,
  slAtrMult: 1.5, tpAtrMult: 2.0,
  maxHoldBars: 12, riskPct: 0.5,
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

  const cfgs: Cfg[] = [];
  cfgs.push({ label: 'BASELINE'.padEnd(40), strategy: lsTopPositionFade(BASE) });

  for (const tp of [1.5, 2.0, 2.5] as const) {
    for (const cd of [0, 8] as const) {
      for (const decay of [0.5, 0.7] as const) {
        for (const fixed of [false, true] as const) {
          const tpMode = fixed ? 'FIXED' : 'avg  ';
          const label = `TP${tp} cd${cd}h decay${decay} ${tpMode}`.padEnd(40);
          cfgs.push({
            label,
            strategy: lsTopPositionFade({
              ...BASE,
              cooldownAfterTpHours: cd,
              scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: tp, sizingMode: 'dca_boost', dcaBoostDecay: decay, tpRecomputeOnFill: !fixed },
            }),
          });
        }
      }
    }
  }

  console.log(`Total configs: ${cfgs.length}`);
  console.log('config                                    | trades  WR     PF    sumR    MaxDD  return');
  console.log('─'.repeat(100));

  const rows: Awaited<ReturnType<typeof runOne>>[] = [];
  for (const c of cfgs) {
    const r = await runOne(c, startTs, endTs);
    rows.push(r);
    const marker = (r.sumR > 30 && r.maxDD < 4) ? ' ⭐' : '';
    console.log(
      r.label + '| ' +
      String(r.trades).padStart(4) + '   ' +
      r.WR.toFixed(1).padStart(5) + '  ' +
      r.PF.toFixed(2).padStart(4) + '  ' +
      r.sumR.toFixed(2).padStart(7) + '  ' +
      r.maxDD.toFixed(2).padStart(5) + '%  ' +
      r.netPnlPct.toFixed(2).padStart(6) + '%' + marker
    );
  }

  const ranked = rows.slice(1).sort((a, b) => (b.sumR - 2 * b.maxDD) - (a.sumR - 2 * a.maxDD));
  console.log('\nTop 5 by (sumR − 2×MaxDD):');
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    const r = ranked[i];
    console.log(`  #${i + 1}: ${r.label.trim()} — sumR ${r.sumR.toFixed(2)} WR ${r.WR.toFixed(1)}% PF ${r.PF.toFixed(2)} MaxDD ${r.maxDD.toFixed(2)}%`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * Walk-forward 50/50 validation для ETH (S1 scaled-in) и BNB (S3 scaled-in)
 * перед добавлением в production portfolio.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN_FIXED = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

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

interface Cand { pair: string; label: string; strategy: Strategy; }

const candidates: Cand[] = [
  {
    pair: 'ETHUSDT',
    label: 'ETH S1 scaled-in (pair trend)',
    strategy: lsTopPositionFade({
      pctHi: 0.85, pctLo: 0.15,
      usePairTrend: true, useBtcTrend: false,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: 0.5, scaledIn: SCALED_IN_FIXED,
    }),
  },
  {
    pair: 'BNBUSDT',
    label: 'BNB S3 scaled-in (funding fade)',
    strategy: fundingFade({ riskPct: 0.5, scaledIn: SCALED_IN_FIXED }),
  },
];

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const fullStart = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;
  console.log(`WF split @ ${new Date(splitTs).toISOString().slice(0, 10)}\n`);

  for (const c of candidates) {
    console.log(`========== ${c.label} (${c.pair}) ==========`);
    resetCgFadeCooldownState();
    const rTr = await runBacktest(c.strategy, { symbol: c.pair, startTs: fullStart, endTs: splitTs, ...COMMON });
    resetCgFadeCooldownState();
    const rTe = await runBacktest(c.strategy, { symbol: c.pair, startTs: splitTs, endTs: now, ...COMMON });
    const tr = rTr.metrics, te = rTe.metrics;
    console.log(`  TRAIN: n=${tr.trades}  WR=${(tr.winRate*100).toFixed(1)}%  PF=${tr.profitFactor.toFixed(2)}  sumR=${tr.totalR.toFixed(2)}  return=${tr.netPnlPct.toFixed(2)}%  MaxDD=${tr.maxDDPct.toFixed(2)}%`);
    console.log(`  TEST : n=${te.trades}  WR=${(te.winRate*100).toFixed(1)}%  PF=${te.profitFactor.toFixed(2)}  sumR=${te.totalR.toFixed(2)}  return=${te.netPnlPct.toFixed(2)}%  MaxDD=${te.maxDDPct.toFixed(2)}%`);
    console.log(`  Δ TEST−TRAIN: WR=${((te.winRate-tr.winRate)*100).toFixed(1)}pp  PF=${(te.profitFactor-tr.profitFactor).toFixed(2)}  sumR=${(te.totalR-tr.totalR).toFixed(2)}\n`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

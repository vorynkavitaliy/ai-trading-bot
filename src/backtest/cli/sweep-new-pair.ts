/**
 * Sweep all 4 strategy archetypes (S1/S2/S3/S4) × baseline + scaled-in FIXED
 * for a new candidate pair. Identifies the best strategy + sizing combination.
 *
 * Usage: npx tsx src/backtest/cli/sweep-new-pair.ts HYPEUSDT 365
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

// HONEST=1 → mirror live execution conditions (cron-realistic entry timing on the
// 4H→HH:00 grid past funding windows, slip 0.25%, prop startEquity) instead of the
// optimistic defaults (slip 0.05%, instant 4H entry). The optimistic mode is what
// over-validated ETH/HYPE in the first place — always HONEST=1 for a real screen.
const HONEST = process.env.HONEST === '1';

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: HONEST ? 668_000 : 200_000,
  slippagePct: HONEST ? 0.25 : 0.05,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  cronRealistic: HONEST,
};

const SCALED_IN_FIXED = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,     // 0.5 matches live (was stale 0.6)
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

interface Cfg { label: string; strategy: Strategy; }

function makeConfigs(): Cfg[] {
  return [
    // S1: LS-top-pos with pair trend
    { label: 'S1 baseline (pair trend)', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }) },
    { label: 'S1 scaled-in FIXED       ', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
    // S2: LS-top-pos with BTC trend
    { label: 'S2 baseline (BTC trend) ', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }) },
    { label: 'S2 scaled-in FIXED       ', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
    // S3: funding fade
    { label: 'S3 baseline (funding fade)', strategy: fundingFade() },
    { label: 'S3 scaled-in FIXED        ', strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
    // S4: funding+TA confluence
    { label: 'S4 baseline (F+TA)        ', strategy: fundingTaConfluence() },
    { label: 'S4 scaled-in FIXED        ', strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  ];
}

async function main() {
  const pair = process.argv[2];
  const days = parseFloat(process.argv[3] ?? '365');
  if (!pair) { console.error('usage: sweep-new-pair.ts <PAIR> [days=365]'); process.exit(1); }

  // SKIP=N ends the window N days before now → TRAIN/TEST split (both historical).
  const skipDays = parseFloat(process.env.SKIP ?? '0');
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - days * 24 * 3600_000;

  console.log(`Sweep ${pair} (${days}d${skipDays ? `, SKIP ${skipDays}d` : ''}) — ${HONEST ? 'HONEST: cron-realistic, slip 0.25%, $668k' : 'OPTIMISTIC: slip 0.05%, instant entry (overstates!)'}\n`);
  console.log('config                       | trades  WR     PF    sumR    MaxDD  return');
  console.log('─'.repeat(95));

  const cfgs = makeConfigs();
  const rows: Array<{ label: string; trades: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number }> = [];
  for (const c of cfgs) {
    const r = await runBacktest(c.strategy, { symbol: pair, startTs, endTs, ...COMMON });
    const m = r.metrics;
    rows.push({ label: c.label, trades: m.trades, wr: m.winRate*100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct });
    console.log(
      c.label.padEnd(29) + '| ' +
      String(m.trades).padStart(4) + '   ' +
      (m.winRate*100).toFixed(1).padStart(5) + '  ' +
      m.profitFactor.toFixed(2).padStart(4) + '  ' +
      m.totalR.toFixed(2).padStart(7) + '  ' +
      m.maxDDPct.toFixed(2).padStart(5) + '%  ' +
      m.netPnlPct.toFixed(2).padStart(6) + '%'
    );
  }

  console.log('\nWinner by sumR:');
  const top = [...rows].sort((a, b) => b.sumR - a.sumR)[0];
  console.log(`  ${top.label.trim()} — sumR ${top.sumR.toFixed(2)} WR ${top.wr.toFixed(1)}% PF ${top.pf.toFixed(2)} return ${top.ret.toFixed(2)}%`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

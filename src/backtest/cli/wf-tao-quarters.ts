/**
 * RESEARCH: per-quarter consistency for TAOUSDT S1 scaled-in.
 * Tier-1 gold standard = 4/4 quarters positive (CLAUDE.md). Tier-2 = 3/4.
 * Read-only.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN = { nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0, sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5, tpRecomputeOnFill: false };
const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000, slippagePct: 0.05, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

function makeS1() {
  return lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN });
}

function stat(trades: ClosedTrade[]) {
  if (trades.length === 0) return { n: 0, wr: 0, sumR: 0, longN: 0, shortN: 0 };
  let wins = 0, losses = 0, sumR = 0, longN = 0, shortN = 0;
  for (const t of trades) {
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
    if (t.side === 'long') longN++; else shortN++;
  }
  return { n: trades.length, wr: (wins + losses) > 0 ? wins / (wins + losses) * 100 : 0, sumR, longN, shortN };
}

async function main() {
  const now = Date.now();
  const q = 91 * 24 * 3600_000;  // ~quarter
  // 4 quarters back from now
  const quarters = [
    { name: 'Q1 (oldest)', start: now - 4 * q, end: now - 3 * q },
    { name: 'Q2        ', start: now - 3 * q, end: now - 2 * q },
    { name: 'Q3        ', start: now - 2 * q, end: now - 1 * q },
    { name: 'Q4 (recent)', start: now - 1 * q, end: now },
  ];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TAOUSDT S1 scaled-in — PER-QUARTER CONSISTENCY (Tier-1 gate 4/4)');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Quarter        | dates                   | n  | WR    | sumR   | L/S split');
  console.log('---------------+-------------------------+----+-------+--------+----------');

  let positiveQ = 0;
  for (const qt of quarters) {
    resetCgFadeCooldownState();
    const r = await runBacktest(makeS1(), { symbol: 'TAOUSDT', startTs: qt.start, endTs: qt.end, ...COMMON });
    const s = stat(r.trades);
    if (s.sumR > 0) positiveQ++;
    const flag = s.sumR > 0 ? '🟢' : (s.n === 0 ? '⚪' : '🔴');
    console.log(`  ${qt.name} | ${new Date(qt.start).toISOString().slice(0,10)} → ${new Date(qt.end).toISOString().slice(0,10)} | ${String(s.n).padStart(2)} | ${s.wr.toFixed(0).padStart(4)}% | ${s.sumR.toFixed(2).padStart(6)} | ${s.longN}L/${s.shortN}S ${flag}`);
  }

  console.log(`\n  Positive quarters: ${positiveQ}/4`);
  if (positiveQ === 4) console.log('  🟢 TIER-1 grade — consistent across all market regimes.');
  else if (positiveQ === 3) console.log('  🟡 TIER-2 grade — one weak quarter. Same tier as paused ETH/SOL/DOGE/BNB pre-promotion.');
  else console.log('  🔴 Below Tier-2 — inconsistent. Keep out.');

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * Дебажит ARB сделки за 24-29 мая в cronRealistic режиме: печатает per-trade
 * детали (entry, SL, TP, exit) чтобы сверить с live.
 *
 * Usage: npx tsx src/tools/diagnostics/debug-arb-27.ts
 */
import { runBacktest } from '../../backtest/engine';
import { resetCgFadeCooldownState, fundingFade } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';

const SCALED_IN = {
  nEntries: 3,
  spacingAtr: 0.5,
  tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const,
  dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

const KNOBS = {
  symbol: 'ARBUSDT',
  startEquity: 668_000,
  slippagePct: 0.25,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  riskPctBase: 0.5,
  cronRealistic: true,
};

async function main() {
  const now = Date.now();
  const startTs = now - 5 * 24 * 3600_000;

  const strategy = fundingFade({ riskPct: 0.5, scaledIn: SCALED_IN });

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  ARB DEBUG — cronRealistic=true, slip=0.25%, 24-29 May 2026        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  resetCgFadeCooldownState();
  const result = await runBacktest(strategy, { ...KNOBS, startTs, endTs: now });

  console.log(`Total ARB trades found: ${result.trades.length}\n`);
  for (const t of result.trades) {
    const entryDate = new Date(t.entryTs).toISOString();
    const exitDate = new Date(t.exitTs).toISOString();
    const durMin = Math.round((t.exitTs - t.entryTs) / 60_000);
    console.log(`────────────────────────────────────────────────────────────────────`);
    console.log(`  ${t.side.toUpperCase()} ENTRY @ ${entryDate}  qty=${t.qty.toFixed(2)}`);
    console.log(`    entry_price: ${t.entry.toFixed(5)}`);
    console.log(`    SL:          ${t.sl.toFixed(5)}`);
    console.log(`    TP1/TP2:     ${t.tp1?.toFixed(5) ?? 'null'} / ${t.tp2?.toFixed(5) ?? 'null'}`);
    console.log(`    MFE:         ${t.mfeR?.toFixed(3) ?? 'n/a'} R @ ${t.mfeTs ? new Date(t.mfeTs).toISOString() : 'n/a'}`);
    console.log(`    MAE:         ${t.maeR?.toFixed(3) ?? 'n/a'} R @ ${t.maeTs ? new Date(t.maeTs).toISOString() : 'n/a'}`);
    console.log(`  ${t.exitReason?.toUpperCase().padEnd(10)} EXIT @ ${exitDate}  ${durMin}min (${(durMin/60).toFixed(1)}h)`);
    console.log(`    exit_price:  ${t.exit.toFixed(5)}`);
    console.log(`    pnl_usd:     $${t.pnlUsd.toFixed(2)}`);
    console.log(`    fees_usd:    $${t.feesUsd.toFixed(2)}`);
    console.log(`    pnl_R:       ${t.pnlR.toFixed(3)}`);
  }

  console.log('\n=== ROADMAP ARB live trades 24-29 May (для сверки) ===');
  console.log('  24/05 17:01 SHORT entry 0.10588 → SL 0.10638 → loss');
  console.log('  25/05 17:00 SHORT entry 0.10990 (slot avg) → TP1 0.10538 → WIN');
  console.log('  27/05 18:00 SHORT entry 0.10821/0.10802 (slot1/2) → SL 0.10998, TP 0.10540 → TP1 WIN');
  console.log('  28/05 21:00 SHORT entry 0.10513 → TP → WIN');

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

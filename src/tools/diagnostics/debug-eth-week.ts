/**
 * ETH сделки за 24-29 May в cronRealistic+CG-fix режиме vs live.
 *
 * Usage: npx tsx src/tools/diagnostics/debug-eth-week.ts
 */
import { runBacktest } from '../../backtest/engine';
import { resetCgFadeCooldownState, lsTopPositionFade } from '../../strategies/cg-fade';
import { close as closePg, query } from '../../core/db';

const SCALED_IN = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5, tpRecomputeOnFill: false,
};

const KNOBS = {
  symbol: 'ETHUSDT',
  startEquity: 668_000,
  slippagePct: 0.25,
  takerFeeRate: 0.00055, makerFeeRate: 0.0002,
  leverage: 10, decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
  riskPctBase: 0.5,
  cronRealistic: true,
};

async function main() {
  const now = Date.now();
  const startTs = now - 5 * 24 * 3600_000;

  const strategy = lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15,
    usePairTrend: true, useBtcTrend: false,
    slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
    riskPct: 0.5, scaledIn: SCALED_IN });

  console.log('\n╔════ ETH BACKTEST (cron-realistic + CG fix, 5d) ════════╗\n');
  resetCgFadeCooldownState();
  const result = await runBacktest(strategy, { ...KNOBS, startTs, endTs: now });
  console.log(`Total ETH trades: ${result.trades.length}\n`);
  for (const t of result.trades) {
    const entry = new Date(t.entryTs).toISOString();
    const exit = new Date(t.exitTs).toISOString();
    const durH = ((t.exitTs - t.entryTs) / 3600_000).toFixed(1);
    console.log(`  ${t.side.toUpperCase()} entry ${entry} @ ${t.entry.toFixed(2)}  SL ${t.sl.toFixed(2)}  TP ${t.tp1?.toFixed(2) ?? '-'}  → ${t.exitReason} @ ${exit} (${durH}h)  pnlR ${t.pnlR.toFixed(2)}`);
  }

  console.log('\n=== LIVE ETH 24-29 May ===');
  const live = await query<any>(
    `SELECT side, exit_reason, entry_price, sl, tp1, exit_price, opened_at, closed_at
     FROM trades WHERE symbol='ETHUSDT' AND opened_at >= '2026-05-24' AND status='closed'
     ORDER BY opened_at`
  );
  for (const r of live.rows) {
    console.log(`  ${r.side.toUpperCase()} entry ${r.opened_at} @ ${parseFloat(r.entry_price).toFixed(2)}  SL ${parseFloat(r.sl).toFixed(2)}  TP ${parseFloat(r.tp1).toFixed(2)}  → ${r.exit_reason} @ ${r.closed_at} @ ${parseFloat(r.exit_price).toFixed(2)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

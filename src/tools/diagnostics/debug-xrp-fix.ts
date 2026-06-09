/**
 * Debug XRP trades после TP-anchor fix.
 */
import { runBacktest } from '../../backtest/engine';
import { resetCgFadeCooldownState, fundingTaConfluence } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';

const SCALED_IN = { nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0, sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5, tpRecomputeOnFill: false };

const KNOBS = {
  symbol: 'XRPUSDT', startEquity: 668_000, slippagePct: 0.25,
  takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
  riskPctBase: 0.5, cronRealistic: true,
};

async function main() {
  const now = Date.now();
  const startTs = now - 5 * 24 * 3600_000;
  const strategy = fundingTaConfluence({ riskPct: 0.5, scaledIn: SCALED_IN });

  resetCgFadeCooldownState();
  const result = await runBacktest(strategy, { ...KNOBS, startTs, endTs: now });

  console.log(`\nXRP trades: ${result.trades.length}\n`);
  for (const t of result.trades) {
    console.log(`────────────────────────────────────────`);
    console.log(`  ${t.side.toUpperCase()} entry ${new Date(t.entryTs).toISOString()} @ ${t.entry.toFixed(5)}`);
    console.log(`  SL ${t.sl.toFixed(5)}  TP1/TP2 ${t.tp1?.toFixed(5)} / ${t.tp2?.toFixed(5)}`);
    console.log(`  exit ${new Date(t.exitTs).toISOString()} @ ${t.exit.toFixed(5)}  reason=${t.exitReason}`);
    console.log(`  qty=${t.qty.toFixed(2)}  pnlUsd=$${t.pnlUsd.toFixed(2)}  feesUsd=$${t.feesUsd.toFixed(2)}  pnlR=${t.pnlR.toFixed(3)}`);
    console.log(`  MFE ${t.mfeR?.toFixed(3) ?? 'n/a'}R @ ${t.mfeTs ? new Date(t.mfeTs).toISOString() : 'n/a'}`);
    console.log(`  MAE ${t.maeR?.toFixed(3) ?? 'n/a'}R @ ${t.maeTs ? new Date(t.maeTs).toISOString() : 'n/a'}`);
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

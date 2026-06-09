/**
 * DDD-WORST-DAY — read-only forensic on the worst intraday Daily-DD day.
 *
 * Runs the live-mirror portfolio backtest, finds the worst day from r.dailyDd,
 * then re-walks that UTC day's 15-min grid and prints the per-position MTM
 * contribution at the trough. Answers: is the worst day driven by (a) a qty
 * explosion (one position with riskedUsd >> intended), (b) realized churn (many
 * closes same day), or (c) honest correlated drawdown of capped positions?
 *
 * Usage: CAP=2 ENTRYCAP=2 npx tsx src/tools/diagnostics/ddd-worst-day.ts [days=365]
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../../backtest/engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../../backtest/types';
import { close as closePg } from '../../core/db';

const RISK = 0.5;
const SCALED = { nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0, sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5, tpRecomputeOnFill: false };
const PAIRS: { symbol: string; strategy: Strategy }[] = [
  { symbol: 'SOLUSDT',  strategy: fundingTaConfluence({ riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'INJUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'ATOMUSDT', strategy: fundingFade({ riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'ARBUSDT',  strategy: fundingFade({ riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'XRPUSDT',  strategy: fundingTaConfluence({ riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'LTCUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'HYPEUSDT', strategy: fundingTaConfluence({ riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'ETHUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'BNBUSDT',  strategy: fundingFade({ riskPct: RISK, scaledIn: SCALED }) },
  { symbol: 'TAOUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK, scaledIn: SCALED }) },
];

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const cap = parseInt(process.env.CAP ?? '2', 10);
  const entryCap = parseInt(process.env.ENTRYCAP ?? '2', 10);
  const now = Date.now();
  const endTs = now;
  const startTs = endTs - days * 24 * 3600_000;
  const startEquity = 668_000;

  const symbolStrats: PortfolioSymbolStrategy[] = PAIRS.map((p, i) => ({ symbol: p.symbol, strategy: p.strategy, priority: i }));
  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(symbolStrats, {
    startEquity, slippagePct: 0.25, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: cap, maxEntriesPerWindow: entryCap, entryCapWindowMs: 12 * 3600_000,
  });

  const worstDay = r.dailyDd.worstDay;
  console.log(`\n=== WORST DAY FORENSIC: ${worstDay}  (reported ${r.dailyDd.worstDailyDdPct}%) ===`);
  console.log(`  cap=${cap} entryCap=${entryCap} totalTrades=${r.trades.length} return=${((r.endEquity-startEquity)/startEquity*100).toFixed(2)}%\n`);

  const dayStart = Date.parse(worstDay + 'T00:00:00.000Z');
  const dayEnd = dayStart + 24 * 3600_000;

  // Trades whose life overlaps the worst day.
  const overlap = r.trades.filter(t => t.entryTs < dayEnd && t.exitTs > dayStart);
  const closedThatDay = r.trades.filter(t => t.exitTs >= dayStart && t.exitTs < dayEnd);
  const openedThatDay = r.trades.filter(t => t.entryTs >= dayStart && t.entryTs < dayEnd);

  console.log(`  trades overlapping the day: ${overlap.length}  (opened ${openedThatDay.length}, closed ${closedThatDay.length})`);
  const fixedRiskUsd = startEquity * (RISK / 100);  // 1R in $ at fixed-R reporting
  console.log(`  1R (fixed, ${RISK}% of $${startEquity}) = $${fixedRiskUsd.toFixed(0)}\n`);

  console.log('  --- per overlapping trade (entry/initialSl/tp1, qty, riskedUsd-implied, pnlR, exitReason) ---');
  for (const t of overlap.sort((a, b) => a.entryTs - b.entryTs)) {
    const stopDist = Math.abs(t.entry - t.initialSl);
    const riskedUsd = stopDist * t.qty;                 // $ at SL with full qty
    const riskInR = riskedUsd / fixedRiskUsd;           // how many "1R" this position actually risks
    const notional = t.entry * t.qty;
    console.log(
      `  ${t.symbol.padEnd(9)} ${t.side.padEnd(5)} entry=${t.entry.toFixed(4)} iSL=${t.initialSl.toFixed(4)} ` +
      `qty=${t.qty.toFixed(2)} notional=$${(notional/1000).toFixed(0)}k riskedUsd=$${riskedUsd.toFixed(0)} ` +
      `risk=${riskInR.toFixed(2)}R pnlR=${t.pnlR.toFixed(2)} ${t.exitReason} ` +
      `[${new Date(t.entryTs).toISOString().slice(5,16)}→${new Date(t.exitTs).toISOString().slice(5,16)}]`
    );
  }

  // Realized P&L closed that day (engine $).
  const realizedDay = closedThatDay.reduce((s, t) => s + t.pnlUsd, 0);
  console.log(`\n  realized P&L from closes on ${worstDay}: $${realizedDay.toFixed(0)}  (${(realizedDay/startEquity*100).toFixed(2)}% of start)`);

  // Max single-trade risk across the WHOLE run (qty-explosion detector).
  let maxRiskR = 0, maxRiskT: ClosedTrade | null = null;
  for (const t of r.trades) {
    const riskInR = (Math.abs(t.entry - t.initialSl) * t.qty) / fixedRiskUsd;
    if (riskInR > maxRiskR) { maxRiskR = riskInR; maxRiskT = t; }
  }
  console.log(`\n  === QTY-EXPLOSION CHECK (whole run) ===`);
  console.log(`  max single-trade implied risk = ${maxRiskR.toFixed(2)}R  (intended full-DCA ≈ 1.75R = 0.875%)`);
  if (maxRiskT) console.log(`    → ${maxRiskT.symbol} ${maxRiskT.side} entry=${maxRiskT.entry} iSL=${maxRiskT.initialSl} qty=${maxRiskT.qty} pnlR=${maxRiskT.pnlR.toFixed(2)} on ${new Date(maxRiskT.entryTs).toISOString().slice(0,10)}`);
  const over3R = r.trades.filter(t => (Math.abs(t.entry - t.initialSl) * t.qty) / fixedRiskUsd > 3).length;
  console.log(`  trades risking >3R (explosion suspects): ${over3R} / ${r.trades.length}`);

  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

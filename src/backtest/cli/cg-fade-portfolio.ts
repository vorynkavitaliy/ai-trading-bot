/**
 * CG-fade portfolio backtest via engine.ts (validates Phase A integration).
 *
 * Should reproduce standalone results (cg-tier1-portfolio.ts):
 *   601 trades, WR 54.6%, MaxDD 7.18%, +82% on $200k base.
 *
 * If numbers diverge → integration bug. Acceptable variance ±5% on sumR (engine
 * uses real 1m bar resolution, standalone uses 4H — small differences expected).
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

interface PairCfg { pair: string; strategy: Strategy; }

const TIER1: PairCfg[] = [
  { pair: 'BTCUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }) },
  { pair: 'TAOUSDT',  strategy: fundingFade()       /* defaults: pct 0.75, both trends, SL1.5/TP2 */ },
  { pair: 'INJUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }) },
  { pair: 'ATOMUSDT', strategy: fundingFade() },
  { pair: 'ARBUSDT',  strategy: fundingFade() },
  { pair: 'XRPUSDT',  strategy: fundingTaConfluence() },
  { pair: 'LTCUSDT',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }) },
];

const COMMON = {
  startEquity: 200_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: 0.05,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,
  // CG-fade uses single TP target (tp1==tp2). Engine fires both at the same
  // price → full position close. tp1SlMode is moot (only relevant for true
  // partial splits).
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

async function main() {
  // Args: `<days>` (e.g. 365, 30) OR fractional like 0.4 for ~10h.
  // Or use env BT_HOURS to specify hours directly (overrides argv).
  const hoursOverride = process.env.BT_HOURS ? parseFloat(process.env.BT_HOURS) : null;
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const lookbackMs = hoursOverride != null ? hoursOverride * 3600_000 : days * 24 * 3600_000;
  const startTs = now - lookbackMs;
  const endTs = now;

  console.log(`=== Tier-1 portfolio via engine.ts — fresh run ${new Date().toISOString()} ===`);
  console.log(`Period: ${days}d   Universe: ${TIER1.map(c => c.pair).join(', ')}`);
  console.log(`Start equity: $${COMMON.startEquity.toLocaleString()}  Risk per trade: ${COMMON.riskPctBase}%\n`);

  // 1) Run per-pair backtests via engine
  const allTrades: ClosedTrade[] = [];
  const perPair: Record<string, { trades: ClosedTrade[]; sumR: number; wins: number }> = {};

  for (const cfg of TIER1) {
    log.info(`engine backtest ${cfg.pair}`, { strategy: cfg.strategy.name });
    const r = await runBacktest(cfg.strategy, {
      symbol: cfg.pair, startTs, endTs, ...COMMON,
    });
    log.info(`engine done ${cfg.pair}`, {
      trades: r.metrics.trades, totalR: r.metrics.totalR.toFixed(2), pf: r.metrics.profitFactor,
    });
    allTrades.push(...r.trades);
    perPair[cfg.pair] = {
      trades: r.trades,
      sumR: r.trades.reduce((s, t) => s + t.pnlR, 0),
      wins: r.trades.filter(t => t.pnlR > 0.05).length,
    };
  }

  // 2) Portfolio simulation: shared compounding equity
  allTrades.sort((a, b) => a.entryTs - b.entryTs);
  let equity = COMMON.startEquity;
  let peak = equity;
  let maxDD = 0;
  let maxDDStart = 0, maxDDEnd = 0, curDDStart = 0;
  let wins = 0, losses = 0, scratches = 0;
  let consL = 0, consW = 0, maxConsL = 0, maxConsW = 0;
  let sumR = 0;
  const monthly: Record<string, { trades: number; pnl: number }> = {};

  for (const t of allTrades) {
    const riskUsd = equity * (COMMON.riskPctBase / 100);
    const pnlUsd = t.pnlR * riskUsd;
    equity += pnlUsd;
    if (equity > peak) { peak = equity; curDDStart = t.exitTs; }
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) { maxDD = dd; maxDDStart = curDDStart; maxDDEnd = t.exitTs; }
    sumR += t.pnlR;
    if (t.pnlR > 0.05) { wins++; consW++; consL = 0; if (consW > maxConsW) maxConsW = consW; }
    else if (t.pnlR < -0.05) { losses++; consL++; consW = 0; if (consL > maxConsL) maxConsL = consL; }
    else scratches++;
    const m = new Date(t.entryTs).toISOString().slice(0, 7);
    if (!monthly[m]) monthly[m] = { trades: 0, pnl: 0 };
    monthly[m].trades++;
    monthly[m].pnl += pnlUsd;
  }

  const total = wins + losses + scratches;
  const wr = total ? wins / total * 100 : 0;
  const ret = (equity - COMMON.startEquity) / COMMON.startEquity * 100;
  const winSum = allTrades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossSum = Math.abs(allTrades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const pf = lossSum > 0 ? winSum / lossSum : Infinity;

  console.log('\n=== AGGREGATE ===');
  console.log(`Total trades:      ${total}  (W:${wins}  L:${losses}  scratch:${scratches})`);
  console.log(`Win Rate:          ${wr.toFixed(1)}%`);
  console.log(`Profit Factor:     ${pf.toFixed(2)}`);
  console.log(`Total R:           ${sumR.toFixed(2)}R`);
  console.log(`Start → Final:     $${COMMON.startEquity.toLocaleString()} → $${equity.toFixed(0)}`);
  console.log(`Return:            ${ret.toFixed(2)}%`);
  console.log(`Max Drawdown:      ${maxDD.toFixed(2)}%  ($${(peak * maxDD / 100).toFixed(0)})`);
  console.log(`DD period:         ${new Date(maxDDStart).toISOString().slice(0,10)} → ${new Date(maxDDEnd).toISOString().slice(0,10)}`);
  console.log(`Max consec L/W:    ${maxConsL} / ${maxConsW}`);

  console.log('\n=== PER-PAIR ===');
  console.log('pair      |  n   wins  WR%    sumR');
  for (const cfg of TIER1) {
    const s = perPair[cfg.pair];
    const n = s.trades.length;
    if (n === 0) { console.log(`${cfg.pair.padEnd(9)} | (no trades)`); continue; }
    console.log(`${cfg.pair.padEnd(9)} | ${String(n).padStart(3)}   ${String(s.wins).padStart(3)}   ${(s.wins / n * 100).toFixed(1).padStart(4)}%  ${s.sumR.toFixed(2).padStart(6)}`);
  }

  console.log('\n=== MONTHLY P&L ===');
  const months = Object.keys(monthly).sort();
  let runEq = COMMON.startEquity;
  for (const m of months) {
    const pnl = monthly[m].pnl;
    runEq += pnl;
    const pct = pnl / (runEq - pnl) * 100;
    console.log(`  ${m}: ${String(monthly[m].trades).padStart(3)} trades   $${pnl.toFixed(0).padStart(7)} (${pct.toFixed(2).padStart(6)}%)   → equity $${runEq.toFixed(0)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

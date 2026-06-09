/**
 * EXPERIMENT — то же что live-cron-true-mirror, но ETH с pctHi 0.90 / pctLo 0.10
 * (вместо стандартных 0.85/0.15). Гипотеза: ETH в 5-day cron-backtest даёт 6 entries
 * vs live 1, из-за чрезмерной чувствительности порога. Ужесточение должно сократить.
 *
 * НЕ ТРОГАЕТ pair-strategies.ts → live runtime не затронут. Только backtest эксперимент.
 *
 * Usage: npx tsx src/backtest/cli/live-cron-true-eth-tight.ts [days=5]
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const LIVE_RISK_PCT = 0.5;
const LIVE_MAX_PARALLEL = 6;

const LIVE_SCALED_IN_FIXED = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5, tpRecomputeOnFill: false,
};

const COMMON = {
  startEquity: 668_000,
  slippagePct: parseFloat(process.env.SLIP ?? '0.25'),
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  riskPctBase: LIVE_RISK_PCT,
  cronRealistic: true,
};

interface LivePair { symbol: string; family: string; strategy: Strategy; note?: string; }

// ⚠️ EXPERIMENT: ETH pctHi 0.90 (vs live 0.85). Все остальные — как live.
const ETH_PCT_HI = 0.90;
const ETH_PCT_LO = 0.10;

const LIVE_PAIRS: LivePair[] = [
  { symbol: 'SOLUSDT',  family: 'S4', strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'INJUSDT',  family: 'S2', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'ATOMUSDT', family: 'S3', strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'ARBUSDT',  family: 'S3', strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'XRPUSDT',  family: 'S4', strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'LTCUSDT',  family: 'S2', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'HYPEUSDT', family: 'S4', strategy: fundingTaConfluence({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'ETHUSDT',  family: 'S1', note: `pctHi=${ETH_PCT_HI} (EXP, live=0.85)`,
    strategy: lsTopPositionFade({ pctHi: ETH_PCT_HI, pctLo: ETH_PCT_LO,
      usePairTrend: true, useBtcTrend: false,
      slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'BNBUSDT',  family: 'S3', strategy: fundingFade({ riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
  { symbol: 'TAOUSDT',  family: 'S1', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK_PCT, scaledIn: LIVE_SCALED_IN_FIXED }) },
];

function aggregate(trades: ClosedTrade[], label: string, startEquity: number, riskPct: number) {
  const fixedRiskUsd = startEquity * (riskPct / 100);
  let equity = startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  const sortedByExit = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  for (const t of sortedByExit) {
    const pnlUsd = t.pnlR * fixedRiskUsd;
    equity += pnlUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const ret = (equity - startEquity) / startEquity * 100;
  console.log(`${label}: n=${total} WR=${(wins/Math.max(1,total)*100).toFixed(1)}% PF=${(winR/Math.max(0.01,lossR)).toFixed(2)} sumR=${sumR.toFixed(2)} return=${ret.toFixed(2)}%  MaxDD=${maxDD.toFixed(2)}%`);
  return { ret, maxDD };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '5');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`  ETH-TIGHT EXPERIMENT — pctHi=${ETH_PCT_HI}/${ETH_PCT_LO} (live=0.85/0.15)`);
  console.log(`  ${LIVE_PAIRS.length} pairs | risk ${LIVE_RISK_PCT}% | cap ${LIVE_MAX_PARALLEL} | startEq $${COMMON.startEquity.toLocaleString()}`);
  console.log(`  slip ${COMMON.slippagePct}% | period ${days}d | cronRealistic=true`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const symbolStrats: PortfolioSymbolStrategy[] = LIVE_PAIRS.map((p, i) => ({
    symbol: p.symbol, strategy: p.strategy, priority: i,
  }));

  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(symbolStrats, { ...COMMON, startTs, endTs: now, maxParallelCap: LIVE_MAX_PARALLEL });

  console.log('=== AGGREGATE ===');
  aggregate(r.trades, 'FULL ', COMMON.startEquity, LIVE_RISK_PCT);

  console.log(`\n=== ENGINE COMPOUND ===`);
  console.log(`  startEq $${r.startEquity.toFixed(0)} → endEq $${r.endEquity.toFixed(0)}  (${((r.endEquity - r.startEquity) / r.startEquity * 100).toFixed(2)}%)`);

  console.log('\n=== PER-PAIR ===');
  const perPair: Record<string, ClosedTrade[]> = {};
  for (const p of LIVE_PAIRS) perPair[p.symbol] = [];
  for (const t of r.trades) (perPair[t.symbol] ?? (perPair[t.symbol] = [])).push(t);
  const sorted = [...LIVE_PAIRS].sort((a, b) => {
    const sa = (perPair[a.symbol] ?? []).reduce((s, t) => s + t.pnlR, 0);
    const sb = (perPair[b.symbol] ?? []).reduce((s, t) => s + t.pnlR, 0);
    return sb - sa;
  });
  for (const p of sorted) {
    const t = perPair[p.symbol] ?? [];
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const losses = t.filter(x => x.pnlR < -0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : 0;
    const note = p.note ? `  ${p.note}` : '';
    console.log(`  ${p.family} ${p.symbol.padEnd(9)} n=${String(t.length).padStart(3)} WR=${(wins/Math.max(1,wins+losses)*100).toFixed(1).padStart(5)}% PF=${pf.toFixed(2).padStart(5)} sumR=${sumR.toFixed(2).padStart(7)}${note}`);
  }

  console.log('\n=== DECISION STATS ===');
  for (const p of LIVE_PAIRS) {
    const s = r.decisionStats[p.symbol];
    if (s && s.candidates > 0) console.log(`  ${p.symbol.padEnd(10)} candidates=${s.candidates} opened=${s.opened} blocked=${s.blocked}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

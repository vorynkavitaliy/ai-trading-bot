/**
 * portfolio-btc-sol — what does ADDING SOL to a BTC-only book give? A/B over 1 year:
 *   BTC-only (cap 1)  vs  BTC + SOL (cap 2), both at the same risk%, winning standalone
 *   configs, single entry, NO flatten (raw combined-risk picture). BTC & SOL are
 *   correlated (SOL follows BTC) → the question is whether their daily-DD stacks past
 *   the Hyro −5% / −10% limits.
 * Run: npx tsx src/backtest/cli/portfolio-btc-sol.ts [risk=1.25] [days=365]
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade } from '../../strategies/cg-fade';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const RISK = parseFloat(process.argv[2] ?? '1.25');
const DAYS = parseFloat(process.argv[3] ?? '365');
const startEquity = 200_000;
const fixedRiskUsd = startEquity * (RISK / 100);

const BTC = lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK });
const SOL = fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK });

function stats(trades: ClosedTrade[]) {
  let eq = startEquity, peak = eq, maxDD = 0, wins = 0, losses = 0, sumR = 0;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    eq += t.pnlR * fixedRiskUsd; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    sumR += t.pnlR; if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const tot = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  return { n: trades.length, wr: tot ? wins / tot * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, sumR, maxDD, ret: sumR * RISK };
}

async function run(mode: 'btc' | 'btcsol') {
  const pairs: PortfolioSymbolStrategy[] = mode === 'btc'
    ? [{ symbol: 'BTCUSDT', strategy: BTC, priority: 0 }]
    : [{ symbol: 'BTCUSDT', strategy: BTC, priority: 0 }, { symbol: 'SOLUSDT', strategy: SOL, priority: 1 }];
  const endTs = Date.now(), startTs = endTs - DAYS * 24 * 3600_000;
  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(pairs, {
    startEquity, slippagePct: 0.25, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs,
    maxParallelCap: mode === 'btc' ? 1 : 2, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: undefined,
  });
  return { r, s: stats(r.trades) };
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;

  console.log(`\n══ A/B: BTC-only vs BTC+SOL — 1 год (${DAYS}d), риск ${RISK}%, NO flatten, старт $${startEquity.toLocaleString()} ══\n`);
  const btc = await run('btc');
  const both = await run('btcsol');

  const line = (s: any, dd: any) => `доход ${(s.ret >= 0 ? '+' : '') + s.ret.toFixed(1)}%  PF ${s.pf.toFixed(2)}  MaxDD ${s.maxDD.toFixed(1)}%  худ.день ${dd.worstDailyDdPct}%  Hyro−5% ${dd.daysBreach5}/${dd.balDaysBreach5}  n=${s.n}`;
  console.log(`BTC-only   │ ${line(btc.s, btc.r.dailyDd)}  → ${btc.r.dailyDd.daysBreach5 === 0 && btc.s.maxDD < 10 ? 'ВЫЖИВАЕТ' : 'ПРОБОЙ'}`);
  console.log(`BTC+SOL    │ ${line(both.s, both.r.dailyDd)}  → ${both.r.dailyDd.daysBreach5 === 0 && both.s.maxDD < 10 ? 'ВЫЖИВАЕТ' : 'ПРОБОЙ'}`);
  console.log(`Δ (доход)  │ ${(both.s.ret - btc.s.ret >= 0 ? '+' : '') + (both.s.ret - btc.s.ret).toFixed(1)}pp   Δ MaxDD ${(both.s.maxDD - btc.s.maxDD >= 0 ? '+' : '') + (both.s.maxDD - btc.s.maxDD).toFixed(1)}pp`);

  console.log(`\n=== BTC+SOL: вклад по парам ===`);
  for (const sym of ['BTCUSDT', 'SOLUSDT']) {
    const t = both.r.trades.filter(x => x.symbol === sym);
    const s = stats(t);
    console.log(`  ${sym.padEnd(9)} n=${String(s.n).padStart(3)} WR=${s.wr.toFixed(0)}% PF=${s.pf.toFixed(2)} доход +${s.ret.toFixed(1)}%`);
  }
  // combined long/short
  const side = (sd: string) => { const t = both.r.trades.filter(x => String((x as any).side) === sd); return stats(t); };
  const L = side('long'), S = side('short');
  console.log(`\n=== BTC+SOL: лонг/шорт ===`);
  console.log(`  long  n=${L.n} WR=${L.wr.toFixed(0)}% доход +${L.ret.toFixed(1)}%`);
  console.log(`  short n=${S.n} WR=${S.wr.toFixed(0)}% доход +${S.ret.toFixed(1)}%`);

  console.log(`\n  (worstDay/Hyro считаны без flatten — это сырой совместный риск; live flatten −4.3% срежет хвост)`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

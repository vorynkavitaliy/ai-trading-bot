/**
 * portfolio-btc-eth-test — A/B: does adding BTC (ls_top_position fade, baseline single
 * entry) + ETH (funding fade, baseline single entry) to the live 8-pair book HELP the
 * portfolio, or just dilute it under cap-6? Both candidates use NO scaled-in DCA (the
 * sweep showed DCA destroys low-vol BTC/ETH). Runs 8-pair vs 10-pair on both OOS halves
 * under L2 (DECISION_CADENCE=240m), live risk config (cap6, flatten −4.3, cooldown-commit,
 * entrycap3). Prints a comparison + per-pair contribution.
 *
 * Run (background, ~35min): npx tsx src/backtest/cli/portfolio-btc-eth-test.ts
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const COMMON = {
  startEquity: 668_000,
  slippagePct: 0.25,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  riskPctBase: LIVE_RISK_PCT,
  cronRealistic: true,
};

// Candidates — baseline (NO scaledIn), winning archetype per the sweep:
//   BTC → ls_top_position fade (BTC trend); ETH → funding fade.
const BTC = lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK_PCT });
const ETH = fundingFade({ riskPct: LIVE_RISK_PCT });

interface M { n: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number }
function metrics(trades: ClosedTrade[], startEquity: number, riskPct: number): M {
  const fixedRiskUsd = startEquity * (riskPct / 100);
  let equity = startEquity, peak = equity, maxDD = 0, wins = 0, losses = 0, sumR = 0;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = t.pnlR * fixedRiskUsd; equity += pnl;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100; if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR; if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  return { n: trades.length, wr: total ? wins / total * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, sumR, maxDD, ret: (equity - startEquity) / startEquity * 100 };
}

async function run(mode: 'base' | 'add', days: number, skipDays: number) {
  const base: PortfolioSymbolStrategy[] = TIER1_PORTFOLIO.filter(c => c.enabled).map((c, i) => ({ symbol: c.pair, strategy: c.strategy, priority: i }));
  const pairs: PortfolioSymbolStrategy[] = mode === 'base' ? base
    : [...base, { symbol: 'BTCUSDT', strategy: BTC, priority: 8 }, { symbol: 'ETHUSDT', strategy: ETH, priority: 9 }];
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - days * 24 * 3600_000;
  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(pairs, {
    ...COMMON, startTs, endTs,
    maxParallelCap: 6, maxEntriesPerWindow: 3, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: -4.3,
  });
  return { m: metrics(r.trades, COMMON.startEquity, LIVE_RISK_PCT), trades: r.trades, dd: r.dailyDd };
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const DAYS = 170;

  console.log('\n══ A/B: 8-pair vs 10-pair (+BTC ls_pos base, +ETH funding base) — L2, cap6, flatten ══\n');
  const out: Record<string, { base: any; add: any }> = {};
  for (const [label, skip] of [['recent', 0], ['older', DAYS]] as [string, number][]) {
    const base = await run('base', DAYS, skip);
    const add = await run('add', DAYS, skip);
    out[label] = { base, add };
  }

  const line = (m: M) => `ret ${m.ret.toFixed(2).padStart(6)}%  PF ${m.pf.toFixed(2)}  sumR ${m.sumR.toFixed(1).padStart(6)}  MaxDD ${m.maxDD.toFixed(2)}%  n=${m.n}`;
  console.log('half     │ config  │ result');
  console.log('─'.repeat(90));
  for (const half of ['recent', 'older']) {
    const b = out[half].base.m, a = out[half].add.m;
    const bBreach = out[half].base.dd.daysBreach5, aBreach = out[half].add.dd.daysBreach5;
    console.log(`${half.padEnd(8)} │ 8-pair  │ ${line(b)}  Hyro−5%=${bBreach}`);
    console.log(`${''.padEnd(8)} │ 10-pair │ ${line(a)}  Hyro−5%=${aBreach}`);
    console.log(`${''.padEnd(8)} │ Δ       │ ret ${(a.ret - b.ret >= 0 ? '+' : '') + (a.ret - b.ret).toFixed(2)}pp  PF ${(a.pf - b.pf >= 0 ? '+' : '') + (a.pf - b.pf).toFixed(2)}  MaxDD ${(a.maxDD - b.maxDD >= 0 ? '+' : '') + (a.maxDD - b.maxDD).toFixed(2)}pp`);
    console.log('─'.repeat(90));
  }

  // BTC/ETH per-pair contribution in the 10-pair book
  console.log('\n=== BTC/ETH contribution inside the 10-pair book ===');
  for (const half of ['recent', 'older']) {
    for (const sym of ['BTCUSDT', 'ETHUSDT']) {
      const t = (out[half].add.trades as ClosedTrade[]).filter(x => x.symbol === sym);
      const m = metrics(t, COMMON.startEquity, LIVE_RISK_PCT);
      console.log(`  ${half.padEnd(7)} ${sym.padEnd(8)} n=${String(m.n).padStart(3)} WR=${m.wr.toFixed(0)}% PF=${m.pf.toFixed(2)} sumR=${m.sumR.toFixed(1)}`);
    }
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * btc-risk-sweep — how high can risk% go on a STANDALONE BTC account before it breaches
 * the HyroTrader limits (−5% daily trailing, −10% total)? Runs the winning BTC strategy
 * (ls_top_position fade, SL 2.0×ATR, single entry) as a single-pair book at escalating
 * risk levels and reports the actual Hyro daily-DD breach counts (NOT a linear guess).
 * No flatten — we want the RAW risk picture of a pure-BTC account.
 *
 * Run (background ~12min): npx tsx src/backtest/cli/btc-risk-sweep.ts
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade } from '../../strategies/cg-fade';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const RISKS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0];
const COMMON = {
  startEquity: 200_000,        // a single 200k Hyro bucket (BTC-only account)
  slippagePct: 0.25, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
  cronRealistic: true,
};

function maxDDpct(trades: ClosedTrade[], startEquity: number, riskPct: number): number {
  const fixedRiskUsd = startEquity * (riskPct / 100);
  let eq = startEquity, peak = eq, dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    eq += t.pnlR * fixedRiskUsd; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > dd) dd = d;
  }
  return dd;
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = 340, endTs = Date.now(), startTs = endTs - days * 24 * 3600_000;

  console.log(`\n══ BTC-ONLY RISK SWEEP — winning strat (ls_pos .85/.15 btcTrend, SL 2.0×ATR, 1 entry), ${days}d, NO flatten ══`);
  console.log(`Hyro: −5% daily trailing = account terminated; −10% total = terminated.\n`);
  console.log('risk%/trade │ return%(fixed) │ MaxDD%(equity) │ worstDay%(MTM) │ Hyro −5% days (MTM / bal) │ survives?');
  console.log('─'.repeat(110));

  for (const R of RISKS) {
    const strat = lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: R });
    const pairs: PortfolioSymbolStrategy[] = [{ symbol: 'BTCUSDT', strategy: strat, priority: 0 }];
    resetCgFadeCooldownState();
    const r = await runPortfolioBacktest(pairs, {
      ...COMMON, startTs, endTs,
      maxParallelCap: 1, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
      cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: undefined,
    });
    const sumR = r.trades.reduce((s, t) => s + t.pnlR, 0);
    const ret = sumR * R;                       // fixed-base return % (live-faithful)
    const dd = maxDDpct(r.trades, COMMON.startEquity, R);
    const d = r.dailyDd;
    const survives = d.daysBreach5 === 0 && dd < 10 ? 'YES' : (d.daysBreach5 > 0 ? `NO (−5% ${d.daysBreach5}d)` : 'NO (>−10% total)');
    console.log(
      `   ${R.toFixed(1).padStart(4)}%    │ ${(ret >= 0 ? '+' : '') + ret.toFixed(1).padStart(6)}        │ ${dd.toFixed(1).padStart(6)}         │ ${d.worstDailyDdPct.toFixed(2).padStart(7)}        │ ${String(d.daysBreach5).padStart(3)} / ${String(d.balDaysBreach5).padStart(3)}                  │ ${survives}`,
    );
  }
  console.log(`\nworstDay%(MTM) scales with risk; −5% daily breach (MTM, floating included) = the binding Hyro limit.`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

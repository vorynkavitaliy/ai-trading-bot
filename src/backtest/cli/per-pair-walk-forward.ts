/**
 * per-pair-walk-forward — isolate each TIER1 pair's intrinsic edge under L2
 * (DECISION_CADENCE=240m, the 4H-cadence config we just validated). Each pair runs
 * ALONE (single-symbol portfolio, no cap / flatten / entry-cap overlays = pure pair
 * edge) on two contiguous halves:
 *   IS  = older  170d (SKIP=170)   ← train
 *   OOS = recent 170d (SKIP=0)     ← test
 * Uses each pair's ASSIGNED live strategy (no archetype re-selection = no overfit-
 * selection trap). Prints an IS→OOS table so we can decide keep / drop / re-add.
 * Includes ETH+HYPE (currently disabled) to re-confirm they stay out under L2.
 *
 * Run (background, ~20min): npx tsx src/backtest/cli/per-pair-walk-forward.ts
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const FAMILY: Record<string, string> = {
  SOLUSDT: 'S4', INJUSDT: 'S2', ATOMUSDT: 'S3', ARBUSDT: 'S3', XRPUSDT: 'S4',
  LTCUSDT: 'S2', HYPEUSDT: 'S4', ETHUSDT: 'S1', BNBUSDT: 'S3', TAOUSDT: 'S1',
};

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

interface M { n: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number; avgR: number }

function metrics(trades: ClosedTrade[], startEquity: number, riskPct: number): M {
  const fixedRiskUsd = startEquity * (riskPct / 100);
  let equity = startEquity, peak = equity, maxDD = 0, wins = 0, losses = 0, sumR = 0;
  const sorted = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  for (const t of sorted) {
    const pnl = t.pnlR * fixedRiskUsd;
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const pf = lossR > 0 ? winR / lossR : (winR > 0 ? 99 : 0);
  const ret = (equity - startEquity) / startEquity * 100;
  return { n: trades.length, wr: total ? wins / total * 100 : 0, pf, sumR, maxDD, ret, avgR: trades.length ? sumR / trades.length : 0 };
}

async function runOne(pair: string, strategy: any, days: number, skipDays: number): Promise<M> {
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - days * 24 * 3600_000;
  resetCgFadeCooldownState();
  const symbolStrats: PortfolioSymbolStrategy[] = [{ symbol: pair, strategy, priority: 0 }];
  const r = await runPortfolioBacktest(symbolStrats, {
    ...COMMON, startTs, endTs,
    maxParallelCap: 99,            // single pair → cap never binds (pure edge)
    maxEntriesPerWindow: 999,      // no entry-cap throttle
    entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true,        // keep — it's a strategy mechanic
    intradayDdGuardPct: undefined,
    dailyDdFlattenPct: undefined,  // no book-level flatten → raw pair edge
  });
  return metrics(r.trades, COMMON.startEquity, LIVE_RISK_PCT);
}

async function main() {
  // L2: decide on the 4H bar close (no hourly re-decision).
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;

  const DAYS = 170;
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('  PER-PAIR WALK-FORWARD on L2 (DECISION_CADENCE=240m) — isolated, pure pair edge');
  console.log(`  IS = older ${DAYS}d (SKIP=${DAYS}) · OOS = recent ${DAYS}d (SKIP=0) · risk ${LIVE_RISK_PCT}%/slot · slip 0.25%`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('pair        fam  en │ IS:  n   WR    PF    sumR   ret%  maxDD │ OOS: n   WR    PF    sumR   ret%  maxDD │ verdict');
  console.log('─'.repeat(120));

  const results: Array<{ pair: string; fam: string; en: boolean; is: M; oos: M }> = [];
  for (const cfg of TIER1_PORTFOLIO) {
    const fam = FAMILY[cfg.pair] ?? '?';
    const is = await runOne(cfg.pair, cfg.strategy, DAYS, DAYS);
    const oos = await runOne(cfg.pair, cfg.strategy, DAYS, 0);
    results.push({ pair: cfg.pair, fam, en: cfg.enabled, is, oos });
    const bothPos = is.sumR > 0 && oos.sumR > 0;
    const oosStrong = oos.sumR > 0 && oos.pf >= 1.4;
    const verdict = bothPos ? (oosStrong ? 'KEEP (both+, OOS PF≥1.4)' : 'both+ (OOS weak)') :
      (oos.sumR > 0 ? 'OOS+ only' : is.sumR > 0 ? 'IS+ only (degraded)' : 'DROP (both−)');
    const fmt = (m: M) => `${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${m.pf.toFixed(2).padStart(5)} ${m.sumR.toFixed(1).padStart(6)} ${m.ret.toFixed(1).padStart(5)} ${m.maxDD.toFixed(1).padStart(5)}`;
    console.log(`  ${cfg.pair.padEnd(9)} ${fam.padEnd(3)} ${cfg.enabled ? 'Y' : 'n'} │ ${fmt(is)} │ ${fmt(oos)} │ ${verdict}`);
  }

  // Sorted summary by OOS sumR
  console.log('\n=== RANKED by OOS sumR ===');
  for (const r of [...results].sort((a, b) => b.oos.sumR - a.oos.sumR)) {
    console.log(`  ${r.pair.padEnd(9)} ${r.fam}  en=${r.en ? 'Y' : 'n'}  OOS sumR ${r.oos.sumR.toFixed(1).padStart(6)} (PF ${r.oos.pf.toFixed(2)}, avgR ${r.oos.avgR.toFixed(2)})  | IS sumR ${r.is.sumR.toFixed(1).padStart(6)} (PF ${r.is.pf.toFixed(2)})`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

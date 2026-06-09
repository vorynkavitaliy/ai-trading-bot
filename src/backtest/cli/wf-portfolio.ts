/**
 * wf-portfolio — HONEST walk-forward for the BTC+SOL+ADA portfolio. For each pair, run a
 * variant set on the TRAIN half (older 170d) ONLY, auto-pick the best by TRAIN sumR
 * (PF≥1.3 gate), then build the portfolio with those picks and validate on the TEST half
 * (recent 170d) — which the selection NEVER saw. This removes the in-sample selection bias
 * (configs were previously chosen on the full window). Pure OOS portfolio result.
 *
 * Run: npx tsx src/backtest/cli/wf-portfolio.ts [testRisk=1.0] [days=170] PAIR...
 */
import { runBacktest } from '../engine';
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SLIP = parseFloat(process.env.SLIP ?? '0.25');
const SINGLE = {
  ...BACKTEST_COMMON, startEquity: 668_000, slippagePct: SLIP, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10, cronRealistic: true,
};

// Variant set spanning the families (each a builder of risk). Selection is risk-invariant
// (sumR/PF), so we build at 0.5 for selection.
const VARIANTS: { label: string; build: (r: number) => Strategy }[] = [
  { label: 'lspos.85/.15 btcTr sl1.5', build: r => lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: r }) },
  { label: 'lspos.85/.15 btcTr sl2.0', build: r => lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: r }) },
  { label: 'funding.70/.30 sl1.5', build: r => fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: r }) },
  { label: 'funding.70/.30 sl2.0', build: r => fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: r }) },
  { label: 'funding.75/.25 sl1.5', build: r => fundingFade({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: r }) },
  { label: 'funding.80/.20 sl1.5', build: r => fundingFade({ pctHi: .80, pctLo: .20, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: r }) },
  { label: 'S4 F+TopAcct.70/.30 sl1.5', build: r => fundingTaConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: r }) },
];

function pnlStats(t: ClosedTrade[], risk: number, startEq: number) {
  let eq = startEq, peak = eq, maxDD = 0, w = 0, l = 0, sumR = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    eq += x.pnlR * (risk / 100 * startEq); if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    sumR += x.pnlR; if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
  }
  const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, sumR, maxDD, ret: sumR * risk };
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const testRisk = parseFloat(process.argv[2] ?? '1.0');
  const days = parseFloat(process.argv[3] ?? '170');
  const SELECT = (process.env.SELECT ?? 'sumr').toLowerCase(); // 'sumr' | 'pf'
  const REVERSE = process.env.REVERSE === '1'; // train recent, test older
  const pairs = process.argv.slice(4).map(s => s.toUpperCase());
  if (!pairs.length) { console.error('usage: wf-portfolio.ts <testRisk> <days> PAIR...'); process.exit(1); }

  const now = Date.now();
  const D = days * 24 * 3600_000;
  const olderStart = now - 2 * D, olderEnd = now - D, recentStart = now - D, recentEnd = now;
  const [trainStart, trainEnd, testStart, testEnd] = REVERSE
    ? [recentStart, recentEnd, olderStart, olderEnd]   // train RECENT, test OLDER
    : [olderStart, olderEnd, recentStart, recentEnd];  // train OLDER, test RECENT

  console.log(`\n══ WALK-FORWARD: select on TRAIN (older ${days}d), validate on TEST (recent ${days}d) ══`);
  console.log(`TRAIN ${new Date(trainStart).toISOString().slice(0, 10)}→${new Date(trainEnd).toISOString().slice(0, 10)} · TEST ${new Date(testStart).toISOString().slice(0, 10)}→${new Date(testEnd).toISOString().slice(0, 10)}\n`);

  // 1) Select best config per pair on TRAIN only
  const picks: { pair: string; label: string; build: (r: number) => Strategy; trainSumR: number; trainPf: number }[] = [];
  for (const pair of pairs) {
    let best: any = null;
    console.log(`${pair} — TRAIN scan:`);
    for (const v of VARIANTS) {
      resetCgFadeCooldownState();
      const r = await runBacktest(v.build(0.5), { symbol: pair, startTs: trainStart, endTs: trainEnd, ...SINGLE });
      const m = r.metrics;
      console.log(`    ${v.label.padEnd(28)} train sumR ${m.totalR.toFixed(1).padStart(6)}  PF ${m.profitFactor.toFixed(2)}`);
      const passGate = m.totalR > 0 && m.profitFactor >= 1.3;
      const better = SELECT === 'pf' ? (!best || m.profitFactor > best.trainPf) : (!best || m.totalR > best.trainSumR);
      if (passGate && better) best = { pair, label: v.label, build: v.build, trainSumR: m.totalR, trainPf: m.profitFactor };
    }
    if (!best) { console.log(`    → no config cleared TRAIN gate (PF≥1.3) → pair DROPPED OOS`); continue; }
    console.log(`    → PICKED: ${best.label} (train sumR ${best.trainSumR.toFixed(1)}, PF ${best.trainPf.toFixed(2)})`);
    picks.push(best);
  }

  if (!picks.length) { console.log('\nNo pairs survived TRAIN selection.'); await closePg(); return; }

  // 2) Validate the picked portfolio on TEST (pure OOS)
  const strats: PortfolioSymbolStrategy[] = picks.map((p, i) => ({ symbol: p.pair, strategy: p.build(testRisk), priority: i }));
  resetCgFadeCooldownState();
  const tr = await runPortfolioBacktest(strats, {
    startEquity: 200_000, slippagePct: SLIP, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs: testStart, endTs: testEnd,
    maxParallelCap: picks.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: undefined,
  });
  const S = pnlStats(tr.trades, testRisk, 200_000);
  const dd = tr.dailyDd;
  console.log(`\n══ OOS TEST RESULT (configs chosen on TRAIN, never saw TEST) — risk ${testRisk}% ══`);
  console.log(`  доход ${(S.ret >= 0 ? '+' : '') + S.ret.toFixed(1)}% (за ${days}d) · PF ${S.pf.toFixed(2)} · WR ${S.wr.toFixed(0)}% · n=${S.n}`);
  console.log(`  MaxDD ${S.maxDD.toFixed(1)}% · худ.день ${dd.worstDailyDdPct}% · Hyro−5% ${dd.daysBreach5}/${dd.balDaysBreach5} → ${dd.daysBreach5 === 0 && S.maxDD < 10 ? 'ВЫЖИВАЕТ ✅' : 'ПРОБОЙ ❌'}`);
  for (const p of picks) { const s = pnlStats(tr.trades.filter(x => x.symbol === p.pair), testRisk, 200_000); console.log(`    ${p.pair.padEnd(9)} [${p.label}] n=${s.n} PF=${s.pf.toFixed(2)} доход +${s.ret.toFixed(1)}%`); }
  // Two-sided robustness: long AND short both positive OOS = real signal edge (not a directional regime bet).
  const sd = (x: string) => pnlStats(tr.trades.filter(t => String((t as any).side) === x), testRisk, 200_000);
  const L = sd('long'), Sh = sd('short');
  console.log(`  ДВУСТОРОННОСТЬ: лонг n=${L.n} PF=${L.pf.toFixed(2)} доход ${(L.ret >= 0 ? '+' : '') + L.ret.toFixed(1)}% · шорт n=${Sh.n} PF=${Sh.pf.toFixed(2)} доход ${(Sh.ret >= 0 ? '+' : '') + Sh.ret.toFixed(1)}% → ${L.ret > 0 && Sh.ret > 0 ? 'ДВУСТОРОННИЙ ✅' : 'ОДНОСТОРОННИЙ ⚠️'}`);
  console.log(`\n  (annualized ≈ доход × ${(365 / days).toFixed(1)})`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

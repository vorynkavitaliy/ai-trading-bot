/**
 * slip-sweep — slippage-sensitivity map for the LIVE deployed portfolio
 * (BTC ls_pos .85/.15 r1.25 + SOL funding .70/.30 r0.875 + ADA funding .75/.25 r0.875,
 *  all SINGLE-ENTRY MARKET, mixed risk — EXACT live config from pair-strategies.ts).
 *
 * The config is FIXED (deployed) — this is NOT a re-selection. We hold the strategy
 * constant and sweep slippagePct to find where the edge degrades / dies (breakeven slip).
 * That answers the live risk question: "at what execution cost does our book stop working?"
 *
 * Market entries → engine applies applySlippage(entry) + taker fee, so slip bites the fill.
 * Run over the full window (max trades, max stat power) and also the recent half (sanity).
 *
 * Run: npx tsx src/backtest/cli/slip-sweep.ts [days=340]
 *   SLIPS env overrides the swept levels, e.g. SLIPS=0,0.05,0.1,0.2
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const LIVE_RISK = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875 } as const;

function liveCfg(): { symbol: string; strategy: Strategy }[] {
  return [
    { symbol: 'BTCUSDT', strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK.BTCUSDT }) },
    { symbol: 'SOLUSDT', strategy: fundingFade({ pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK.SOLUSDT }) },
    { symbol: 'ADAUSDT', strategy: fundingFade({ pctHi: 0.75, pctLo: 0.25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK.ADAUSDT }) },
  ];
}

const START_EQ = 200_000;
const riskOf = (sym: string) => (LIVE_RISK as Record<string, number>)[sym] ?? 0.875;

function stats(t: ClosedTrade[]) {
  let eq = START_EQ, peak = eq, maxDD = 0, w = 0, l = 0, sumR = 0, usd = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = x.pnlR * (riskOf(x.symbol) / 100 * START_EQ);
    eq += pnl; usd += pnl; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    sumR += x.pnlR; if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
  }
  const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, sumR, maxDD, ret: usd / START_EQ * 100, usd };
}

async function runAt(slip: number, startTs: number, endTs: number) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = liveCfg().map((c, i) => ({ symbol: c.symbol, strategy: c.strategy, priority: i }));
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: slip, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs,
    maxParallelCap: 3, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: undefined,
  });
  return { S: stats(r.trades), dd: r.dailyDd, trades: r.trades };
}

async function sweep(label: string, startTs: number, endTs: number, slips: number[], days: number) {
  console.log(`\n══ SLIP-SWEEP — ${label} (${days}d) · live config, MARKET, mixed risk (BTC 1.25 / SOL 0.875 / ADA 0.875) ══`);
  console.log(`  slip%   доход%     PF    WR%   n    MaxDD%  худ.день  Hyro    verdict`);
  const rows: { slip: number; ret: number; pf: number }[] = [];
  let liveCell: Awaited<ReturnType<typeof runAt>> | null = null;
  for (const slip of slips) {
    const { S, dd, trades } = await runAt(slip, startTs, endTs);
    const surv = dd.daysBreach5 === 0 && S.maxDD < 10;
    const ann = S.ret * (365 / days);
    console.log(`  ${slip.toFixed(2).padStart(5)}  ${((S.ret >= 0 ? '+' : '') + S.ret.toFixed(1)).padStart(7)} (${(ann >= 0 ? '+' : '') + ann.toFixed(0)}%/г) ${S.pf.toFixed(2).padStart(5)}  ${S.wr.toFixed(0).padStart(3)}  ${String(S.n).padStart(3)}  ${S.maxDD.toFixed(1).padStart(5)}   ${String(dd.worstDailyDdPct).padStart(6)}  ${dd.daysBreach5}/${dd.balDaysBreach5}   ${surv ? 'ВЫЖИВАЕТ ✅' : 'ПРОБОЙ ❌'}`);
    rows.push({ slip, ret: S.ret, pf: S.pf });
    if (Math.abs(slip - 0.05) < 1e-9) liveCell = { S, dd, trades };
  }
  // Breakeven slip: linear-interpolate where return crosses 0.
  let be: number | null = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].ret > 0 && rows[i].ret <= 0) {
      const a = rows[i - 1], b = rows[i];
      be = a.slip + (b.slip - a.slip) * (a.ret / (a.ret - b.ret));
      break;
    }
  }
  if (be != null) console.log(`  → breakeven slip ≈ ${be.toFixed(3)}% (доход→0 между ${rows.find(r => r.ret > 0 && rows.indexOf(r) < rows.length - 1)?.slip}…)`);
  else if (rows[rows.length - 1].ret > 0) console.log(`  → доход > 0 на ВСЕХ протестированных уровнях слипа (до ${rows[rows.length - 1].slip}%) — breakeven выше диапазона`);
  if (liveCell) {
    console.log(`\n  при live-слипе 0.05% — вклад по парам:`);
    for (const sym of ['BTCUSDT', 'SOLUSDT', 'ADAUSDT']) {
      const s = stats(liveCell.trades.filter(x => x.symbol === sym));
      console.log(`    ${sym.padEnd(9)} n=${String(s.n).padStart(3)} WR=${s.wr.toFixed(0)}% PF=${s.pf.toFixed(2)} доход ${(s.ret >= 0 ? '+' : '') + s.ret.toFixed(1)}%`);
    }
  }
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const slips = (process.env.SLIPS ?? '0,0.02,0.05,0.10,0.15,0.25,0.40').split(',').map(s => parseFloat(s.trim()));
  const now = Date.now();
  const fullStart = now - days * 24 * 3600_000;
  const recentStart = now - Math.round(days / 2) * 24 * 3600_000;

  await sweep('ПОЛНОЕ ОКНО', fullStart, now, slips, days);
  await sweep('ТОЛЬКО RECENT (свежая половина)', recentStart, now, slips, Math.round(days / 2));

  console.log(`\n  Реальный market-слип для BTC/SOL/ADA ≈ 0.02–0.05%. Сравни с breakeven выше.`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

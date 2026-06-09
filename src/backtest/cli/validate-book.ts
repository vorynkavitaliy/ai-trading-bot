/**
 * validate-book — full pre-deploy battery for the candidate 4-pair live book
 * (BTC ls_pos r1.25 + SOL funding r0.875 + ADA funding r0.875 + LINK S4 confluence
 *  r=CAND_RISK). Compares against the current 3-pair base, all live-realistic
 *  (flatten armed, market entries). One process → exact numbers for the deploy table.
 *
 * Sections:
 *   1) by period (year / old half / recent half), flatten ON, slip 0.05 — base vs 4-pair
 *   2) slip sensitivity of the 4-pair book (full year, flatten ON)
 *   3) flatten ON vs OFF (4-pair, full year, slip 0.05) — honest flatten-interaction
 *   4) per-pair contribution + long/short (4-pair, full year, flatten ON, slip 0.05)
 *
 * Run: CAND_RISK=0.6 npx tsx src/backtest/cli/validate-book.ts [days=340]
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const CAND_RISK = parseFloat(process.env.CAND_RISK ?? '0.6');
const START_EQ = 200_000;
const RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: CAND_RISK };
const riskOf = (s: string) => RISK[s] ?? CAND_RISK;
const BASE = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT'];
const BOOK = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];

function cfg(pair: string, risk: number): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'LINKUSDT': return fundingTaConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    default: throw new Error(`no cfg ${pair}`);
  }
}

function stats(t: ClosedTrade[]) {
  let eq = START_EQ, peak = eq, maxDD = 0, w = 0, l = 0, usd = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = x.pnlR * (riskOf(x.symbol) / 100 * START_EQ);
    eq += pnl; usd += pnl; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
  }
  const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, maxDD, ret: usd / START_EQ * 100 };
}

async function run(pairs: string[], startTs: number, endTs: number, slip: number, flat: number | undefined) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = pairs.map((p, i) => ({ symbol: p, strategy: cfg(p, riskOf(p)), priority: i }));
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: slip, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: pairs.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: flat,
  });
  return { S: stats(r.trades), dd: r.dailyDd, trades: r.trades };
}

const fmtRow = (label: string, S: { ret: number; pf: number; maxDD: number; n: number }, dd: any, days: number) => {
  const ann = (S.ret * 365 / days);
  const surv = dd.daysBreach5 === 0 && dd.balDaysBreach5 === 0;
  return `  ${label.padEnd(22)} ${((S.ret >= 0 ? '+' : '') + S.ret.toFixed(1) + '%').padStart(7)} (${(ann >= 0 ? '+' : '') + ann.toFixed(0)}%/г) · PF ${S.pf.toFixed(2)} · MaxDD ${S.maxDD.toFixed(1).padStart(4)}% · худ.день ${String(dd.worstDailyDdPct).padStart(5)}% · Hyro ${dd.daysBreach5}/${dd.balDaysBreach5} ${surv ? '✅' : '❌'} · n=${S.n}`;
};

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const now = Date.now(), D = days * 24 * 3600_000, half = Math.round(days / 2);
  console.log(`\n████ ВАЛИДАЦИЯ 4-ПАРНОЙ КНИГИ — BTC(1.25)+SOL(0.875)+ADA(0.875)+LINK(${CAND_RISK}) ████`);
  console.log(`(LINK = S4 fundingTaConfluence .70/.30 SL1.5; market-входы; live-условия)`);

  console.log(`\n── 1) ПО ПЕРИОДАМ (flatten ВКЛ 4.3% · slip 0.05%) ──`);
  for (const [lbl, s, e, d] of [['ГОД', now - D, now, days], ['СТАРАЯ половина', now - D, now - D / 2, half], ['СВЕЖАЯ половина', now - D / 2, now, half]] as [string, number, number, number][]) {
    const b = await run(BASE, s, e, 0.05, 4.3), bk = await run(BOOK, s, e, 0.05, 4.3);
    console.log(`  [${lbl}]`);
    console.log(fmtRow('  база (3 пары)', b.S, b.dd, d));
    console.log(fmtRow('  +LINK (4 пары)', bk.S, bk.dd, d));
  }

  console.log(`\n── 2) ЧУВСТВИТЕЛЬНОСТЬ К СЛИПУ (4 пары · год · flatten ВКЛ) ──`);
  for (const slip of [0.02, 0.05, 0.10, 0.15, 0.25]) {
    const bk = await run(BOOK, now - D, now, slip, 4.3);
    console.log(fmtRow(`  slip ${slip.toFixed(2)}%`, bk.S, bk.dd, days));
  }

  console.log(`\n── 3) FLATTEN ВКЛ vs ВЫКЛ (4 пары · год · slip 0.05) ──`);
  const fon = await run(BOOK, now - D, now, 0.05, 4.3), foff = await run(BOOK, now - D, now, 0.05, undefined);
  console.log(fmtRow('  flatten ВКЛ', fon.S, fon.dd, days));
  console.log(fmtRow('  flatten ВЫКЛ', foff.S, foff.dd, days));

  console.log(`\n── 4) ВКЛАД ПО ПАРАМ (4 пары · год · flatten ВКЛ · slip 0.05) ──`);
  const full = await run(BOOK, now - D, now, 0.05, 4.3);
  for (const p of BOOK) {
    const s = stats(full.trades.filter(x => x.symbol === p));
    const sd = (x: string) => stats(full.trades.filter(t => String((t as any).side) === x && t.symbol === p));
    console.log(`  ${p.padEnd(9)} n=${String(s.n).padStart(3)} · PF ${s.pf.toFixed(2)} · доход ${(s.ret >= 0 ? '+' : '') + s.ret.toFixed(1)}% (лонг ${(sd('long').ret >= 0 ? '+' : '') + sd('long').ret.toFixed(1)}% / шорт ${(sd('short').ret >= 0 ? '+' : '') + sd('short').ret.toFixed(1)}%)`);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

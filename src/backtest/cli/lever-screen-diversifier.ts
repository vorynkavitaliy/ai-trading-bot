/**
 * lever-screen-diversifier — LEVER-3 decisive A/B + rolling-WF for a candidate
 * diversifier added to the LIVE 4-pair book (BTC+SOL+ADA+LINK). The binding
 * constraint is correlated drawdown, so the bar is: does the candidate LIFT return
 * AND keep MaxDD within ~1pp AND add 0 Hyro −5% breaches, robustly two-sided (long
 * AND short contribute) across a 4-window rolling walk-forward — not just a 2-half
 * aggregate (which hides opposite one-sided windows).
 *
 * It runs, per candidate:
 *   1) 4-window rolling WF on the SINGLE pair (HONEST cron-realistic, market entry,
 *      slip env) → per-window sumR + long/short split. A robust pair is positive in
 *      ≥3/4 windows with BOTH sides contributing somewhere.
 *   2) Portfolio A/B: live 4-pair book vs book+candidate (5-pair), full year + both
 *      halves, flatten 4.3 ON, slip 0.05 → Δreturn, ΔMaxDD, Hyro breach count.
 *
 * The candidate's archetype is chosen by ARCH env: S1(ls_top_pos+pairtrend),
 * S2(ls_top_pos+btctrend), S3(funding), S4(funding+ls_acc confluence), S5(funding+
 * ls_pos confluence). Default picks per the B1 signal that survived.
 *
 * Run: ARCH=S3 CAND_RISK=0.6 SLIP=0.05 npx tsx src/backtest/cli/lever-screen-diversifier.ts 340 LTCUSDT
 */
import { runBacktest } from '../engine';
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import {
  resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence,
  lsTopPositionFundingConfluence,
} from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SLIP = parseFloat(process.env.SLIP ?? '0.05');
const CAND_RISK = parseFloat(process.env.CAND_RISK ?? '0.6');
const ARCH = (process.env.ARCH ?? 'S3').toUpperCase();
const START_EQ = 200_000;
const DAY = 24 * 3600_000;

// Live book risks (single source: pair-strategies.ts).
const BASE_RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: 0.6 };
const BOOK = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];

function liveCfg(pair: string): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 1.25 });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.875 });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.875 });
    case 'LINKUSDT': return fundingTaConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.6 });
    default: throw new Error(`no live cfg for ${pair}`);
  }
}

// Candidate archetype, parameterised by ARCH. Single-entry (no scaledIn), market.
function candCfg(risk: number): Strategy {
  const base = { slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk };
  switch (ARCH) {
    case 'S1': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: true, useBtcTrend: false, ...base });
    case 'S2': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, ...base });
    case 'S3': return fundingFade({ pctHi: .70, pctLo: .30, ...base });
    case 'S4': return fundingTaConfluence({ pctHi: .70, pctLo: .30, ...base });
    case 'S5': return lsTopPositionFundingConfluence({ pctHi: .80, pctLo: .20, ...base });
    default: throw new Error(`unknown ARCH ${ARCH}`);
  }
}

function pstats(t: ClosedTrade[], riskOf: (s: string) => number) {
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

async function portRun(pairs: string[], riskOf: (s: string) => number, startTs: number, endTs: number, flat: number | undefined) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = pairs.map((p, i) => ({
    symbol: p, strategy: p === pairs[pairs.length - 1] && !BOOK.includes(p) ? candCfg(riskOf(p)) : liveCfg(p), priority: i,
  }));
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: SLIP, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: pairs.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: flat,
  });
  return { S: pstats(r.trades, riskOf), dd: r.dailyDd, trades: r.trades };
}

// Single-pair HONEST sweep of the candidate config, for the rolling WF.
const SWEEP_COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 668_000, slippagePct: SLIP, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10, cronRealistic: true,
};

async function soloWindow(pair: string, startTs: number, endTs: number) {
  resetCgFadeCooldownState();
  const r = await runBacktest(candCfg(CAND_RISK), { symbol: pair, startTs, endTs, ...SWEEP_COMMON });
  const m = r.metrics;
  const longR = r.trades.filter(t => String((t as any).side) === 'long').reduce((s, t) => s + t.pnlR, 0);
  const shortR = r.trades.filter(t => String((t as any).side) === 'short').reduce((s, t) => s + t.pnlR, 0);
  const nL = r.trades.filter(t => String((t as any).side) === 'long').length;
  const nS = r.trades.filter(t => String((t as any).side) === 'short').length;
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, longR, shortR, nL, nS };
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const cand = (process.argv[3] ?? '').toUpperCase();
  if (!cand) { console.error('usage: lever-screen-diversifier.ts <days> CANDIDATE'); process.exit(1); }
  const now = Date.now(), D = days * DAY, half = Math.round(days / 2);

  console.log(`\n████ LEVER-3 DIVERSIFIER SCREEN — ${cand} as ${ARCH} (risk ${CAND_RISK}%) · slip ${SLIP}% ████`);

  // ── 1) 4-window rolling WF on the SINGLE candidate ──
  console.log(`\n── 1) ROLLING WF (4 окна · одиночная пара ${cand} · HONEST cron-realistic) ──`);
  console.log('  окно'.padEnd(20) + 'n   WR     PF    sumR    MaxDD   long_R  short_R  (nL/nS)');
  const wins = 4, wlen = D / wins;
  let posWindows = 0, longContribWin = 0, shortContribWin = 0;
  for (let i = 0; i < wins; i++) {
    const s = now - D + i * wlen, e = s + wlen;
    const w = await soloWindow(cand, s, e);
    if (w.sumR > 0) posWindows++;
    if (w.longR > 0) longContribWin++;
    if (w.shortR > 0) shortContribWin++;
    const lbl = `W${i + 1} ${new Date(s).toISOString().slice(0, 10)}`;
    console.log(`  ${lbl.padEnd(18)} ${String(w.trades).padStart(2)}  ${w.wr.toFixed(0).padStart(3)}%  ${w.pf.toFixed(2).padStart(4)}  ${(w.sumR >= 0 ? '+' : '') + w.sumR.toFixed(1)}`.padEnd(48) + `  ${w.maxDD.toFixed(1).padStart(4)}%   ${(w.longR >= 0 ? '+' : '') + w.longR.toFixed(1)}    ${(w.shortR >= 0 ? '+' : '') + w.shortR.toFixed(1)}    (${w.nL}/${w.nS})`);
  }
  const twoSided = longContribWin >= 1 && shortContribWin >= 1;
  console.log(`  → положительных окон ${posWindows}/4 · long-плюс в ${longContribWin}/4 окон · short-плюс в ${shortContribWin}/4 · two-sided=${twoSided ? 'ДА' : 'НЕТ'}`);

  // ── 2) Portfolio A/B (book vs book+cand) ──
  console.log(`\n── 2) ПОРТФЕЛЬ A/B (книга 4 пары vs +${cand} = 5 пар · flatten 4.3 · slip ${SLIP}) ──`);
  const riskOf = (s: string) => BASE_RISK[s] ?? CAND_RISK;
  const ann = (x: number, d: number) => (x >= 0 ? '+' : '') + (x * 365 / d).toFixed(0) + '%/г';
  for (const [lbl, s, e, d] of [['ГОД', now - D, now, days], ['СТАРАЯ пол.', now - D, now - D / 2, half], ['СВЕЖАЯ пол.', now - D / 2, now, half]] as [string, number, number, number][]) {
    const b = await portRun(BOOK, riskOf, s, e, 4.3);
    const k = await portRun([...BOOK, cand], riskOf, s, e, 4.3);
    const dRet = k.S.ret - b.S.ret, dDD = k.S.maxDD - b.S.maxDD;
    const ok = dRet > 0 && dDD <= 1.0 && k.dd.daysBreach5 === 0 && k.dd.balDaysBreach5 === 0;
    console.log(`  [${lbl}]`);
    console.log(`    база 4п:  ${(b.S.ret >= 0 ? '+' : '') + b.S.ret.toFixed(1)}% (${ann(b.S.ret, d)}) PF ${b.S.pf.toFixed(2)} MaxDD ${b.S.maxDD.toFixed(1)}% Hyro ${b.dd.daysBreach5}/${b.dd.balDaysBreach5} n=${b.S.n}`);
    console.log(`    +${cand.padEnd(8)}: ${(k.S.ret >= 0 ? '+' : '') + k.S.ret.toFixed(1)}% (${ann(k.S.ret, d)}) PF ${k.S.pf.toFixed(2)} MaxDD ${k.S.maxDD.toFixed(1)}% Hyro ${k.dd.daysBreach5}/${k.dd.balDaysBreach5} n=${k.S.n}`);
    const cs = pstats(k.trades.filter(x => x.symbol === cand), riskOf);
    const sd = (x: string) => pstats(k.trades.filter(t => String((t as any).side) === x && t.symbol === cand), riskOf);
    console.log(`      Δдоход ${(dRet >= 0 ? '+' : '') + dRet.toFixed(1)}pp · ΔMaxDD ${(dDD >= 0 ? '+' : '') + dDD.toFixed(1)}pp → ${ok ? 'ДОБАВЛЯТЬ ✅' : 'НЕ ДОБАВЛЯТЬ ❌'} | ${cand}: n=${cs.n} PF=${cs.pf.toFixed(2)} (лонг ${(sd('long').ret >= 0 ? '+' : '') + sd('long').ret.toFixed(1)}% / шорт ${(sd('short').ret >= 0 ? '+' : '') + sd('short').ret.toFixed(1)}%)`);
  }

  console.log(`\n  ВЕРДИКТ ${cand} (${ARCH}): rolling ${posWindows}/4 окон · two-sided=${twoSided ? 'ДА' : 'НЕТ'}. Робастный диверсификатор ТОЛЬКО если ≥3/4 окон + two-sided + A/B ✅ на ГОД и обеих половинах.`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

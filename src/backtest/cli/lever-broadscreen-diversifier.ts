/**
 * lever-broadscreen-diversifier — B2 two-sided WF + portfolio A/B for the broader-pair lever.
 * For each B1 survivor it assigns the signal-appropriate archetype, runs:
 *   (B2) single-pair: recent/older static halves + 4-window rolling WF, long/short split,
 *        at slip 0.05 (headline) — a robust pair is two-sided AND holds across windows.
 *   (A/B) portfolio: live 4-pair book (BTC1.25 + SOL0.875 + ADA0.875 + LINK0.6) as base
 *        vs base + candidate (5-pair), full live harness (flatten 4.3, cooldownOnCommit,
 *        cap=#pairs, 1m authoritative DD, Hyro breach counts). Criterion to add: Δreturn>0,
 *        ΔMaxDD ≤ +1pp, 0 Hyro −5% breaches (the LINK bar).
 *
 * Archetype map from B1 winning signal family:
 *   ls_top_position → lsTopPositionFade (BTC-trend, like the live BTC config)
 *   funding_oi      → fundingFade (.70/.30)
 *
 * Read-only on DB. Run: npx tsx src/backtest/cli/lever-broadscreen-diversifier.ts [days=340]
 *   SLIP env (default 0.05), CAND_RISK env (default 0.6, the LINK precedent).
 */
import { runBacktest } from '../engine';
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SLIP = parseFloat(process.env.SLIP ?? '0.05');
const CAND_RISK = parseFloat(process.env.CAND_RISK ?? '0.6');
const START_EQ = 200_000;
const DAY = 24 * 3600_000;

const ARCHETYPE: Record<string, 'lspos' | 'funding'> = {
  ARBUSDT: 'lspos', TAOUSDT: 'lspos', INJUSDT: 'lspos',
  HYPEUSDT: 'funding', LTCUSDT: 'funding', XRPUSDT: 'funding', DOGEUSDT: 'funding',
};
const CANDS = ['ARBUSDT', 'TAOUSDT', 'INJUSDT', 'HYPEUSDT', 'LTCUSDT', 'XRPUSDT', 'DOGEUSDT'];

function candCfg(pair: string, risk: number): Strategy {
  const a = ARCHETYPE[pair];
  if (a === 'lspos') return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
  return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
}

const BOOK_RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: 0.6 };
function bookCfg(pair: string): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 1.25 });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.875 });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.875 });
    case 'LINKUSDT': return fundingTaConfluence({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.6 });
    default: throw new Error(`no book cfg ${pair}`);
  }
}

function bCommon(slip: number) {
  return { ...BACKTEST_COMMON, startEquity: START_EQ, slippagePct: slip, riskPctBase: 0.5, leverage: 10,
    decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10, cronRealistic: true };
}
async function single(pair: string, startTs: number, endTs: number, slip: number) {
  resetCgFadeCooldownState();
  const r = await runBacktest(candCfg(pair, 0.5), { symbol: pair, startTs, endTs, ...bCommon(slip) });
  let lr = 0, sr = 0, lt = 0, st = 0;
  for (const t of r.trades) { if (t.side === 'long') { lt++; lr += t.pnlR; } else { st++; sr += t.pnlR; } }
  const m = r.metrics;
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, lt, lr, st, sr };
}
function fmtSingle(tag: string, x: any) {
  const twoSided = x.lr > 0 && x.sr > 0 ? 'TWO-SIDED ✅' : (x.lr > 0 || x.sr > 0 ? 'one-sided' : 'NEG ❌');
  return `${tag.padEnd(20)} tr${String(x.trades).padStart(3)} WR${x.wr.toFixed(0).padStart(3)} PF${x.pf.toFixed(2)} R${x.sumR.toFixed(1).padStart(6)} DD${x.maxDD.toFixed(1).padStart(4)}% [L${x.lt}/${x.lr.toFixed(1)} S${x.st}/${x.sr.toFixed(1)}] ${twoSided}`;
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
async function port(pairs: string[], stratOf: (p: string) => Strategy, riskOf: (s: string) => number, startTs: number, endTs: number) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = pairs.map((p, i) => ({ symbol: p, strategy: stratOf(p), priority: i }));
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: SLIP, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: pairs.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: 4.3,
  });
  return { S: pstats(r.trades, riskOf), dd: r.dailyDd, trades: r.trades };
}

const BOOK = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const now = Date.now();
  const days = parseFloat(process.argv[2] ?? '340');
  const D = days * DAY;
  const W = 92;

  console.log(`████ LEVER-3 DIVERSIFIER SCREEN · slip ${SLIP}% · cand-risk ${CAND_RISK}% · ${days}d ████`);

  console.log(`\n══ B2 SINGLE-PAIR TWO-SIDED WF (slip ${SLIP}, single-entry, live-shaped) ══`);
  for (const p of CANDS) {
    console.log(`\n── ${p} [${ARCHETYPE[p] === 'lspos' ? 'lsTopPositionFade BTC-trend .85/.15 SL2.0' : 'fundingFade .70/.30 SL2.0'}] ──`);
    const recent = await single(p, now - 183 * DAY, now, SLIP);
    const older = await single(p, now - 366 * DAY, now - 183 * DAY, SLIP);
    console.log('  ' + fmtSingle('recent half', recent));
    console.log('  ' + fmtSingle('older half', older));
    let winsTwoSided = 0, winsPos = 0;
    for (let i = 4; i >= 1; i--) {
      const e = now - (i - 1) * W * DAY, s = e - W * DAY;
      const r = await single(p, s, e, SLIP);
      if (r.lr > 0 && r.sr > 0) winsTwoSided++;
      if (r.sumR > 0) winsPos++;
      console.log('  ' + fmtSingle(`win${5 - i} ${new Date(s).toISOString().slice(0, 10)}`, r));
    }
    console.log(`  → rolling WF: ${winsPos}/4 windows sumR>0, ${winsTwoSided}/4 two-sided`);
  }

  console.log(`\n\n══ A/B PORTFOLIO: live 4-pair book + candidate (5-pair) ══`);
  const riskBase = (s: string) => BOOK_RISK[s] ?? CAND_RISK;
  for (const [lbl, s, e, d] of [['FULL YEAR', now - D, now, days], ['OLDER half', now - D, now - D / 2, Math.round(days / 2)], ['RECENT half', now - D / 2, now, Math.round(days / 2)]] as [string, number, number, number][]) {
    console.log(`\n── ${lbl} (${d}d) ──`);
    const base = await port(BOOK, bookCfg, riskBase, s, e);
    const ann = (x: number) => (x >= 0 ? '+' : '') + (x * 365 / d).toFixed(0) + '%/y';
    console.log(`  BASE 4-pair (BTC+SOL+ADA+LINK): ret ${(base.S.ret >= 0 ? '+' : '') + base.S.ret.toFixed(1)}% (${ann(base.S.ret)}) PF ${base.S.pf.toFixed(2)} MaxDD ${base.S.maxDD.toFixed(1)}% worstDay ${base.dd.worstDailyDdPct}% Hyro ${base.dd.daysBreach5}/${base.dd.balDaysBreach5} n=${base.S.n}`);
    for (const c of CANDS) {
      const pairs = [...BOOK, c];
      const riskOf = (s2: string) => BOOK_RISK[s2] ?? CAND_RISK;
      const stratOf = (p: string) => (p === c ? candCfg(p, CAND_RISK) : bookCfg(p));
      const res = await port(pairs, stratOf, riskOf, s, e);
      const dRet = res.S.ret - base.S.ret, dDD = res.S.maxDD - base.S.maxDD;
      const ok = dRet > 0 && dDD <= 1.0 && res.dd.daysBreach5 === 0;
      const cs = pstats(res.trades.filter(x => x.symbol === c), riskOf);
      const sd = (x: string) => pstats(res.trades.filter(t => String((t as any).side) === x && t.symbol === c), riskOf);
      console.log(`  +${c.padEnd(8)} ret ${(res.S.ret >= 0 ? '+' : '') + res.S.ret.toFixed(1)}% (${ann(res.S.ret)}) PF ${res.S.pf.toFixed(2)} MaxDD ${res.S.maxDD.toFixed(1)}% worstDay ${res.dd.worstDailyDdPct}% Hyro ${res.dd.daysBreach5}/${res.dd.balDaysBreach5} | Δret ${(dRet >= 0 ? '+' : '') + dRet.toFixed(1)}pp ΔDD ${(dDD >= 0 ? '+' : '') + dDD.toFixed(1)}pp ${ok ? 'ADD ✅' : 'NO ❌'} | ${c} n=${cs.n} PF=${cs.pf.toFixed(2)} L+${sd('long').ret.toFixed(1)}%/S+${sd('short').ret.toFixed(1)}%`);
    }
  }
  console.log(`\nCriterion ADD: Δret>0 AND ΔMaxDD ≤ +1.0pp AND 0 Hyro −5% (full year). Two-sided+rolling robust in B2.`);
  console.log(`HEAT NOTE: book heat = 3.6% of 3.75 cap → only 0.15% headroom. A 5th pair at ${CAND_RISK}% needs heat-cap raise or another pair de-risked.`);
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

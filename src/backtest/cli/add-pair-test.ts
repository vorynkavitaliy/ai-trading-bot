/**
 * add-pair-test — A/B test for ADDING a candidate pair to the live BTC+SOL+ADA book.
 * The binding constraint is correlated drawdown on ONE account, not single-pair edge.
 * So we compare the FIXED live config (BTC ls_pos r1.25 + SOL funding r0.875 + ADA
 * funding r0.875) as a 3-pair baseline vs the same book + each candidate (4-pair),
 * over full / older-half / recent-half windows, at a realistic slip, flatten optional.
 *
 * Criterion to add: candidate lifts return while MaxDD rise ≤ ~1pp AND 0 Hyro −5% days
 * (the bar SOL cleared when added to BTC: +30pp return for +0.8pp DD).
 *
 * Run: npx tsx src/backtest/cli/add-pair-test.ts [days=340] CAND1 CAND2 ...
 *   SLIP env (default 0.05), CAND_RISK env (default 0.875), FLATTEN env (e.g. 4.3) optional.
 *   e.g. SLIP=0.05 CAND_RISK=0.6 FLATTEN=4.3 npx tsx src/backtest/cli/add-pair-test.ts 340 LINKUSDT INJUSDT
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const SLIP = parseFloat(process.env.SLIP ?? '0.05');
const CAND_RISK = parseFloat(process.env.CAND_RISK ?? '0.875');
const FLAT = process.env.FLATTEN ? parseFloat(process.env.FLATTEN) : undefined;
const START_EQ = 200_000;

const BASE_RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875 };

// Live configs (BTC/SOL/ADA) + B2 walk-forward winners (LINK/XRP/INJ = S4 confluence).
function cfg(pair: string, risk: number): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'LINKUSDT': case 'XRPUSDT': case 'INJUSDT':
      return fundingTaConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    default: throw new Error(`no config for ${pair} (add it to cfg())`);
  }
}

function stats(t: ClosedTrade[], riskOf: (s: string) => number) {
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

async function run(pairs: string[], riskOf: (s: string) => number, startTs: number, endTs: number) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = pairs.map((p, i) => ({ symbol: p, strategy: cfg(p, riskOf(p)), priority: i }));
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: SLIP, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs,
    maxParallelCap: pairs.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: FLAT,
  });
  return { S: stats(r.trades, riskOf), dd: r.dailyDd, trades: r.trades };
}

const BASE = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT'];

async function window(label: string, days: number, endTs: number, startTs: number, cands: string[]) {
  const riskBase = (s: string) => BASE_RISK[s] ?? CAND_RISK;
  console.log(`\n══ ${label} (${days}d) · slip ${SLIP}% · flatten ${FLAT ?? 'OFF'} · cand-risk ${CAND_RISK}% ══`);
  const base = await run(BASE, riskBase, startTs, endTs);
  const ann = (x: number) => (x >= 0 ? '+' : '') + (x * 365 / days).toFixed(0) + '%/г';
  console.log(`  БАЗА (BTC+SOL+ADA, cap3):  доход ${(base.S.ret >= 0 ? '+' : '') + base.S.ret.toFixed(1)}% (${ann(base.S.ret)}) · PF ${base.S.pf.toFixed(2)} · MaxDD ${base.S.maxDD.toFixed(1)}% · худ.день ${base.dd.worstDailyDdPct}% · Hyro ${base.dd.daysBreach5}/${base.dd.balDaysBreach5} · n=${base.S.n}`);
  for (const c of cands) {
    const pairs = [...BASE, c];
    const riskOf = (s: string) => BASE_RISK[s] ?? CAND_RISK;
    const res = await run(pairs, riskOf, startTs, endTs);
    const dRet = res.S.ret - base.S.ret, dDD = res.S.maxDD - base.S.maxDD;
    const ok = dRet > 0 && dDD <= 1.0 && res.dd.daysBreach5 === 0;
    console.log(`  +${c.padEnd(8)} (cap4):       доход ${(res.S.ret >= 0 ? '+' : '') + res.S.ret.toFixed(1)}% (${ann(res.S.ret)}) · PF ${res.S.pf.toFixed(2)} · MaxDD ${res.S.maxDD.toFixed(1)}% · худ.день ${res.dd.worstDailyDdPct}% · Hyro ${res.dd.daysBreach5}/${res.dd.balDaysBreach5} · n=${res.S.n}`);
    const cs = stats(res.trades.filter(x => x.symbol === c), riskOf);
    const sd = (x: string) => stats(res.trades.filter(t => String((t as any).side) === x && t.symbol === c), riskOf);
    console.log(`      Δ доход ${(dRet >= 0 ? '+' : '') + dRet.toFixed(1)}pp · Δ MaxDD ${(dDD >= 0 ? '+' : '') + dDD.toFixed(1)}pp → ${ok ? 'ДОБАВЛЯТЬ ✅' : 'НЕ ДОБАВЛЯТЬ ❌'}  | ${c}: n=${cs.n} PF=${cs.pf.toFixed(2)} (лонг +${sd('long').ret.toFixed(1)}% / шорт +${sd('short').ret.toFixed(1)}%)`);
  }
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const cands = process.argv.slice(3).map(s => s.toUpperCase());
  if (!cands.length) { console.error('usage: add-pair-test.ts <days> CAND...'); process.exit(1); }
  const now = Date.now();
  const D = days * 24 * 3600_000;
  await window('ПОЛНОЕ ОКНО', days, now, now - D, cands);
  await window('СТАРАЯ ПОЛОВИНА', Math.round(days / 2), now - D / 2, now - D, cands);
  await window('СВЕЖАЯ ПОЛОВИНА', Math.round(days / 2), now, now - D / 2, cands);
  console.log(`\n  Критерий ДОБАВЛЯТЬ: Δдоход > 0 И ΔMaxDD ≤ +1.0pp И 0 дней Hyro−5%. Иначе кандидат стекует корреляцию.`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

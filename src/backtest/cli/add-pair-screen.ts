/**
 * add-pair-screen — find a robust 5th pair. Reuses the validated broadscreen method
 * (two-sided + rolling WF + portfolio A/B vs the live 4-pair book) on the NEW candidates
 * (AVAX/DOT/NEAR/SUI/OP — data prepped via add-pair-cg-backfill + add-pair-candle-refresh).
 *
 * Per candidate, tests 3 archetypes (funding/.70.30, lspos/.85.15 BTC-trend, S4-confluence/.70.30)
 * over the FULL window. Any archetype that is TWO-SIDED full-window auto-advances to:
 *   - rolling 4-window WF + static halves (two-sided + pos count)
 *   - portfolio A/B: base 4-pair vs +candidate (5-pair, full live harness, flatten 4.3, Hyro)
 * ADD bar (LINK precedent): Δret>0 AND ΔMaxDD ≤ +1pp AND 0 Hyro −5%, AND two-sided ≥3/4 WF.
 *
 * Read-only on DB. Run: npx tsx src/backtest/cli/add-pair-screen.ts [days=340]
 *   SLIP env (default 0.05), CAND_RISK env (default 0.6, the LINK precedent / heat-fit).
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

const CANDS = (process.env.CANDS ?? 'AVAXUSDT DOTUSDT NEARUSDT SUIUSDT OPUSDT').split(/\s+/);
type Arch = 'funding' | 'lspos' | 's4';
const ARCHES: Arch[] = ['funding', 'lspos', 's4'];

function archCfg(a: Arch, risk: number): Strategy {
  if (a === 'lspos') return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
  if (a === 's4') return fundingTaConfluence({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
  return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
}

const BOOK = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];
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
async function single(pair: string, a: Arch, startTs: number, endTs: number, slip: number) {
  resetCgFadeCooldownState();
  const r = await runBacktest(archCfg(a, 0.5), { symbol: pair, startTs, endTs, ...bCommon(slip) });
  let lr = 0, sr = 0, lt = 0, st = 0;
  for (const t of r.trades) { if (t.side === 'long') { lt++; lr += t.pnlR; } else { st++; sr += t.pnlR; } }
  const m = r.metrics;
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, lt, lr, st, sr };
}
function twoSided(x: any) { return x.lr > 0 && x.sr > 0; }
function fmtSingle(tag: string, x: any) {
  const ts = twoSided(x) ? 'TWO-SIDED ✅' : (x.lr > 0 || x.sr > 0 ? 'one-sided' : 'NEG ❌');
  return `${tag.padEnd(22)} tr${String(x.trades).padStart(3)} WR${x.wr.toFixed(0).padStart(3)} PF${x.pf.toFixed(2)} R${x.sumR.toFixed(1).padStart(6)} DD${x.maxDD.toFixed(1).padStart(5)}% [L${x.lt}/${x.lr.toFixed(1)} S${x.st}/${x.sr.toFixed(1)}] ${ts}`;
}

function pstats(t: ClosedTrade[], riskOf: (s: string) => number) {
  let eq = START_EQ, peak = eq, maxDD = 0, w = 0, l = 0, usd = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = x.pnlR * (riskOf(x.symbol) / 100 * START_EQ);
    eq += pnl; usd += pnl; if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak * 100; if (dd > maxDD) maxDD = dd;
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

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const now = Date.now();
  const days = parseFloat(process.argv[2] ?? '340');
  const D = days * DAY;
  const W = 92;

  console.log(`████ ADD-PAIR SCREEN · slip ${SLIP}% · cand-risk ${CAND_RISK}% · ${days}d · cands: ${CANDS.join(' ')} ████`);

  // ── STAGE 1: full-window two-sided scan across 3 archetypes ──
  console.log(`\n══ STAGE 1 — full ${days}d, 3 archetypes each ══`);
  const best: Record<string, { a: Arch; x: any } | null> = {};
  for (const p of CANDS) {
    console.log(`\n── ${p} ──`);
    let pick: { a: Arch; x: any } | null = null;
    for (const a of ARCHES) {
      const x = await single(p, a, now - D, now, SLIP);
      console.log('  ' + fmtSingle(a, x));
      if (twoSided(x) && (!pick || x.sumR > pick.x.sumR)) pick = { a, x };
    }
    best[p] = pick;
    console.log(`  → best two-sided archetype: ${pick ? `${pick.a} (R ${pick.x.sumR.toFixed(1)})` : 'NONE — drop'}`);
  }

  // ── STAGE 2: rolling WF + halves for full-window two-sided survivors ──
  const survivors = CANDS.filter(p => best[p]);
  console.log(`\n\n══ STAGE 2 — rolling WF + halves (survivors: ${survivors.length ? survivors.join(' ') : 'none'}) ══`);
  const wfPass: string[] = [];
  for (const p of survivors) {
    const a = best[p]!.a;
    console.log(`\n── ${p} [${a}] ──`);
    const recent = await single(p, a, now - 183 * DAY, now, SLIP);
    const older = await single(p, a, now - 366 * DAY, now - 183 * DAY, SLIP);
    console.log('  ' + fmtSingle('recent half', recent));
    console.log('  ' + fmtSingle('older half', older));
    let winsTwoSided = 0, winsPos = 0;
    for (let i = 4; i >= 1; i--) {
      const e = now - (i - 1) * W * DAY, s = e - W * DAY;
      const r = await single(p, a, s, e, SLIP);
      if (twoSided(r)) winsTwoSided++;
      if (r.sumR > 0) winsPos++;
      console.log('  ' + fmtSingle(`win${5 - i} ${new Date(s).toISOString().slice(0, 10)}`, r));
    }
    console.log(`  → rolling WF: ${winsPos}/4 sumR>0, ${winsTwoSided}/4 two-sided` + (winsTwoSided >= 3 ? ' ✅ WF-ROBUST' : ' ❌'));
    if (winsTwoSided >= 3) wfPass.push(p);
  }

  // ── STAGE 3: portfolio A/B for WF-robust candidates ──
  console.log(`\n\n══ STAGE 3 — portfolio A/B vs live 4-pair book (WF-robust: ${wfPass.length ? wfPass.join(' ') : 'none'}) ══`);
  if (wfPass.length) {
    const riskBase = (s: string) => BOOK_RISK[s] ?? CAND_RISK;
    for (const [lbl, s, e, d] of [['FULL', now - D, now, days], ['OLDER', now - D, now - D / 2, Math.round(days / 2)], ['RECENT', now - D / 2, now, Math.round(days / 2)]] as [string, number, number, number][]) {
      console.log(`\n── ${lbl} (${d}d) ──`);
      const base = await port(BOOK, bookCfg, riskBase, s, e);
      const ann = (x: number) => (x >= 0 ? '+' : '') + (x * 365 / d).toFixed(0) + '%/y';
      console.log(`  BASE: ret ${(base.S.ret >= 0 ? '+' : '') + base.S.ret.toFixed(1)}% (${ann(base.S.ret)}) PF ${base.S.pf.toFixed(2)} MaxDD ${base.S.maxDD.toFixed(1)}% Hyro ${base.dd.daysBreach5}/${base.dd.balDaysBreach5} n=${base.S.n}`);
      for (const c of wfPass) {
        const pairs = [...BOOK, c];
        const stratOf = (p: string) => (p === c ? archCfg(best[c]!.a, CAND_RISK) : bookCfg(p));
        const res = await port(pairs, stratOf, riskBase, s, e);
        const dRet = res.S.ret - base.S.ret, dDD = res.S.maxDD - base.S.maxDD;
        const ok = dRet > 0 && dDD <= 1.0 && res.dd.daysBreach5 === 0;
        const cs = pstats(res.trades.filter(x => x.symbol === c), riskBase);
        const sd = (x: string) => pstats(res.trades.filter(t => String((t as any).side) === x && t.symbol === c), riskBase);
        console.log(`  +${c.padEnd(8)}[${best[c]!.a}] ret ${(res.S.ret >= 0 ? '+' : '') + res.S.ret.toFixed(1)}% (${ann(res.S.ret)}) PF ${res.S.pf.toFixed(2)} MaxDD ${res.S.maxDD.toFixed(1)}% Hyro ${res.dd.daysBreach5}/${res.dd.balDaysBreach5} | Δret ${(dRet >= 0 ? '+' : '') + dRet.toFixed(1)}pp ΔDD ${(dDD >= 0 ? '+' : '') + dDD.toFixed(1)}pp ${ok ? 'ADD ✅' : 'NO ❌'} | ${c} n=${cs.n} PF=${cs.pf.toFixed(2)} L+${sd('long').ret.toFixed(1)}/S+${sd('short').ret.toFixed(1)}`);
      }
    }
  }

  console.log(`\n\nADD bar: two-sided ≥3/4 WF AND (Δret>0, ΔMaxDD ≤ +1pp, 0 Hyro −5% full year).`);
  console.log(`HEAT: book = 3.60% of 3.75 cap → only 0.15% headroom. A 5th pair at ${CAND_RISK}% ⇒ needs heat-cap raise or de-risk another pair.`);
  await closePg();
}

main().catch(e => { console.error(e); process.exit(1); });

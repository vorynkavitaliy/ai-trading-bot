/**
 * lever-macrocorr-wf — LEVER 5 robustness battery for the WINNING overlay candidates.
 * Companion to lever-macrocorr-overlay.ts (which did SECTION A quantify + B-1 full +
 * disqualified half3 with a +13.65pp MaxDD / +2 Hyro pathology). This runs ONLY the
 * viable variants across the robustness discriminator (halves + 4-window rolling WF +
 * slip stress + the 2026-05-21 breach day), to test whether the blk-overlay return lift
 * is robust two-sided or a full-sample selection artifact.
 *
 * Variants: base (no overlay), blk3 (block 3rd same-side entry), blk4 (block 4th/all-same).
 * (half-size variants dropped: half3 desyncs the flatten → WORSE; see overlay.ts.)
 *
 * Run: npx tsx src/backtest/cli/lever-macrocorr-wf.ts [days=340]   SLIP env(0.05) FLAT env(4.3)
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, StrategyContext, Action, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const SLIP = parseFloat(process.env.SLIP ?? '0.05');
const FLAT = process.env.FLAT ? parseFloat(process.env.FLAT) : 4.3;
const START_EQ = 200_000;
const RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: 0.6 };
const riskOf = (s: string) => RISK[s] ?? 0.6;
const BOOK = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];

function baseCfg(pair: string): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.BTCUSDT });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.SOLUSDT });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.ADAUSDT });
    case 'LINKUSDT': return fundingTaConfluence({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK.LINKUSDT });
    default: throw new Error(`no cfg ${pair}`);
  }
}

interface OverlayState {
  openSides: Map<string, 'long' | 'short'>;
  pendingTs: number; pendingLong: number; pendingShort: number;
  mode: 'off' | 'block'; conc: number;
}

class CorrOverlayStrategy implements Strategy {
  readonly name: string; readonly needsCoinglass: boolean; readonly needsBtcContext: boolean;
  constructor(private inner: Strategy, private symbol: string, private st: OverlayState) {
    this.name = `corr-overlay(${inner.name})`;
    this.needsCoinglass = (inner as any).needsCoinglass ?? false;
    this.needsBtcContext = (inner as any).needsBtcContext ?? false;
  }
  decide(ctx: StrategyContext): Action {
    const st = this.st;
    if (ctx.ts !== st.pendingTs) { st.pendingTs = ctx.ts; st.pendingLong = 0; st.pendingShort = 0; }
    if (ctx.position) st.openSides.set(this.symbol, ctx.position.side); else st.openSides.delete(this.symbol);
    const action = this.inner.decide(ctx);
    if (st.mode === 'off' || action.kind !== 'enter') return action;
    const side = action.side;
    let openSame = 0;
    for (const [sym, sd] of st.openSides) { if (sym !== this.symbol && sd === side) openSame++; }
    const pendingSame = side === 'long' ? st.pendingLong : st.pendingShort;
    const wouldBe = openSame + pendingSame + 1;
    if (wouldBe >= st.conc) return { kind: 'hold' };  // block
    if (side === 'long') st.pendingLong++; else st.pendingShort++;
    return action;
  }
}

function makeStrats(mode: 'off' | 'block', conc: number): PortfolioSymbolStrategy[] {
  const st: OverlayState = { openSides: new Map(), pendingTs: -1, pendingLong: 0, pendingShort: 0, mode, conc };
  return BOOK.map((p, i) => ({ symbol: p, strategy: new CorrOverlayStrategy(baseCfg(p), p, st), priority: i }));
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

async function runV(mode: 'off' | 'block', conc: number, startTs: number, endTs: number, slip = SLIP) {
  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(makeStrats(mode, conc), {
    startEquity: START_EQ, slippagePct: slip, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: BOOK.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, dailyDdFlattenPct: FLAT,
  });
  return { S: stats(r.trades), dd: r.dailyDd, trades: r.trades };
}

const VARIANTS: Array<{ key: string; mode: 'off' | 'block'; conc: number }> = [
  { key: 'base', mode: 'off', conc: 0 },
  { key: 'blk3', mode: 'block', conc: 3 },
  { key: 'blk4', mode: 'block', conc: 4 },
];

const row = (label: string, res: any, days: number) => {
  const S = res.S, dd = res.dd; const ann = (S.ret * 365 / days);
  const surv = dd.daysBreach5 === 0 && dd.balDaysBreach5 === 0;
  const lr = res.trades.filter((t: ClosedTrade) => t.side === 'long').reduce((s: number, t: ClosedTrade) => s + t.pnlR * (riskOf(t.symbol) / 100 * START_EQ), 0);
  const sr = res.trades.filter((t: ClosedTrade) => t.side === 'short').reduce((s: number, t: ClosedTrade) => s + t.pnlR * (riskOf(t.symbol) / 100 * START_EQ), 0);
  const two = lr > 0 && sr > 0 ? '2-sided' : (lr > 0 || sr > 0 ? '1-sided' : 'NEG');
  return `    ${label.padEnd(6)} ${((S.ret >= 0 ? '+' : '') + S.ret.toFixed(1) + '%').padStart(7)} (${(ann >= 0 ? '+' : '') + ann.toFixed(0)}%/г) · PF ${S.pf.toFixed(2)} · MaxDD ${S.maxDD.toFixed(1).padStart(4)}% · худ.день ${String(dd.worstDailyDdPct).padStart(6)}% · Hyro ${dd.daysBreach5}/${dd.balDaysBreach5} ${surv ? '✅' : '❌'} · n=${String(S.n).padStart(3)} · L$${(lr / 1000).toFixed(0)}k/S$${(sr / 1000).toFixed(0)}k ${two}`;
};

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const now = Date.now(), D = days * 24 * 3600_000, half = Math.round(days / 2);

  console.log(`\n████ LEVER 5 WF — corr-block overlay robustness (slip ${SLIP}% · flatten ${FLAT}%) ████`);

  console.log(`\n── ПОЛОВИНЫ ──`);
  for (const [lbl, s, e, d] of [['СТАРАЯ', now - D, now - D / 2, half], ['СВЕЖАЯ', now - D / 2, now, half]] as [string, number, number, number][]) {
    console.log(`  [${lbl} половина ${d}d]`);
    for (const v of VARIANTS) console.log(row(v.key, await runV(v.mode, v.conc, s, e), d));
  }

  console.log(`\n── 4-ОКОННЫЙ СКОЛЬЗЯЩИЙ WF (~${Math.floor(days / 4)}d каждое) ──`);
  const W = Math.floor(days / 4);
  for (let i = 4; i >= 1; i--) {
    const endTs = now - (i - 1) * W * 24 * 3600_000;
    const startTs = endTs - W * 24 * 3600_000;
    console.log(`  win${5 - i} (${new Date(startTs).toISOString().slice(0, 10)} → ${new Date(endTs).toISOString().slice(0, 10)}):`);
    for (const v of VARIANTS) console.log(row(v.key, await runV(v.mode, v.conc, startTs, endTs), W));
  }

  console.log(`\n── СТРЕСС-СЛИП (полный год · flatten ${FLAT}) ──`);
  for (const slip of [0.10, 0.25]) {
    console.log(`  slip ${slip.toFixed(2)}%:`);
    for (const v of VARIANTS) console.log(row(v.key, await runV(v.mode, v.conc, now - D, now, slip), days));
  }

  console.log(`\n  Робастность: blk-overlay должен (а) держать/поднимать доход в обеих половинах И ≥3/4 WF-окнах,`);
  console.log(`  (б) НЕ добавлять Hyro-пробоев, (в) держать MaxDD в ~1pp. Иначе это full-sample артефакт.`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

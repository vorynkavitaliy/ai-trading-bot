/**
 * lever-macrocorr-overlay — LEVER 5: macro / correlation de-risk overlay.
 *
 * GOAL: quantify how much of the live 4-pair book's MaxDD and Hyro −5% breach risk
 * comes from CORRELATED same-side exposure (many pairs long, or many short, at once),
 * then A/B a portfolio overlay that fires when the book is dangerously concentrated.
 *
 * Live book (single source of truth src/runtime/pair-strategies.ts, NOT edited):
 *   BTCUSDT lsTopPositionFade .85/.15 btcTrend sl2.0 tp2.0 r1.25
 *   SOLUSDT fundingFade       .70/.30          sl2.0 tp2.0 r0.875
 *   ADAUSDT fundingFade       .75/.25          sl1.5 tp2.0 r0.875
 *   LINKUSDT fundingTaConfluence .70/.30       sl1.5 tp2.0 r0.6
 *   single-entry MARKET, decisionTf 240m, cap 4, flatten 4.3% of base, slip 0.05.
 *
 * SECTION A — QUANTIFY (read-only on the BASELINE ledger):
 *   - Run the live book (flatten ON). From the trade ledger, reconstruct daily
 *     intraday equity on a 1-min grid (same markContribution bound the engine uses)
 *     and measure, per day, the MAX same-side concentration (how many pairs were
 *     simultaneously open on the SAME side) and how that day's worst DD splits by
 *     concentration bucket. Tells us: are the worst days the concentrated ones?
 *   - List the worst-5 days with: worst DD, max concurrent same-side, sides.
 *
 * SECTION B — OVERLAY A/B (engine, full + halves + 4-window rolling WF):
 *   The overlay is applied via a STRATEGY WRAPPER (engine-portfolio.ts is NOT
 *   edited). Each wrapped strategy, at decide() time, consults a shared per-boundary
 *   registry of (a) currently-open positions' sides (refreshed from ctx.position at
 *   the top of every decide) and (b) entries already signalled THIS 4H boundary by
 *   higher-priority pairs. If entering side X would make ≥ CONC pairs same-side
 *   (open + pending), the overlay acts: MODE=block → return hold; MODE=half →
 *   halve sizePct. This is causal/live-faithful: a pair only sees what is already
 *   committed/open or decided ahead of it, exactly like a live overlay.
 *
 *   Variants compared (full year + 2 halves + 4×~85d rolling WF, flatten ON, slip 0.05):
 *     base      — live book, no overlay (current protection = flatten alone)
 *     blk3      — block the entry that would make the 3rd same-side position
 *     half3     — half-size the entry that would make the 3rd same-side position
 *     blk4      — block only the 4th (all-4 same side) entry
 *     half4     — half-size only the 4th
 *
 *   Reported per variant: ret%/yr, PF, MaxDD, worst 1-min day, Hyro −5% breaches
 *   (1m authoritative + balance), trades, long/short split. Plus the 2026-05-21
 *   class breach day specifically.
 *
 * Run: npx tsx src/backtest/cli/lever-macrocorr-overlay.ts [days=340]
 *      SLIP env (default 0.05), FLAT env (default 4.3).
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

// ─── Correlation overlay shared state (per-run) ──────────────────────────────
// openSides: symbol → side of its CURRENTLY-OPEN position (null/absent if flat).
//   Each wrapper refreshes its own entry at the top of decide() from ctx.position.
// pending: per-boundary set of entries SIGNALLED this 4H boundary by pairs decided
//   so far (priority order). Reset when ctx.ts advances.
interface OverlayState {
  openSides: Map<string, 'long' | 'short'>;
  pendingTs: number;
  pendingLong: number;
  pendingShort: number;
  mode: 'off' | 'block' | 'half';
  conc: number;      // concentration threshold: act if entering makes >= conc same-side
}

class CorrOverlayStrategy implements Strategy {
  readonly name: string;
  readonly needsCoinglass: boolean;
  readonly needsBtcContext: boolean;
  constructor(private inner: Strategy, private symbol: string, private st: OverlayState) {
    this.name = `corr-overlay(${inner.name})`;
    this.needsCoinglass = (inner as any).needsCoinglass ?? false;
    this.needsBtcContext = (inner as any).needsBtcContext ?? false;
  }
  decide(ctx: StrategyContext): Action {
    const st = this.st;
    // Reset per-boundary pending registry when the boundary advances.
    if (ctx.ts !== st.pendingTs) { st.pendingTs = ctx.ts; st.pendingLong = 0; st.pendingShort = 0; }
    // Refresh my open-position side into the shared registry (engine resolves
    // positions before the decide loop, so ctx.position is fresh).
    if (ctx.position) st.openSides.set(this.symbol, ctx.position.side);
    else st.openSides.delete(this.symbol);

    const action = this.inner.decide(ctx);
    if (st.mode === 'off' || action.kind !== 'enter') return action;

    // Count how many pairs (OTHER than me) are already same-side: open + pending.
    const side = action.side;
    let openSame = 0;
    for (const [sym, sd] of st.openSides) { if (sym !== this.symbol && sd === side) openSame++; }
    const pendingSame = side === 'long' ? st.pendingLong : st.pendingShort;
    // If I enter, the resulting same-side count INCLUDING me:
    const wouldBe = openSame + pendingSame + 1;

    if (wouldBe >= st.conc) {
      if (st.mode === 'block') {
        // Do NOT register a pending entry (we're suppressing it).
        return { kind: 'hold' };
      }
      // half: register pending (it will open) and halve size.
      if (side === 'long') st.pendingLong++; else st.pendingShort++;
      return { ...action, sizePct: action.sizePct * 0.5 };
    }
    // Below threshold: register pending and pass through.
    if (side === 'long') st.pendingLong++; else st.pendingShort++;
    return action;
  }
}

function makeStrats(mode: 'off' | 'block' | 'half', conc: number): { strats: PortfolioSymbolStrategy[]; st: OverlayState } {
  const st: OverlayState = { openSides: new Map(), pendingTs: -1, pendingLong: 0, pendingShort: 0, mode, conc };
  const strats = BOOK.map((p, i) => ({ symbol: p, strategy: new CorrOverlayStrategy(baseCfg(p), p, st), priority: i }));
  return { strats, st };
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

async function runVariant(mode: 'off' | 'block' | 'half', conc: number, startTs: number, endTs: number) {
  resetCgFadeCooldownState();
  const { strats } = makeStrats(mode, conc);
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: SLIP, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: BOOK.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: FLAT,
  });
  return { S: stats(r.trades), dd: r.dailyDd, trades: r.trades };
}

// markContribution bound (mirror engine-portfolio.ts) for SECTION A reconstruction.
function markContribution(tr: ClosedTrade, rawMark: number): number {
  const dir = tr.side === 'long' ? 1 : -1;
  let c = (rawMark - tr.entry) * tr.qty * dir;
  const riskedUsd = Math.abs(tr.entry - tr.initialSl) * tr.qty;
  const favCap = (tr.mfeR ?? 0) * riskedUsd;
  const advCap = (tr.maeR ?? 0) * riskedUsd;
  if (c > favCap) c = favCap;
  if (c < advCap) c = advCap;
  return c;
}

// Section A: reconstruct per-day worst DD AND max concurrent same-side concentration.
// Uses the live-sizing basis (riskOf per pair × START_EQ) so DD matches the deploy
// table convention used elsewhere. 1-min grid.
async function quantifyConcentration(trades: ClosedTrade[]) {
  if (trades.length === 0) return;
  // Reload 1m closes per symbol via a tiny portfolio run is heavy; instead use the
  // trade's own entry/exit linear mark fallback bounded by mfe/mae — we already have
  // the per-trade excursion envelope. We approximate intraday marks by the bounded
  // contribution at the trade's own price path proxy. To get a true per-minute
  // same-side concentration we only need OPEN INTERVALS (entryTs..exitTs) + side,
  // which the ledger gives directly. DD attribution uses the bounded envelope.
  const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  const tStart = sorted[0].entryTs;
  const tEnd = Math.max(...trades.map(t => t.exitTs));
  const STEP = 15 * 60_000;
  // Scale each trade's pnl into live-sizing $ (engine sizes on compounding equity at
  // START_EQ basis with riskPct already in qty; for concentration attribution we use
  // the engine pnlUsd directly as realized, and bound unreal by envelope × riskedUsd
  // scaled to live risk). Simpler & consistent with stats(): convert via pnlR.
  const closesByTs = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  let ci = 0, realizedR_byPair = 0;
  // Track realized R cumulative (live $) and active set.
  const opens = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  let oi = 0;
  const active = new Set<ClosedTrade>();
  let realizedUsd = 0;
  let curDay = '', dayPeak = 0, dayTrough = 0;
  const dayWorst = new Map<string, number>();
  const dayMaxConc = new Map<string, number>();      // max concurrent same-side (any side)
  const daySideAtWorst = new Map<string, string>();
  for (let t = tStart; t <= tEnd; t += STEP) {
    while (ci < closesByTs.length && closesByTs[ci].exitTs <= t) {
      const x = closesByTs[ci];
      realizedUsd += x.pnlR * (riskOf(x.symbol) / 100 * START_EQ);
      active.delete(x); ci++;
    }
    while (oi < opens.length && opens[oi].entryTs <= t) { if (opens[oi].exitTs > t) active.add(opens[oi]); oi++; }
    // unrealized (bounded envelope, in live $)
    let unrealUsd = 0; let nLong = 0, nShort = 0;
    for (const tr of active) {
      // bounded contribution in R: we don't have minute price here, so use a
      // time-linear proxy between maeR (early) and final pnlR is unreliable; instead
      // use the per-trade WORST-CASE envelope only for the day's trough (maeR) and
      // best for peak (mfeR). For concentration counting we only need side counts.
      if (tr.side === 'long') nLong++; else nShort++;
      // contribute the bounded worst (maeR) to capture trough pressure; this is a
      // conservative same-side-stress proxy (mark each open at its MAE in live $).
      const rUsd = (tr.maeR ?? 0) * (riskOf(tr.symbol) / 100 * START_EQ);
      unrealUsd += rUsd;
    }
    const conc = Math.max(nLong, nShort);
    const eq = START_EQ + realizedUsd + unrealUsd;
    const day = new Date(t).toISOString().slice(0, 10);
    if (day !== curDay) { curDay = day; dayPeak = START_EQ + realizedUsd; dayTrough = eq; }
    else { if (eq > dayPeak) { dayPeak = eq; dayTrough = eq; } else if (eq < dayTrough) dayTrough = eq; }
    const dd = dayPeak > 0 ? (dayTrough - dayPeak) / dayPeak * 100 : 0;
    if (dd < (dayWorst.get(day) ?? 0)) {
      dayWorst.set(day, dd);
      daySideAtWorst.set(day, `${nLong}L/${nShort}S`);
    }
    if (conc > (dayMaxConc.get(day) ?? 0)) dayMaxConc.set(day, conc);
  }
  // Aggregate: split days by max same-side concentration bucket.
  const buckets: Record<number, { days: number; worstDdSum: number; minDd: number }> = {};
  for (const [day, dd] of dayWorst) {
    const c = dayMaxConc.get(day) ?? 0;
    if (!buckets[c]) buckets[c] = { days: 0, worstDdSum: 0, minDd: 0 };
    buckets[c].days++;
    buckets[c].worstDdSum += dd;
    if (dd < buckets[c].minDd) buckets[c].minDd = dd;
  }
  console.log(`\n── SECTION A: КОНЦЕНТРАЦИЯ vs ПРОСАДКА (base book, live-sizing, 15m grid, маркируем по MAE-конверту) ──`);
  console.log(`  Дней с открытой позицией: ${dayWorst.size}`);
  console.log(`  Макс. одновр. однонаправл.  | дней | ср.внутр.DD | худш.внутр.DD`);
  for (const c of Object.keys(buckets).map(Number).sort((a, b) => a - b)) {
    const b = buckets[c];
    console.log(`     ${c} пар(ы) в одну сторону   | ${String(b.days).padStart(4)} | ${(b.worstDdSum / b.days).toFixed(2).padStart(7)}% | ${b.minDd.toFixed(2).padStart(7)}%`);
  }
  // Worst-5 days
  const worst5 = [...dayWorst.entries()].sort((a, b) => a[1] - b[1]).slice(0, 8);
  console.log(`  Худшие 8 дней (внутр.DD по MAE-конверту):`);
  for (const [day, dd] of worst5) {
    console.log(`     ${day}  DD ${dd.toFixed(2).padStart(6)}%  макс.одностор=${dayMaxConc.get(day)}  состав@trough=${daySideAtWorst.get(day)}`);
  }
}

const fmtRow = (label: string, S: { ret: number; pf: number; maxDD: number; n: number }, dd: any, days: number) => {
  const ann = (S.ret * 365 / days);
  const surv = dd.daysBreach5 === 0 && dd.balDaysBreach5 === 0;
  return `  ${label.padEnd(10)} ${((S.ret >= 0 ? '+' : '') + S.ret.toFixed(1) + '%').padStart(7)} (${(ann >= 0 ? '+' : '') + ann.toFixed(0)}%/г) · PF ${S.pf.toFixed(2)} · MaxDD ${S.maxDD.toFixed(1).padStart(4)}% · худ.день ${String(dd.worstDailyDdPct).padStart(6)}% · Hyro ${dd.daysBreach5}/${dd.balDaysBreach5} ${surv ? '✅' : '❌'} · n=${S.n}`;
};

const VARIANTS: Array<{ key: string; mode: 'off' | 'block' | 'half'; conc: number }> = [
  { key: 'base',  mode: 'off',   conc: 0 },
  { key: 'blk3',  mode: 'block', conc: 3 },
  { key: 'half3', mode: 'half',  conc: 3 },
  { key: 'blk4',  mode: 'block', conc: 4 },
  { key: 'half4', mode: 'half',  conc: 4 },
];

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const now = Date.now(), D = days * 24 * 3600_000, half = Math.round(days / 2);

  console.log(`\n████ LEVER 5 — MACRO/CORR DE-RISK OVERLAY (4-пары · slip ${SLIP}% · flatten ${FLAT}%) ████`);

  // SECTION A — quantify on the baseline (flatten ON) full-year ledger.
  const baseFull = await runVariant('off', 0, now - D, now);
  await quantifyConcentration(baseFull.trades);

  // SECTION B — overlay A/B.
  console.log(`\n── SECTION B-1: ПОЛНЫЙ ГОД (${days}d) ──`);
  const fullRes: Record<string, any> = {};
  for (const v of VARIANTS) {
    const res = v.key === 'base' ? baseFull : await runVariant(v.mode, v.conc, now - D, now);
    fullRes[v.key] = res;
    console.log(fmtRow(v.key, res.S, res.dd, days));
  }
  // Deltas vs base
  console.log(`  Δ vs base (год):`);
  for (const v of VARIANTS) { if (v.key === 'base') continue;
    const b = fullRes.base.S, x = fullRes[v.key].S;
    const dRetAnn = (x.ret - b.ret) * 365 / days;
    const dDD = x.maxDD - b.maxDD;
    const dWorst = fullRes[v.key].dd.worstDailyDdPct - fullRes.base.dd.worstDailyDdPct;
    const dBreach = (fullRes[v.key].dd.daysBreach5 + fullRes[v.key].dd.balDaysBreach5) - (fullRes.base.dd.daysBreach5 + fullRes.base.dd.balDaysBreach5);
    console.log(`     ${v.key.padEnd(6)} Δret ${(dRetAnn >= 0 ? '+' : '') + dRetAnn.toFixed(0)}%/г · ΔMaxDD ${(dDD >= 0 ? '+' : '') + dDD.toFixed(2)}pp · Δхуд.день ${(dWorst >= 0 ? '+' : '') + dWorst.toFixed(2)}pp · ΔHyro ${(dBreach >= 0 ? '+' : '') + dBreach}`);
  }

  console.log(`\n── SECTION B-2: ПОЛОВИНЫ (flatten ${FLAT} · slip ${SLIP}) ──`);
  for (const [lbl, s, e, d] of [['СТАРАЯ', now - D, now - D / 2, half], ['СВЕЖАЯ', now - D / 2, now, half]] as [string, number, number, number][]) {
    console.log(`  [${lbl} половина]`);
    for (const v of VARIANTS) {
      const res = await runVariant(v.mode, v.conc, s, e);
      console.log(fmtRow('  ' + v.key, res.S, res.dd, d));
    }
  }

  console.log(`\n── SECTION B-3: 4-ОКОННЫЙ СКОЛЬЗЯЩИЙ WF (~${Math.round(days / 4)}d каждое · flatten ${FLAT} · slip ${SLIP}) ──`);
  const W = Math.floor(days / 4);
  for (let i = 4; i >= 1; i--) {
    const endTs = now - (i - 1) * W * 24 * 3600_000;
    const startTs = endTs - W * 24 * 3600_000;
    console.log(`  win${5 - i} (${new Date(startTs).toISOString().slice(0, 10)} → ${new Date(endTs).toISOString().slice(0, 10)}):`);
    for (const v of VARIANTS) {
      const res = await runVariant(v.mode, v.conc, startTs, endTs);
      console.log(fmtRow('  ' + v.key, res.S, res.dd, W));
    }
  }

  console.log(`\n── SECTION B-4: ВКЛАД ЛОНГ/ШОРТ (год · base vs лучший overlay) ──`);
  for (const v of ['base', 'blk3', 'half3'] as const) {
    const res = fullRes[v];
    const sd = (x: string) => stats(res.trades.filter((t: ClosedTrade) => String((t as any).side) === x));
    console.log(`  ${v.padEnd(6)} лонг ${(sd('long').ret >= 0 ? '+' : '') + sd('long').ret.toFixed(1)}% (n=${sd('long').n}) / шорт ${(sd('short').ret >= 0 ? '+' : '') + sd('short').ret.toFixed(1)}% (n=${sd('short').n})`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

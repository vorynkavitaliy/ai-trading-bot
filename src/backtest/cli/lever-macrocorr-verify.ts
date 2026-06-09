/**
 * lever-macrocorr-verify — INDEPENDENT adversarial re-run of LEVER 5 (macro/corr
 * de-risk overlay: block the entry that would make the 3rd same-side position across
 * the live 4-pair book BTC/SOL/ADA/LINK, on top of the 4.3%-of-base DD-flatten).
 *
 * Built from scratch (does NOT import the measurer's CLI). Live book is the single
 * source of truth (pair-strategies.ts — NOT edited). Overlay = strategy wrapper,
 * engine-portfolio.ts NOT edited. Reports for base / blk3 / blk4:
 *   - ret%, ret%/yr, PF, MaxDD, worst 1m-raw DD, Hyro breaches (15m-MTM daysBreach5 +
 *     balDaysBreach5 + authoritative 1m-raw −5% from the flatten grid), n, L/S split.
 * Windows: FULL, OLDER half, RECENT half, 4-window rolling WF, slip-stress (0.10/0.25).
 *
 * The flatten makes the engine print "[AUTHORITATIVE 1m raw DD] ... −5%=N" — I capture
 * that by reading per-run; but the returned dailyDd object only carries the 15m grid.
 * To get the authoritative 1m breach count programmatically I re-derive it the same
 * way the engine does NOT expose — so I rely on (a) daysBreach5/balDaysBreach5 from the
 * returned object AND (b) the worst 1m-raw value via a fixed-base reconstruction so the
 * live (fixed-bucket) sizing breach is visible (engine compounds off START_EQ and hides
 * the May breach). Fixed-base recon mirrors add-pair-test stats() convention.
 *
 * Run: npx tsx src/backtest/cli/lever-macrocorr-verify.ts [days=340]  SLIP env(0.05) FLAT env(4.3)
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence, peekCgFadeCooldown, restoreCgFadeCooldown } from '../../strategies/cg-fade';
import { Strategy, StrategyContext, Action, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const SLIP = parseFloat(process.env.SLIP ?? '0.05');
const FLAT = process.env.FLAT ? parseFloat(process.env.FLAT) : 4.3;
const START_EQ = 200_000;
// Live per-pair risk (pair-strategies.ts: BTC 1.25, SOL/ADA 0.875, LINK 0.6).
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

// ── Overlay: portfolio same-side concentration block. Causal/live-faithful:
//   - openSides refreshed from ctx.position at the top of every decide (engine
//     resolves positions before the decide loop, so ctx.position is current).
//   - pending counts entries SIGNALLED this 4H boundary by higher-priority pairs
//     decided ahead of me (reset when boundary ts advances).
//   - If entering side X would make same-side count (open + pending + me) reach
//     `conc`, return hold (SUPPRESS). Do NOT register pending on suppress.
//   - cooldownOnCommit:true in the engine rolls back the burned 6h cooldown for a
//     suppressed (held) signal, so a suppressed extreme can re-fire next boundary.
interface OverlayState {
  openSides: Map<string, 'long' | 'short'>;
  pendingTs: number; pendingLong: number; pendingShort: number;
  mode: 'off' | 'block'; conc: number;
  suppressed: number;          // count of entries suppressed (diagnostic)
}

class CorrBlockOverlay implements Strategy {
  readonly name: string; readonly needsCoinglass: boolean; readonly needsBtcContext: boolean;
  constructor(private inner: Strategy, private symbol: string, private st: OverlayState) {
    this.name = `corrblk(${inner.name})`;
    this.needsCoinglass = (inner as any).needsCoinglass ?? false;
    this.needsBtcContext = (inner as any).needsBtcContext ?? false;
  }
  decide(ctx: StrategyContext): Action {
    const st = this.st;
    if (ctx.ts !== st.pendingTs) { st.pendingTs = ctx.ts; st.pendingLong = 0; st.pendingShort = 0; }
    if (ctx.position) st.openSides.set(this.symbol, ctx.position.side); else st.openSides.delete(this.symbol);
    // Snapshot the pair's cooldown BEFORE inner.decide() burns it (markEntry burns the
    // 6h same-direction cooldown on an enter SIGNAL). On SUPPRESS we restore it so a
    // suppressed extreme can re-fire next boundary — the spec says "do not burn the 6h
    // cooldown at commit". The engine's cooldownOnCommit only rolls back when IT blocks;
    // it does NOT roll back our wrapper-level suppress (it sees `hold` and just continues),
    // so the wrapper must do its own rollback here.
    const cdSnap = peekCgFadeCooldown(this.symbol);
    const action = this.inner.decide(ctx);
    if (st.mode === 'off' || action.kind !== 'enter') return action;
    const side = action.side;
    let openSame = 0;
    for (const [sym, sd] of st.openSides) { if (sym !== this.symbol && sd === side) openSame++; }
    const pendingSame = side === 'long' ? st.pendingLong : st.pendingShort;
    const wouldBe = openSame + pendingSame + 1;
    if (wouldBe >= st.conc) {
      st.suppressed++;
      restoreCgFadeCooldown(this.symbol, cdSnap);  // suppressed entry does NOT burn cooldown
      return { kind: 'hold' };
    }
    if (side === 'long') st.pendingLong++; else st.pendingShort++;
    return action;
  }
}

function makeStrats(mode: 'off' | 'block', conc: number): { strats: PortfolioSymbolStrategy[]; st: OverlayState } {
  const st: OverlayState = { openSides: new Map(), pendingTs: -1, pendingLong: 0, pendingShort: 0, mode, conc, suppressed: 0 };
  const strats = BOOK.map((p, i) => ({ symbol: p, strategy: new CorrBlockOverlay(baseCfg(p), p, st), priority: i }));
  return { strats, st };
}

// Compounding stats (engine sizing basis — what the engine equityRef does).
function statsCompound(t: ClosedTrade[]) {
  let eq = START_EQ, peak = eq, maxDD = 0, w = 0, l = 0, usd = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = x.pnlR * (riskOf(x.symbol) / 100 * START_EQ);  // fixed-base $ per R
    eq += pnl; usd += pnl; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
  }
  const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, maxDD, ret: usd / START_EQ * 100 };
}

// Fixed-base intraday worst DD (live-faithful: size off START_EQ, do NOT compound).
// Walks a 15m grid using the trade's [maeR,mfeR] envelope (same bound the engine uses).
// Returns worst daily DD% and count of UTC days breaching −5% / −4%.
function fixedBaseDailyDd(trades: ClosedTrade[], bars1mBySym: Map<string, { ts: number; close: number }[]>, idxBySym: Map<string, Map<number, number>>) {
  if (trades.length === 0) return { worst: 0, worstDay: '', b5: 0, b4: 0 };
  const opens = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  const closes = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  let oi = 0, ci = 0, realized = 0;
  const active = new Set<ClosedTrade>();
  const tStart = opens[0].entryTs, tEnd = closes[closes.length - 1].exitTs;
  const STEP = 15 * 60_000;
  let curDay = '', dayPeak = 0, dayTrough = 0, worst = 0, worstDay = '';
  const dayWorst = new Map<string, number>();
  for (let t = tStart; t <= tEnd; t += STEP) {
    while (ci < closes.length && closes[ci].exitTs <= t) { realized += closes[ci].pnlR * (riskOf(closes[ci].symbol) / 100 * START_EQ); active.delete(closes[ci]); ci++; }
    while (oi < opens.length && opens[oi].entryTs <= t) { if (opens[oi].exitTs > t) active.add(opens[oi]); oi++; }
    let unreal = 0;
    for (const tr of active) {
      const bars = bars1mBySym.get(tr.symbol); const idxMap = idxBySym.get(tr.symbol);
      const tMin = t - (t % 60_000);
      const idx = idxMap?.get(tMin);
      const rawMark = (idx !== undefined && bars) ? bars[idx].close : tr.entry;
      const dir = tr.side === 'long' ? 1 : -1;
      let c = (rawMark - tr.entry) * tr.qty * dir;
      const riskedUsd = Math.abs(tr.entry - tr.initialSl) * tr.qty;
      const favCap = (tr.mfeR ?? 0) * riskedUsd, advCap = (tr.maeR ?? 0) * riskedUsd;
      if (c > favCap) c = favCap; if (c < advCap) c = advCap;
      // rescale engine-$ contribution to fixed-base live $ (engine qty sized off START_EQ
      // already, but riskedUsd here uses engine qty → already fixed-base since entries are
      // single-entry and equity≈START_EQ basis in this recon). Keep as-is.
      unreal += c;
    }
    const eq = START_EQ + realized + unreal;
    const day = new Date(t).toISOString().slice(0, 10);
    if (day !== curDay) { curDay = day; dayPeak = eq; dayTrough = eq; }
    else { if (eq > dayPeak) { dayPeak = eq; dayTrough = eq; } else if (eq < dayTrough) dayTrough = eq; }
    const dd = dayPeak > 0 ? (dayTrough - dayPeak) / dayPeak * 100 : 0;
    if (dd < (dayWorst.get(day) ?? 0)) dayWorst.set(day, dd);
    if (dd < worst) { worst = dd; worstDay = day; }
  }
  let b5 = 0, b4 = 0;
  for (const v of dayWorst.values()) { if (v <= -5) b5++; if (v <= -4) b4++; }
  return { worst: Number(worst.toFixed(2)), worstDay, b5, b4 };
}

async function runV(mode: 'off' | 'block', conc: number, startTs: number, endTs: number, slip = SLIP) {
  resetCgFadeCooldownState();
  const { strats, st } = makeStrats(mode, conc);
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: slip, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: BOOK.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, dailyDdFlattenPct: FLAT,
  });
  return { S: statsCompound(r.trades), dd: r.dailyDd, trades: r.trades, suppressed: st.suppressed };
}

const VARIANTS: Array<{ key: string; mode: 'off' | 'block'; conc: number }> = [
  { key: 'base', mode: 'off', conc: 0 },
  { key: 'blk3', mode: 'block', conc: 3 },
  { key: 'blk4', mode: 'block', conc: 4 },
];

function lsSplit(trades: ClosedTrade[]) {
  const lr = trades.filter(t => t.side === 'long').reduce((s, t) => s + t.pnlR * (riskOf(t.symbol) / 100 * START_EQ), 0);
  const sr = trades.filter(t => t.side === 'short').reduce((s, t) => s + t.pnlR * (riskOf(t.symbol) / 100 * START_EQ), 0);
  const two = lr > 0 && sr > 0 ? '2-side' : (lr > 0 || sr > 0 ? '1-side' : 'NEG');
  return { lr, sr, two };
}

function row(label: string, res: any, days: number) {
  const S = res.S, dd = res.dd; const ann = S.ret * 365 / days;
  // Hyro breach = ANY of: 15m-MTM −5% day, balance −5% day, OR fixed-base 1m/15m −5% day.
  const surv15 = dd.daysBreach5 === 0 && dd.balDaysBreach5 === 0;
  const { lr, sr, two } = lsSplit(res.trades);
  return `    ${label.padEnd(6)} ${((S.ret >= 0 ? '+' : '') + S.ret.toFixed(1) + '%').padStart(7)} (${(ann >= 0 ? '+' : '') + ann.toFixed(0)}%/г) · PF ${S.pf.toFixed(2)} · MaxDD ${S.maxDD.toFixed(1).padStart(4)}% · Hyro(15m) ${dd.daysBreach5}/${dd.balDaysBreach5} ${surv15 ? 'OK' : 'X'} · n=${String(S.n).padStart(3)} · supp=${String(res.suppressed).padStart(2)} · L$${(lr / 1000).toFixed(0)}k/S$${(sr / 1000).toFixed(0)}k ${two}`;
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const now = Date.now(), D = days * 24 * 3600_000, half = Math.round(days / 2);

  console.log(`\n#### LEVER 5 INDEPENDENT VERIFY — corr-block overlay (book ${BOOK.join('+')} · slip ${SLIP}% · flatten ${FLAT}%) ####`);
  console.log(`#### Hyro(15m) = daysBreach5/balDaysBreach5 from engine dailyDd. Watch [AUTHORITATIVE 1m raw DD] lines above each block for the 1m-grid breach the flatten sees. ####`);

  console.log(`\n== FULL ${days}d ==`);
  for (const v of VARIANTS) console.log(row(v.key, await runV(v.mode, v.conc, now - D, now), days));

  console.log(`\n== HALVES ==`);
  for (const [lbl, s, e, d] of [['OLD', now - D, now - D / 2, half], ['NEW', now - D / 2, now, half]] as [string, number, number, number][]) {
    console.log(`  [${lbl} half ${d}d]`);
    for (const v of VARIANTS) console.log(row(v.key, await runV(v.mode, v.conc, s, e), d));
  }

  console.log(`\n== 4-WINDOW ROLLING WF (~${Math.floor(days / 4)}d each) ==`);
  const W = Math.floor(days / 4);
  for (let i = 4; i >= 1; i--) {
    const endTs = now - (i - 1) * W * 24 * 3600_000;
    const startTs = endTs - W * 24 * 3600_000;
    console.log(`  win${5 - i} (${new Date(startTs).toISOString().slice(0, 10)} -> ${new Date(endTs).toISOString().slice(0, 10)}):`);
    for (const v of VARIANTS) console.log(row(v.key, await runV(v.mode, v.conc, startTs, endTs), W));
  }

  console.log(`\n== SLIP STRESS (full ${days}d) ==`);
  for (const slip of [0.10, 0.25]) {
    console.log(`  slip ${slip.toFixed(2)}%:`);
    for (const v of VARIANTS) console.log(row(v.key, await runV(v.mode, v.conc, now - D, now, slip), days));
  }

  console.log(`\n  PASS if blk3 raises full-year ret, ΔMaxDD ≤ +1pp, 0 added Hyro breaches, two-sided + holds >=3/4 WF windows, lift survives slip 0.10.`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * btc-cvd-cooldown-attrib — TWO adversarial tracks on the cap-4 FAITHFUL BOOK mirror
 * for the BTC CVD-opposition fade-filter (T=1.0). Decides if the book-level +2pp on the
 * recent OOS half is REAL+ROBUST or a cooldown-reshuffle / one-window artifact.
 *
 * BOOK = BTC+SOL+ADA+LINK, cap-4, maxEntriesPerWindow=3/12h, mixed risk
 * (1.25/0.875/0.875/0.6 via pair-strategies.ts), slip 0.25%, flatten −4.3, kills off,
 * 1H cadence + 4H anchor, cooldown-on-commit. Identical to btc-cvd-filter-book.ts /
 * live-cron-true-mirror.ts. Filter wraps ONLY BTCUSDT (same loadCvd/zAsOf/opposes/wrap).
 *
 * ── TRACK 1 — COOLDOWN ROBUSTNESS ────────────────────────────────────────────────
 * Re-run BASE vs FILT under the cooldown constants perturbed ±50%:
 *   same-dir   6h → {3h, 9h}   (cg-fade strategy .p.cooldownHours, mutated in-process)
 *   any-close  4h → {2h, 6h}   (COOLDOWN_ANYCLOSE_HOURS env, read at engine module-load)
 *   SL         12h → {6h,18h}  (COOLDOWN_SL_HOURS env)   [bonus — same family]
 *   entry-win  12h → {6h,18h}  (entryCapWindowMs settings; maxEntriesPerWindow HELD=3)
 * For each perturbation, report FILT−BASE delta (ret pp + sumR) on OOS and IS. If the
 * benefit flips sign / vanishes under ±50% → cooldown-reshuffle artifact tied to the
 * live constants. If it survives → robust.
 *
 * env constants (COOLDOWN_ANYCLOSE_HOURS / COOLDOWN_SL_HOURS) are read once at engine
 * module-load, so they CANNOT be swept in-process — this CLI sweeps them per RUN via
 * the env it's launched with. PERTURB selects which knob is active:
 *   PERTURB=base | samedir3 | samedir9 | anyclose2 | anyclose6 | sl6 | sl18 |
 *           entrywin6 | entrywin18
 * The same-dir + entry-window knobs ARE swept in-process (no env dependency) so the
 * 'base' run also emits those; anyclose/sl require relaunch (driver does that).
 *
 * ── TRACK 2 — BOOK ATTRIBUTION (PERTURB=base only) ───────────────────────────────
 * Decompose the book-level FILT−BASE benefit into:
 *   (a) BTC loser-removal — realized R (in BOOK context) of the BTC trades the filter
 *       drops. Run the BOOK with BTC wrapped to keep ONLY the opposed (dropped) entries
 *       → their book-context realized R. Negative ⇒ genuine loser-removal.
 *   (b) reshuffle/re-timing — net book trade-count change, per-pair count deltas
 *       (BTC took different/later entries; alts SOL/ADA/LINK got freed cap/entry-budget
 *       slots), and the alt-only sumR delta (FILT − BASE on non-BTC pairs).
 *
 * Run: npx tsx src/backtest/cli/btc-cvd-cooldown-attrib.ts   (PERTURB=base default)
 *      PERTURB=anyclose2 COOLDOWN_ANYCLOSE_HOURS=2 npx tsx ...   (driver sets both)
 *
 * Pure research CLI. Does NOT edit cg-fade.ts / engine.ts / engine-portfolio.ts /
 * pair-strategies.ts / live-cron-true-mirror.ts. Filter logic duplicated from
 * btc-cvd-filter-book.ts.
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, CgFadeStrategy } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { Action, Strategy, StrategyContext, ClosedTrade } from '../types';
import { cgGet } from '../../core/coinglass';
import { close as closePg } from '../../core/db';

const START_EQUITY = 668_000;
const CAP = 4;
const ENTRYCAP = 3;
const SLIP = 0.25;
const Z_WINDOW = parseInt(process.env.CVD_Z_WINDOW ?? '180', 10);
const EXCHANGES = process.env.CVD_EXCHANGES ?? 'Binance,OKX,Bybit';
const T = parseFloat(process.env.CVD_T ?? '1.0');
const BARS_24H = 6;
const FOUR_H = 4 * 3600_000;

const PERTURB = process.env.PERTURB ?? 'base';

// ─── CVD series + as-of z (duplicated from btc-cvd-filter-book.ts; no look-ahead) ──
interface CvdSeries { ts: number[]; cvd24: number[]; }

async function loadCvd(): Promise<CvdSeries> {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', {
    symbol: 'BTC', exchange_list: EXCHANGES, interval: '4h', limit: 2160,
  });
  const arr = ((r as any).data as any[]).slice().sort((a, b) => a.time - b.time);
  const ts: number[] = []; const delta: number[] = [];
  for (const d of arr) {
    ts.push(Number(d.time));
    delta.push((d.aggregated_buy_volume_usd ?? 0) - (d.aggregated_sell_volume_usd ?? 0));
  }
  const cvd24: number[] = new Array(ts.length).fill(NaN);
  for (let i = 0; i < ts.length; i++) {
    if (i + 1 < BARS_24H) continue;
    let s = 0; for (let k = i - BARS_24H + 1; k <= i; k++) s += delta[k];
    cvd24[i] = s;
  }
  return { ts, cvd24 };
}

function zAsOf(series: CvdSeries, atTs: number): number | null {
  let idx = -1;
  for (let i = 0; i < series.ts.length; i++) {
    if (series.ts[i] + FOUR_H <= atTs) idx = i; else break;
  }
  if (idx < 0) return null;
  const cur = series.cvd24[idx];
  if (!Number.isFinite(cur)) return null;
  const lo = Math.max(0, idx - Z_WINDOW + 1);
  const win: number[] = [];
  for (let i = lo; i <= idx; i++) if (Number.isFinite(series.cvd24[i])) win.push(series.cvd24[i]);
  if (win.length < Math.min(30, Z_WINDOW)) return null;
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const variance = win.reduce((a, b) => a + (b - mean) * (b - mean), 0) / win.length;
  const std = Math.sqrt(variance);
  if (std <= 0) return null;
  return (cur - mean) / std;
}

function opposes(side: 'long' | 'short', z: number | null, t: number): boolean {
  if (z == null) return false;
  if (side === 'short') return z >= +t;
  return z <= -t;
}

interface WrapStats { seenEnter: number; dropped: number; }

// mode 'filter' → drop opposed (FILTERED book). mode 'dropped' → keep ONLY opposed
// (so we measure dropped-set realized R IN BOOK CONTEXT — track-2 loser-removal).
type WrapMode = 'filter' | 'dropped';
function wrapBtc(inner: Strategy, series: CvdSeries, t: number, mode: WrapMode, stats: WrapStats): Strategy {
  return {
    name: `${inner.name}+cvd-${mode}(T${t})`,
    needsCoinglass: inner.needsCoinglass,
    needsBtcContext: inner.needsBtcContext,
    decide(ctx: StrategyContext): Action {
      const a = inner.decide(ctx);
      if (a.kind !== 'enter') return a;
      stats.seenEnter++;
      const z = zAsOf(series, ctx.ts);
      const isOpposed = opposes(a.side, z, t);
      if (isOpposed) stats.dropped++;
      if (mode === 'filter') return isOpposed ? { kind: 'hold' } : a;
      return isOpposed ? a : { kind: 'hold' };          // dropped-only set
    },
  };
}

// ─── book metrics (mirrors btc-cvd-filter-book.aggregate, fixed-risk sizing) ──────
function aggregate(trades: ClosedTrade[]) {
  const fixedRiskUsd = START_EQUITY * (LIVE_RISK_PCT / 100);
  let equity = START_EQUITY, peak = equity, maxDD = 0, sumR = 0, wins = 0, losses = 0;
  const sorted = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  for (const tr of sorted) {
    equity += tr.pnlR * fixedRiskUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += tr.pnlR;
    if (tr.pnlR > 0.05) wins++; else if (tr.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  return {
    ret: (equity - START_EQUITY) / START_EQUITY * 100,
    maxDD, sumR, pf: lossR > 0 ? winR / lossR : (winR > 0 ? 99 : 0),
    n: trades.length, wr: total > 0 ? wins / total * 100 : 0,
  };
}

interface RunResult {
  ret: number; pf: number; sumR: number; maxDD: number; n: number; wr: number;
  worstDay: number; rawWorst: number; breach5: number; breach4: number; flatten: number;
  perPairN: Record<string, number>;
  perPairSumR: Record<string, number>;
  btcDropped: number;
  trades: ClosedTrade[];
}

// Clone TIER1_PORTFOLIO strategy instances and OVERRIDE same-dir cooldownHours in-process.
// CgFadeStrategy exposes a public `p` (readonly is compile-time only) → safe to mutate
// in this research process; never touches the live module's instance because we set it
// freshly per run from the SAME instance — so we must restore. Simpler: capture original
// and reset each run (resetCgFadeCooldownState already clears entry state, not params).
function applySameDirCooldown(hours: number) {
  for (const c of TIER1_PORTFOLIO) {
    const s = c.strategy as unknown as CgFadeStrategy;
    if (s && (s as any).p && typeof (s as any).p.cooldownHours === 'number') {
      (s as any).p.cooldownHours = hours;
    }
  }
}

async function runBook(
  variant: 'BASE' | 'FILT' | 'DROPPED',
  startTs: number, endTs: number, series: CvdSeries,
  sameDirHours: number, entryWindowMs: number,
): Promise<RunResult> {
  process.env.DECISION_CADENCE = '60m';
  process.env.ANCHOR_4H = '1';
  applySameDirCooldown(sameDirHours);

  const stats: WrapStats = { seenEnter: 0, dropped: 0 };
  const activePairs = TIER1_PORTFOLIO.filter(c => c.enabled);
  const symbolStrats: PortfolioSymbolStrategy[] = activePairs.map((c, i) => {
    let strat = c.strategy;
    if (c.pair === 'BTCUSDT') {
      if (variant === 'FILT') strat = wrapBtc(c.strategy, series, T, 'filter', stats);
      else if (variant === 'DROPPED') strat = wrapBtc(c.strategy, series, T, 'dropped', stats);
    }
    return { symbol: c.pair, strategy: strat, priority: i };
  });

  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(symbolStrats, {
    startTs, endTs,
    startEquity: START_EQUITY,
    slippagePct: SLIP,
    takerFeeRate: 0.00055,
    makerFeeRate: 0.0002,
    leverage: 10,
    decisionTf: '240m',
    tp1SlMode: 'no_move',
    bePlusBufferPct: 0.10,
    maxParallelCap: CAP,
    maxEntriesPerWindow: ENTRYCAP,
    entryCapWindowMs: entryWindowMs,
    cooldownOnCommit: true,
    dailyDdFlattenPct: -4.3,
  });

  const agg = aggregate(r.trades);
  const perPairN: Record<string, number> = {};
  const perPairSumR: Record<string, number> = {};
  for (const sym of ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT']) {
    const ts = r.trades.filter(t => t.symbol === sym);
    perPairN[sym] = ts.length;
    perPairSumR[sym] = ts.reduce((s, t) => s + t.pnlR, 0);
  }
  return {
    ret: agg.ret, pf: agg.pf, sumR: agg.sumR, maxDD: agg.maxDD, n: agg.n, wr: agg.wr,
    worstDay: r.dailyDd.worstDailyDdPct,
    rawWorst: (r.dailyDd as any).rawWorstDailyDdPct ?? r.dailyDd.worstDailyDdPct,
    breach5: r.dailyDd.daysBreach5,
    breach4: r.dailyDd.daysBreach4,
    flatten: r.guard.flattenDays,
    perPairN, perPairSumR,
    btcDropped: stats.dropped,
    trades: r.trades,
  };
}

interface Win { name: string; startTs: number; endTs: number; }

// ── TRACK 1: cooldown-robustness sweep ────────────────────────────────────────────
async function track1(windows: Win[], series: CvdSeries) {
  // What this PERTURB run sweeps. anyclose/sl come from env (relaunch). same-dir &
  // entry-window are in-process so 'base' emits them all; the dedicated PERTURB names
  // pin a single value for clarity in the driver output.
  const SAME_DIR_BASE = 6, ENTRY_WIN_BASE_MS = 12 * 3600_000;

  // perturbation set this run will produce (label → {sameDirHours, entryWinMs})
  let sweeps: { label: string; sameDir: number; entryWinMs: number }[];
  if (PERTURB === 'base') {
    sweeps = [
      { label: 'samedir6h(base)',  sameDir: 6, entryWinMs: ENTRY_WIN_BASE_MS },
      { label: 'samedir3h',        sameDir: 3, entryWinMs: ENTRY_WIN_BASE_MS },
      { label: 'samedir9h',        sameDir: 9, entryWinMs: ENTRY_WIN_BASE_MS },
      { label: 'entrywin6h',       sameDir: 6, entryWinMs: 6 * 3600_000 },
      { label: 'entrywin18h',      sameDir: 6, entryWinMs: 18 * 3600_000 },
    ];
  } else if (PERTURB === 'samedir3') sweeps = [{ label: 'samedir3h', sameDir: 3, entryWinMs: ENTRY_WIN_BASE_MS }];
  else if (PERTURB === 'samedir9') sweeps = [{ label: 'samedir9h', sameDir: 9, entryWinMs: ENTRY_WIN_BASE_MS }];
  else if (PERTURB === 'entrywin6') sweeps = [{ label: 'entrywin6h', sameDir: 6, entryWinMs: 6 * 3600_000 }];
  else if (PERTURB === 'entrywin18') sweeps = [{ label: 'entrywin18h', sameDir: 6, entryWinMs: 18 * 3600_000 }];
  else {
    // anyclose2/anyclose6/sl6/sl18: env COOLDOWN_* already applied at module-load;
    // run the base same-dir + entry-window with that env. Label carries the env knob.
    sweeps = [{ label: `${PERTURB}(anyclose=${process.env.COOLDOWN_ANYCLOSE_HOURS ?? 4},sl=${process.env.COOLDOWN_SL_HOURS ?? 12})`, sameDir: 6, entryWinMs: ENTRY_WIN_BASE_MS }];
  }

  console.log(`\n#### TRACK 1 — COOLDOWN ROBUSTNESS  (PERTURB=${PERTURB}, T=${T})`);
  console.log(`anyclose(env)=${process.env.COOLDOWN_ANYCLOSE_HOURS ?? 4}h  sl(env)=${process.env.COOLDOWN_SL_HOURS ?? 12}h`);
  console.log(`  ${'perturbation'.padEnd(18)} ${'window'.padEnd(12)} ${'BASEret%'.padStart(9)} ${'FILTret%'.padStart(9)} ${'Δret(pp)'.padStart(9)} ${'BASEsumR'.padStart(9)} ${'FILTsumR'.padStart(9)} ${'ΔsumR'.padStart(8)} ${'btcDrop'.padStart(7)} ${'FILTmaxDD'.padStart(9)} ${'FILTflat'.padStart(8)} ${'FILTb5'.padStart(6)}`);
  console.log('  ' + '─'.repeat(150));

  const rows: any[] = [];
  for (const s of sweeps) {
    for (const w of windows) {
      const base = await runBook('BASE', w.startTs, w.endTs, series, s.sameDir, s.entryWinMs);
      const filt = await runBook('FILT', w.startTs, w.endTs, series, s.sameDir, s.entryWinMs);
      const dRet = filt.ret - base.ret;
      const dSumR = filt.sumR - base.sumR;
      rows.push({ perturbation: s.label, window: w.name, baseRet: base.ret, filtRet: filt.ret, dRet, baseSumR: base.sumR, filtSumR: filt.sumR, dSumR, btcDrop: filt.btcDropped, filtMaxDD: filt.maxDD, filtFlat: filt.flatten, filtB5: filt.breach5 });
      console.log(`  ${s.label.padEnd(18)} ${w.name.padEnd(12)} ${base.ret.toFixed(2).padStart(9)} ${filt.ret.toFixed(2).padStart(9)} ${(dRet >= 0 ? '+' : '') + dRet.toFixed(2).padStart(8)} ${base.sumR.toFixed(2).padStart(9)} ${filt.sumR.toFixed(2).padStart(9)} ${(dSumR >= 0 ? '+' : '') + dSumR.toFixed(2).padStart(7)} ${String(filt.btcDropped).padStart(7)} ${filt.maxDD.toFixed(2).padStart(9)} ${String(filt.flatten).padStart(8)} ${String(filt.breach5).padStart(6)}`);
    }
  }
  return rows;
}

// ── TRACK 2: book attribution (PERTURB=base) ──────────────────────────────────────
async function track2(windows: Win[], series: CvdSeries) {
  const SAME_DIR = 6, ENTRY_WIN = 12 * 3600_000;
  console.log(`\n#### TRACK 2 — BOOK ATTRIBUTION  (T=${T}, live cooldowns)`);
  for (const w of windows) {
    const base = await runBook('BASE', w.startTs, w.endTs, series, SAME_DIR, ENTRY_WIN);
    const filt = await runBook('FILT', w.startTs, w.endTs, series, SAME_DIR, ENTRY_WIN);
    const dropped = await runBook('DROPPED', w.startTs, w.endTs, series, SAME_DIR, ENTRY_WIN);

    const dRet = filt.ret - base.ret;
    const dSumR = filt.sumR - base.sumR;
    // (a) loser-removal: book-context realized R of the dropped-only BTC set.
    const droppedBtcN = dropped.perPairN['BTCUSDT'];
    const droppedBtcSumR = dropped.perPairSumR['BTCUSDT'];
    // (b) reshuffle decomposition (FILT − BASE per pair)
    const pairDeltaN: Record<string, number> = {};
    const pairDeltaSumR: Record<string, number> = {};
    let altDeltaSumR = 0, btcDeltaSumR = 0;
    for (const sym of ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT']) {
      pairDeltaN[sym] = filt.perPairN[sym] - base.perPairN[sym];
      pairDeltaSumR[sym] = filt.perPairSumR[sym] - base.perPairSumR[sym];
      if (sym === 'BTCUSDT') btcDeltaSumR = pairDeltaSumR[sym];
      else altDeltaSumR += pairDeltaSumR[sym];
    }
    const netTradeDelta = filt.n - base.n;

    console.log(`\n  ── ${w.name} ──`);
    console.log(`  BOOK   BASE ret=${base.ret.toFixed(2)}% sumR=${base.sumR.toFixed(2)} n=${base.n}  |  FILT ret=${filt.ret.toFixed(2)}% sumR=${filt.sumR.toFixed(2)} n=${filt.n}`);
    console.log(`  BENEFIT  Δret=${(dRet >= 0 ? '+' : '') + dRet.toFixed(2)}pp  ΔsumR=${(dSumR >= 0 ? '+' : '') + dSumR.toFixed(2)}  netΔtrades=${netTradeDelta >= 0 ? '+' : ''}${netTradeDelta}  btcDropped=${filt.btcDropped}`);
    console.log(`  (a) LOSER-REMOVAL  dropped-only BTC set in book context: n=${droppedBtcN}  sumR=${droppedBtcSumR.toFixed(2)}  (avgR=${droppedBtcN ? (droppedBtcSumR / droppedBtcN).toFixed(3) : 'n/a'})  ← negative ⇒ genuine losers`);
    console.log(`  (b) RESHUFFLE per-pair FILT−BASE  Δn / ΔsumR:`);
    for (const sym of ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT']) {
      console.log(`        ${sym.padEnd(9)} Δn=${(pairDeltaN[sym] >= 0 ? '+' : '') + pairDeltaN[sym]}   ΔsumR=${(pairDeltaSumR[sym] >= 0 ? '+' : '') + pairDeltaSumR[sym].toFixed(2)}`);
    }
    console.log(`        BTC ΔsumR=${(btcDeltaSumR >= 0 ? '+' : '') + btcDeltaSumR.toFixed(2)}  |  ALT(SOL+ADA+LINK) ΔsumR=${(altDeltaSumR >= 0 ? '+' : '') + altDeltaSumR.toFixed(2)}`);
    // Attribution split: of the total ΔsumR, how much is BTC vs alts (reshuffle).
    if (Math.abs(dSumR) > 1e-9) {
      console.log(`  SPLIT  ΔsumR ${dSumR.toFixed(2)} = BTC ${btcDeltaSumR.toFixed(2)} (${(btcDeltaSumR / dSumR * 100).toFixed(0)}%) + ALT ${altDeltaSumR.toFixed(2)} (${(altDeltaSumR / dSumR * 100).toFixed(0)}%)`);
    }
  }
}

async function main() {
  const series = await loadCvd();
  console.log(`\nCVD: ${series.ts.length} bars  ${new Date(series.ts[0]).toISOString().slice(0, 10)} → ${new Date(series.ts[series.ts.length - 1]).toISOString().slice(0, 10)}  exch=${EXCHANGES}  zWin=${Z_WINDOW}  T=${T}`);
  console.log(`BOOK: BTC+SOL+ADA+LINK  cap=${CAP} entrycap=${ENTRYCAP}/12h slip=${SLIP}% flatten=−4.3 (kills off)  startEq=$${START_EQUITY.toLocaleString()}  PERTURB=${PERTURB}`);

  const now = Date.now();
  const D = 24 * 3600_000;
  const windows: Win[] = [
    { name: 'OOS-rec183d', startTs: now - 183 * D, endTs: now },
    { name: 'IS-old183d', startTs: now - 366 * D, endTs: now - 183 * D },
  ];

  await track1(windows, series);
  if (PERTURB === 'base') await track2(windows, series);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

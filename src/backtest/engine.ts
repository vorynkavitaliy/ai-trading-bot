import { query } from '../core/db';
import { computeFeatures, CandleRow } from '../data/features';
import { loadCoinglassAt, CoinglassFeatures } from '../data/coinglass-features';
import {
  Action,
  BacktestResult,
  BacktestSettings,
  Bar,
  ClosedTrade,
  OpenPosition,
  Strategy,
  StrategyContext,
} from './types';
import { computeMetrics } from './metrics';
import { log } from '../core/logger';

const FUNDING_INTERVAL_MS = 8 * 60 * 60_000;
// Funding window mirrors runtime/risk-guard.ts: ±10 min around 00/08/16 UTC.
const FUNDING_WINDOW_MIN = 10;
export function isInFundingWindow(ts: number): boolean {
  // Research toggle: NO_FUNDING_WINDOW=1 disables the ±10min funding-settlement entry
  // block so we can A/B whether it helps or hurts (esp. for funding-fade, where it may
  // suppress the freshest signals). LIVE risk-guard is unaffected — backtest-only.
  if (process.env.NO_FUNDING_WINDOW === '1') return false;
  const remainder = ts % FUNDING_INTERVAL_MS;
  const distToPrev = remainder;
  const distToNext = FUNDING_INTERVAL_MS - remainder;
  return Math.min(distToPrev, distToNext) <= FUNDING_WINDOW_MIN * 60_000;
}

// Live risk-guard constants — mirrored here so backtest doesn't over-trade vs prod.
// Sources of truth: src/runtime/risk-guard.ts RISK object.
// Research toggles (backtest-only, default = live values): COOLDOWN_ANYCLOSE_HOURS /
// COOLDOWN_SL_HOURS override the any-close / SL cooldown for cooldown-sensitivity sweeps.
// LIVE risk-guard is unaffected (it has its own constants). When unset, exactly = live.
const COOLDOWN_AFTER_SL_MS =
  (process.env.COOLDOWN_SL_HOURS ? parseFloat(process.env.COOLDOWN_SL_HOURS) : 12) * 3600_000;
const COOLDOWN_AFTER_ANY_CLOSE_MS =
  (process.env.COOLDOWN_ANYCLOSE_HOURS ? parseFloat(process.env.COOLDOWN_ANYCLOSE_HOURS) : 4) * 3600_000;
const MAX_SL_PER_PAIR_PER_DAY = 2;
export const MIN_RR_TP2 = 0.3;
const DAILY_SOFT_KILL_PCT = -2.5;
const DAILY_HARD_KILL_PCT = -4.0;
const TOTAL_KILL_PCT = -8.0;
const TOTAL_HEAT_CAP_PCT = 3.75;
// 6 = legacy default (operator cap 2026-05-25). Per-run overridable via
// makeBacktestRiskState opts so a runner can mirror the CURRENT live cap (2).
const MAX_PARALLEL_POSITIONS = 6;
// Live risk-guard added a rolling per-window entry cap (operator 2026-06-01:
// maxEntriesPerWindow=2 over entryCapWindowHours=12). Disabled by default here
// (research runners predate it); the live-mirror runner enables it so the backtest
// throttles entries exactly like live.
const ENTRY_CAP_WINDOW_MS_DEFAULT = 12 * 3600_000;

/**
 * Risk state shared across runBacktest calls for portfolio-aware backtests.
 * When provided, the engine mirrors live risk-guard checks (cooldowns, kill
 * switches, heat cap, daily SL cap). When omitted, a fresh per-symbol state
 * is created and only per-symbol filters apply (the cross-symbol kills + heat
 * cap stay inactive but per-symbol cooldowns still work).
 */
export interface BacktestRiskState {
  lastSlTs: Map<string, number>;         // pair → ts of last SL close
  lastCloseTs: Map<string, number>;      // pair → ts of last close (any reason)
  slCountByDay: Map<string, number>;     // "YYYY-MM-DD:PAIR" → count
  startEquity: number;                   // baseline for total kill
  dailyOpenEquity: { day: string; equity: number };  // resets at UTC midnight
  // HyroTrader-faithful DDD: peak equity since UTC midnight AND the lowest
  // equity observed AFTER that peak was set (including unrealized P&L in live).
  // Kill switches measure (trough - peak) / peak * 100 so the breach latches on
  // the worst point seen — matching Hyro's "once −5% from peak is touched, the
  // account is dead" semantics. Resets at UTC midnight: a new day reseeds both
  // peak and trough to the opening equity.
  dailyPeakEquity: { day: string; peak: number; trough: number };
  realizedPnlUsd: number;                // cumulative across all pairs (for total kill)
  openPositions: Map<string, { riskedUsd: number; pair: string }>;  // pair → live risk
  // Configurable caps. Defaults = legacy backtest behaviour; the live-mirror runner
  // sets these to current live values so the backtest throttles entries like live.
  maxParallelPositions: number;          // live = 2
  maxEntriesPerWindow: number;           // 0 = disabled (legacy). Live = 2.
  entryCapWindowMs: number;              // rolling window for maxEntriesPerWindow
  entryTsLog: number[];                  // ts of every committed entry (rolling-cap counter)
  disableKillSwitches: boolean;          // when an external daily-DD flatten supersedes the engine kills
}

export interface BacktestRiskOpts {
  maxParallelPositions?: number;
  maxEntriesPerWindow?: number;
  entryCapWindowMs?: number;
  disableKillSwitches?: boolean;
}

export function makeBacktestRiskState(startEquity: number, startTs: number, opts: BacktestRiskOpts = {}): BacktestRiskState {
  const day = new Date(startTs).toISOString().slice(0, 10);
  return {
    lastSlTs: new Map(),
    lastCloseTs: new Map(),
    slCountByDay: new Map(),
    startEquity,
    dailyOpenEquity: { day, equity: startEquity },
    dailyPeakEquity: { day, peak: startEquity, trough: startEquity },
    realizedPnlUsd: 0,
    openPositions: new Map(),
    maxParallelPositions: opts.maxParallelPositions ?? MAX_PARALLEL_POSITIONS,
    maxEntriesPerWindow: opts.maxEntriesPerWindow ?? 0,
    entryCapWindowMs: opts.entryCapWindowMs ?? ENTRY_CAP_WINDOW_MS_DEFAULT,
    entryTsLog: [],
    disableKillSwitches: opts.disableKillSwitches ?? false,
  };
}

/** Record a committed entry for the rolling per-window entry cap. Call wherever a
 *  position is opened (alongside openPositions.set). */
export function recordBacktestEntry(state: BacktestRiskState, ts: number): void {
  state.entryTsLog.push(ts);
}

function dayUtcKey(ts: number): string { return new Date(ts).toISOString().slice(0, 10); }

export function checkBacktestRisk(
  state: BacktestRiskState,
  symbol: string,
  ts: number,
  equity: number,
  projectedRiskUsd: number,
): { allowed: boolean; reason?: string } {
  // 0) Roll daily open equity AND daily peak at UTC midnight
  const today = dayUtcKey(ts);
  if (state.dailyOpenEquity.day !== today) {
    state.dailyOpenEquity = { day: today, equity };
  }
  if (state.dailyPeakEquity.day !== today) {
    state.dailyPeakEquity = { day: today, peak: equity, trough: equity };
  } else if (equity > state.dailyPeakEquity.peak) {
    // Fresh leg up: peak advances and trough resets to the new peak.
    state.dailyPeakEquity.peak = equity;
    state.dailyPeakEquity.trough = equity;
  } else if (equity < state.dailyPeakEquity.trough) {
    state.dailyPeakEquity.trough = equity;
  }
  // 1+2) Engine kill switches (total −8%, daily soft −2.5% / hard −4%). Skipped
  //      when an external daily-DD flatten supersedes them (it IS the kill mech).
  if (!state.disableKillSwitches) {
    // Total kill — terminal portfolio loss
    const totalPnlPct = (equity - state.startEquity) / state.startEquity * 100;
    if (totalPnlPct <= TOTAL_KILL_PCT) {
      return { allowed: false, reason: `total kill: ${totalPnlPct.toFixed(2)}% ≤ ${TOTAL_KILL_PCT}%` };
    }
    // Daily soft/hard kill — DDD = peak − trough (HyroTrader-faithful). Latches
    // on the lowest equity seen since today's peak, so a transient dip to −5%
    // kills the account even if equity recovers before the next risk check.
    const dailyDdFromPeakPct = (state.dailyPeakEquity.trough - state.dailyPeakEquity.peak) / state.dailyPeakEquity.peak * 100;
    if (dailyDdFromPeakPct <= DAILY_HARD_KILL_PCT) {
      return { allowed: false, reason: `hard kill (peak DDD): ${dailyDdFromPeakPct.toFixed(2)}% ≤ ${DAILY_HARD_KILL_PCT}%` };
    }
    if (dailyDdFromPeakPct <= DAILY_SOFT_KILL_PCT) {
      return { allowed: false, reason: `soft kill (peak DDD): ${dailyDdFromPeakPct.toFixed(2)}% ≤ ${DAILY_SOFT_KILL_PCT}%` };
    }
  }
  // 3) Per-pair SL cooldown 12h
  const lastSl = state.lastSlTs.get(symbol);
  if (lastSl != null && ts - lastSl < COOLDOWN_AFTER_SL_MS) {
    const minsLeft = Math.round((COOLDOWN_AFTER_SL_MS - (ts - lastSl)) / 60000);
    return { allowed: false, reason: `SL cooldown ${minsLeft}min remaining` };
  }
  // 4) Per-pair any-close cooldown 4h
  const lastClose = state.lastCloseTs.get(symbol);
  if (lastClose != null && ts - lastClose < COOLDOWN_AFTER_ANY_CLOSE_MS) {
    const minsLeft = Math.round((COOLDOWN_AFTER_ANY_CLOSE_MS - (ts - lastClose)) / 60000);
    return { allowed: false, reason: `any-close cooldown ${minsLeft}min remaining` };
  }
  // 5) Per-pair daily SL cap (2/day)
  const slCount = state.slCountByDay.get(`${today}:${symbol}`) ?? 0;
  if (slCount >= MAX_SL_PER_PAIR_PER_DAY) {
    return { allowed: false, reason: `${slCount} SL today (cap ${MAX_SL_PER_PAIR_PER_DAY})` };
  }
  // 6) Heat budget cap (sum of risk-at-SL across open positions ≤ 3.75% equity)
  const currentHeat = Array.from(state.openPositions.values()).reduce((s, p) => s + p.riskedUsd, 0);
  const projectedHeatPct = (currentHeat + projectedRiskUsd) / equity * 100;
  if (projectedHeatPct > TOTAL_HEAT_CAP_PCT) {
    return { allowed: false, reason: `heat ${projectedHeatPct.toFixed(2)}% > cap ${TOTAL_HEAT_CAP_PCT}%` };
  }
  // 7) Max parallel positions
  if (state.openPositions.size >= state.maxParallelPositions) {
    return { allowed: false, reason: `max parallel positions ${state.maxParallelPositions}` };
  }
  // 8) Rolling per-window entry cap (mirrors live risk-guard maxEntriesPerWindow).
  //    Off when maxEntriesPerWindow === 0. Counts committed entries within the
  //    trailing entryCapWindowMs across the (portfolio-shared) state.
  if (state.maxEntriesPerWindow > 0) {
    const windowStart = ts - state.entryCapWindowMs;
    let recent = 0;
    for (const t of state.entryTsLog) if (t >= windowStart) recent++;
    if (recent >= state.maxEntriesPerWindow) {
      return { allowed: false, reason: `${recent} entries in last ${Math.round(state.entryCapWindowMs / 3600_000)}h (cap ${state.maxEntriesPerWindow})` };
    }
  }
  return { allowed: true };
}

export function updateBacktestRiskOnClose(state: BacktestRiskState, trade: ClosedTrade): void {
  state.lastCloseTs.set(trade.symbol, trade.exitTs);
  // Live trade-repo defines SL as realized_r < 0 (any losing close), regardless
  // of exit_reason. A time_stop with pnl<0, a strategy_exit with pnl<0, even a
  // tp1_then_sl_be — all count as SL for cooldown purposes. Match that.
  if (trade.pnlR < 0) {
    state.lastSlTs.set(trade.symbol, trade.exitTs);
    const day = dayUtcKey(trade.exitTs);
    const key = `${day}:${trade.symbol}`;
    state.slCountByDay.set(key, (state.slCountByDay.get(key) ?? 0) + 1);
  }
  state.realizedPnlUsd += trade.pnlUsd - trade.feesUsd - trade.fundingUsd;
  state.openPositions.delete(trade.symbol);
}

export interface DataBundle {
  barsDecision: Bar[];                // bars at decisionTf — main iteration
  bars1h: Bar[];                       // always loaded for ctx.features1h
  bars1m: Bar[];                       // for SL/TP fill resolution
  bars4h?: Bar[];
  bars1d?: Bar[];
  bars1w?: Bar[];
  btcBars4h?: Bar[];                   // BTC 4H bars when strategy needs cross-pair macro filter
  fundingByTs: Map<number, number>;
}

import { loadBars as loadBarsCanonical } from '../data/candles';

async function loadBars(symbol: string, tf: string, fromTs: number, toTs: number): Promise<Bar[]> {
  return loadBarsCanonical(symbol, tf, { fromTs, toTs });
}

export async function loadData(symbol: string, startTs: number, endTs: number, decisionTf: string, needsBtcContext = false): Promise<DataBundle> {
  // Warmup needed for indicator stability:
  //   1H: 300 bars × 1h ≈ 12.5 days
  //   4H: 300 bars × 4h ≈ 50 days
  //   1D: 200 bars ≈ 200 days
  //   1W: 50 bars ≈ ~1 year
  const warmupHourlyMs = 300 * 60 * 60_000;
  const warmupDailyMs = 250 * 24 * 60 * 60_000;
  const warmupWeeklyMs = 60 * 7 * 24 * 60 * 60_000;

  // Always load 1D + 1W — they are tiny tables (≈365 + 52 rows) and are needed
  // for HTF context (PWL/PWH, daily VP, weekly bias) by structural strategies.
  const wantsMtf = decisionTf === '240m';

  const [bars1h, bars1m, rf, bars4h, bars1d, bars1w] = await Promise.all([
    loadBars(symbol, '60m', startTs - warmupHourlyMs, endTs),
    loadBars(symbol, '1m', startTs - warmupHourlyMs, endTs),
    query<any>(
      `SELECT ts::text, rate::text FROM funding_history
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
      [symbol, startTs - warmupHourlyMs, endTs]
    ),
    wantsMtf ? loadBars(symbol, '240m', startTs - warmupDailyMs, endTs) : Promise.resolve([] as Bar[]),
    loadBars(symbol, '1D', startTs - warmupDailyMs, endTs),
    loadBars(symbol, '1W', startTs - warmupWeeklyMs, endTs),
  ]);

  const fundingByTs = new Map<number, number>();
  for (const row of rf.rows) fundingByTs.set(parseInt(row.ts, 10), parseFloat(row.rate));

  const barsDecision = decisionTf === '240m' ? bars4h : bars1h;

  // BTC 4H bars — only when strategy needs cross-pair macro context AND symbol != BTCUSDT.
  // For BTCUSDT backtest the pair bars ARE the BTC bars, so loading separately is redundant.
  let btcBars4h: Bar[] | undefined;
  if (needsBtcContext && symbol !== 'BTCUSDT') {
    btcBars4h = await loadBars('BTCUSDT', '240m', startTs - warmupDailyMs, endTs);
  } else if (needsBtcContext && symbol === 'BTCUSDT') {
    btcBars4h = bars4h;
  }

  return {
    barsDecision,
    bars1h,
    bars1m,
    bars4h: wantsMtf ? bars4h : undefined,
    bars1d,
    bars1w,
    btcBars4h,
    fundingByTs,
  };
}

// Aggregate hourly bars within [periodStart, cutoff) into a single synthetic
// higher-TF bar. Returns null if no hourly bars fall in the window. Used to
// reconstruct the CURRENT incomplete day/week bar's week-to-date H/L at any
// cutoff during the period — avoids look-ahead bias from DB-stored full-period
// snapshots, and matches what live would observe with realtime data.
export function aggregateHourlyTo(hourly: Bar[], periodStart: number, cutoff: number): Bar | null {
  let open: number | null = null;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  let vol = 0;
  let any = false;
  for (const b of hourly) {
    if (b.ts < periodStart) continue;
    if (b.ts >= cutoff) break;     // hourly bars are sorted ascending
    if (!any) { open = b.open; any = true; }
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    close = b.close;
    vol += b.volume;
  }
  if (!any) return null;
  return { ts: periodStart, open: open!, high, low, close, volume: vol };
}

// UTC period boundaries for the current incomplete day / week containing ts.
export function dayStartUtc(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
export function weekStartUtc(ts: number): number {
  const d = new Date(ts);
  // Bybit weekly bars open on Monday 00:00 UTC. Convert getUTCDay() (Sun=0) so Monday=0.
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysFromMonday);
}

export function applySlippage(price: number, side: 'long' | 'short', kind: 'entry' | 'exit', slipPct: number): number {
  // long entry pays more, exit (sell) gets less
  // short entry sells lower, exit (buy) pays more
  const factor = slipPct / 100;
  if (side === 'long') return kind === 'entry' ? price * (1 + factor) : price * (1 - factor);
  return kind === 'entry' ? price * (1 - factor) : price * (1 + factor);
}

export function calcQty(equity: number, riskPct: number, entry: number, sl: number, leverage: number, maxNotionalPctOfEquity?: number): number {
  const riskUsd = equity * (riskPct / 100);
  const stopDist = Math.abs(entry - sl);
  if (stopDist <= 0) return 0;
  let qty = riskUsd / stopDist;
  // Cap 1: hard leverage cap (HyroTrader compliance, prevents catastrophe)
  const maxNotionalLev = equity * leverage;
  const maxQtyByLev = maxNotionalLev / entry;
  if (qty > maxQtyByLev) qty = maxQtyByLev;
  // Cap 2 (optional): position-size guard — limit notional to N% of equity.
  // Triggers when stopDist is so tight that risk-based qty inflates the position.
  // Result: actual realized risk on this trade < target riskPct, but absolute loss
  // on slippage stays bounded.
  if (maxNotionalPctOfEquity != null && maxNotionalPctOfEquity > 0) {
    const maxNotionalPos = equity * (maxNotionalPctOfEquity / 100);
    const maxQtyByPos = maxNotionalPos / entry;
    if (qty > maxQtyByPos) qty = maxQtyByPos;
  }
  return qty;
}

// Cap a scaled-in slot qty by the SAME leverage / notional ceiling calcQty and
// live execute.ts:368-370 apply. The scaled-in path sizes slotQty = risk/slotDist
// directly; without this cap a tight slotDist (DCA pulling the avg fill toward the
// immutable initialSl on low-vol setups) inflates slotQty far past the live cap —
// the documented DCA-tight-SL artifact (XRPUSDT ~12.8M qty / −8R). Mirrors live so
// the gating metrics (CLAUDE.md rule-5 PF/MaxDD) reflect what live would actually do.
export function capSlotQty(qty: number, equity: number, price: number, leverage: number, maxNotionalPctOfEquity?: number): number {
  let q = qty;
  const maxQtyByLev = (equity * leverage) / price;
  if (q > maxQtyByLev) q = maxQtyByLev;
  if (maxNotionalPctOfEquity != null && maxNotionalPctOfEquity > 0) {
    const maxQtyByPos = (equity * (maxNotionalPctOfEquity / 100)) / price;
    if (q > maxQtyByPos) q = maxQtyByPos;
  }
  return q;
}

// Compute new SL after TP1 fill, given the configured mode.
function newSlAfterTp1(
  side: 'long' | 'short',
  entry: number,
  initialSl: number,
  mode: 'be' | 'be_plus' | 'no_move' | 'halfway',
  bePlusBufferPct: number
): number {
  if (mode === 'no_move') return initialSl;
  if (mode === 'halfway') return (entry + initialSl) / 2;
  if (mode === 'be_plus') {
    return side === 'long'
      ? entry * (1 + bePlusBufferPct / 100)
      : entry * (1 - bePlusBufferPct / 100);
  }
  return entry;  // 'be' default
}

// Fill resolution per minute: scan 1m bars between entry and SL/TP touch
export function resolvePosition(
  pos: OpenPosition,
  bars1m: Bar[],
  startIdx: number,
  endIdx: number,
  funding: Map<number, number>,
  fees: { taker: number; maker: number },
  slipPct: number,
  symbol: string,
  rationale: string,
  riskedUsd: number,
  equityRef: { value: number },
  tp1SlMode: 'be' | 'be_plus' | 'no_move' | 'halfway' = 'be',
  bePlusBufferPct: number = 0.10,
  leverage: number = 10,
  maxNotionalPctOfEquity?: number
): ClosedTrade | null {
  let fundingPaid = pos.fundingPaidUsd;
  for (let i = startIdx; i <= endIdx && i < bars1m.length; i++) {
    const b = bars1m[i];
    // Track MFE/MAE — unrealized PnL extremes during the position's lifetime.
    // For LONG: favorable = bar.high (max profit), adverse = bar.low.
    // For SHORT: favorable = bar.low, adverse = bar.high.
    // Converted to R units via riskedUsd. Stored on `pos` so the closing helper
    // closures can attach final mfeR/maeR + timestamps to the returned ClosedTrade.
    {
      const favPx = pos.side === 'long' ? b.high : b.low;
      const advPx = pos.side === 'long' ? b.low : b.high;
      const favUsd = pos.side === 'long'
        ? (favPx - pos.entry) * pos.qty
        : (pos.entry - favPx) * pos.qty;
      const advUsd = pos.side === 'long'
        ? (advPx - pos.entry) * pos.qty
        : (pos.entry - advPx) * pos.qty;
      const banked = (pos as any).bankedPnl ?? 0;
      const denom = riskedUsd > 0 ? riskedUsd : 1;
      const favR = (banked + favUsd) / denom;
      const advR = (banked + advUsd) / denom;
      const curMfe = (pos as any).mfeR ?? 0;
      const curMae = (pos as any).maeR ?? 0;
      if (favR > curMfe) { (pos as any).mfeR = favR; (pos as any).mfeTs = b.ts; }
      if (advR < curMae) { (pos as any).maeR = advR; (pos as any).maeTs = b.ts; }
    }
    // Apply funding if a funding boundary crossed during this minute
    const fr = funding.get(b.ts);
    if (fr !== undefined) {
      // Bybit pays/receives based on position direction:
      //   long pays positive funding (when rate > 0)
      //   short pays negative funding (when rate < 0)
      const sideSign = pos.side === 'long' ? 1 : -1;
      const positionUsd = pos.qty * b.close;
      fundingPaid += positionUsd * fr * sideSign;
    }

    // Intrabar resolution: when SL and TP are both touched within the same 1m bar,
    // assume WORST CASE — SL fires first. Always. We do NOT know the intra-minute
    // path; inferring it from the bar's close (close>open ⇒ "went up first") is
    // look-ahead — it uses end-of-minute information to decide an ordering that
    // would have been unknown when the SL level was first touched. A faithful,
    // no-look-ahead backtest takes the pessimistic fill on every straddle bar.
    const tpFirst = false;

    // TP fill semantics depend on placement mechanism:
    //   - scaledIn path (execute.ts:placeScaledIn) → TP вешается как position-level
    //     takeProfit с tpTriggerBy:LastPrice = market-on-trigger → taker fee + slip
    //   - legacy path (tpPlanner.SingleLimit/DualLimit) → reduce-only limit в книге
    //     → maker fee, без slip
    // 100% v5-универсума (10 пар) идёт через scaledIn — без ветвления бэктест
    // систематически занижал TP-комиссию на ~3.5 bps + игнорировал slip на закрытии.
    // Aудит 2026-05-29.
    const isScaledInTp = pos.scaledIn != null;
    const tpSlipPct = isScaledInTp ? slipPct : 0;
    const tpFeeRate = isScaledInTp ? fees.taker : fees.maker;
    // --- Helper closures that perform the actual fill & return ClosedTrade ---
    const attachExcursion = (t: ClosedTrade): ClosedTrade => ({
      ...t,
      mfeR: (pos as any).mfeR ?? 0,
      maeR: (pos as any).maeR ?? 0,
      mfeTs: (pos as any).mfeTs,
      maeTs: (pos as any).maeTs,
    });
    const fireSl = (): ClosedTrade => {
      const fillPrice = applySlippage(pos.sl, pos.side, 'exit', slipPct);
      const exitFee = pos.qty * fillPrice * fees.taker;
      const tailPnl = pos.side === 'long'
        ? (fillPrice - pos.entry) * pos.qty
        : (pos.entry - fillPrice) * pos.qty;
      const banked = (pos as any).bankedPnl ?? 0;
      const grossPnl = banked + tailPnl;
      const reason: ClosedTrade['exitReason'] = pos.tp1Hit ? 'tp1_then_sl_be' : 'sl';
      const totalFees = pos.openFeesUsd + exitFee;
      const pnlR = (grossPnl - totalFees - fundingPaid) / riskedUsd;
      return attachExcursion({
        side: pos.side, symbol, entry: pos.entry, exit: fillPrice,
        entryTs: pos.entryTs, exitTs: b.ts, qty: pos.tp1Hit ? pos.qty * 2 : pos.qty,
        sl: pos.sl, initialSl: pos.initialSl, tp1: pos.tp1, tp2: pos.tp2,
        pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
        pnlR, exitReason: reason, rationale,
      });
    };
    const fireTp2Tail = (): ClosedTrade => {
      const fillPrice = applySlippage(pos.tp2!, pos.side, 'exit', tpSlipPct);
      const tailPnl = pos.side === 'long'
        ? (fillPrice - pos.entry) * pos.qty
        : (pos.entry - fillPrice) * pos.qty;
      const tailFee = pos.qty * fillPrice * tpFeeRate;
      const totalFees = pos.openFeesUsd + tailFee;
      const grossPnl = ((pos as any).bankedPnl ?? 0) + tailPnl;
      const pnlR = (grossPnl - tailFee - fundingPaid) / riskedUsd;
      return attachExcursion({
        side: pos.side, symbol, entry: pos.entry, exit: fillPrice,
        entryTs: pos.entryTs, exitTs: b.ts, qty: pos.qty * 2,
        sl: pos.sl, initialSl: pos.initialSl, tp1: pos.tp1, tp2: pos.tp2,
        pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
        pnlR, exitReason: 'tp2', rationale,
      });
    };
    // Fill TP1 partial (mutates pos). Returns true if a same-bar TP2 also filled.
    const fireTp1Partial = (): boolean => {
      const fillPrice = applySlippage(pos.tp1, pos.side, 'exit', tpSlipPct);
      const halfQty = pos.qty / 2;
      const halfPnl = pos.side === 'long'
        ? (fillPrice - pos.entry) * halfQty
        : (pos.entry - fillPrice) * halfQty;
      const halfFee = halfQty * fillPrice * tpFeeRate;
      pos.openFeesUsd += halfFee;
      pos.qty -= halfQty;
      pos.tp1Hit = true;
      pos.sl = newSlAfterTp1(pos.side, pos.entry, pos.initialSl, tp1SlMode, bePlusBufferPct);
      (pos as any).bankedPnl = ((pos as any).bankedPnl ?? 0) + halfPnl - halfFee;
      // Same-bar TP2?
      if (pos.tp2 !== undefined) {
        if (pos.side === 'long' && b.high >= pos.tp2) return true;
        if (pos.side === 'short' && b.low <= pos.tp2) return true;
      }
      return false;
    };

    // Scaled-in: before SL/TP, check if any pending DCA limit fills inside this bar.
    // Fill ALL pending levels touched (price could gap deep). Update avg + recompute TP.
    if (pos.scaledIn && pos.scaledIn.pendingEntries.length > 0) {
      const sin = pos.scaledIn;
      const stillPending: typeof sin.pendingEntries = [];
      for (const e of sin.pendingEntries) {
        const touched = pos.side === 'long' ? b.low <= e.price : b.high >= e.price;
        if (!touched) { stillPending.push(e); continue; }
        // Qty for this slot: per-slot risk % stored on the pending entry (captured
        // at signal time; supports both equal_r and dca_boost sizing modes).
        const slotEquity = equityRef.value;
        const slotRiskUsd = slotEquity * (e.riskPct / 100);
        const slotDist = Math.abs(e.price - pos.initialSl);
        if (slotDist <= 0) continue;
        const slotQty = capSlotQty(slotRiskUsd / slotDist, slotEquity, e.price, leverage, maxNotionalPctOfEquity);
        // Maker fee on limit fill
        const slotFee = slotQty * e.price * fees.maker;
        // Update running totals: new avg = (oldNotional + slotNotional) / (oldQty + slotQty)
        const newNotional = pos.entry * pos.qty + e.price * slotQty;
        const newQty = pos.qty + slotQty;
        pos.entry = newNotional / newQty;
        pos.qty = newQty;
        pos.initialQty = newQty;            // for SL/TP qty refs downstream
        pos.openFeesUsd += slotFee;
        pos.riskedUsd += slotQty * slotDist;  // cumulative R at SL
        sin.filledLevels.push(e.level);
        // Recompute TP only if cfg says so (default true). When false, TP stays
        // locked at initial signal price ± tpAtrMult·ATR — DCA fills boost qty
        // but don't pull the target closer.
        if (sin.cfg.tpRecomputeOnFill !== false) {
          const tpDist = sin.cfg.tpAtrMult * sin.cfg.atr;
          const newTp = pos.side === 'long' ? pos.entry + tpDist : pos.entry - tpDist;
          pos.tp1 = newTp;
          pos.tp2 = newTp;
        }
      }
      sin.pendingEntries = stillPending;
    }

    // Touch detection (raw)
    const slTouched = pos.side === 'long' ? b.low <= pos.sl : b.high >= pos.sl;
    const tp1Touchable = !pos.tp1Hit
      && (pos.side === 'long' ? b.high >= pos.tp1 : b.low <= pos.tp1);
    const tp2TailTouchable = pos.tp1Hit && pos.tp2 !== undefined
      && (pos.side === 'long' ? b.high >= pos.tp2 : b.low <= pos.tp2);

    if (tpFirst) {
      // BULL minute (for long) / BEAR minute (for short): TP fires before SL in same bar.
      if (tp1Touchable) {
        const tp2InSameBar = fireTp1Partial();
        if (tp2InSameBar) return fireTp2Tail();
        // After TP1 partial, SL has moved (no_move/be/be_plus). Check whether
        // the (possibly new) SL still gets hit in this bar — only if the bar
        // ALSO crossed it. For 'no_move' SL is unchanged, so the same low/high
        // applies. For 'be' / 'be_plus' the new SL is near entry — also could be hit.
        const slHitNow = pos.side === 'long' ? b.low <= pos.sl : b.high >= pos.sl;
        if (slHitNow) return fireSl();
        continue;
      }
      if (tp2TailTouchable) return fireTp2Tail();
      if (slTouched) return fireSl();
    } else {
      // BEAR minute (for long) / BULL minute (for short) / doji: SL fires before TP in same bar.
      if (slTouched) return fireSl();
      if (tp1Touchable) {
        const tp2InSameBar = fireTp1Partial();
        if (tp2InSameBar) return fireTp2Tail();
        continue;
      }
      if (tp2TailTouchable) return fireTp2Tail();
    }
  }
  // No SL/TP touch in the scanned window — position remains open.
  // Persist updated funding accumulator so the next call continues correctly.
  pos.fundingPaidUsd = fundingPaid;
  return null;
}

export async function runBacktest(
  strategy: Strategy,
  settings: BacktestSettings,
  externalRiskState?: BacktestRiskState,
): Promise<BacktestResult> {
  log.info('backtest start', {
    strategy: strategy.name,
    symbol: settings.symbol,
    from: new Date(settings.startTs).toISOString(),
    to: new Date(settings.endTs).toISOString(),
    startEquity: settings.startEquity,
  });
  const decisionTf = settings.decisionTf ?? '60m';
  const data = await loadData(settings.symbol, settings.startTs, settings.endTs, decisionTf, strategy.needsBtcContext);
  const trades: ClosedTrade[] = [];
  const equityCurve: { ts: number; equity: number }[] = [];
  const equityRef = { value: settings.startEquity };
  equityCurve.push({ ts: settings.startTs, equity: equityRef.value });

  const fees = { taker: settings.takerFeeRate, maker: settings.makerFeeRate };
  let position: OpenPosition | null = null;
  let lastClosedTrade: StrategyContext['lastClosedTrade'] = undefined;
  // Risk state — shared with caller (for portfolio backtests) or fresh per-symbol.
  const riskState: BacktestRiskState = externalRiskState ?? makeBacktestRiskState(settings.startEquity, settings.startTs);

  // Index 1m bars by ts for fast lookup of position resolution start
  const tsTo1mIdx = new Map<number, number>();
  data.bars1m.forEach((b, i) => tsTo1mIdx.set(b.ts, i));

  // Iteration drives over bars at decisionTf (1H by default; 4H for MTF strategies).
  const allDecision = data.barsDecision;
  const idxStartActive = allDecision.findIndex((b) => b.ts >= settings.startTs);
  if (idxStartActive < 0) {
    log.warn('no decision bars in active window', { symbol: settings.symbol, decisionTf });
    return {
      symbol: settings.symbol, trades, startEquity: settings.startEquity,
      endEquity: equityRef.value,
      metrics: computeMetrics(trades, settings.startEquity, equityCurve),
      equityCurve,
    };
  }

  // Iteration semantics: at iteration `i`, we are at the OPEN time of bar[i]
  // (= close time of bar[i-1]). All bars 0..i-1 are closed and known.
  // Decisions use bar[i-1]. Entry executes at bar[i]'s first 1m bar.
  // Position resolution scans 1m bars in [entry+1m, now-1m].
  for (let i = idxStartActive; i < allDecision.length; i++) {
    const nowBar = allDecision[i];
    const nowTs = nowBar.ts;
    if (nowTs > settings.endTs) break;

    // 1) Resolve open position up to (but not including) nowTs.
    if (position) {
      const pos = position;
      const entry1mIdx = tsTo1mIdx.get(pos.entryTs) ?? data.bars1m.findIndex((b) => b.ts >= pos.entryTs);
      // last 1m bar that ENDED strictly before nowTs:
      const nowIdxLookup = tsTo1mIdx.get(nowTs);
      const endIdx = (nowIdxLookup !== undefined ? nowIdxLookup : data.bars1m.findIndex((b) => b.ts >= nowTs)) - 1;
      // Advance start past previously-scanned bars to prevent funding double-count.
      const startIdx = (pos.lastScanned1mIdx ?? entry1mIdx) + 1;
      if (endIdx >= startIdx) {
        const closed = resolvePosition(
          pos, data.bars1m,
          startIdx, endIdx,
          data.fundingByTs, fees, settings.slippagePct,
          settings.symbol, pos.rationale,
          pos.riskedUsd,
          equityRef,
          settings.tp1SlMode ?? 'be',
          settings.bePlusBufferPct ?? 0.10,
          settings.leverage,
          settings.maxNotionalPctOfEquity
        );
        if (closed) {
          trades.push(closed);
          equityRef.value += closed.pnlUsd - closed.feesUsd - closed.fundingUsd;
          equityCurve.push({ ts: closed.exitTs, equity: equityRef.value });
          lastClosedTrade = { exitTs: closed.exitTs, exitReason: closed.exitReason, side: closed.side };
          updateBacktestRiskOnClose(riskState, closed);
          position = null;
        } else {
          pos.lastScanned1mIdx = endIdx;
        }
      }
    }

    // 2026-05-20: previously `if (position) continue` skipped strategy entirely while
    // position open. Now we still call strategy with position context — strategy may
    // return 'exit' if a reverse-direction setup is detected (thesis flipped).
    if (i < 1) continue;

    // 2) Build features from bars 0..i-1 (all CLOSED).
    const decisionBar = allDecision[i - 1];
    const sliceStart = Math.max(0, i - 300);
    const sliceDecision = allDecision.slice(sliceStart, i).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    if (sliceDecision.length < 200) continue;
    const featDecision = computeFeatures(settings.symbol, decisionTf, sliceDecision);

    // Multi-TF features. featDecision is whatever TF we iterate on.
    // featuresD/W are now always computed (cheap) — strategies use them or ignore.
    let feat1h = featDecision;
    let feat4h: any = undefined;
    let featD: any = undefined;
    let featW: any = undefined;
    const cutoff1h = nowTs;
    // D/W bars in DB store full-bar H/L (Bybit snapshot of closed candle, or for
    // recently-inserted bars: frozen at open due to ON CONFLICT DO NOTHING). Both
    // cases are wrong for backtest:
    //   - Historical bars (full H/L): including the current incomplete bar leaks
    //     future H/L to strategy → structural stops artificially wide → inflated WR
    //   - Recent bars (frozen at open): useless data
    // Fix: keep DB bars only for fully-CLOSED periods; reconstruct the current
    // incomplete period's bar from hourly data, capped at cutoff. This gives
    // strategy a faithful week-to-date / day-to-date snapshot.
    const ONE_DAY_MS = 86_400_000;
    const ONE_WEEK_MS = 7 * ONE_DAY_MS;
    if (decisionTf === '240m') {
      feat4h = featDecision;
      const closed1h = data.bars1h.filter((b) => b.ts < cutoff1h);
      const slice1h = closed1h.slice(-300).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (slice1h.length >= 100) feat1h = computeFeatures(settings.symbol, '60m', slice1h);
    }
    if (data.bars1d) {
      const closedD = data.bars1d.filter((b) => b.ts + ONE_DAY_MS <= cutoff1h);
      const curDayStart = dayStartUtc(cutoff1h);
      const synthD = aggregateHourlyTo(data.bars1h, curDayStart, cutoff1h);
      const allD = synthD ? [...closedD, synthD] : closedD;
      const sliceD = allD.slice(-250).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (sliceD.length >= 50) featD = computeFeatures(settings.symbol, '1D', sliceD);
    }
    if (data.bars1w) {
      const closedW = data.bars1w.filter((b) => b.ts + ONE_WEEK_MS <= cutoff1h);
      const curWeekStart = weekStartUtc(cutoff1h);
      const synthW = aggregateHourlyTo(data.bars1h, curWeekStart, cutoff1h);
      const allW = synthW ? [...closedW, synthW] : closedW;
      const sliceW = allW.slice(-60).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (sliceW.length >= 20) featW = computeFeatures(settings.symbol, '1W', sliceW);
    }

    const fundingTs = [...data.fundingByTs.keys()].filter((t) => t <= decisionBar.ts);
    const lastFundingTs = fundingTs.length > 0 ? Math.max(...fundingTs) : null;
    const fundingRate = lastFundingTs ? data.fundingByTs.get(lastFundingTs) : undefined;

    let coinglass: CoinglassFeatures | undefined;
    if (strategy.needsCoinglass) {
      const coin = settings.symbol.replace(/USDT$/, '');
      // CG читается на decisionBar.ts — соответствует scan-decide.ts:146 (live).
      // Live decisionBar = last closed 1H bar; backtest decisionBar = bar[i-1] на decisionTf.
      // Для 4H decisionTf это даёт разную granularity (одно 4H назад vs одно 1H назад),
      // что вероятно объясняет частичный разрыв signal-rate live vs backtest.
      // CG-availability lag (fidelity research, default 0 = unchanged). Live can't read a
      // just-closed 4H CG bar until ~next cron (Coinglass publish + our hourly cg-incremental
      // ingest). Setting CG_AVAIL_LAG_MS>0 delays when the backtest "sees" a CG bar, matching
      // that lag — measures how much the +1h entry delay costs vs boundary-prompt entry.
      const cgLagMs = parseInt(process.env.CG_AVAIL_LAG_MS ?? '0', 10);
      coinglass = await loadCoinglassAt(coin, settings.symbol, decisionBar.ts - cgLagMs);
    }

    // Recent bars at decisionTf — used by strategies for structural SL placement.
    // 200 bars: enough for EMA50 trend on 4H, EMA200 on 1H. Strategies that need
    // only the last N take slice(-N) themselves.
    const recentBars = allDecision.slice(Math.max(0, i - 200), i);
    // HTF recent slices: closed bars + synthetic current-period bar from hourly aggregation.
    // 400 bars = ~16 days of hourly. Strategies that compute "previous closed week
    // H/L" from hourly need >= 14 days of history.
    const bars1hRecent = data.bars1h.filter((b) => b.ts < cutoff1h).slice(-400);
    const closedDRecent = data.bars1d ? data.bars1d.filter((b) => b.ts + ONE_DAY_MS <= cutoff1h) : [];
    const synthDRecent = data.bars1d ? aggregateHourlyTo(data.bars1h, dayStartUtc(cutoff1h), cutoff1h) : null;
    const bars1dRecent = (synthDRecent ? [...closedDRecent, synthDRecent] : closedDRecent).slice(-60);
    const closedWRecent = data.bars1w ? data.bars1w.filter((b) => b.ts + ONE_WEEK_MS <= cutoff1h) : [];
    const synthWRecent = data.bars1w ? aggregateHourlyTo(data.bars1h, weekStartUtc(cutoff1h), cutoff1h) : null;
    const bars1wRecent = (synthWRecent ? [...closedWRecent, synthWRecent] : closedWRecent).slice(-12);
    // BTC 4H bars for cross-pair macro filter (CG-fade altcoin strategies).
    // Only populated when strategy.needsBtcContext = true (engine loaded BTC bars in loadData).
    const btcBars4hRecent = data.btcBars4h
      ? data.btcBars4h.filter((b) => b.ts < cutoff1h).slice(-200)
      : undefined;

    const ctx: StrategyContext = {
      symbol: settings.symbol,
      ts: nowTs,
      price: decisionBar.close,
      features1h: feat1h,
      features4h: feat4h,
      featuresD: featD,
      featuresW: featW,
      fundingRate,
      position,  // 2026-05-20: strategy now sees its own open position for reverse-signal exits
      coinglass,
      recentBars,
      bars1hRecent,
      bars1dRecent,
      bars1wRecent,
      btcBars4hRecent,
      lastClosedTrade,
    };
    let action = strategy.decide(ctx);

    // Reverse-signal exit: strategy asks to close current position
    if (action.kind === 'exit' && position) {
      const next1mIdx = tsTo1mIdx.get(nowTs) ?? data.bars1m.findIndex((b) => b.ts >= nowTs);
      if (next1mIdx >= 0) {
        const exitBar = data.bars1m[next1mIdx];
        const fillPrice = applySlippage(exitBar.open, position.side, 'exit', settings.slippagePct);
        const exitFee = position.qty * fillPrice * fees.taker;
        const grossPnl = position.side === 'long'
          ? (fillPrice - position.entry) * position.qty
          : (position.entry - fillPrice) * position.qty;
        const totalFees = position.openFeesUsd + exitFee;
        const netPnl = grossPnl - totalFees - position.fundingPaidUsd;
        const pnlR = position.riskedUsd > 0 ? netPnl / position.riskedUsd : 0;
        trades.push({
          side: position.side, symbol: settings.symbol,
          entry: position.entry, exit: fillPrice,
          entryTs: position.entryTs, exitTs: exitBar.ts,
          qty: position.initialQty,
          sl: position.initialSl, initialSl: position.initialSl, tp1: position.tp1, tp2: position.tp2,
          pnlUsd: netPnl, feesUsd: totalFees, fundingUsd: position.fundingPaidUsd,
          pnlR, exitReason: 'strategy_exit', rationale: action.reason,
          mfeR: (position as any).mfeR ?? Math.max(0, pnlR),
          maeR: (position as any).maeR ?? Math.min(0, pnlR),
          mfeTs: (position as any).mfeTs ?? exitBar.ts,
          maeTs: (position as any).maeTs ?? exitBar.ts,
        });
        equityRef.value += netPnl;
        equityCurve.push({ ts: exitBar.ts, equity: equityRef.value });
        lastClosedTrade = { exitTs: exitBar.ts, exitReason: 'strategy_exit', side: position.side };
        // Build a synthetic ClosedTrade for risk state update (strategy_exit path)
        updateBacktestRiskOnClose(riskState, trades[trades.length - 1]);
        position = null;
      }
      continue;
    }

    // Skip if hold OR if position still open (don't pyramid)
    if (action.kind !== 'enter' || position) continue;

    // 3) Open position at first 1m bar after decision time.
    //
    // Default (cronRealistic=false): entry на следующем 1m баре сразу после
    // 4H close — мгновенное теоретическое исполнение.
    //
    // cronRealistic=true: эмулирует реальную задержку live cron-pipeline.
    // Декабрь срабатывает на 4H close (например 16:00 UTC). Live cron бежит
    // в HH:00-04 каждого часа, scan-decide → auto-execute → execute.ts. Первое
    // окно когда entry может пройти — следующий HH:00 ПОСЛЕ funding window.
    // Если 4H close на 16:00, funding window 16:00-16:10 → first valid cron = 17:00.
    // Если 4H close на 12:00 (нет funding) → first valid cron = 13:00.
    let entryTs = nowTs;
    if (settings.cronRealistic) {
      // Округляем nowTs (decision bar close) до следующего HH:00, потом ищем
      // первый HH:00 который НЕ в funding window. Шагаем по 1 часу до ОК.
      const MS_HOUR = 3_600_000;
      entryTs = Math.ceil(nowTs / MS_HOUR) * MS_HOUR;
      // CRON_FAST_ENTRY=1 models the POST-cycle.sh-fix live: cg-incremental now runs
      // BEFORE scan-decide, so a 4H close at a NON-funding hour (04/12/20 UTC) is acted
      // on the SAME-hour cron (~+2-3min), not +1h. Funding-boundary closes (00/08/16)
      // still defer via the funding-window skip below. Default (unset) keeps the legacy
      // +1h deferral that models the OLD buggy live (stale-CG read → caught next hour).
      // Research toggle only — live execution path is unaffected.
      if (!(process.env.CRON_FAST_ENTRY === '1') && entryTs <= nowTs) entryTs += MS_HOUR;
      // Защитный лимит: 12 часов вперёд. Если ничего не нашли — пропускаем сигнал.
      let attempts = 0;
      while (isInFundingWindow(entryTs) && attempts < 12) {
        entryTs += MS_HOUR;
        attempts++;
      }
      if (attempts >= 12) continue;
    }
    const next1mIdx = tsTo1mIdx.get(entryTs) ?? data.bars1m.findIndex((b) => b.ts >= entryTs);
    if (next1mIdx < 0) continue;
    const next1m = data.bars1m[next1mIdx];

    // Live risk-guard blocks entries inside the funding window (±10 min around
    // 00/08/16 UTC). Mirror that filter here so backtest doesn't over-count
    // trades that would never execute in production.
    if (isInFundingWindow(next1m.ts)) continue;

    // Quality gate: skip low rrTp2 setups (mirrors scan-decide minRrTp2 filter).
    const rrTp2Dist = action.tp2 != null ? Math.abs(action.tp2 - action.entryPrice) : Math.abs(action.tp1 - action.entryPrice);
    const stopDist = Math.abs(action.entryPrice - action.sl);
    if (stopDist > 0 && rrTp2Dist / stopDist < MIN_RR_TP2) continue;

    // Mirror live risk-guard: cooldowns + daily SL cap + kill switches + heat cap.
    // projectedRiskUsd uses ENTRY price + sizePct + slDist for sizing — approximates
    // what calcQty will produce below.
    const projectedRiskUsd = equityRef.value * (action.sizePct / 100);
    const riskCheck = checkBacktestRisk(riskState, settings.symbol, next1m.ts, equityRef.value, projectedRiskUsd);
    if (!riskCheck.allowed) continue;

    if (action.scaledIn) {
      // ─── Scaled-in entry: place 1st entry (market or limit), queue remaining N-1 limits ───
      const cfg = action.scaledIn;
      const dir = action.side === 'long' ? -1 : +1;     // limits below for long, above for short
      const firstFillPrice = action.orderType === 'market'
        ? applySlippage(next1m.open, action.side, 'entry', settings.slippagePct)
        : action.entryPrice;
      // cronRealistic: НЕ сдвигаем action.sl и action.entryPrice. В live (execute.ts:431,426)
      // SL вешается на args.sl, а TP на args.entryPrice + atr*tpMult — оба от STRATEGY DECISION
      // price, не от actual slot-1 fill price. Movement цены между 4H close и cron-tick меняет
      // только slot-1 fill, но не уровни SL/TP. Раньше я ошибочно сдвигал — отменено 2026-05-29.
      // Per-slot risk allocation (in %). Three modes:
      //   equal_r: each slot risks sizePct/N
      //   dca_boost: slot[i] = sizePct × decay^i (slot 0 is baseline-sized)
      //   custom_weights: explicit array (caller passes weights; slot[i] = sizePct × weight[i])
      const sizingMode = cfg.sizingMode ?? 'dca_boost';   // match live execute.ts default
      const decay = cfg.dcaBoostDecay ?? 0.5;
      const slotRiskPcts: number[] = [];
      if (sizingMode === 'custom_weights') {
        const weights = cfg.customWeights ?? [];
        for (let i = 0; i < cfg.nEntries; i++) {
          const w = weights[i] ?? 0;
          slotRiskPcts.push(action.sizePct * w);
        }
      } else if (sizingMode === 'equal_r') {
        for (let i = 0; i < cfg.nEntries; i++) slotRiskPcts.push(action.sizePct / cfg.nEntries);
      } else {
        for (let i = 0; i < cfg.nEntries; i++) slotRiskPcts.push(action.sizePct * Math.pow(decay, i));
      }
      const riskPerSlotPct = slotRiskPcts[0];     // for slot #0 below; pendingEntries store per-level percent
      const slotRiskUsd = equityRef.value * (riskPerSlotPct / 100);
      const slotDist = Math.abs(firstFillPrice - action.sl);
      if (slotDist <= 0) continue;
      const firstQty = capSlotQty(slotRiskUsd / slotDist, equityRef.value, firstFillPrice, settings.leverage, settings.maxNotionalPctOfEquity);
      const firstFee = firstQty * firstFillPrice * (action.orderType === 'market' ? fees.taker : fees.maker);

      // Build pending entries for levels 2..N. Each carries its own risk-pct
      // so engine can size correctly when DCA fills (sizing mode is captured
      // here at signal time so a later strategy change doesn't affect open trades).
      const pendingEntries: { price: number; level: number; riskPct: number }[] = [];
      for (let lvl = 1; lvl < cfg.nEntries; lvl++) {
        const ep = firstFillPrice + dir * lvl * cfg.spacingAtr * cfg.atr;
        // Skip levels that would be beyond SL (can never fill before SL triggers)
        const onCorrectSide = action.side === 'long' ? ep > action.sl : ep < action.sl;
        if (!onCorrectSide) continue;
        pendingEntries.push({ price: ep, level: lvl + 1, riskPct: slotRiskPcts[lvl] });
      }

      // TP starts at first entry + tpAtrMult·ATR (legacy: anchored to firstFillPrice,
      // not strategy decision price). Re-tested 2026-05-29: anchoring to action.tp1
      // in cronRealistic mode caused trade R-multiple artifacts on tight-SL DCA
      // setups (XRPUSDT showed -8R/trade). Revert to legacy until DCA-tight-SL
      // bug is fixed separately.
      const tpInit = action.side === 'long'
        ? firstFillPrice + cfg.tpAtrMult * cfg.atr
        : firstFillPrice - cfg.tpAtrMult * cfg.atr;

      position = {
        side: action.side,
        qty: firstQty,
        initialQty: firstQty,
        entry: firstFillPrice,
        entryTs: next1m.ts,
        sl: action.sl,
        initialSl: action.sl,
        tp1: tpInit,
        tp2: tpInit,
        tp1Hit: false,
        rationale: action.rationale,
        openFeesUsd: firstFee,
        fundingPaidUsd: 0,
        riskedUsd: firstQty * slotDist,
        lastScanned1mIdx: next1mIdx,
        scaledIn: {
          pendingEntries,
          cfg,
          riskPerSlotPct,
          filledLevels: [1],
        },
      };
      riskState.openPositions.set(settings.symbol, { riskedUsd: position.riskedUsd, pair: settings.symbol });
      recordBacktestEntry(riskState, next1m.ts);
    } else {
      // ─── Legacy single-entry path ───
      const fillPrice = action.orderType === 'market'
        ? applySlippage(next1m.open, action.side, 'entry', settings.slippagePct)
        : action.entryPrice;

      const qty = calcQty(equityRef.value, action.sizePct, fillPrice, action.sl, settings.leverage, settings.maxNotionalPctOfEquity);
      if (qty <= 0) continue;
      const entryFee = qty * fillPrice * (action.orderType === 'market' ? fees.taker : fees.maker);

      position = {
        side: action.side,
        qty,
        initialQty: qty,
        entry: fillPrice,
        entryTs: next1m.ts,
        sl: action.sl,
        initialSl: action.sl,
        tp1: action.tp1,
        tp2: action.tp2,
        tp1Hit: false,
        rationale: action.rationale,
        openFeesUsd: entryFee,
        fundingPaidUsd: 0,
        riskedUsd: Math.abs(fillPrice - action.sl) * qty,
        lastScanned1mIdx: next1mIdx,
      };
      // Register with risk state for cross-pair heat tracking + parallel cap
      riskState.openPositions.set(settings.symbol, { riskedUsd: position.riskedUsd, pair: settings.symbol });
      recordBacktestEntry(riskState, next1m.ts);
    }
  }

  // Close any leftover position at last bar (true time stop — end of test window)
  if (position) {
    const last1m = data.bars1m[data.bars1m.length - 1];
    const fillPrice = applySlippage(last1m.close, position.side, 'exit', settings.slippagePct);
    const exitFee = position.qty * fillPrice * fees.taker;
    const tailPnl = position.side === 'long'
      ? (fillPrice - position.entry) * position.qty
      : (position.entry - fillPrice) * position.qty;
    const totalFees = position.openFeesUsd + exitFee;
    const grossPnl = ((position as any).bankedPnl ?? 0) + tailPnl;
    const pnlR = (grossPnl - exitFee - position.fundingPaidUsd) / position.riskedUsd;
    trades.push({
      side: position.side, symbol: settings.symbol,
      entry: position.entry, exit: fillPrice,
      entryTs: position.entryTs, exitTs: last1m.ts,
      qty: position.qty * (position.tp1Hit ? 2 : 1),
      sl: position.sl, initialSl: position.initialSl, tp1: position.tp1, tp2: position.tp2,
      pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: position.fundingPaidUsd,
      pnlR, exitReason: 'time_stop', rationale: position.rationale,
      mfeR: (position as any).mfeR ?? Math.max(0, pnlR),
      maeR: (position as any).maeR ?? Math.min(0, pnlR),
      mfeTs: (position as any).mfeTs ?? last1m.ts,
      maeTs: (position as any).maeTs ?? last1m.ts,
    });
    equityRef.value += grossPnl - totalFees - position.fundingPaidUsd;
    equityCurve.push({ ts: last1m.ts, equity: equityRef.value });
    updateBacktestRiskOnClose(riskState, trades[trades.length - 1]);
  }

  const metrics = computeMetrics(trades, settings.startEquity, equityCurve);
  log.info('backtest complete', {
    symbol: settings.symbol, trades: metrics.trades, totalR: metrics.totalR,
    PF: metrics.profitFactor, MaxDD: metrics.maxDDPct,
  });

  return {
    symbol: settings.symbol,
    trades,
    startEquity: settings.startEquity,
    endEquity: equityRef.value,
    metrics,
    equityCurve,
  };
}

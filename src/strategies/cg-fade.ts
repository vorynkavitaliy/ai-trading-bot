/**
 * Coinglass-based fade strategies — validated on 365d backtest via walk-forward (2026-05-23).
 *
 * Common setup mechanic:
 *   - Detect extreme percentile of some CG signal (last 180 4H bars = 30 days).
 *   - Fade the crowd: extreme high → SHORT, extreme low → LONG.
 *   - Filter by pair's own 4H EMA20/50 trend and/or BTC 4H trend.
 *   - SL at ATR(14) × multiplier, TP at ATR × multiplier.
 *   - Max hold N × 4H bars; time-stop at market.
 *
 * Used in live (Tier-1 portfolio):
 *   S1 (LsTopPositionFade + pair trend)  — BTCUSDT
 *   S2 (LsTopPositionFade + BTC trend)   — INJUSDT, LTCUSDT
 *   S3 (FundingFade + both trends)        — TAO, ATOM, ARB (and ETH/DOGE/SOL/APT 3/4-q tier)
 *   S4 (FundingTaConfluence)              — XRP
 *
 * Realistic cost assumptions:
 *   - Limit entries → maker fee, no slip.
 *   - TP1/TP2 limits → maker fee, no slip.
 *   - SL market trigger → taker fee + slip applied by engine.
 *
 * Decision cadence: 4H (240m). All strategies need decisionTf: '240m' on the engine.
 *
 * OOP shape (2026-05-24):
 *   Abstract base class `CgFadeStrategy` owns the common flow (hold-on-position,
 *   CG presence, cooldown, trend filters, ATR-based SL/TP). Subclasses only
 *   implement `extractSide(cg, p)` — they map CG history → percentile → side +
 *   rationale. Adding a new CG-fade variant means writing one class, not
 *   copy-pasting the skeleton (OCP).
 */
import { Action, Strategy, StrategyContext, Bar } from '../backtest/types';
import { CoinglassFeatures } from '../data/coinglass-features';
import { atr, percentile, trendUp } from '../core/indicators';

export interface CgFadeParams {
  pctHi: number;
  pctLo: number;
  windowBars: number;     // 180 = 30d × 6 (4H bars)
  atrPeriod: number;
  slAtrMult: number;
  // Single TP target at tpAtrMult × ATR. Strategy returns tp1=tp2; execute.ts
  // detects this and places ONE reduce-only limit (full qty).
  // Backtest (single target): WR 54.8%, PF 1.53, +88.88%/yr — winner vs true
  // partial split (worse on every variant tested).
  tpAtrMult: number;
  maxHoldBars: number;
  riskPct: number;
  usePairTrend: boolean;
  useBtcTrend: boolean;
  emaFast: number;
  emaSlow: number;
  cooldownHours: number;        // same-direction cooldown after ENTRY (was: only mechanic)
  cooldownAfterTpHours?: number; // optional: prevent re-entry within X hours after a TP close
  // Scaled-in entry: when set, split the single limit entry into N orders
  // spaced by spacingAtr·ATR.
  scaledIn?: {
    nEntries: number;
    spacingAtr: number;
    tpAtrMult: number;
    sizingMode?: 'equal_r' | 'dca_boost' | 'custom_weights';
    dcaBoostDecay?: number;
    customWeights?: number[];      // used when sizingMode='custom_weights'
    tpRecomputeOnFill?: boolean;   // false = TP locked at signal price + tpAtrMult·ATR
  };
}

const DEFAULTS: CgFadeParams = {
  pctHi: 0.85, pctLo: 0.15, windowBars: 180,
  atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 2.0,
  maxHoldBars: 12,
  riskPct: 0.5,
  usePairTrend: false, useBtcTrend: false,
  emaFast: 20, emaSlow: 50,
  cooldownHours: 6,
};

// In-process cooldown state (legacy). Used by backtest engines where the entire
// run lives in a single process. Live (scan-decide) instead loads the cooldown
// snapshot from the strategy_cooldowns DB table and passes it via
// StrategyContext.cooldownState — see src/core/strategy-cooldowns.ts. The DB
// path survives cron forks; this in-process Map does not (it resets on every
// `npx tsx` invocation, which silently disabled the cooldown in production).
const lastEntryByPair: Map<string, { side: 'long' | 'short'; ts: number }> = new Map();
export function resetCgFadeCooldownState() { lastEntryByPair.clear(); }
// Snapshot/restore the in-process cooldown for one pair. Used by the backtest
// engine to implement "cooldown-on-COMMIT": decide()→buildEnter→markEntry burns the
// cooldown at SIGNAL time, but if the engine then BLOCKS the entry (cap/heat/funding)
// the cooldown must be rolled back — else a blocked signal silently silences the pair
// for cooldownHours (the cap↔cooldown chaos: trade count non-monotonic in cap).
export function peekCgFadeCooldown(symbol: string): { side: 'long' | 'short'; ts: number } | undefined {
  return lastEntryByPair.get(symbol);
}
export function restoreCgFadeCooldown(symbol: string, prev: { side: 'long' | 'short'; ts: number } | undefined): void {
  if (prev === undefined) lastEntryByPair.delete(symbol);
  else lastEntryByPair.set(symbol, prev);
}

export interface SideDecision {
  side: 'long' | 'short';
  rationale: string;
}

/**
 * Base class for any "fade some Coinglass signal" strategy.
 *
 * Owns the common pipeline: hold-on-existing-position → CG availability →
 * extract side (subclass) → cooldown → trend filter → buildEnter.
 *
 * Subclasses implement `extractSide(cg, p)` — return null to hold, or a
 * SideDecision to enter. The rationale is included in the eventual Action.
 */
export abstract class CgFadeStrategy implements Strategy {
  readonly p: CgFadeParams;
  abstract readonly name: string;
  readonly needsCoinglass = true;

  constructor(params: Partial<CgFadeParams> = {}, defaultOverrides: Partial<CgFadeParams> = {}) {
    this.p = { ...DEFAULTS, ...defaultOverrides, ...params };
  }

  get needsBtcContext(): boolean {
    return this.p.useBtcTrend;
  }

  /** Subclass picks side from CG signal(s). Return null to hold. */
  protected abstract extractSide(cg: CoinglassFeatures, p: CgFadeParams): SideDecision | null;

  /** Helper: classify a single percentile into a side or null. */
  protected sideFromPercentile(pct: number, p: CgFadeParams): 'long' | 'short' | null {
    if (pct >= p.pctHi) return 'short';
    if (pct <= p.pctLo) return 'long';
    return null;
  }

  decide(ctx: StrategyContext): Action {
    if (ctx.position) return { kind: 'hold' };

    const cg = ctx.coinglass as CoinglassFeatures | undefined;
    if (!cg) return { kind: 'hold' };

    const sig = this.extractSide(cg, this.p);
    if (!sig) return { kind: 'hold' };

    if (inCooldown(ctx, sig.side, this.p.cooldownHours)) return { kind: 'hold' };
    // Cooldown after TP: prevent re-entry to a freshly-closed-with-profit cycle.
    // Stops the "extra trades" pattern that broke equal-R scaled-in on BTC.
    if (this.p.cooldownAfterTpHours && this.p.cooldownAfterTpHours > 0 && ctx.lastClosedTrade) {
      const lct = ctx.lastClosedTrade;
      const isTp = lct.exitReason === 'tp1' || lct.exitReason === 'tp2' || lct.exitReason === 'tp1_then_sl_be';
      if (isTp && (ctx.ts - lct.exitTs) < this.p.cooldownAfterTpHours * 3_600_000) return { kind: 'hold' };
    }
    if (!trendFiltersAllow(sig.side, ctx, this.p)) return { kind: 'hold' };

    return buildEnter(ctx, sig.side, ctx.recentBars ?? [], this.p, sig.rationale);
  }
}

// ─── S1/S2: L/S Top Position fade ─────────────────────────────────────────────
export class LsTopPositionFade extends CgFadeStrategy {
  readonly name: string;

  constructor(params: Partial<CgFadeParams> = {}) {
    super(params);
    const p = this.p;
    this.name = `ls-top-position-fade(${p.pctHi}/${p.pctLo}, sl${p.slAtrMult}atr/tp${p.tpAtrMult}atr, hold${p.maxHoldBars}, pair=${p.usePairTrend}, btc=${p.useBtcTrend})`;
  }

  protected extractSide(cg: CoinglassFeatures, p: CgFadeParams): SideDecision | null {
    const hist = cg.ls_top_position_history;
    const cur = cg.ls_top_position;
    if (!hist || hist.length < p.windowBars || cur == null) return null;
    const pct = percentile(hist.slice(-p.windowBars), cur);
    const side = this.sideFromPercentile(pct, p);
    if (!side) return null;
    return {
      side,
      rationale: `L/S Top Position pct ${(pct * 100).toFixed(1)}% — fade extreme ${side === 'short' ? 'long' : 'short'} bias`,
    };
  }
}

// ─── S3: Funding rate fade ────────────────────────────────────────────────────
export class FundingFade extends CgFadeStrategy {
  readonly name: string;

  constructor(params: Partial<CgFadeParams> = {}) {
    super(params, { pctHi: 0.75, pctLo: 0.25, usePairTrend: true, useBtcTrend: true });
    const p = this.p;
    this.name = `funding-fade(${p.pctHi}/${p.pctLo}, sl${p.slAtrMult}atr/tp${p.tpAtrMult}atr, hold${p.maxHoldBars}, pair=${p.usePairTrend}, btc=${p.useBtcTrend})`;
  }

  protected extractSide(cg: CoinglassFeatures, p: CgFadeParams): SideDecision | null {
    const hist = cg.funding_oi_weighted_history;
    const cur = cg.funding_oi_weighted;
    if (!hist || hist.length < p.windowBars || cur == null) return null;
    const pct = percentile(hist.slice(-p.windowBars), cur);
    const side = this.sideFromPercentile(pct, p);
    if (!side) return null;
    return {
      side,
      rationale: `Funding pct ${(pct * 100).toFixed(1)}% (${cur > 0 ? '+' : ''}${(cur * 100).toFixed(3)}%) — fade ${side === 'short' ? 'long' : 'short'} crowd`,
    };
  }
}

// ─── S4: Funding + L/S Top Account confluence ─────────────────────────────────
// Both signals must be extreme in the same direction. Highest-conviction variant.
export class FundingTaConfluence extends CgFadeStrategy {
  readonly name: string;

  constructor(params: Partial<CgFadeParams> = {}) {
    super(params, { pctHi: 0.70, pctLo: 0.30, usePairTrend: true, useBtcTrend: true });
    const p = this.p;
    this.name = `funding-ta-confluence(${p.pctHi}/${p.pctLo}, sl${p.slAtrMult}atr/tp${p.tpAtrMult}atr, hold${p.maxHoldBars})`;
  }

  protected extractSide(cg: CoinglassFeatures, p: CgFadeParams): SideDecision | null {
    const frHist = cg.funding_oi_weighted_history;
    const taHist = cg.ls_top_account_history;
    const fCur = cg.funding_oi_weighted;
    const tCur = cg.ls_top_account;
    if (!frHist || !taHist || frHist.length < p.windowBars || taHist.length < p.windowBars || fCur == null || tCur == null) return null;
    const fPct = percentile(frHist.slice(-p.windowBars), fCur);
    const tPct = percentile(taHist.slice(-p.windowBars), tCur);
    let side: 'long' | 'short' | null = null;
    if (fPct >= p.pctHi && tPct >= p.pctHi) side = 'short';
    else if (fPct <= p.pctLo && tPct <= p.pctLo) side = 'long';
    if (!side) return null;
    return {
      side,
      rationale: `F+TA confluence (F:${(fPct * 100).toFixed(0)}% TA:${(tPct * 100).toFixed(0)}%) — fade ${side === 'short' ? 'long' : 'short'} consensus`,
    };
  }
}

// ─── S5: Funding + L/S Top Position confluence ────────────────────────────────
// Higher-conviction variant of S1 (LsTopPositionFade): requires BOTH funding AND
// L/S Top Position to be extreme in the same direction. Built for BTC (research
// 2026-05-24): on BTC the L/S Top Position signal is sharper than L/S Top Account
// (used by S4), so S4-style confluence with TopPosition is the natural fit.
export class LsTopPositionFundingConfluence extends CgFadeStrategy {
  readonly name: string;

  constructor(params: Partial<CgFadeParams> = {}) {
    super(params, { pctHi: 0.80, pctLo: 0.20, usePairTrend: true, useBtcTrend: false });
    const p = this.p;
    this.name = `ls-top-pos-funding-confluence(${p.pctHi}/${p.pctLo}, sl${p.slAtrMult}atr/tp${p.tpAtrMult}atr, hold${p.maxHoldBars}, pair=${p.usePairTrend}, btc=${p.useBtcTrend})`;
  }

  protected extractSide(cg: CoinglassFeatures, p: CgFadeParams): SideDecision | null {
    const frHist = cg.funding_oi_weighted_history;
    const tpHist = cg.ls_top_position_history;
    const fCur = cg.funding_oi_weighted;
    const tCur = cg.ls_top_position;
    if (!frHist || !tpHist || frHist.length < p.windowBars || tpHist.length < p.windowBars || fCur == null || tCur == null) return null;
    const fPct = percentile(frHist.slice(-p.windowBars), fCur);
    const tPct = percentile(tpHist.slice(-p.windowBars), tCur);
    let side: 'long' | 'short' | null = null;
    if (fPct >= p.pctHi && tPct >= p.pctHi) side = 'short';
    else if (fPct <= p.pctLo && tPct <= p.pctLo) side = 'long';
    if (!side) return null;
    return {
      side,
      rationale: `F+TP confluence (F:${(fPct * 100).toFixed(0)}% TP:${(tPct * 100).toFixed(0)}%) — fade ${side === 'short' ? 'long' : 'short'} consensus`,
    };
  }
}

// ─── Factory exports (back-compat with pair-strategies.ts) ─────────────────────
export function lsTopPositionFade(params: Partial<CgFadeParams> = {}): Strategy {
  return new LsTopPositionFade(params);
}
export function fundingFade(params: Partial<CgFadeParams> = {}): Strategy {
  return new FundingFade(params);
}
export function fundingTaConfluence(params: Partial<CgFadeParams> = {}): Strategy {
  return new FundingTaConfluence(params);
}
export function lsTopPositionFundingConfluence(params: Partial<CgFadeParams> = {}): Strategy {
  return new LsTopPositionFundingConfluence(params);
}

// ─── Shared helpers ────────────────────────────────────────────────────────────
// Cooldown read: prefer the live DB-loaded snapshot in ctx; fall back to the
// in-process Map (backtest). The two surfaces are intentionally identical in
// shape so the decision branch is just "which Map do I read from?".
function inCooldown(ctx: StrategyContext, side: 'long' | 'short', hours: number): boolean {
  const source = ctx.cooldownState ?? lastEntryByPair;
  const last = source.get(ctx.symbol);
  if (!last) return false;
  if (last.side !== side) return false;
  return ctx.ts - last.ts < hours * 3_600_000;
}

// Cooldown write (SIGNAL time, in-process only). Records the prospective entry in
// the in-process Map so the backtest engine's peek/restore rollback can implement
// cooldown-on-COMMIT: decide()→buildEnter→markEntry burns it at signal; the engine
// restores it via restoreCgFadeCooldown if the entry is then blocked by cap/heat/
// funding (see peekCgFadeCooldown above).
//
// Live (scan-decide) deliberately does NOT persist the cooldown here. It used to —
// `recordEntryDb` fired on every SIGNAL, inside decide(), BEFORE risk-guard ran. A
// signal that risk-guard then BLOCKED (cap/heat/funding/quality) still burned the 6h
// DB cooldown, silently silencing the pair with no trade taken (the cap↔cooldown
// chaos: trade count non-monotonic in cap). The live cooldown is now written at
// COMMIT — after the order is actually placed — in execute.ts main() via
// recordEntry(strategy-cooldowns); loadCooldowns reads it on the next cycle.
function markEntry(ctx: StrategyContext, side: 'long' | 'short') {
  lastEntryByPair.set(ctx.symbol, { side, ts: ctx.ts });
}

function trendFiltersAllow(side: 'long' | 'short', ctx: StrategyContext, p: CgFadeParams): boolean {
  if (p.usePairTrend) {
    const closes = (ctx.recentBars ?? []).map(b => b.close);
    const up = trendUp(closes, p.emaFast, p.emaSlow);
    if (up == null) return false;
    if (side === 'short' && up) return false;
    if (side === 'long' && !up) return false;
  }
  if (p.useBtcTrend) {
    const btcBars = ctx.btcBars4hRecent ?? [];
    if (btcBars.length < p.emaSlow + 5) return false;
    const closes = btcBars.map(b => b.close);
    const up = trendUp(closes, p.emaFast, p.emaSlow);
    if (up == null) return false;
    if (side === 'short' && up) return false;
    if (side === 'long' && !up) return false;
  }
  return true;
}

function buildEnter(
  ctx: StrategyContext,
  side: 'long' | 'short',
  bars: Bar[],
  p: CgFadeParams,
  rationale: string,
): Action {
  const a = atr(bars, p.atrPeriod);
  if (a == null || a <= 0) return { kind: 'hold' };
  const sl = side === 'long' ? ctx.price - p.slAtrMult * a : ctx.price + p.slAtrMult * a;
  // When scaledIn is set, TP is recomputed by engine from running avg using
  // scaledIn.tpAtrMult. Initial tp1/tp2 set to first-entry-based target (engine
  // will overwrite on each fill).
  const effectiveTpMult = p.scaledIn?.tpAtrMult ?? p.tpAtrMult;
  const tp = side === 'long' ? ctx.price + effectiveTpMult * a : ctx.price - effectiveTpMult * a;
  markEntry(ctx, side);
  return {
    kind: 'enter',
    side,
    // MARKET entry (2026-06-04): ALL entries — scaled-in slot-0 AND single-entry — use
    // market for guaranteed immediate fill. TP/SL place cleanly, the daemon tracks the
    // position at once, and no phantom 'open' DB row is created from an unfilled limit.
    // The single-entry standalone portfolio hit exactly that: BTC limit @66097 never
    // filled → db_without_bybit divergence + blocked re-entry + missed the (correct) move.
    // Market is also closer to the cron-realistic backtest, which assumes fill at the
    // decision price. The small taker fee/slip is the cost of fill certainty.
    orderType: 'market',
    entryPrice: ctx.price,
    sl,
    tp1: tp, tp2: tp,
    sizePct: p.riskPct,
    rationale,
    scaledIn: p.scaledIn ? {
      nEntries: p.scaledIn.nEntries,
      spacingAtr: p.scaledIn.spacingAtr,
      atr: a,
      tpAtrMult: p.scaledIn.tpAtrMult,
      sizingMode: p.scaledIn.sizingMode,
      dcaBoostDecay: p.scaledIn.dcaBoostDecay,
      customWeights: p.scaledIn.customWeights,
      tpRecomputeOnFill: p.scaledIn.tpRecomputeOnFill,
    } : undefined,
  };
}

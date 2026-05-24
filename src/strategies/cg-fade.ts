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
  cooldownHours: number;
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

// In-process cooldown state, shared across strategies (key = symbol).
// Resets on process restart, which is fine — live restart is rare.
const lastEntryByPair: Map<string, { side: 'long' | 'short'; ts: number }> = new Map();
export function resetCgFadeCooldownState() { lastEntryByPair.clear(); }

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

    if (inCooldown(ctx.symbol, sig.side, ctx.ts, this.p.cooldownHours)) return { kind: 'hold' };
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

// ─── Shared helpers ────────────────────────────────────────────────────────────
function inCooldown(symbol: string, side: 'long' | 'short', ts: number, hours: number): boolean {
  const last = lastEntryByPair.get(symbol);
  if (!last) return false;
  if (last.side !== side) return false;
  return ts - last.ts < hours * 3_600_000;
}
function markEntry(symbol: string, side: 'long' | 'short', ts: number) {
  lastEntryByPair.set(symbol, { side, ts });
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
  const tp = side === 'long' ? ctx.price + p.tpAtrMult * a : ctx.price - p.tpAtrMult * a;
  markEntry(ctx.symbol, side, ctx.ts);
  return {
    kind: 'enter',
    side,
    orderType: 'limit',
    entryPrice: ctx.price,
    sl,
    tp1: tp, tp2: tp,
    sizePct: p.riskPct,
    rationale,
  };
}

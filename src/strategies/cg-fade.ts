/**
 * Coinglass-based fade strategies — validated on 365d backtest via walk-forward (2026-05-23).
 *
 * 4 strategy factories that share the same setup mechanic:
 *   - Detect extreme percentile of some CG signal (last 180 4H bars = 30 days).
 *   - Fade the crowd: extreme high → SHORT, extreme low → LONG.
 *   - Filter by pair's own 4H EMA20/50 trend and/or BTC 4H trend.
 *   - SL at ATR(14) × multiplier, TP at ATR × multiplier.
 *   - Max hold N × 4H bars; time-stop at market.
 *
 * Used in live (Tier-1 portfolio):
 *   S1 (lsTopPositionFade + pair trend) — BTCUSDT
 *   S2 (lsTopPositionFade + BTC trend)  — INJUSDT
 *   S3 (fundingFade + both trends)       — TAO, ATOM, LTC, ARB (and ETH/DOGE/SOL/APT 3/4-q tier)
 *   S4 (fundingTaConfluence)             — XRP, SOL
 *
 * Realistic cost assumptions (no live overrides needed):
 *   - Limit entries (orderType: 'limit') → maker fee, no slip.
 *   - TP1/TP2 limits → maker fee, no slip.
 *   - SL market trigger → taker fee + slip applied by engine.
 *
 * Decision cadence: 4H (240m). All strategies need decisionTf: '240m' on the engine.
 */
import { Action, Strategy, StrategyContext, Bar } from '../backtest/types';
import { CoinglassFeatures } from '../data/coinglass-features';

export interface CgFadeParams {
  pctHi: number;          // 0.85 / 0.75 / 0.70 — percentile threshold for "extreme high"
  pctLo: number;          // mirror
  windowBars: number;     // 180 = 30d × 6 (4H bars)
  atrPeriod: number;      // 14
  slAtrMult: number;      // 1.5
  tpAtrMult: number;      // 2.0
  maxHoldBars: number;    // 12 (= 48h)
  riskPct: number;        // 0.25–0.5 (config-time)
  // Trend filters
  usePairTrend: boolean;
  useBtcTrend: boolean;
  emaFast: number;        // 20
  emaSlow: number;        // 50
  // Cooldown to prevent immediate re-entry on same direction.
  cooldownHours: number;  // 6 (matches existing risk-guard global cooldown semantics)
}

const DEFAULTS: CgFadeParams = {
  pctHi: 0.85, pctLo: 0.15, windowBars: 180,
  atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
  riskPct: 0.5,
  usePairTrend: false, useBtcTrend: false,
  emaFast: 20, emaSlow: 50,
  cooldownHours: 6,
};

// ─── helpers ──────────────────────────────────────────────────────────────────
function atr(bars: Bar[], period: number): number | null {
  if (bars.length < period + 1) return null;
  let s = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    s += Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
  }
  return s / period;
}
function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function trendUp(closes: number[], fast: number, slow: number): boolean | null {
  const eF = ema(closes, fast);
  const eS = ema(closes, slow);
  if (eF == null || eS == null) return null;
  return eF > eS;
}
function percentile(series: number[], value: number): number {
  let cnt = 0;
  for (const v of series) if (v <= value) cnt++;
  return cnt / series.length;
}

// In-process cooldown state (mirror of btc-vp-smc.ts pattern).
// Resets on process restart, which is fine — live restart is rare and small misses are OK.
const lastEntryByPair: Map<string, { side: 'long' | 'short'; ts: number }> = new Map();
export function resetCgFadeCooldownState() { lastEntryByPair.clear(); }

function inCooldown(symbol: string, side: 'long' | 'short', ts: number, hours: number): boolean {
  const last = lastEntryByPair.get(symbol);
  if (!last) return false;
  if (last.side !== side) return false;
  return ts - last.ts < hours * 3_600_000;
}
function markEntry(symbol: string, side: 'long' | 'short', ts: number) {
  lastEntryByPair.set(symbol, { side, ts });
}

// Apply pair-and-BTC trend filters. Returns true if the trade is allowed.
function trendFiltersAllow(side: 'long' | 'short', ctx: StrategyContext, p: CgFadeParams): boolean {
  const pairBars = ctx.recentBars ?? [];
  if (p.usePairTrend) {
    const closes = pairBars.map(b => b.close);
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
    orderType: 'limit',        // matches live auto-execute.ts:117 hardcode
    entryPrice: ctx.price,
    sl,
    tp1: tp, tp2: tp,           // single target (engine uses tp1; tp2 same gives full-position close at TP)
    sizePct: p.riskPct,
    rationale,
  };
}

// ─── S1/S2: L/S Top Position fade ──────────────────────────────────────────────
// S1: usePairTrend=true, useBtcTrend=false  (BTCUSDT champion)
// S2: usePairTrend=false, useBtcTrend=true  (INJUSDT — alt follows BTC macro)
export function lsTopPositionFade(params: Partial<CgFadeParams> = {}): Strategy {
  const p = { ...DEFAULTS, ...params };
  return {
    name: `ls-top-position-fade(${p.pctHi}/${p.pctLo}, sl${p.slAtrMult}atr/tp${p.tpAtrMult}atr, hold${p.maxHoldBars}, pair=${p.usePairTrend}, btc=${p.useBtcTrend})`,
    needsCoinglass: true,
    needsBtcContext: p.useBtcTrend,
    decide(ctx: StrategyContext): Action {
      if (ctx.position) return { kind: 'hold' };
      const cg = ctx.coinglass as CoinglassFeatures | undefined;
      if (!cg) return { kind: 'hold' };
      const hist = cg.ls_top_position_history;
      const cur = cg.ls_top_position;
      if (!hist || hist.length < p.windowBars || cur == null) return { kind: 'hold' };

      const window = hist.slice(-p.windowBars);
      const pct = percentile(window, cur);
      let side: 'long' | 'short' | null = null;
      if (pct >= p.pctHi) side = 'short';
      else if (pct <= p.pctLo) side = 'long';
      if (!side) return { kind: 'hold' };

      if (inCooldown(ctx.symbol, side, ctx.ts, p.cooldownHours)) return { kind: 'hold' };
      if (!trendFiltersAllow(side, ctx, p)) return { kind: 'hold' };

      return buildEnter(ctx, side, ctx.recentBars ?? [], p,
        `L/S Top Position pct ${(pct * 100).toFixed(1)}% — fade extreme ${side === 'short' ? 'long' : 'short'} bias`,
      );
    },
  };
}

// ─── S3: Funding rate fade ─────────────────────────────────────────────────────
// Used for: TAO, ATOM, LTC, ARB, ETH, DOGE, SOL, APT, BNB (default params with both trends).
export function fundingFade(params: Partial<CgFadeParams> = {}): Strategy {
  const p = { ...DEFAULTS, pctHi: 0.75, pctLo: 0.25, usePairTrend: true, useBtcTrend: true, ...params };
  return {
    name: `funding-fade(${p.pctHi}/${p.pctLo}, sl${p.slAtrMult}atr/tp${p.tpAtrMult}atr, hold${p.maxHoldBars}, pair=${p.usePairTrend}, btc=${p.useBtcTrend})`,
    needsCoinglass: true,
    needsBtcContext: p.useBtcTrend,
    decide(ctx: StrategyContext): Action {
      if (ctx.position) return { kind: 'hold' };
      const cg = ctx.coinglass as CoinglassFeatures | undefined;
      if (!cg) return { kind: 'hold' };
      const hist = cg.funding_oi_weighted_history;
      const cur = cg.funding_oi_weighted;
      if (!hist || hist.length < p.windowBars || cur == null) return { kind: 'hold' };

      const window = hist.slice(-p.windowBars);
      const pct = percentile(window, cur);
      let side: 'long' | 'short' | null = null;
      if (pct >= p.pctHi) side = 'short';
      else if (pct <= p.pctLo) side = 'long';
      if (!side) return { kind: 'hold' };

      if (inCooldown(ctx.symbol, side, ctx.ts, p.cooldownHours)) return { kind: 'hold' };
      if (!trendFiltersAllow(side, ctx, p)) return { kind: 'hold' };

      return buildEnter(ctx, side, ctx.recentBars ?? [], p,
        `Funding pct ${(pct * 100).toFixed(1)}% (${cur > 0 ? '+' : ''}${(cur * 100).toFixed(3)}%) — fade ${side === 'short' ? 'long' : 'short'} crowd`,
      );
    },
  };
}

// ─── S4: Funding + L/S Top Account confluence ──────────────────────────────────
// Both signals must be extreme in the same direction. Used for XRP, SOL.
export function fundingTaConfluence(params: Partial<CgFadeParams> = {}): Strategy {
  const p = { ...DEFAULTS, pctHi: 0.70, pctLo: 0.30, usePairTrend: true, useBtcTrend: true, ...params };
  return {
    name: `funding-ta-confluence(${p.pctHi}/${p.pctLo}, sl${p.slAtrMult}atr/tp${p.tpAtrMult}atr, hold${p.maxHoldBars})`,
    needsCoinglass: true,
    needsBtcContext: p.useBtcTrend,
    decide(ctx: StrategyContext): Action {
      if (ctx.position) return { kind: 'hold' };
      const cg = ctx.coinglass as CoinglassFeatures | undefined;
      if (!cg) return { kind: 'hold' };
      const frHist = cg.funding_oi_weighted_history;
      const taHist = cg.ls_top_account_history;
      const fCur = cg.funding_oi_weighted;
      const tCur = cg.ls_top_account;
      if (!frHist || !taHist || frHist.length < p.windowBars || taHist.length < p.windowBars || fCur == null || tCur == null) return { kind: 'hold' };

      const fPct = percentile(frHist.slice(-p.windowBars), fCur);
      const tPct = percentile(taHist.slice(-p.windowBars), tCur);
      let side: 'long' | 'short' | null = null;
      if (fPct >= p.pctHi && tPct >= p.pctHi) side = 'short';
      else if (fPct <= p.pctLo && tPct <= p.pctLo) side = 'long';
      if (!side) return { kind: 'hold' };

      if (inCooldown(ctx.symbol, side, ctx.ts, p.cooldownHours)) return { kind: 'hold' };
      if (!trendFiltersAllow(side, ctx, p)) return { kind: 'hold' };

      return buildEnter(ctx, side, ctx.recentBars ?? [], p,
        `F+TA confluence (F:${(fPct * 100).toFixed(0)}% TA:${(tPct * 100).toFixed(0)}%) — fade ${side === 'short' ? 'long' : 'short'} consensus`,
      );
    },
  };
}

import { Action, Strategy, StrategyContext, Bar } from '../types';
import { CoinglassFeatures } from '../../data/coinglass-features';

// BTC-only structural strategy: Volume Profile + PWL/PWH + FVG + crowd-fade.
//
// Methodology synthesis:
//   - Daily Volume Profile (POC, VAL, VAH) from prior session's 1H bars.
//     Trade reversion to POC when price taps the value-area edge.
//   - PWL/PWH (previous closed weekly high/low) define HTF context. Long requires
//     price above PWL (no bearish HTF). Short requires below PWH.
//   - FVG (Fair Value Gap) on 1H as confirmation: 3-bar imbalance in the trade
//     direction within last N bars before signal.
//   - Coinglass crowd-fade gates: skip if funding extreme, skip if top traders
//     overwhelmingly aligned with the entry direction (no edge in fading them).
//   - Structural SL anchored at PWL/PWH ± buffer×ATR — wider than statistical SL,
//     gives setup room to work without invalidating the structural thesis.
//   - TP1 = POC (mean reversion target). TP2 = opposite VA edge.

export interface BtcVpSmcParams {
  // Volume profile
  vpBins: number;             // 24 — bin count for daily VP
  vpValueAreaPct: number;     // 0.7 — 70% of volume defines VA
  vpLookbackHours: number;    // 24 — bars to use for "previous day" VP
  vpVaTouchLookback: number;  // 6 — last N 1H bars to check for VAL/VAH touch
  vpReentryRequired: boolean; // true — must close back inside VA after touch
  // FVG
  fvgLookback: number;        // 8 — last N 1H bars to scan for fresh FVG
  fvgMinSizeAtrFrac: number;  // 0.3 — minimum FVG size as fraction of ATR
  // Coinglass crowd fade
  fundingExtremeAbs: number;  // 0.005 — skip if |funding| above this
  lsTopMaxLong: number;       // 1.7 — skip long if top traders too long already
  lsTopMinShort: number;      // 0.7 — skip short if top traders too short already
  // SL placement
  slBufferAtr: number;        // 0.3 — extra ATR beyond PWL/PWH
  minStopAtr: number;         // 0.5
  maxStopAtrPct: number;      // 3.0 — reject if stop > 3% (too far, bad R/R)
  // Targets
  minTpAtrFromEntry: number;  // 0.4 — TP1 must be at least this far from entry in trade direction
  // Sizing
  riskPct: number;            // 0.6
  // Trade-frequency control
  cooldownHours: number;      // 6 — minimum hours between entries on same side
}

export const DEFAULT_BTC_VP_SMC: BtcVpSmcParams = {
  vpBins: 24,
  vpValueAreaPct: 0.7,
  vpLookbackHours: 24,
  vpVaTouchLookback: 6,
  vpReentryRequired: true,
  fvgLookback: 8,
  fvgMinSizeAtrFrac: 0.3,
  fundingExtremeAbs: 0.005,
  lsTopMaxLong: 1.7,
  lsTopMinShort: 0.7,
  slBufferAtr: 0.3,
  minStopAtr: 0.5,
  maxStopAtrPct: 3.0,
  minTpAtrFromEntry: 0.4,
  riskPct: 0.6,
  cooldownHours: 6,
};

// Module-level cooldown tracker. Reset implicitly when a new backtest is run
// (each engine.runBacktest call iterates the time window forward; we use ts to
// gate against the most recent enter signal). For safety we keep a small map
// scoped to symbol+side so live runs don't cross-contaminate.
const lastEntryTs: Map<string, number> = new Map();

function inCooldown(symbol: string, side: 'long' | 'short', ts: number, hours: number): boolean {
  const key = `${symbol}:${side}`;
  const last = lastEntryTs.get(key);
  if (last === undefined) return false;
  return ts - last < hours * 3_600_000;
}

function markEntry(symbol: string, side: 'long' | 'short', ts: number): void {
  lastEntryTs.set(`${symbol}:${side}`, ts);
}

interface VolumeProfile {
  poc: number;
  val: number;
  vah: number;
  binSize: number;
  totalVol: number;
}

// Build a volume profile from a contiguous slice of bars.
// Distributes each bar's volume evenly across bins overlapped by [low, high].
function buildVolumeProfile(bars: Bar[], binCount: number, valuePct: number): VolumeProfile | null {
  if (bars.length < 6) return null;
  const lo = Math.min(...bars.map((b) => b.low));
  const hi = Math.max(...bars.map((b) => b.high));
  if (hi <= lo) return null;
  const binSize = (hi - lo) / binCount;
  const bins = new Array<number>(binCount).fill(0);
  for (const b of bars) {
    const startIdx = Math.max(0, Math.floor((b.low - lo) / binSize));
    const endIdx = Math.min(binCount - 1, Math.floor((b.high - lo) / binSize));
    const span = endIdx - startIdx + 1;
    if (span <= 0) continue;
    const volPerBin = b.volume / span;
    for (let i = startIdx; i <= endIdx; i++) bins[i] += volPerBin;
  }
  const totalVol = bins.reduce((s, v) => s + v, 0);
  if (totalVol <= 0) return null;
  // POC = bin with max volume
  let pocIdx = 0;
  for (let i = 1; i < binCount; i++) if (bins[i] > bins[pocIdx]) pocIdx = i;
  // Expand from POC until we cover valuePct of total
  let lower = pocIdx;
  let upper = pocIdx;
  let acc = bins[pocIdx];
  const target = totalVol * valuePct;
  while (acc < target && (lower > 0 || upper < binCount - 1)) {
    const canDown = lower > 0;
    const canUp = upper < binCount - 1;
    const downVol = canDown ? bins[lower - 1] : -1;
    const upVol = canUp ? bins[upper + 1] : -1;
    if (downVol >= upVol && canDown) {
      lower--;
      acc += bins[lower];
    } else if (canUp) {
      upper++;
      acc += bins[upper];
    } else {
      break;
    }
  }
  // Convert bin indices to prices (midpoint of bin)
  const binMid = (idx: number) => lo + binSize * (idx + 0.5);
  return {
    poc: binMid(pocIdx),
    val: lo + binSize * lower,
    vah: lo + binSize * (upper + 1),
    binSize,
    totalVol,
  };
}

// Check if any of the last N bars touched a level (low ≤ level ≤ high).
function levelTouchedRecently(bars: Bar[], level: number, n: number, side: 'val' | 'vah'): boolean {
  const slice = bars.slice(-n);
  for (const b of slice) {
    if (side === 'val') {
      if (b.low <= level) return true;
    } else {
      if (b.high >= level) return true;
    }
  }
  return false;
}

// Bullish FVG: 3-bar pattern where bar[n-2].high < bar[n].low.
// We scan last N+2 bars and report whether at least one bullish FVG exists.
function hasBullishFvg(bars: Bar[], lookback: number, minSize: number): boolean {
  const start = Math.max(2, bars.length - lookback);
  for (let n = start; n < bars.length; n++) {
    const a = bars[n - 2];
    const c = bars[n];
    const gap = c.low - a.high;
    if (gap > minSize) return true;
  }
  return false;
}

function hasBearishFvg(bars: Bar[], lookback: number, minSize: number): boolean {
  const start = Math.max(2, bars.length - lookback);
  for (let n = start; n < bars.length; n++) {
    const a = bars[n - 2];
    const c = bars[n];
    const gap = a.low - c.high;
    if (gap > minSize) return true;
  }
  return false;
}

function passCoinglassLong(cg: CoinglassFeatures | undefined, p: BtcVpSmcParams): { ok: boolean; reason: string } {
  if (!cg) return { ok: true, reason: 'cg-missing-permissive' };
  if (cg.funding_oi_weighted != null && Math.abs(cg.funding_oi_weighted) > p.fundingExtremeAbs)
    return { ok: false, reason: `funding-extreme:${cg.funding_oi_weighted.toFixed(5)}` };
  if (cg.ls_top_position != null && cg.ls_top_position > p.lsTopMaxLong)
    return { ok: false, reason: `ls-top-too-long:${cg.ls_top_position.toFixed(2)}` };
  return { ok: true, reason: 'pass' };
}

function passCoinglassShort(cg: CoinglassFeatures | undefined, p: BtcVpSmcParams): { ok: boolean; reason: string } {
  if (!cg) return { ok: true, reason: 'cg-missing-permissive' };
  if (cg.funding_oi_weighted != null && Math.abs(cg.funding_oi_weighted) > p.fundingExtremeAbs)
    return { ok: false, reason: `funding-extreme:${cg.funding_oi_weighted.toFixed(5)}` };
  if (cg.ls_top_position != null && cg.ls_top_position < p.lsTopMinShort)
    return { ok: false, reason: `ls-top-too-short:${cg.ls_top_position.toFixed(2)}` };
  return { ok: true, reason: 'pass' };
}

export function btcVpSmc(params: BtcVpSmcParams = DEFAULT_BTC_VP_SMC): Strategy {
  return {
    name: `btc-vp-smc(VP-POC reversion + PWL/PWH + FVG + crowd-fade, SL=struct+${params.slBufferAtr}×ATR)`,
    needsCoinglass: true,
    decide(ctx: StrategyContext): Action {
      // Universal: BTC + ETH. Strategy is ATR-relative so it scales with volatility.
      // Caller restricts via the runner script (one symbol per backtest).
      const f = ctx.features1h;
      if (!f || f.atr == null || f.atr_pct == null) return { kind: 'hold' };

      const bars1h = ctx.bars1hRecent ?? [];
      const bars1w = ctx.bars1wRecent ?? [];
      if (bars1h.length < params.vpLookbackHours + params.vpVaTouchLookback) return { kind: 'hold' };
      if (bars1w.length < 1) return { kind: 'hold' };

      // 1) Build "previous day" VP from the 1H bars BEFORE the recent touch window.
      // This way VP is a "level set" computed on prior session, and the touch happens NOW.
      const vpEnd = bars1h.length - params.vpVaTouchLookback;
      const vpStart = Math.max(0, vpEnd - params.vpLookbackHours);
      const vpBars = bars1h.slice(vpStart, vpEnd);
      const vp = buildVolumeProfile(vpBars, params.vpBins, params.vpValueAreaPct);
      if (!vp) return { kind: 'hold' };

      // 2) PWL/PWH from last closed 1W bar
      const lastW = bars1w[bars1w.length - 1];
      const pwl = lastW.low;
      const pwh = lastW.high;

      // 3) Recent touch window
      const touchBars = bars1h.slice(-params.vpVaTouchLookback);
      const cg = ctx.coinglass as CoinglassFeatures | undefined;
      const minFvgSize = f.atr * params.fvgMinSizeAtrFrac;

      // ---- LONG setup ----
      const valTouched = levelTouchedRecently(bars1h, vp.val, params.vpVaTouchLookback, 'val');
      const reentryLong = !params.vpReentryRequired || ctx.price > vp.val;
      const fvgBull = hasBullishFvg(bars1h, params.fvgLookback, minFvgSize);
      const aboveSwl = ctx.price > pwl;

      if (valTouched && reentryLong && fvgBull && aboveSwl) {
        if (inCooldown(ctx.symbol, 'long', ctx.ts, params.cooldownHours)) return { kind: 'hold' };

        const cgRes = passCoinglassLong(cg, params);
        if (!cgRes.ok) return { kind: 'hold' };

        const sl = pwl - params.slBufferAtr * f.atr;
        const stopDist = ctx.price - sl;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        if ((stopDist / ctx.price) * 100 > params.maxStopAtrPct) return { kind: 'hold' };

        // TP1 must be in trade direction (above entry by ≥ minTpAtrFromEntry × ATR).
        // For LONG: prefer POC; if POC ≤ entry (price already past it), use VAH; if
        // VAH also ≤ entry → no upside target → skip (this is momentum, not reversion).
        const minTp = params.minTpAtrFromEntry * f.atr;
        let tp1 = vp.poc;
        let tp2 = vp.vah;
        if (tp1 < ctx.price + minTp) {
          tp1 = vp.vah;
          tp2 = vp.vah + (vp.vah - vp.val) * 0.5;
        }
        if (tp1 < ctx.price + minTp) return { kind: 'hold' };
        if (tp2 < tp1) tp2 = tp1 + (tp1 - ctx.price);

        markEntry(ctx.symbol, 'long', ctx.ts);
        return {
          kind: 'enter', side: 'long', orderType: 'market',
          entryPrice: ctx.price, sl, tp1, tp2,
          sizePct: params.riskPct,
          rationale: `BTC-VP-SMC LONG: VAL ${vp.val.toFixed(0)} touched, re-entry above; bull-FVG within ${params.fvgLookback}H; PWL ${pwl.toFixed(0)} structural SL; POC ${vp.poc.toFixed(0)}; funding ${cg?.funding_oi_weighted ?? 'n/a'}, LS-top ${cg?.ls_top_position?.toFixed(2) ?? 'n/a'}.`,
        };
      }

      // ---- SHORT setup ----
      const vahTouched = levelTouchedRecently(bars1h, vp.vah, params.vpVaTouchLookback, 'vah');
      const reentryShort = !params.vpReentryRequired || ctx.price < vp.vah;
      const fvgBear = hasBearishFvg(bars1h, params.fvgLookback, minFvgSize);
      const belowPwh = ctx.price < pwh;

      if (vahTouched && reentryShort && fvgBear && belowPwh) {
        if (inCooldown(ctx.symbol, 'short', ctx.ts, params.cooldownHours)) return { kind: 'hold' };

        const cgRes = passCoinglassShort(cg, params);
        if (!cgRes.ok) return { kind: 'hold' };

        const sl = pwh + params.slBufferAtr * f.atr;
        const stopDist = sl - ctx.price;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        if ((stopDist / ctx.price) * 100 > params.maxStopAtrPct) return { kind: 'hold' };

        const minTp = params.minTpAtrFromEntry * f.atr;
        let tp1 = vp.poc;
        let tp2 = vp.val;
        if (tp1 > ctx.price - minTp) {
          tp1 = vp.val;
          tp2 = vp.val - (vp.vah - vp.val) * 0.5;
        }
        if (tp1 > ctx.price - minTp) return { kind: 'hold' };
        if (tp2 > tp1) tp2 = tp1 - (ctx.price - tp1);

        markEntry(ctx.symbol, 'short', ctx.ts);
        return {
          kind: 'enter', side: 'short', orderType: 'market',
          entryPrice: ctx.price, sl, tp1, tp2,
          sizePct: params.riskPct,
          rationale: `BTC-VP-SMC SHORT: VAH ${vp.vah.toFixed(0)} touched, re-entry below; bear-FVG within ${params.fvgLookback}H; PWH ${pwh.toFixed(0)} structural SL; POC ${vp.poc.toFixed(0)}; funding ${cg?.funding_oi_weighted ?? 'n/a'}, LS-top ${cg?.ls_top_position?.toFixed(2) ?? 'n/a'}.`,
        };
      }

      return { kind: 'hold' };
    },
  };
}

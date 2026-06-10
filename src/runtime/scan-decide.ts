// Live decision scanner — runs from cycle.sh at every top-of-hour tick.
//
// For each pair in TIER1_PORTFOLIO (enabled):
//   1. Loads OHLCV at 1H/4H/1D/1W from DB (warmup-padded)
//   2. Computes features at all TFs
//   3. Loads Coinglass features (if available — null otherwise, strategy permissive)
//   4. Builds StrategyContext identical to backtest engine
//   5. Calls per-pair strategy decide() → 'hold' | 'enter'
//      (strategy assignment in src/runtime/pair-strategies.ts; CG-fade v4)
//
// For 'enter' decisions:
//   - Runs risk-guard precheck (heat cap, kill switches, funding window, ...)
//   - Outputs ready-to-execute parameters (entry, sl, tp1, tp2, sizePct)
//
// Output: JSON with { cycle, risk, decisions[] }
// Consumed by: trader subagent / /trade-scan command. Trader picks best 0-4 of
// the 'enter' decisions, calls execute.ts with each.

import fs from 'node:fs';
import { query, close as closePg } from '../core/db';
import { computeFeatures, CandleRow } from '../data/features';
import { loadCoinglassAt, CoinglassFeatures } from '../data/coinglass-features';
import { buildVolumeProfile } from '../strategies/volume-profile';
import { getStrategyForPair, tier1Pairs } from './pair-strategies';
import { Action, Bar, StrategyContext } from '../backtest/types';
import { RiskManager, RISK, RiskState } from './risk-guard';
import { getLiveTickers } from '../core/bybit';
import { loadAccounts } from '../core/accounts';
import { refreshForScan } from '../data/backfill';
import { log } from '../core/logger';
import { loadAll as loadCooldowns, CooldownState } from '../core/strategy-cooldowns';
import { loadDecidedAnchors, recordDecidedAnchor } from '../core/decided-anchors';

// 2026-05-23: pivot from VP-SMC to Tier-1 CG-fade portfolio.
// Universe = 7 pairs validated via walk-forward (cg-fade.ts strategies).
// Per-pair strategy mapping lives in src/runtime/pair-strategies.ts.
const UNIVERSE = tier1Pairs();

// 2026-05-23: PER_SYMBOL VP-SMC overrides removed (legacy strategy retired).
// Per-pair params now live inside the strategy factory call in pair-strategies.ts.

import { loadBars as loadBarsCanonical } from '../data/candles';

async function loadBars(symbol: string, tf: string, lookbackBars: number): Promise<Bar[]> {
  return loadBarsCanonical(symbol, tf, { limit: lookbackBars });
}

interface ContextResult {
  ctx: StrategyContext | null;
  reason?: string;          // why ctx is null (data freshness, missing live price, etc.)
  // ts of the anchor 4H bar the decision is pinned to (LEVER 1). Used by the
  // once-per-anchor latch for strategies with decideOncePerAnchor.
  anchorTs?: number;
  // Extra TFs for enrichment (not used by strategy.decide; for trader's discretionary analysis)
  features5m?: any;
  features15m?: any;
  features4h?: any;
  // Set when CG load threw OR core gate field (funding_oi_weighted) is null. The strategy
  // doesn't crash — it skips the funding-extreme filter — but operator should know the
  // gate is silently disabled. Aggregated at scanDecide level into coinglassStatus.
  cgMissing?: boolean;
  cgReason?: string;
}

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const STALE_TOLERANCE_MS = 5 * 60_000;    // 1H bar must close within 65 min ago = current bar fresh enough

export async function buildContext(
  symbol: string,
  nowTs: number,
  livePrice: number | null,
  btcBars4h?: Bar[],
  cooldownState?: CooldownState,
  cgReadLagBars: number = 0,
): Promise<ContextResult> {
  if (livePrice == null) {
    return { ctx: null, reason: 'live-price-unavailable' };
  }

  const [bars1h, bars1d, bars1w, bars5m, bars15m, bars4h] = await Promise.all([
    loadBars(symbol, '60m', 300),
    loadBars(symbol, '1D', 250),
    loadBars(symbol, '1W', 60),
    loadBars(symbol, '5m', 300),
    loadBars(symbol, '15m', 300),
    loadBars(symbol, '240m', 300),
  ]);
  if (bars1h.length < 100) return { ctx: null, reason: 'insufficient-1h-bars' };

  // Use bars closed strictly before now (engine semantics).
  const closed1h = bars1h.filter((b) => b.ts < nowTs);
  const closedD = bars1d.filter((b) => b.ts < nowTs);
  const closedW = bars1w.filter((b) => b.ts < nowTs);

  if (closed1h.length < 100) return { ctx: null, reason: 'insufficient-closed-1h' };
  if (closedW.length < 1) return { ctx: null, reason: 'no-closed-1w-bar' };

  // Freshness gate: most recent 1H bar must close within last (1h + tolerance).
  // If older, refreshForScan failed or Bybit is behind — do NOT decide on stale data.
  const lastBarTs = closed1h[closed1h.length - 1].ts;
  const ageMs = nowTs - (lastBarTs + HOUR_MS);   // age past expected close
  if (ageMs > STALE_TOLERANCE_MS) {
    return { ctx: null, reason: `stale-1h-bar (${Math.round(ageMs / 60_000)}min past close)` };
  }

  const decisionBar = closed1h[closed1h.length - 1];

  // LEVER 1 (2026-06-03): decide on the last CLOSED 4H bar, not the forming 1H/CG.
  // CG-fade is a 4H strategy. Live used to anchor ctx.price + the CG read to the last
  // closed 1H bar — whose ts lands in the CURRENT, still-forming 4H CG bucket (CG is
  // 4H-bucketed, inserted ON CONFLICT DO NOTHING). The honest 4H backtest instead reads
  // the last COMPLETED 4H bucket + anchors levels to the 4H close. That divergence
  // (forming vs completed CG + 1H vs 4H price anchor) cost ~half the edge: honest mirror
  // (cap6/flatten/365d) = +31%/yr at the 1H anchor (current live) vs +46%/yr at the 4H
  // anchor, and the 4H anchor held in BOTH OOS halves. So anchor BOTH ctx.price and the
  // CG read to the last closed 4H bar. (The further 4H-cadence/+1h-defer lever to +62.8%
  // was NOT robust OOS — recent +19.5pp but older −1.4pp — so it deliberately stays out.)
  const FOUR_H_MS = 4 * 60 * 60_000;
  const closed4h = bars4h.filter((b) => b.ts + FOUR_H_MS <= nowTs);
  const anchorBar = closed4h.length > 0 ? closed4h[closed4h.length - 1] : decisionBar;
  // The decisionBar fallback carries a 1H-grid ts — recording it would poison the
  // once-per-anchor latch (a 1H ts is always newer than the real 4H anchor, so the
  // monotonic guard in decided_anchors would then block legitimate consumption).
  // Latch only on a REAL closed 4H bar; otherwise fail open to hourly re-evaluation.
  const anchorIs4h = closed4h.length > 0;

  // Build feature snapshots
  const slice1h = closed1h.slice(-300).map<CandleRow>((b) => ({
    ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }));
  const features1h = computeFeatures(symbol, '60m', slice1h);

  let featuresD: any = undefined;
  if (closedD.length >= 50) {
    const sliceD = closedD.slice(-250).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    featuresD = computeFeatures(symbol, '1D', sliceD);
  }
  let featuresW: any = undefined;
  if (closedW.length >= 20) {
    const sliceW = closedW.slice(-60).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    featuresW = computeFeatures(symbol, '1W', sliceW);
  }

  // Multi-TF features (5m/15m/4h) for trader's discretionary analysis — not used by strategy.decide.
  function safeFeatures(tf: string, bars: Bar[]): any {
    const closed = bars.filter((b) => b.ts < nowTs);
    if (closed.length < 50) return undefined;
    const slice = closed.slice(-300).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    return computeFeatures(symbol, tf, slice);
  }
  const features5m = safeFeatures('5m', bars5m);
  const features15m = safeFeatures('15m', bars15m);
  const features4h = safeFeatures('240m', bars4h);

  // Coinglass — load if available; null fields are permissive in the strategy, BUT
  // we now track when the load throws OR when the core gate field (funding_oi_weighted)
  // is null, so the operator knows the funding-extreme filter is silently off.
  //
  // cgReadLagBars (v5 = 1): read the series as of anchor − N×4H so the "current" CG
  // point is the bucket closed one step BEFORE the anchor closed — the exact
  // information set the srcNew validation used (publishLag 120s > gap 60s), and
  // revision-settled (CG retro-revises fresh liquidation buckets). Policy experiment
  // 2026-06-10: reading the just-closed bucket doubled MTM maxDD at equal return.
  const cgAtTs = anchorBar.ts - cgReadLagBars * FOUR_H_MS;
  let coinglass: CoinglassFeatures | undefined;
  let cgMissing = false;
  let cgReason: string | undefined;
  try {
    const coin = symbol.replace(/USDT$/, '');
    coinglass = await loadCoinglassAt(coin, symbol, cgAtTs);
    if (coinglass.funding_oi_weighted == null) {
      cgMissing = true;
      cgReason = 'no funding_oi_weighted row at anchorBar.ts (last closed 4H)';
    }
  } catch (e: any) {
    coinglass = undefined;
    cgMissing = true;
    cgReason = `load threw: ${e?.message ?? String(e)}`;
  }

  // v5 cgSlowFade: BTC sentiment context for alt pairs (btc-signal / btc-trend modes).
  // A failed load degrades btc-signal pairs to hold (fadeSignal needs both BTC
  // percentiles) — fail-safe, but surface it via cgMissing so the operator sees
  // the pair is running blind instead of it silently never trading.
  let btcCoinglass: CoinglassFeatures | undefined;
  if (symbol === 'BTCUSDT') {
    btcCoinglass = coinglass;
  } else {
    try {
      btcCoinglass = await loadCoinglassAt('BTC', 'BTCUSDT', cgAtTs);
    } catch (e: any) {
      btcCoinglass = undefined;
      cgMissing = true;
      cgReason = cgReason ?? `btcCoinglass load threw: ${e?.message ?? String(e)}`;
      log.error('btcCoinglass load failed — btc-signal/btc-trend pairs degrade this cycle', {
        symbol, err: e?.message ?? String(e),
      });
    }
  }

  // CTX price = last closed 1H bar's close (matches backtest engine semantics:
  // at iteration i, decide using bar[i-1].close).
  // Live ticker is FRESHER but creates structural divergence with backtest:
  // backtest decides at hour-close on closed-bar close, live used to decide every
  // 5min on live ticker → different decision points = different trades.
  // To use the same algorithm in backtest and live, we sync on closed bars.
  // Cron is gated to HH:00-04 minute window so scan-decide runs once per hour
  // right after the bar closes (see cycle.sh).
  const _liveTickerNote = livePrice;  // kept for diagnostic/observability only

  // recentBars at decisionTf — for CG-fade strategies decisionTf=4H, so use 4H bars.
  // For 1H strategies (legacy VP-SMC) keep 1H. We slice 200 bars for EMA50 support.
  // CLOSED bars only (b.ts + 4h <= now): the previous `b.ts < nowTs` filter let the
  // FORMING 4H bar into ATR(14) — a minutes-old near-zero-TR bar shrank ATR ~5-7%
  // → SL/TP systematically tighter than both backtest engines (which never see a
  // forming bar). Found in the 2026-06-10 v5 migration audit.
  const recentBars4h = closed4h.slice(-200);

  const ctx: StrategyContext = {
    symbol,
    ts: nowTs,
    price: anchorBar.close,           // LEVER 1: last CLOSED 4H bar (was last closed 1H)
    features1h,
    features4h,
    featuresD,
    featuresW,
    position: null,
    coinglass,
    // recentBars at the strategy's decisionTf. CG-fade strategies = 4H. Engine
    // backtest uses 4H bars here too (slice 200). For VP-SMC we kept 1H below.
    recentBars: recentBars4h,
    bars1hRecent: closed1h.slice(-200),
    bars1dRecent: closedD.slice(-60),
    bars1wRecent: closedW.slice(-12),
    btcBars4hRecent: btcBars4h ? btcBars4h.filter((b) => b.ts + FOUR_H_MS <= nowTs).slice(-200) : undefined,
    btcCoinglass,
    cooldownState,
  };
  return { ctx, anchorTs: anchorIs4h ? anchorBar.ts : undefined, features5m, features15m, features4h, cgMissing, cgReason };
}

// Confluence summary across 5m/15m/60m/240m/1D — for discretionary check
interface MtfFeatureSummary {
  tf: string;
  rsi: number | null;
  adx: number | null;
  ema_stack: 'bull' | 'bear' | null;
  bb_pos: number | null;     // (close - bb_lower) / (bb_upper - bb_lower) — 0..1
  vol_spike: number | null;
  atr_pct: number | null;
}

interface StructuralLevels {
  poc: number | null;        // prior-day VP center
  val: number | null;
  vah: number | null;
  pwl: number | null;        // prior-week low
  pwh: number | null;
  distancePctToVAL: number;  // signed: +ve = above
  distancePctToVAH: number;
  distancePctToPOC: number;
}

interface CoinglassRaw {
  funding_oi_weighted: number | null;
  funding_vol_weighted: number | null;
  oi_close: number | null;
  oi_pct_chg_24h: number | null;
  ls_global_account: number | null;
  ls_top_account: number | null;
  ls_top_position: number | null;
  liq_long_24h_usd: number | null;
  liq_short_24h_usd: number | null;
  taker_buy_24h_usd: number | null;
  taker_sell_24h_usd: number | null;
  taker_delta_24h_usd: number | null;
}

interface BtcContext {
  price: number;
  rsi1h: number | null;
  adx1h: number | null;
  ema_stack_1h: 'bull' | 'bear' | null;
  ema_stack_4h: 'bull' | 'bear' | null;
  pwl: number | null;
  pwh: number | null;
  distancePctToPWL: number | null;
  distancePctToPWH: number | null;
  fundingOiWeighted: number | null;
  oiPctChg24h: number | null;
}

interface DecisionEnrichment {
  mtf: MtfFeatureSummary[];                // 5m, 15m, 60m, 240m, 1D
  structural: StructuralLevels;
  coinglass: CoinglassRaw | null;          // null when none of the CG fields available
  setupQuality: {
    rrTp1: number;                          // (tp1 - entry) / |entry - sl|, signed in trade direction
    rrTp2: number;
    stopPct: number;                        // |entry - sl| / entry × 100
  };
  btcContext: BtcContext | null;
  notes: string[];                          // human-readable confluence flags
}

interface PairDecision {
  symbol: string;
  price: number;
  action: 'hold' | 'enter';
  // strategy.name — flows through auto-execute → execute → trades.strategy so the
  // max-hold enforcer (and reporting) can attribute trades to their strategy.
  strategy?: string;
  side?: 'long' | 'short';
  entryPrice?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
  sizePct?: number;
  rationale?: string;
  riskCheck?: { allowed: boolean; reason?: string };
  reason?: string;
  enrichment?: DecisionEnrichment;
  // S5 scaled-in: when set, execute.ts places 3 ATR-spaced limit orders with
  // dca_boost or custom-weight qty allocation. See pair-strategies.ts.
  scaledIn?: {
    nEntries: number;
    spacingAtr: number;
    atr: number;
    tpAtrMult: number;
    sizingMode?: 'equal_r' | 'dca_boost' | 'custom_weights';
    dcaBoostDecay?: number;
    customWeights?: number[];
    tpRecomputeOnFill?: boolean;
  };
}

export interface ScanDecideResult {
  cycle: { ts: number; iso: string };
  risk: RiskState;
  decisions: PairDecision[];
  enterCount: number;
  btcContext: BtcContext | null;
  coinglassStatus: {
    missingSymbols: string[];     // pairs where funding_oi_weighted gate is disabled
    missingCount: number;
    totalSymbols: number;
  };
}

function bbPosition(f: any): number | null {
  if (!f || f.bb_upper == null || f.bb_lower == null || f.close == null) return null;
  const range = f.bb_upper - f.bb_lower;
  if (range <= 0) return null;
  return (f.close - f.bb_lower) / range;
}

function summariseFeatures(tf: string, f: any): MtfFeatureSummary {
  return {
    tf,
    rsi: f?.rsi ?? null,
    adx: f?.adx ?? null,
    ema_stack: (f?.ema_stack_aligned ?? null) as 'bull' | 'bear' | null,
    bb_pos: bbPosition(f),
    vol_spike: f?.volume_spike ?? null,
    atr_pct: f?.atr_pct ?? null,
  };
}

function pctDist(from: number, to: number | null | undefined): number {
  if (to == null || !Number.isFinite(to) || from <= 0) return 0;
  return ((from - to) / from) * 100;
}

function buildEnrichment(
  ctx: StrategyContext,
  features5m: any, features15m: any, features4h: any,
  side: 'long' | 'short',
  entry: number, sl: number, tp1: number, tp2: number | undefined,
  btcContext: BtcContext | null,
): DecisionEnrichment {
  // VP from same window the strategy used (24×1H prior to 6×1H touch zone)
  const bars1h = ctx.bars1hRecent ?? [];
  const vpEnd = Math.max(0, bars1h.length - 6);
  const vpStart = Math.max(0, vpEnd - 24);
  const vpBars = bars1h.slice(vpStart, vpEnd);
  const vp = buildVolumeProfile(vpBars, 24, 0.7);

  const lastW = ctx.bars1wRecent && ctx.bars1wRecent.length > 0 ? ctx.bars1wRecent[ctx.bars1wRecent.length - 1] : null;
  const pwl = lastW?.low ?? null;
  const pwh = lastW?.high ?? null;

  const cg = ctx.coinglass as CoinglassFeatures | undefined;
  const cgRaw: CoinglassRaw | null = cg ? {
    funding_oi_weighted: cg.funding_oi_weighted,
    funding_vol_weighted: cg.funding_vol_weighted,
    oi_close: cg.oi_close,
    oi_pct_chg_24h: cg.oi_pct_chg_24h,
    ls_global_account: cg.ls_global_account,
    ls_top_account: cg.ls_top_account,
    ls_top_position: cg.ls_top_position,
    liq_long_24h_usd: cg.liq_long_24h_usd,
    liq_short_24h_usd: cg.liq_short_24h_usd,
    taker_buy_24h_usd: cg.taker_buy_24h_usd,
    taker_sell_24h_usd: cg.taker_sell_24h_usd,
    taker_delta_24h_usd: cg.taker_delta_24h_usd,
  } : null;
  // Drop completely-empty CG (all fields null) so trader knows to be permissive
  const cgHasData = cgRaw && Object.values(cgRaw).some((v) => v != null);

  const stopDist = Math.abs(entry - sl);
  const tp1Dist = Math.abs(tp1 - entry);
  const tp2Dist = tp2 != null ? Math.abs(tp2 - entry) : 0;

  // Confluence notes — actionable hints for the trader
  const notes: string[] = [];
  // Multi-TF agreement: are 5m / 15m RSI on the trade side?
  if (side === 'long') {
    if (features5m?.rsi != null && features5m.rsi < 35) notes.push('5m RSI < 35 — продавцы перегружены, поддерживает long-возврат');
    if (features15m?.rsi != null && features15m.rsi < 40) notes.push('15m RSI < 40 — confluence для long');
    if (features4h?.ema_stack_aligned === 'bear') notes.push('⚠ 4H EMA stack BEARISH — counter-HTF риск');
    if (features4h?.ema_stack_aligned === 'bull') notes.push('✅ 4H EMA stack BULLISH — HTF подтверждает');
    if (cg?.ls_top_position != null && cg.ls_top_position > 1.5) notes.push(`⚠ LS-top ${cg.ls_top_position.toFixed(2)} — топы уже перегружены long`);
    if (cg?.ls_top_position != null && cg.ls_top_position < 1.0) notes.push(`✅ LS-top ${cg.ls_top_position.toFixed(2)} — топы не в long`);
    if (cg?.taker_delta_24h_usd != null && cg.taker_delta_24h_usd > 0) notes.push('✅ Taker delta 24h положительный — покупательская сила');
    if (cg?.taker_delta_24h_usd != null && cg.taker_delta_24h_usd < 0) notes.push('⚠ Taker delta 24h отрицательный — продавцы доминируют');
    if (cg?.liq_long_24h_usd != null && cg?.liq_short_24h_usd != null && cg.liq_long_24h_usd > cg.liq_short_24h_usd * 2) {
      notes.push('✅ Лонги ликвидированы 2× больше — капитуляция, бычий setup');
    }
  } else {
    if (features5m?.rsi != null && features5m.rsi > 65) notes.push('5m RSI > 65 — покупатели перегружены, поддерживает short');
    if (features15m?.rsi != null && features15m.rsi > 60) notes.push('15m RSI > 60 — confluence для short');
    if (features4h?.ema_stack_aligned === 'bull') notes.push('⚠ 4H EMA stack BULLISH — counter-HTF риск');
    if (features4h?.ema_stack_aligned === 'bear') notes.push('✅ 4H EMA stack BEARISH — HTF подтверждает');
    if (cg?.ls_top_position != null && cg.ls_top_position < 0.7) notes.push(`⚠ LS-top ${cg.ls_top_position.toFixed(2)} — топы уже перегружены short`);
    if (cg?.ls_top_position != null && cg.ls_top_position > 1.0) notes.push(`✅ LS-top ${cg.ls_top_position.toFixed(2)} — топы не в short`);
    if (cg?.taker_delta_24h_usd != null && cg.taker_delta_24h_usd < 0) notes.push('✅ Taker delta 24h отрицательный — продавцы доминируют');
    if (cg?.taker_delta_24h_usd != null && cg.taker_delta_24h_usd > 0) notes.push('⚠ Taker delta 24h положительный — покупатели доминируют');
    if (cg?.liq_short_24h_usd != null && cg?.liq_long_24h_usd != null && cg.liq_short_24h_usd > cg.liq_long_24h_usd * 2) {
      notes.push('✅ Шорты ликвидированы 2× больше — капитуляция, медвежий setup');
    }
  }

  // BTC correlation note
  if (btcContext && ctx.symbol !== 'BTCUSDT') {
    if (side === 'long') {
      if (btcContext.ema_stack_4h === 'bear') notes.push('⚠ BTC 4H bearish — альт long идёт против BTC');
      if (btcContext.distancePctToPWL != null && btcContext.distancePctToPWL < 1) notes.push('⚠ BTC рядом с PWL — риск пробоя');
    } else {
      if (btcContext.ema_stack_4h === 'bull') notes.push('⚠ BTC 4H bullish — альт short идёт против BTC');
      if (btcContext.distancePctToPWH != null && Math.abs(btcContext.distancePctToPWH) < 1) notes.push('⚠ BTC рядом с PWH — риск прорыва вверх');
    }
  }

  // Funding extreme hint
  if (cg?.funding_oi_weighted != null) {
    const fr = cg.funding_oi_weighted;
    if (Math.abs(fr) > 0.003) {
      if (side === 'long' && fr > 0.003) notes.push(`⚠ Funding +${fr.toFixed(4)} — лонги платят, перегретость`);
      if (side === 'short' && fr < -0.003) notes.push(`⚠ Funding ${fr.toFixed(4)} — шорты платят, перегретость`);
    }
  }

  return {
    mtf: [
      summariseFeatures('5m', features5m),
      summariseFeatures('15m', features15m),
      summariseFeatures('60m', ctx.features1h),
      summariseFeatures('240m', features4h),
      summariseFeatures('1D', ctx.featuresD),
    ],
    structural: {
      poc: vp?.poc ?? null,
      val: vp?.val ?? null,
      vah: vp?.vah ?? null,
      pwl, pwh,
      distancePctToVAL: pctDist(entry, vp?.val ?? null),
      distancePctToVAH: pctDist(entry, vp?.vah ?? null),
      distancePctToPOC: pctDist(entry, vp?.poc ?? null),
    },
    coinglass: cgHasData ? cgRaw : null,
    setupQuality: {
      rrTp1: stopDist > 0 ? tp1Dist / stopDist : 0,
      rrTp2: stopDist > 0 ? tp2Dist / stopDist : 0,
      stopPct: (stopDist / entry) * 100,
    },
    btcContext,
    notes,
  };
}

function buildBtcContext(ctx: StrategyContext, features4h: any): BtcContext {
  const lastW = ctx.bars1wRecent && ctx.bars1wRecent.length > 0 ? ctx.bars1wRecent[ctx.bars1wRecent.length - 1] : null;
  const pwl = lastW?.low ?? null;
  const pwh = lastW?.high ?? null;
  return {
    price: ctx.price,
    rsi1h: ctx.features1h?.rsi ?? null,
    adx1h: ctx.features1h?.adx ?? null,
    ema_stack_1h: (ctx.features1h?.ema_stack_aligned ?? null) as any,
    ema_stack_4h: (features4h?.ema_stack_aligned ?? null) as any,
    pwl, pwh,
    distancePctToPWL: pwl != null ? pctDist(ctx.price, pwl) : null,
    distancePctToPWH: pwh != null ? pctDist(ctx.price, pwh) : null,
    fundingOiWeighted: (ctx.coinglass as any)?.funding_oi_weighted ?? null,
    oiPctChg24h: (ctx.coinglass as any)?.oi_pct_chg_24h ?? null,
  };
}

export async function scanDecide(): Promise<ScanDecideResult> {
  // STEP 1: refresh DB candles (60m/1D/1W + funding) for v3 universe.
  // This is the ONLY way to guarantee scan operates on current data.
  // Failures here propagate as stale-bar errors per pair below.
  const refreshStartMs = Date.now();
  try {
    await refreshForScan();
    log.info('scan-decide: data refreshed', { ms: Date.now() - refreshStartMs });
  } catch (e: any) {
    log.warn('scan-decide: refreshForScan failed', { err: e?.message ?? String(e) });
    // Continue — per-pair freshness check will catch stale data.
  }

  const now = new Date();
  const nowTs = now.getTime();
  // Snapshot the risk state ONCE per cycle. precheck calls on every actionable
  // signal use the same snapshot in memory instead of re-querying DB+Bybit.
  const riskManager = await RiskManager.createForTick(now);
  const risk = riskManager.state();

  // STEP 2: single batch call for live ticker prices. If this fails, ALL pairs
  // hold (no fallback to stale closed-bar prices — that was the original bug).
  const accounts = loadAccounts();
  let livePrices = new Map<string, number>();
  try {
    livePrices = await getLiveTickers(accounts[0], UNIVERSE);
  } catch (e: any) {
    log.error('live tickers fetch failed — all pairs will hold', { err: e?.message ?? String(e) });
  }

  // STEP 2.5: load same-direction cooldown snapshot ONCE per cycle from DB.
  // The cg-fade strategy reads this via ctx.cooldownState to enforce its
  // `cooldownHours` gate (default 6h) across cron forks — its in-process Map
  // would otherwise reset to empty on every `npx tsx` invocation, making the
  // gate a no-op in production. See src/core/strategy-cooldowns.ts.
  const cooldownState = await loadCooldowns();

  // STEP 2.6: once-per-4H-anchor latch for decideOncePerAnchor strategies (v5).
  // The validated srcNew engine decides exactly once per (pair, closed 4H bar) and
  // consumes the bar even when the signal is blocked. Hourly cron scans inside the
  // same 4H window see an IDENTICAL anchor + CG read, so without this latch a
  // blocked signal re-fires at +1/+2/+3h and enters on a stale anchor.
  const decidedAnchors = await loadDecidedAnchors();

  // STEP 3a: BTC global context — fetched first so all alts can reference it.
  let btcContext: BtcContext | null = null;
  const btcLive = livePrices.get('BTCUSDT');
  if (btcLive != null) {
    const btcR = await buildContext('BTCUSDT', nowTs, btcLive, undefined, cooldownState);
    if (btcR.ctx) btcContext = buildBtcContext(btcR.ctx, btcR.features4h);
  }

  // STEP 3b: per-pair decide with strict gates + enrichment for actionable signals.
  const decisions: PairDecision[] = [];
  const cgMissingSymbols: string[] = [];

  // BTC 4H bars loaded ONCE — passed to buildContext for every pair that needs
  // cross-pair macro filter (CG-fade strategies with useBtcTrend).
  const btcBars4hRaw = await loadBars('BTCUSDT', '240m', 300);
  // Freshness guard: btcBars4h feeds the useBtcTrend macro filter for most live pairs
  // (cg-fade trendFiltersAllow). If BTC ingestion lags and these go stale, do NOT
  // silently gate entries on week-old BTC trend — drop them so useBtcTrend pairs
  // fail-safe to HOLD (trendFiltersAllow returns false on insufficient bars) + log loud.
  const BTC_BARS_STALE_MS = 12 * 60 * 60_000;
  const btcLastTs = btcBars4hRaw.reduce((m, b) => Math.max(m, b.ts), 0);
  const btcStale = btcLastTs === 0 || (nowTs - btcLastTs) > BTC_BARS_STALE_MS;
  if (btcStale && btcBars4hRaw.length > 0) {
    log.error('BTC 4H bars STALE — useBtcTrend filter disabled this cycle (affected pairs HOLD). Restore BTC candle ingestion (backfill SYMBOLS).', {
      lastTs: btcLastTs, ageHours: Math.round((nowTs - btcLastTs) / 3_600_000),
    });
  }
  const btcBars4h = btcStale ? [] : btcBars4hRaw;

  for (const symbol of UNIVERSE) {
    const strategy = getStrategyForPair(symbol);
    if (!strategy) {
      decisions.push({ symbol, price: livePrices.get(symbol) ?? 0, action: 'hold', reason: 'no-strategy-mapped' });
      continue;
    }
    const live = livePrices.get(symbol) ?? null;
    const r = await buildContext(symbol, nowTs, live, btcBars4h, cooldownState, strategy.cgReadLagBars ?? 0);
    if (r.cgMissing) cgMissingSymbols.push(symbol);
    if (!r.ctx) {
      // No anchor consumed: stale/missing data retries next hour once refresh recovers.
      decisions.push({ symbol, price: live ?? 0, action: 'hold', reason: r.reason });
      continue;
    }

    const latched = strategy.decideOncePerAnchor === true && r.anchorTs != null;
    if (latched && decidedAnchors.get(symbol) === r.anchorTs) {
      decisions.push({
        symbol, price: r.ctx.price, action: 'hold', strategy: strategy.name,
        reason: 'anchor-already-decided (once-per-4H latch)',
      });
      continue;
    }
    // Consume the anchor for every terminal outcome below (hold / enter-approved /
    // enter-blocked), with two retry-next-hour exceptions that mirror operational
    // reality rather than signal logic: (a) CG data missing at the boundary — the
    // signal never evaluated, and the +1h evaluation reads the SAME anchor-ts CG row,
    // so it computes exactly what hour 0 would have; (b) funding-window block — the
    // cron tick at 00/08/16 lands inside the ±10min window, so consuming the anchor
    // there would silently drop ~half of all validated entries (3 of 6 daily
    // boundaries). One bounded +1h retry instead; see commit message for the trade-off.
    // SCAN_LATCH_RECORD=0 → read-only probe: decide and report but do NOT consume the
    // anchor. For ad-hoc operator/Claude runs of scan-decide outside cycle.sh — a manual
    // run that surfaced an approved enter would otherwise swallow the signal (auto-execute
    // only runs from cron). Default (unset) = record, which is what cycle.sh needs.
    const latchReadOnly = process.env.SCAN_LATCH_RECORD === '0';
    const consumeAnchor = async (blockedByFundingWindow: boolean) => {
      if (!latched || latchReadOnly) return;
      if (r.cgMissing || blockedByFundingWindow) return;
      await recordDecidedAnchor(symbol, r.anchorTs!);
    };

    const action: Action = strategy.decide(r.ctx);

    if (action.kind !== 'enter') {
      await consumeAnchor(false);
      decisions.push({ symbol, price: r.ctx.price, action: 'hold', strategy: strategy.name });
      continue;
    }

    const riskCheck = await riskManager.precheck(symbol, action.sizePct);
    const enrichment = buildEnrichment(
      r.ctx, r.features5m, r.features15m, r.features4h,
      action.side, action.entryPrice, action.sl, action.tp1, action.tp2,
      btcContext,
    );

    // Quality gate: skip setups where reward-to-TP2 is too small relative to risk.
    // Implemented here (not in risk-guard.precheckEntry) because precheckEntry
    // doesn't see the action's TP/SL levels — this is decision-level filtering.
    let finalRiskCheck = { allowed: riskCheck.allowed, reason: riskCheck.reason };
    if (finalRiskCheck.allowed && RISK.minRrTp2 > 0 && enrichment.setupQuality.rrTp2 < RISK.minRrTp2) {
      finalRiskCheck = {
        allowed: false,
        reason: `rrTp2 ${enrichment.setupQuality.rrTp2.toFixed(2)} < min ${RISK.minRrTp2} (low-quality setup)`,
      };
    }

    // Macro-correlation overlay (L5, 2026-06-06): block the entry that would create
    // the 3rd SAME-side open position across the book. The 4 pairs are highly
    // BTC-correlated; an all-same-side stack is the gap-day tail risk that breaches
    // Hyro −5% (2026-05-21 in backtest). Faithful mirror of the validated
    // lever-macrocorr blk3: wouldBe = openSameSide + sameCycleApproved + 1; block if
    // wouldBe ≥ RISK.maxSameSideConcentration (3). openSameSide = unique pairs already
    // open this side (risk snapshot); sameCycleApproved = same-side entries approved
    // earlier THIS cycle (the once-per-cycle snapshot can't see in-cycle approvals —
    // this is the backtest's per-bar `pendingSame`, and UNIVERSE order == backtest BOOK
    // priority order). A block here never reaches execute.ts → burns no strategy
    // cooldown (the suppressed extreme re-fires next cycle).
    if (finalRiskCheck.allowed && RISK.maxSameSideConcentration > 0) {
      const openSameSide = action.side === 'long' ? risk.openLongCount : risk.openShortCount;
      const sameCycleApproved = decisions.filter(
        (d) => d.action === 'enter' && d.riskCheck?.allowed === true && d.side === action.side,
      ).length;
      const wouldBe = openSameSide + sameCycleApproved + 1;
      if (wouldBe >= RISK.maxSameSideConcentration) {
        finalRiskCheck = {
          allowed: false,
          reason: `same-side concentration: ${wouldBe}× ${action.side} (open ${openSameSide} + cycle ${sameCycleApproved} + this) ≥ cap ${RISK.maxSameSideConcentration} — macro-corr overlay`,
        };
      }
    }

    // Funding-window block is the ONLY non-consuming block (bounded +1h retry);
    // every other outcome (approved, cooldown, cap, heat, rrTp2, same-side) consumes
    // the anchor exactly like the validated engine consumes a decision bar. An
    // approved entry consumes even if downstream execution is paused (PAUSE.md) or
    // fails — a late entry on a stale anchor is exactly what the latch forbids.
    const fundingBlocked = !finalRiskCheck.allowed && risk.inFundingWindow;
    await consumeAnchor(fundingBlocked);

    decisions.push({
      symbol,
      price: r.ctx.price,
      action: 'enter',
      strategy: strategy.name,
      side: action.side,
      entryPrice: action.entryPrice,
      sl: action.sl,
      tp1: action.tp1,
      tp2: action.tp2,
      sizePct: action.sizePct,
      rationale: action.rationale,
      riskCheck: finalRiskCheck,
      enrichment,
      scaledIn: action.scaledIn,
    });
  }

  const enterCount = decisions.filter((d) => d.action === 'enter' && d.riskCheck?.allowed).length;

  // Surface Coinglass degraded state: when funding_oi_weighted is missing for any pair,
  // the strategy's funding-extreme gate is silently disabled for that pair. Operator
  // needs to know the strategy is running weaker than designed.
  if (cgMissingSymbols.length > 0) {
    log.warn('coinglass degraded — funding-extreme gate off for these symbols', {
      missing: cgMissingSymbols,
      total: UNIVERSE.length,
    });
  }

  return {
    cycle: { ts: nowTs, iso: now.toISOString() },
    risk,
    decisions,
    enterCount,
    btcContext,
    coinglassStatus: {
      missingSymbols: cgMissingSymbols,
      missingCount: cgMissingSymbols.length,
      totalSymbols: UNIVERSE.length,
    },
  };
}

// Fixed output path — every run writes the JSON here, so trader reads via Read tool
// without needing shell redirect (`> /tmp/x.json`) which triggers Claude Code prompts.
const JSON_OUT_PATH = '/tmp/scan-decide-latest.json';

async function main() {
  const arg = process.argv[2];
  const result = await scanDecide();

  // Always write JSON to fixed path (side effect). Then format stdout per arg.
  fs.writeFileSync(JSON_OUT_PATH, JSON.stringify(result, null, 2));

  if (arg === 'json') {
    console.log(JSON.stringify(result, null, 2));
    await closePg();
    return;
  }

  // Human-readable summary
  console.log(`==== scan-decide @ ${result.cycle.iso} ====`);
  console.log(`equity: $${result.risk.totalEquityUsd.toFixed(0)}  daily P&L: ${result.risk.dailyPnlPct.toFixed(2)}%  open: ${result.risk.openPositionsCount}/${RISK.maxParallelPositions}  heat: ${result.risk.totalHeatPct.toFixed(2)}%/${RISK.totalHeatCapPct}%`);
  if (result.risk.inFundingWindow) console.log('  ⛔ FUNDING WINDOW');
  if (result.risk.softKillTriggered) console.log('  ⛔ SOFT KILL');
  if (result.risk.hardKillTriggered) console.log('  ⛔ HARD KILL');
  console.log('');

  for (const d of result.decisions) {
    if (d.action === 'hold') {
      console.log(`  ${d.symbol.padEnd(10)} HOLD  price ${d.price.toFixed(4)}  ${d.reason ?? ''}`);
    } else {
      const ok = d.riskCheck?.allowed ? '✅' : '❌';
      const block = d.riskCheck?.allowed ? '' : `BLOCKED: ${d.riskCheck?.reason}`;
      console.log(`  ${d.symbol.padEnd(10)} ${ok} ENTER ${d.side?.toUpperCase()} @ ${d.entryPrice?.toFixed(4)}  SL ${d.sl?.toFixed(4)}  TP1 ${d.tp1?.toFixed(4)}  TP2 ${d.tp2?.toFixed(4)}  size ${d.sizePct}%  ${block}`);
      if (d.riskCheck?.allowed && d.rationale) console.log(`      ${d.rationale}`);
    }
  }
  console.log(`\n${result.enterCount} actionable entries (after risk check).`);
  console.log(`\nMachine-readable JSON also written to ${JSON_OUT_PATH} (Read tool to inspect).`);

  await closePg();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (e) => {
      log.error('scan-decide failed', { err: e?.message ?? String(e), stack: e?.stack });
      try { await closePg(); } catch {}
      process.exit(1);
    });
}

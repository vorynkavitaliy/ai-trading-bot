// Live decision scanner — what the /loop calls every cycle.
//
// For each of the 10 pairs:
//   1. Loads OHLCV at 1H/4H/1D/1W from DB (warmup-padded)
//   2. Computes features at all TFs
//   3. Loads Coinglass features (if available — null otherwise, strategy permissive)
//   4. Builds StrategyContext identical to backtest engine
//   5. Calls VP-SMC decide() → 'hold' | 'enter'
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
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams, buildVolumeProfile } from '../strategies/btc-vp-smc';
import { Action, Bar, StrategyContext } from '../backtest/types';
import { getRiskState, precheckEntry, RISK, RiskState } from './risk-guard';
import { getLiveTickers } from '../core/bybit';
import { loadAccounts } from '../core/accounts';
import { refreshForScan } from '../data/backfill';
import { log } from '../core/logger';

const UNIVERSE = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'BNBUSDT', 'LTCUSDT', 'ATOMUSDT',
  'TONUSDT', 'DOGEUSDT',
  'APTUSDT', 'ARBUSDT',
  'TAOUSDT', 'INJUSDT',  // 2026-05-17: replace LINK/SUI per regime-decompose audit
];                       // (LINK weak in trend_bull, SUI no preferred regime).
                         // TAO bt 365d slip 0.25%: WR 80.4%/PF 3.86/+5.87%.
                         // INJ bt 365d slip 0.25%: WR 82.5%/PF 4.79/+5.09%.

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT:  { maxStopAtrPct: 5.0 },
  DOGEUSDT: { maxStopAtrPct: 5.5 },
  APTUSDT:  { maxStopAtrPct: 5.0 },
  ARBUSDT:  { maxStopAtrPct: 5.0 },
  TAOUSDT:  { maxStopAtrPct: 5.0 },
  INJUSDT:  { maxStopAtrPct: 5.0 },
};

async function loadBars(symbol: string, tf: string, lookbackBars: number): Promise<Bar[]> {
  const r = await query<any>(
    `SELECT ts::text, open, high, low, close, volume FROM candles
     WHERE symbol = $1 AND tf = $2 ORDER BY ts DESC LIMIT $3`,
    [symbol, tf, lookbackBars]
  );
  return r.rows.reverse().map((row: any): Bar => ({
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
  }));
}

interface ContextResult {
  ctx: StrategyContext | null;
  reason?: string;          // why ctx is null (data freshness, missing live price, etc.)
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

async function buildContext(symbol: string, nowTs: number, livePrice: number | null): Promise<ContextResult> {
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
  let coinglass: CoinglassFeatures | undefined;
  let cgMissing = false;
  let cgReason: string | undefined;
  try {
    const coin = symbol.replace(/USDT$/, '');
    coinglass = await loadCoinglassAt(coin, symbol, decisionBar.ts);
    if (coinglass.funding_oi_weighted == null) {
      cgMissing = true;
      cgReason = 'no funding_oi_weighted row at decisionBar.ts';
    }
  } catch (e: any) {
    coinglass = undefined;
    cgMissing = true;
    cgReason = `load threw: ${e?.message ?? String(e)}`;
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
  const ctx: StrategyContext = {
    symbol,
    ts: nowTs,
    price: decisionBar.close,         // matches backtest engine
    features1h,
    features4h,
    featuresD,
    featuresW,
    position: null,
    coinglass,
    recentBars: closed1h.slice(-30),
    bars1hRecent: closed1h.slice(-200),
    bars1dRecent: closedD.slice(-60),
    bars1wRecent: closedW.slice(-12),
  };
  return { ctx, features5m, features15m, features4h, cgMissing, cgReason };
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
  const risk = await getRiskState(now);

  // STEP 2: single batch call for live ticker prices. If this fails, ALL pairs
  // hold (no fallback to stale closed-bar prices — that was the original bug).
  const accounts = loadAccounts();
  let livePrices = new Map<string, number>();
  try {
    livePrices = await getLiveTickers(accounts[0], UNIVERSE);
  } catch (e: any) {
    log.error('live tickers fetch failed — all pairs will hold', { err: e?.message ?? String(e) });
  }

  // STEP 3a: BTC global context — fetched first so all alts can reference it.
  let btcContext: BtcContext | null = null;
  const btcLive = livePrices.get('BTCUSDT');
  if (btcLive != null) {
    const btcR = await buildContext('BTCUSDT', nowTs, btcLive);
    if (btcR.ctx) btcContext = buildBtcContext(btcR.ctx, btcR.features4h);
  }

  // STEP 3b: per-pair decide with strict gates + enrichment for actionable signals.
  const decisions: PairDecision[] = [];
  const cgMissingSymbols: string[] = [];

  for (const symbol of UNIVERSE) {
    const live = livePrices.get(symbol) ?? null;
    const r = await buildContext(symbol, nowTs, live);
    if (r.cgMissing) cgMissingSymbols.push(symbol);
    if (!r.ctx) {
      decisions.push({ symbol, price: live ?? 0, action: 'hold', reason: r.reason });
      continue;
    }
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const action: Action = strategy.decide(r.ctx);

    if (action.kind !== 'enter') {
      decisions.push({ symbol, price: r.ctx.price, action: 'hold' });
      continue;
    }

    const riskCheck = await precheckEntry(symbol, action.sizePct, now);
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

    decisions.push({
      symbol,
      price: r.ctx.price,
      action: 'enter',
      side: action.side,
      entryPrice: action.entryPrice,
      sl: action.sl,
      tp1: action.tp1,
      tp2: action.tp2,
      sizePct: action.sizePct,
      rationale: action.rationale,
      riskCheck: finalRiskCheck,
      enrichment,
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

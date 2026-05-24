// Per-signal enrichment block: everything the trader needs for discretionary
// confluence analysis (multi-TF, Coinglass raw, BTC context, structural levels).
// Used by both live `scan-decide.ts` and historical `walk-7d.ts`.

import { Bar, StrategyContext } from './types';
import { buildVolumeProfile } from '../strategies/volume-profile';
import { CoinglassFeatures } from '../data/coinglass-features';

export interface MtfFeatureSummary {
  tf: string;
  rsi: number | null;
  adx: number | null;
  ema_stack: 'bull' | 'bear' | null;
  bb_pos: number | null;
  vol_spike: number | null;
  atr_pct: number | null;
}

export interface StructuralLevels {
  poc: number | null;
  val: number | null;
  vah: number | null;
  pwl: number | null;
  pwh: number | null;
  distancePctToVAL: number;
  distancePctToVAH: number;
  distancePctToPOC: number;
}

export interface CoinglassRaw {
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

export interface BtcContext {
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

export interface DecisionEnrichment {
  mtf: MtfFeatureSummary[];
  structural: StructuralLevels;
  coinglass: CoinglassRaw | null;
  setupQuality: { rrTp1: number; rrTp2: number; stopPct: number };
  btcContext: BtcContext | null;
  notes: string[];
}

function bbPosition(f: any): number | null {
  if (!f || f.bb_upper == null || f.bb_lower == null || f.close == null) return null;
  const range = f.bb_upper - f.bb_lower;
  if (range <= 0) return null;
  return (f.close - f.bb_lower) / range;
}

export function summariseFeatures(tf: string, f: any): MtfFeatureSummary {
  return {
    tf,
    rsi: f?.rsi ?? null,
    adx: f?.adx ?? null,
    ema_stack: (f?.ema_stack_aligned ?? null) as any,
    bb_pos: bbPosition(f),
    vol_spike: f?.volume_spike ?? null,
    atr_pct: f?.atr_pct ?? null,
  };
}

function pctDist(from: number, to: number | null | undefined): number {
  if (to == null || !Number.isFinite(to) || from <= 0) return 0;
  return ((from - to) / from) * 100;
}

export function buildBtcContextFrom(price: number, features1h: any, features4h: any, bars1wRecent: Bar[] | undefined, coinglass: CoinglassFeatures | undefined): BtcContext {
  const lastW = bars1wRecent && bars1wRecent.length > 0 ? bars1wRecent[bars1wRecent.length - 1] : null;
  const pwl = lastW?.low ?? null;
  const pwh = lastW?.high ?? null;
  return {
    price,
    rsi1h: features1h?.rsi ?? null,
    adx1h: features1h?.adx ?? null,
    ema_stack_1h: (features1h?.ema_stack_aligned ?? null) as any,
    ema_stack_4h: (features4h?.ema_stack_aligned ?? null) as any,
    pwl, pwh,
    distancePctToPWL: pwl != null ? pctDist(price, pwl) : null,
    distancePctToPWH: pwh != null ? pctDist(price, pwh) : null,
    fundingOiWeighted: coinglass?.funding_oi_weighted ?? null,
    oiPctChg24h: coinglass?.oi_pct_chg_24h ?? null,
  };
}

export function buildEnrichment(
  ctx: StrategyContext,
  features5m: any, features15m: any, features4h: any,
  side: 'long' | 'short',
  entry: number, sl: number, tp1: number, tp2: number | undefined,
  btcContext: BtcContext | null,
): DecisionEnrichment {
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
  const cgHasData = cgRaw && Object.values(cgRaw).some((v) => v != null);

  const stopDist = Math.abs(entry - sl);
  const tp1Dist = Math.abs(tp1 - entry);
  const tp2Dist = tp2 != null ? Math.abs(tp2 - entry) : 0;

  const notes: string[] = [];
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

  if (btcContext && ctx.symbol !== 'BTCUSDT') {
    if (side === 'long') {
      if (btcContext.ema_stack_4h === 'bear') notes.push('⚠ BTC 4H bearish — альт long идёт против BTC');
      if (btcContext.distancePctToPWL != null && btcContext.distancePctToPWL < 1) notes.push('⚠ BTC рядом с PWL — риск пробоя');
    } else {
      if (btcContext.ema_stack_4h === 'bull') notes.push('⚠ BTC 4H bullish — альт short идёт против BTC');
      if (btcContext.distancePctToPWH != null && Math.abs(btcContext.distancePctToPWH) < 1) notes.push('⚠ BTC рядом с PWH — риск прорыва вверх');
    }
  }

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

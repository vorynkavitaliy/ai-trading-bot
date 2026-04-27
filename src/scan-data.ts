/**
 * Claude-driven data provider. Returns raw market data as JSON for Claude to analyze.
 *
 *   npx tsx src/scan-data.ts BTCUSDT
 *   npx tsx src/scan-data.ts BTCUSDT ETHUSDT SOLUSDT
 *   npx tsx src/scan-data.ts all
 *
 * Output: structured JSON to stdout. NO confluence scoring, NO decisions — just facts.
 * Claude reads vault + this JSON and decides.
 *
 * Shape (per symbol):
 * {
 *   "symbol": "BTCUSDT",
 *   "timestamp": "2026-04-18T14:45:00Z",
 *   "price": 103500,
 *   "klines": {
 *     "4h": {"last5": [...OHLCV], "atr14": 820},
 *     "1h": {"last10": [...OHLCV], "atr14": 280},
 *     "15m": {"last20": [...OHLCV], "atr14": 95},
 *     "3m": {"last30": [...OHLCV]}
 *   },
 *   "indicators": {
 *     "rsi": {"4h": 58, "1h": 52, "15m": 47, "3m": 45},
 *     "ema": {"1h_21": 103200, "1h_55": 102800, "4h_21": 101000},
 *     "adx": {"1h": 28, "1h_plus_di": 24, "1h_minus_di": 18},
 *     "macd": {"1h_hist": 0.2, "1h_direction": "up"},
 *     "obv": {"1h_slope": "up", "1h_div": null}
 *   },
 *   "orderbook": {
 *     "bid_depth_5pct": 12400000,
 *     "ask_depth_5pct": 8100000,
 *     "imbalance": 0.605, // bids / (bids + asks)
 *     "spread_bps": 1.2
 *   },
 *   "orderflow": {  // Phase 3 — CVD + top-5 OBI; leading signals
 *     "cvd_1m": {"cvd_usd": 420000, "divergence": "none", "trades": 310, "price_change_pct": 0.08},
 *     "cvd_5m": {"cvd_usd": 1800000, "divergence": "bullish", "trades": 1600, "price_change_pct": -0.12},
 *     "obi_top5": {"obi": 0.23, "obi_usd": 0.21, "bid_usd": 2100000, "ask_usd": 1300000}
 *   },
 *   "marketStructure": {
 *     "bos_1h": "bullish" | "bearish" | null,
 *     "choch_1h": null,
 *     "sweep": {"direction": "high", "level": 104200, "bars_ago": 3} | null,
 *     "key_levels": {"nearest_support": 102800, "nearest_resistance": 104200},
 *     "order_blocks_1h": [...]
 *   },
 *   "btc": {...} | null,  // null for BTCUSDT self
 *   "session": {"name": "London", "quality": 1.0, "allow_entry": true, "near_funding_window_min": 134},
 *   "news": {
 *     "bias": "neutral" | "risk-on" | "risk-off",
 *     "impact": "low" | "medium" | "high",
 *     "risk_multiplier": 1.0,
 *     "triggers": [...],
 *     "headlines": [...first 5]
 *   },
 *   "openPositions": [
 *     {"account": "50k", "direction": "Long", "entry": 103000, "qty": 0.5, "ageMin": 47,
 *      "unrealizedR": 0.8, "sl": 102500, "tp": 104500, "unrealizedPnlUsd": 400}
 *   ],
 *   "pendingOrders": [...],
 *   "risk": [{"account": "50k", "status": "ok", "dailyDd": 1.2, "totalDd": 0.7, "equity": 49500}]
 * }
 */
import * as path from 'node:path';
import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';
import { RiskEngine } from './risk/engine';
import { cache } from './cache';
import { config } from './config';
import { Indicators, Candle } from './analysis/indicators';
import { Structure } from './analysis/structure';
import { Orderflow } from './analysis/orderflow';
import { detectSession, isNearFundingWindow } from './analysis/sessions';
import { RegimeHmm, type HmmParams, type RegimeInference } from './analysis/regime-hmm';
import { NewsFetcher } from './news/fetcher';

/**
 * Phase 4: HMM regime params loaded lazily from vault/state/hmm-params.json.
 * Null if file missing — caller falls back to slow 4H `regime` field.
 * Retrain via `npm run train-hmm`.
 */
const HMM_PARAMS_PATH = path.join(process.cwd(), 'vault/state/hmm-params.json');
let hmmParams: HmmParams | null = null;
try {
  hmmParams = RegimeHmm.load(HMM_PARAMS_PATH);
} catch {
  hmmParams = null;
}

function minutesToNextFunding(now: Date = new Date()): number {
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const fundingHours = [0, 8, 16];
  const mins = fundingHours.map((fh) => {
    let diff = (fh - h) * 60 - m;
    if (diff <= 0) diff += 24 * 60;
    return diff;
  });
  return Math.min(...mins);
}

interface KlineSummary {
  last: Array<[number, number, number, number, number, number]>; // [ts, o, h, l, c, v]
  atr14?: number;
}

function summarizeKlines(candles: Candle[], keepLast: number): KlineSummary {
  const last = candles.slice(-keepLast).map(
    (c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume] as [number, number, number, number, number, number],
  );
  const atr14 = Indicators.atr(candles, 14);
  return { last, atr14 };
}

function indicatorSummary(c4h: Candle[], c1h: Candle[], c15m: Candle[], c3m: Candle[]) {
  // v2 core (strategy.md Playbook A + B)
  const ema8_1h = Indicators.ema(c1h, 8);
  const ema21_1h = Indicators.ema(c1h, 21);
  const ema55_1h = Indicators.ema(c1h, 55);
  const ema200_1h = Indicators.ema(c1h, 200);
  const ema21_4h = Indicators.ema(c4h, 21);
  const bb_1h = Indicators.bb(c1h, 20, 2.0);
  const atr_1h = Indicators.atr(c1h, 14);
  const volCurrent_1h = c1h[c1h.length - 1]?.volume;
  // Manual SMA20 of volume (1H)
  const vol20 = c1h.slice(-20).reduce((s, k) => s + k.volume, 0) / Math.max(1, Math.min(20, c1h.length));
  const volSpikeMult_1h = vol20 > 0 && volCurrent_1h !== undefined ? volCurrent_1h / vol20 : null;

  // Legacy/auxiliary (kept for other parts of pipeline + Claude free-form analysis)
  const macd1h = Indicators.macd(c1h);
  const adx1h = Indicators.adx(c1h, 14);
  const obvSeries1h = Indicators.obv(c1h);
  const stoch15m = Indicators.stoch(c15m);
  const rsiSlopeAccel1h = Indicators.rsiSlopeAcceleration(c1h, 14, 5, 3);
  const obvLast = obvSeries1h[obvSeries1h.length - 1];
  const obvPrev10 = obvSeries1h[obvSeries1h.length - 11] ?? obvSeries1h[0];

  return {
    rsi: {
      '4h': Indicators.rsi(c4h, 14),
      '1h': Indicators.rsi(c1h, 14),
      '15m': Indicators.rsi(c15m, 14),
      '3m': Indicators.rsi(c3m, 14),
    },
    rsi_slope_1h: Indicators.rsiSlope(c1h, 14, 5),
    rsi_slope_accel_1h: rsiSlopeAccel1h !== undefined ? +rsiSlopeAccel1h.toFixed(4) : null,
    stoch_15m: stoch15m
      ? { k: +stoch15m.k.toFixed(2), d: +stoch15m.d.toFixed(2) }
      : null,
    ema: {
      '4h_21': ema21_4h,
      '1h_8': ema8_1h,
      '1h_21': ema21_1h,
      '1h_55': ema55_1h,
      '1h_200': ema200_1h,
    },
    bb_1h: bb_1h ? {
      upper: +bb_1h.upper.toFixed(2),
      middle: +bb_1h.middle.toFixed(2),
      lower: +bb_1h.lower.toFixed(2),
    } : null,
    atr_1h: atr_1h !== undefined ? +atr_1h.toFixed(2) : null,
    volume_1h: {
      current: volCurrent_1h !== undefined ? +volCurrent_1h.toFixed(2) : null,
      sma20: +vol20.toFixed(2),
      spike_mult: volSpikeMult_1h !== null ? +volSpikeMult_1h.toFixed(2) : null,
    },
    macd1h: macd1h
      ? {
          macd: +macd1h.MACD.toFixed(4),
          signal: +macd1h.signal.toFixed(4),
          histogram: +macd1h.histogram.toFixed(4),
        }
      : null,
    adx1h,
    obv1h: {
      last: obvLast,
      prev_10: obvPrev10,
      slope_10: obvLast - obvPrev10,
    },
    rsi_div_1h: Indicators.rsiDivergence(c1h, 30),
    obv_div_1h: Indicators.obvDivergence(c1h, 30),
  };
}

/**
 * Strategy v2 context: regime gate + active playbook + entry trigger state.
 *
 * Mirror of `vault/Playbook/strategy.md` Playbook A/B rules so Claude sees the
 * binary decision inline — no re-derivation from raw indicators needed.
 *
 * For SOL: B is disabled regardless of regime (backtest showed B fails on SOL).
 */
function computeV2Context(symbol: string, c1h: Candle[]) {
  if (c1h.length < 200) return null;

  const ema8 = Indicators.ema(c1h, 8);
  const ema21 = Indicators.ema(c1h, 21);
  const ema55 = Indicators.ema(c1h, 55);
  const ema200 = Indicators.ema(c1h, 200);
  const adx = Indicators.adx(c1h, 14);
  const rsi = Indicators.rsi(c1h, 14);
  const bb = Indicators.bb(c1h, 20, 2.0);
  const atr = Indicators.atr(c1h, 14);
  const last = c1h[c1h.length - 1];
  if (!ema8 || !ema21 || !ema55 || !ema200 || !adx || !rsi || !bb || !atr) return null;

  const vol20 = c1h.slice(-20).reduce((s, k) => s + k.volume, 0) / 20;
  const volSpike = last.volume / Math.max(vol20, 1e-9);

  const stackBullish = ema8 > ema21 && ema21 > ema55 && ema55 > ema200;
  const stackBearish = ema8 < ema21 && ema21 < ema55 && ema55 < ema200;
  const stackAligned = stackBullish || stackBearish;
  const diDominant = adx.pdi > adx.mdi ? 'pdi' : adx.mdi > adx.pdi ? 'mdi' : 'neutral';

  // Regime gate per strategy.md
  let regime: 'RANGE' | 'TREND' | 'TRANSITION';
  if (adx.adx < 22) regime = 'RANGE';
  else if (adx.adx >= 25 && stackAligned) regime = 'TREND';
  else regime = 'TRANSITION';

  // A-only pairs: B playbook failed OOS walk-forward. In TREND regime these pairs skip
  // (don't force B); only trade A on range.
  //   - SOL −4.22R, BNB −0.27R (v2 original pairs)
  //   - OP/NEAR/AVAX/SUI (added 2026-04-23): B OOS weak (AVAX −2.11R, OP −0.79R,
  //     SUI +1.20R marginal, NEAR +4.43R on 6 trades only). A-only enforced.
  //   - XLM/TAO (added 2026-04-27): B OOS −0.34R / −1.83R respectively. A-only enforced.
  const aOnlyPairs = ['SOLUSDT', 'BNBUSDT', 'OPUSDT', 'NEARUSDT', 'AVAXUSDT', 'SUIUSDT', 'XLMUSDT', 'TAOUSDT'];
  const isAOnly = aOnlyPairs.includes(symbol);
  const activePlaybook: 'A' | 'B' | 'SKIP' =
    regime === 'RANGE' ? 'A' :
    regime === 'TREND' && !isAOnly ? 'B' :
    'SKIP';

  // Playbook A entry triggers (1H close state)
  const a_long_trigger = regime === 'RANGE' && last.close <= bb.lower && rsi < 35 && volSpike >= 1.3;
  const a_short_trigger = regime === 'RANGE' && last.close >= bb.upper && rsi > 65 && volSpike >= 1.3;

  // Playbook B entry triggers (pullback to EMA55 with close-through)
  const pullbackTol = 0.005;
  const ema55Touch = last.low <= ema55 * (1 + pullbackTol) && last.high >= ema55 * (1 - pullbackTol);
  const b_long_trigger = regime === 'TREND' && !isAOnly && stackBullish && diDominant === 'pdi'
    && ema55Touch && last.close > ema55 && rsi > 45;
  const b_short_trigger = regime === 'TREND' && !isAOnly && stackBearish && diDominant === 'mdi'
    && ema55Touch && last.close < ema55 && rsi < 55;

  // Stop distance for the would-be setup (informational, Claude plans actual SL)
  const slDistA_long = Math.max(last.close - (bb.lower - 0.5 * atr), 0);
  const slDistA_short = Math.max((bb.upper + 0.5 * atr) - last.close, 0);
  const slDistB_long = Math.max(last.close - (Math.min(ema55, last.low) - 1.0 * atr), 0);
  const slDistB_short = Math.max((Math.max(ema55, last.high) + 1.0 * atr) - last.close, 0);

  return {
    regime,
    active_playbook: activePlaybook,
    ema_stack_1h: stackBullish ? 'bullish' : stackBearish ? 'bearish' : 'mixed',
    di_dominant: diDominant,
    playbook_a: {
      long_trigger: a_long_trigger,
      short_trigger: a_short_trigger,
      sl_dist_long_pct: +((slDistA_long / last.close) * 100).toFixed(3),
      sl_dist_short_pct: +((slDistA_short / last.close) * 100).toFixed(3),
      sl_long: +(bb.lower - 0.5 * atr).toFixed(2),
      sl_short: +(bb.upper + 0.5 * atr).toFixed(2),
      tp1_middle: +bb.middle.toFixed(2),
      tp2_long: +bb.upper.toFixed(2),
      tp2_short: +bb.lower.toFixed(2),
    },
    playbook_b: {
      enabled: !isAOnly,
      long_trigger: b_long_trigger,
      short_trigger: b_short_trigger,
      ema55_touch: ema55Touch,
      sl_dist_long_pct: +((slDistB_long / last.close) * 100).toFixed(3),
      sl_dist_short_pct: +((slDistB_short / last.close) * 100).toFixed(3),
    },
    // Volatility scalar per strategy.md
    atr_pct: +((atr / last.close) * 100).toFixed(3),
    vol_scalar: (() => {
      const p = (atr / last.close) * 100;
      if (p < 1.5) return 1.2;
      if (p > 2.5) return 0.7;
      return 1.0;
    })(),
  };
}

/**
 * Funding rate + open interest with 1h deltas.
 * Snapshots are persisted in Redis hash `ts:${symbol}` (see cache.tsAppend).
 * Delta computed from prior snapshot closest to 60 min ago within ±15 min tolerance.
 * Trim entries older than 150 min each cycle to keep hash small.
 */
async function fundingOiSummary(bybit: BybitClient, symbol: string) {
  const WINDOW_MS = 60 * 60 * 1000;
  const TOLERANCE_MS = 15 * 60 * 1000;
  const TRIM_MS = 150 * 60 * 1000;
  const nowMs = Date.now();

  let fundingRate: number | null = null;
  let openInterest: number | null = null;
  try {
    const t = await bybit.getPrice(symbol);
    fundingRate = t.fundingRate !== undefined && t.fundingRate !== '' ? Number(t.fundingRate) : null;
    openInterest = t.openInterest !== undefined && t.openInterest !== '' ? Number(t.openInterest) : null;
  } catch (err: any) {
    return {
      funding_rate: null,
      funding_delta_1h: null,
      open_interest: null,
      oi_delta_1h_pct: null,
      error: err?.message ?? String(err),
    };
  }

  // Read prior snapshots, find one closest to nowMs - WINDOW_MS within tolerance
  let fundingDelta: number | null = null;
  let oiDeltaPct: number | null = null;
  try {
    const series = await cache.tsGetAll<{ funding: number | null; oi: number | null }>(symbol);
    const targetTs = nowMs - WINDOW_MS;
    let best: { ts: number; data: { funding: number | null; oi: number | null } } | null = null;
    let bestDiff = Infinity;
    for (const entry of series) {
      const diff = Math.abs(entry.ts - targetTs);
      if (diff <= TOLERANCE_MS && diff < bestDiff) {
        best = entry;
        bestDiff = diff;
      }
    }
    if (best) {
      if (fundingRate !== null && best.data.funding !== null && best.data.funding !== undefined) {
        fundingDelta = +(fundingRate - best.data.funding).toFixed(6);
      }
      if (
        openInterest !== null &&
        best.data.oi !== null &&
        best.data.oi !== undefined &&
        best.data.oi !== 0
      ) {
        oiDeltaPct = +(((openInterest - best.data.oi) / best.data.oi) * 100).toFixed(3);
      }
    }
  } catch {
    /* treat as no prior */
  }

  // Append current snapshot + trim old (best-effort)
  try {
    await cache.tsAppend(symbol, { funding: fundingRate, oi: openInterest }, nowMs);
    await cache.tsTrim(symbol, TRIM_MS, nowMs);
  } catch {
    /* non-fatal */
  }

  return {
    funding_rate: fundingRate,
    funding_delta_1h: fundingDelta,
    open_interest: openInterest,
    oi_delta_1h_pct: oiDeltaPct,
  };
}

async function getOrderbookSummary(bybit: BybitClient, symbol: string, price: number) {
  try {
    const ob = await bybit.getOrderbook(symbol, 200);
    if (!ob.bids.length || !ob.asks.length) return null;
    const bestBid = ob.bids[0].price;
    const bestAsk = ob.asks[0].price;
    const spread_bps = ((bestAsk - bestBid) / price) * 10_000;
    const lowerBound = price * 0.95;
    const upperBound = price * 1.05;
    const bid5pct = ob.bids.filter((b) => b.price >= lowerBound).reduce((s, b) => s + b.price * b.qty, 0);
    const ask5pct = ob.asks.filter((a) => a.price <= upperBound).reduce((s, a) => s + a.price * a.qty, 0);
    const total = bid5pct + ask5pct;
    return {
      bid_depth_5pct_usd: Math.round(bid5pct),
      ask_depth_5pct_usd: Math.round(ask5pct),
      imbalance: total > 0 ? +(bid5pct / total).toFixed(3) : 0.5,
      spread_bps: +spread_bps.toFixed(2),
      best_bid: bestBid,
      best_ask: bestAsk,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

function marketStructureSummary(c1h: Candle[], c15m: Candle[], c3m: Candle[]) {
  const bos_1h = Structure.bos(c1h);
  // Faster-TF BOS for intraday responsiveness (1H BOS lags up to 60 min, 15M lags up to 15 min, 3M lags up to 3 min)
  const bos_15m = Structure.bos(c15m);
  const bos_3m = Structure.bos(c3m);
  // Sweep detection: look for wicks beyond last 20-bar swing on 15m
  const recent = c15m.slice(-25);
  let sweep: { direction: 'high' | 'low'; level: number; bars_ago: number } | null = null;
  if (recent.length >= 20) {
    const testArea = recent.slice(0, -3);
    const lastBars = recent.slice(-3);
    const areaHigh = Math.max(...testArea.map((c) => c.high));
    const areaLow = Math.min(...testArea.map((c) => c.low));
    for (let i = 0; i < lastBars.length; i++) {
      const c = lastBars[i];
      if (c.high > areaHigh && c.close < areaHigh) {
        sweep = { direction: 'high', level: areaHigh, bars_ago: lastBars.length - i - 1 };
        break;
      }
      if (c.low < areaLow && c.close > areaLow) {
        sweep = { direction: 'low', level: areaLow, bars_ago: lastBars.length - i - 1 };
        break;
      }
    }
  }
  // Key levels — simple swing high/low
  const last50 = c1h.slice(-50);
  const highs = last50.map((c) => c.high);
  const lows = last50.map((c) => c.low);
  const lastPrice = c1h[c1h.length - 1].close;
  const resistanceCands = highs.filter((h) => h > lastPrice).sort((a, b) => a - b);
  const supportCands = lows.filter((l) => l < lastPrice).sort((a, b) => b - a);
  // Close vs prior swing low/high on 15M — "implicit" breakdown/breakout signal
  // that fires the same cycle price breaks, without waiting for pivot confirmation.
  // This is tighter than Structure.bos() which requires a confirmed swing pivot.
  let close_vs_swing_15m: 'below_prior_low' | 'above_prior_high' | 'inside' = 'inside';
  if (c15m.length >= 22) {
    const priorWindow = c15m.slice(-21, -1);
    const priorLow = Math.min(...priorWindow.map((k) => k.low));
    const priorHigh = Math.max(...priorWindow.map((k) => k.high));
    const curClose = c15m[c15m.length - 1].close;
    if (curClose < priorLow) close_vs_swing_15m = 'below_prior_low';
    else if (curClose > priorHigh) close_vs_swing_15m = 'above_prior_high';
  }

  // Prior UTC day high/low — explicit for `prior_day_hl` zone derivation at 1H-Close Protocol.
  // Computed from the 1H kline bucket covering yesterday 00:00-23:59 UTC.
  // Added 2026-04-22 so Claude doesn't reach for python3 -c to extract manually (forbidden).
  const now = new Date();
  const yStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0);
  const yEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
  const yBars = c1h.filter((c) => c.timestamp >= yStart && c.timestamp < yEnd);
  const prior_day_utc = yBars.length
    ? {
        date: new Date(yStart).toISOString().slice(0, 10),
        high: Math.max(...yBars.map((c) => c.high)),
        low: Math.min(...yBars.map((c) => c.low)),
        bar_count: yBars.length,
      }
    : null;

  return {
    bos_1h,
    bos_15m,
    bos_3m,
    close_vs_swing_15m,
    sweep,
    prior_day_utc,
    key_levels: {
      nearest_resistance: resistanceCands[0] ?? null,
      nearest_support: supportCands[0] ?? null,
    },
  };
}

async function gatherForSymbol(
  symbol: string,
  bybit: BybitClient,
  risk: RiskEngine,
  mgr: AccountManager,
  news: { bias: string; impact: string; riskMultiplier: number; triggers: string[]; items: any[] },
  btcContext: any,
) {
  // Klines parallel
  const [c4h, c1h, c15m, c3m] = await Promise.all([
    bybit.getKlines(symbol, '240', 200),
    bybit.getKlines(symbol, '60', 200),
    bybit.getKlines(symbol, '15', 200),
    bybit.getKlines(symbol, '3', 200),
  ]);
  if (c4h.length < 50 || c1h.length < 50 || c15m.length < 30 || c3m.length < 30) {
    return { symbol, error: 'insufficient klines' };
  }

  const price = (c3m as Candle[])[c3m.length - 1].close;

  const orderbook = await getOrderbookSummary(bybit, symbol, price);
  const indicators = indicatorSummary(c4h as Candle[], c1h as Candle[], c15m as Candle[], c3m as Candle[]);
  const marketStructure = marketStructureSummary(c1h as Candle[], c15m as Candle[], c3m as Candle[]);
  const v2Context = computeV2Context(symbol, c1h as Candle[]);
  const fundingOi = await fundingOiSummary(bybit, symbol);

  // === Orderflow block (Phase 3) — CVD windows + top-N orderbook imbalance ===
  // CVD leads price by 30-120s on fresh flow (per 2025 crypto LOB research).
  // Wrapped in catch: a single-pair rate-limit OR timeout degrades to null
  // rather than blowing the scan.
  let orderflow: any = null;
  try {
    const trades = await Orderflow.fetchRecentTrades(bybit, symbol, 1000);
    const rawOb = await bybit.getOrderbook(symbol, 50).catch(() => null);
    const cvd_1m = Orderflow.cvdWindow(trades, 60_000);
    const cvd_5m = Orderflow.cvdWindow(trades, 300_000);
    const obi_top5 = rawOb
      ? Orderflow.imbalanceFromOrderbook(rawOb.bids, rawOb.asks, 5)
      : null;
    orderflow = {
      cvd_1m: {
        cvd_usd: cvd_1m.cvd_usd,
        divergence: cvd_1m.divergence,
        trades: cvd_1m.trades_count,
        price_change_pct: cvd_1m.price_change_pct,
      },
      cvd_5m: {
        cvd_usd: cvd_5m.cvd_usd,
        divergence: cvd_5m.divergence,
        trades: cvd_5m.trades_count,
        price_change_pct: cvd_5m.price_change_pct,
      },
      obi_top5: obi_top5
        ? {
            obi: obi_top5.obi,
            obi_usd: obi_top5.obi_usd,
            bid_usd: obi_top5.bid_size_usd,
            ask_usd: obi_top5.ask_size_usd,
          }
        : null,
    };
  } catch {
    orderflow = null;
  }

  const session = detectSession();
  const minToFunding = minutesToNextFunding();

  // Open positions on this symbol across all accounts
  const allPositions = await bybit.getAllPositions(symbol);
  const openPositions = allPositions.flatMap((acc) =>
    acc.positions
      .filter((p: any) => Number(p.size ?? 0) > 0)
      .map((p: any) => {
        const entry = Number(p.entryPrice);
        const mark = Number(p.markPrice);
        const isLong = p.side === 'Buy';
        const sl = Number(p.stopLoss);
        const tp = Number(p.takeProfit);
        const qty = Number(p.size);
        const stopDist = Math.abs(entry - (sl || entry));
        const r = stopDist > 0 ? (isLong ? mark - entry : entry - mark) / stopDist : 0;
        const unrealizedPnlUsd = isLong ? (mark - entry) * qty : (entry - mark) * qty;
        const createdTime = p.createdTime ? Number(p.createdTime) : null;
        const ageMin = createdTime ? Math.round((Date.now() - createdTime) / 60_000) : null;
        const graceRemainingMin = ageMin !== null ? Math.max(0, 9 - ageMin) : null;
        return {
          account: acc.sub.label,
          direction: isLong ? 'Long' : 'Short',
          entry,
          mark,
          qty,
          sl,
          tp,
          unrealized_r: +r.toFixed(2),
          unrealized_pnl_usd: +unrealizedPnlUsd.toFixed(2),
          age_min: ageMin,
          grace_remaining_min: graceRemainingMin, // if > 0, DO NOT proactive exit yet
          can_proactive_exit: ageMin !== null && ageMin >= 9 && r < 1.0,
        };
      }),
  );

  // Pending limits on this symbol
  const pending = await cache.getAllPendingOrders();
  const pendingOrders = pending
    .filter((p) => p.symbol === symbol)
    .map((p) => ({
      direction: p.direction,
      limitPrice: p.limitPrice,
      sl: p.stopLoss,
      tp: p.takeProfit,
      ageMin: Math.round((Date.now() - p.placedAt) / 60_000),
      maxAgeMin: p.maxAge / 60_000,
    }));

  return {
    symbol,
    timestamp: new Date().toISOString(),
    price,
    klines: {
      '4h': summarizeKlines(c4h as Candle[], 5),
      '1h': summarizeKlines(c1h as Candle[], 10),
      '15m': summarizeKlines(c15m as Candle[], 20),
      '3m': summarizeKlines(c3m as Candle[], 30),
    },
    indicators,
    v2_strategy: v2Context,
    orderbook,
    market_structure: marketStructure,
    btc_context: symbol === 'BTCUSDT' ? null : btcContext,
    session: {
      name: session.label,
      quality: session.qualityMultiplier,
      allow_entry: session.allowEntry,
      near_funding_window: isNearFundingWindow(),
      min_to_next_funding: minToFunding,
    },
    news: {
      bias: news.bias,
      impact: news.impact,
      risk_multiplier: news.riskMultiplier,
      triggers: news.triggers,
      headlines: news.items.slice(0, 5).map((i: any) => i.title ?? i.headline),
    },
    funding_oi: fundingOi,
    orderflow,
    open_positions: openPositions,
    pending_orders: pendingOrders,
  };
}

async function getBtcContext(bybit: BybitClient): Promise<any> {
  try {
    const [c4h, c1h, c15m] = await Promise.all([
      bybit.getKlines('BTCUSDT', '240', 100),
      bybit.getKlines('BTCUSDT', '60', 100),
      bybit.getKlines('BTCUSDT', '15', 100),
    ]);
    const c4hArr = c4h as Candle[];
    const c1hArr = c1h as Candle[];
    const c15mArr = c15m as Candle[];
    const price = c1hArr[c1hArr.length - 1].close;
    const rsi1h = Indicators.rsi(c1hArr, 14);
    const rsi1hPrev = Indicators.rsi(c1hArr.slice(0, -3), 14);
    const rsiSlope = rsi1h !== undefined && rsi1hPrev !== undefined ? rsi1h - rsi1hPrev : 0;
    // 1h trend: simple — current vs 20 bars ago
    const chg20 = ((price - c1hArr[c1hArr.length - 21].close) / c1hArr[c1hArr.length - 21].close) * 100;
    const trend1h = chg20 > 0.5 ? 'up' : chg20 < -0.5 ? 'down' : 'range';
    // Regime: very rough 4h trend
    const chg50_4h = ((c4hArr[c4hArr.length - 1].close - c4hArr[c4hArr.length - 50].close) / c4hArr[c4hArr.length - 50].close) * 100;
    const regime = chg50_4h > 3 ? 'Bull' : chg50_4h < -3 ? 'Bear' : 'Range';

    // === Intraday-responsive signals (don't wait for 4H or 1H close) ===
    // 5-bar 15M % change: catches sharp intraday moves (5×15=75 min)
    const chg5_15m =
      c15mArr.length >= 6
        ? ((price - c15mArr[c15mArr.length - 6].close) / c15mArr[c15mArr.length - 6].close) * 100
        : 0;
    // 3-bar 1H slope: RSI delta across last 3 1H bars (already have rsiSlope — same thing)
    // slope1h as used in pair-scope is RSI change per bar; here we replicate for parity
    const slope1h = +(rsiSlope / 3).toFixed(2);

    // === HMM regime inference (Phase 4) ===
    // Replaces rule-based `effective_regime`. Gaussian HMM on (log_return, realized_vol)
    // produces probabilistic state + transitioning flag. If params file missing
    // (training never run) emit null — scoring code falls back to slow `regime` (4H).
    let hmmRegime: RegimeInference | null = null;
    if (hmmParams) {
      try {
        hmmRegime = RegimeHmm.infer(
          c1hArr.map((c) => c.close),
          hmmParams,
        );
      } catch {
        hmmRegime = null;
      }
    }

    return {
      price,
      regime,
      hmm_regime: hmmRegime
        ? {
            state: hmmRegime.state,
            probs: {
              bull: +hmmRegime.probs.bull.toFixed(3),
              bear: +hmmRegime.probs.bear.toFixed(3),
              range: +hmmRegime.probs.range.toFixed(3),
            },
            confidence: +hmmRegime.confidence.toFixed(2),
            transitioning: hmmRegime.transitioning,
          }
        : null,
      trend1h,
      rsi1h: rsi1h !== undefined ? +rsi1h.toFixed(1) : null,
      rsi_slope_3bars: +rsiSlope.toFixed(2),
      slope1h,
      chg_50_4h_pct: +chg50_4h.toFixed(2),
      chg_20_1h_pct: +chg20.toFixed(2),
      chg_5_15m_pct: +chg5_15m.toFixed(2),
    };
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length === 0) {
    console.error('Usage: npx tsx src/scan-data.ts <SYMBOL|all> [SYMBOL2 SYMBOL3 ...]');
    process.exit(1);
  }
  const symbols =
    args[0].toLowerCase() === 'all' ? [...config.watchlist] : args.map((s) => s.toUpperCase());

  const mgr = new AccountManager();
  const bybit = new BybitClient(mgr);
  const risk = new RiskEngine(bybit);

  // News + BTC context shared across symbols
  const fetcher = new NewsFetcher();
  const macro = await fetcher.assess(60);
  const items = await fetcher.fetchAll();
  const news = {
    bias: macro.bias,
    impact: macro.impact,
    riskMultiplier: macro.riskMultiplier,
    triggers: macro.triggers,
    items,
  };
  const btcContext = symbols.some((s) => s !== 'BTCUSDT') ? await getBtcContext(bybit) : null;

  // Per-account risk snapshot
  const subs = mgr.getAllSubAccounts();
  const riskSnapshots = await Promise.all(
    subs.map(async (s) => {
      const a = await risk.snapshot(s);
      return {
        account: s.label,
        status: a.status,
        daily_dd_pct: +a.dailyDdPct.toFixed(2),
        total_dd_pct: +a.totalDdPct.toFixed(2),
        equity: a.equity,
        initial: a.initial,
        reason: a.reason || null,
      };
    }),
  );

  // Per-symbol data — batched to avoid Bybit rate limits on public klines endpoint.
  // 8 symbols × 4 TFs = 32 parallel kline calls hit rate limit (IP-based, public API).
  // Batch size 3 → 3 batches, ~1.5s each total ~5s for 8 pairs.
  const BATCH_SIZE = 3;
  const data: any[] = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((s) => gatherForSymbol(s, bybit, risk, mgr, news, btcContext)),
    );
    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled') {
        data.push(r.value);
      } else {
        data.push({ symbol: batch[j], error: r.reason?.message ?? String(r.reason) });
      }
    }
    // Small gap between batches to let rate limit reset
    if (i + BATCH_SIZE < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // === Cross-pair structure aggregator (Variant 2: implicit BOS) ===
  // Counts pairs where current 15M close has broken prior 15M swing low/high.
  // Fires SAME cycle as price breaks — no waiting for scanner's pivot confirmation.
  // Effective regime change triggered when ≥5/8 pairs align.
  const breakdownPairs: string[] = [];
  const breakoutPairs: string[] = [];
  const bos15mBearish: string[] = [];
  const bos15mBullish: string[] = [];
  const bos1hBearish: string[] = [];
  const bos1hBullish: string[] = [];
  for (const s of data) {
    if (s.error || !s.market_structure) continue;
    const ms = s.market_structure;
    if (ms.close_vs_swing_15m === 'below_prior_low') breakdownPairs.push(s.symbol);
    if (ms.close_vs_swing_15m === 'above_prior_high') breakoutPairs.push(s.symbol);
    if (ms.bos_15m === 'bearish') bos15mBearish.push(s.symbol);
    if (ms.bos_15m === 'bullish') bos15mBullish.push(s.symbol);
    if (ms.bos_1h === 'bearish') bos1hBearish.push(s.symbol);
    if (ms.bos_1h === 'bullish') bos1hBullish.push(s.symbol);
  }
  const totalPairs = data.filter((s) => !s.error).length;
  const cross_pair_structure = {
    total_pairs: totalPairs,
    // Fastest: close below/above prior 20-bar 15M swing (same-cycle)
    breakdown_count: breakdownPairs.length,
    breakdown_pairs: breakdownPairs,
    breakout_count: breakoutPairs.length,
    breakout_pairs: breakoutPairs,
    // Medium: BOS on 15M (up to 15 min lag)
    bos_15m_bearish_count: bos15mBearish.length,
    bos_15m_bearish_pairs: bos15mBearish,
    bos_15m_bullish_count: bos15mBullish.length,
    bos_15m_bullish_pairs: bos15mBullish,
    // Slowest: BOS on 1H (up to 60 min lag)
    bos_1h_bearish_count: bos1hBearish.length,
    bos_1h_bullish_count: bos1hBullish.length,
    // Effective regime flags — triggered when ≥5/8 OR ≥60% of pairs align.
    // Any of three independent signals can fire; Claude picks which to trust per context.
    effective_bearish:
      breakdownPairs.length >= 5 || bos15mBearish.length >= 4 || bos1hBearish.length >= 5,
    effective_bullish:
      breakoutPairs.length >= 5 || bos15mBullish.length >= 4 || bos1hBullish.length >= 5,
  };

  const output = {
    generated_at: new Date().toISOString(),
    global_risk: riskSnapshots,
    cross_pair_structure,
    symbols: data,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message ?? String(err) }));
  process.exit(1);
});

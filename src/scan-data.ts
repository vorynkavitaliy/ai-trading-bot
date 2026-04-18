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
import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';
import { RiskEngine } from './risk/engine';
import { cache } from './cache';
import { config } from './config';
import { Indicators, Candle } from './analysis/indicators';
import { Structure } from './analysis/structure';
import { detectSession, isNearFundingWindow } from './analysis/sessions';
import { NewsFetcher } from './news/fetcher';

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
  const ema21_1h = Indicators.ema(c1h, 21);
  const ema55_1h = Indicators.ema(c1h, 55);
  const ema21_4h = Indicators.ema(c4h, 21);
  const macd1h = Indicators.macd(c1h);
  const adx1h = Indicators.adx(c1h, 14);
  const obvSeries1h = Indicators.obv(c1h);

  // Quick MACD histogram direction — recompute short history from emaSeries if available
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
    ema: {
      '4h_21': ema21_4h,
      '1h_21': ema21_1h,
      '1h_55': ema55_1h,
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

function marketStructureSummary(c1h: Candle[], c15m: Candle[]) {
  const bos_1h = Structure.bos(c1h);
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
  return {
    bos_1h,
    sweep,
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
  const marketStructure = marketStructureSummary(c1h as Candle[], c15m as Candle[]);

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
    open_positions: openPositions,
    pending_orders: pendingOrders,
    _note: 'Claude: use MCP Bybit tools for funding rate / open interest / liquidations if needed',
  };
}

async function getBtcContext(bybit: BybitClient): Promise<any> {
  try {
    const [c4h, c1h] = await Promise.all([
      bybit.getKlines('BTCUSDT', '240', 100),
      bybit.getKlines('BTCUSDT', '60', 100),
    ]);
    const c4hArr = c4h as Candle[];
    const c1hArr = c1h as Candle[];
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
    return {
      price,
      regime,
      trend1h,
      rsi1h: rsi1h !== undefined ? +rsi1h.toFixed(1) : null,
      rsi_slope_3bars: +rsiSlope.toFixed(2),
      chg_50_4h_pct: +chg50_4h.toFixed(2),
      chg_20_1h_pct: +chg20.toFixed(2),
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

  const output = {
    generated_at: new Date().toISOString(),
    global_risk: riskSnapshots,
    symbols: data,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message ?? String(err) }));
  process.exit(1);
});

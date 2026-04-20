/**
 * Order-flow primitives — CVD (cumulative volume delta) and orderbook imbalance.
 *
 * Why: per 2025 crypto-LOB research (arXiv 2506.05764, ScienceDirect Bitcoin
 * Wild Moves / VPIN), taker-aggressor flow leads mid-price by 30-120 seconds.
 * MACD/RSI/BOS all lag by 3-14 bars. CVD + top-of-book imbalance catch
 * accumulation/distribution BEFORE structure breaks.
 *
 * Phase 3 of the lag-reduction refactor. REST polling only (no websocket).
 */
import { BybitClient } from '../core/bybit-client';

export interface TradeTick {
  timestamp: number; // ms
  price: number;
  size: number;
  side: 'Buy' | 'Sell'; // aggressor side (taker)
}

export interface CVDWindow {
  window_ms: number;
  trades_count: number;
  buy_volume: number;
  sell_volume: number;
  cvd: number; // buy_volume − sell_volume (in base asset units)
  cvd_usd: number; // CVD × avg price
  last_price: number;
  first_price: number;
  price_change_pct: number;
  divergence: 'bullish' | 'bearish' | 'none';
}

export interface OrderbookImbalance {
  levels: number;
  bid_size_top5: number;
  ask_size_top5: number;
  obi: number; // (bid − ask) / (bid + ask), range [-1, +1]
  bid_size_usd: number;
  ask_size_usd: number;
  obi_usd: number;
}

export class Orderflow {
  /**
   * Fetch recent public trades from Bybit REST.
   * Returns up to `limit` most-recent ticks in chronological order (oldest → newest).
   */
  static async fetchRecentTrades(
    bybit: BybitClient,
    symbol: string,
    limit = 1000,
  ): Promise<TradeTick[]> {
    const list = await bybit.getRecentTrades(symbol, limit);
    const ticks: TradeTick[] = list.map((t: any) => ({
      timestamp: Number(t.time),
      price: Number(t.price),
      size: Number(t.size),
      // Bybit V5 marks the aggressor side on public trades (taker).
      side: t.side === 'Buy' ? 'Buy' : 'Sell',
    }));
    // Bybit returns newest first; reverse to chronological for window math.
    return ticks.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Aggregate trades into a CVD window ending `now`, starting `windowMs` ago.
   * `trades` is expected in chronological order (see fetchRecentTrades).
   */
  static cvdWindow(trades: TradeTick[], windowMs: number, now?: number): CVDWindow {
    const endTs = now ?? Date.now();
    const startTs = endTs - windowMs;
    const slice = trades.filter((t) => t.timestamp >= startTs && t.timestamp <= endTs);

    let buyVol = 0;
    let sellVol = 0;
    let notional = 0;
    for (const t of slice) {
      if (t.side === 'Buy') buyVol += t.size;
      else sellVol += t.size;
      notional += t.size * t.price;
    }
    const cvd = buyVol - sellVol;
    const totalVol = buyVol + sellVol;
    const avgPrice = totalVol > 0 ? notional / totalVol : 0;
    const cvd_usd = cvd * avgPrice;

    const firstPrice = slice.length ? slice[0].price : 0;
    const lastPrice = slice.length ? slice[slice.length - 1].price : 0;
    const priceChangePct =
      firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

    return {
      window_ms: windowMs,
      trades_count: slice.length,
      buy_volume: +buyVol.toFixed(6),
      sell_volume: +sellVol.toFixed(6),
      cvd: +cvd.toFixed(6),
      cvd_usd: Math.round(cvd_usd),
      last_price: lastPrice,
      first_price: firstPrice,
      price_change_pct: +priceChangePct.toFixed(4),
      divergence: Orderflow.classifyDivergence(cvd, priceChangePct),
    };
  }

  /**
   * Classify CVD vs price divergence.
   * Tolerance 0.1% filters noise. A neutral flat tape returns 'none'.
   *
   * bullish: CVD > 0 (accumulation) despite price DOWN > 0.1% (hidden bid absorption)
   * bearish: CVD < 0 (distribution) despite price UP > 0.1% (hidden ask absorption)
   */
  static classifyDivergence(
    cvd: number,
    priceChangePct: number,
  ): 'bullish' | 'bearish' | 'none' {
    if (cvd > 0 && priceChangePct < -0.1) return 'bullish';
    if (cvd < 0 && priceChangePct > 0.1) return 'bearish';
    return 'none';
  }

  /**
   * Compute top-N-level orderbook imbalance from an already-fetched snapshot.
   * `bids`/`asks` must be sorted best-first (highest bid, lowest ask).
   * OBI in [-1, +1]: positive = bid-heavy (upward pressure).
   * USD variant weights each level by qty × price.
   * Empty orderbook returns obi=0 (neutral).
   */
  static imbalanceFromOrderbook(
    bids: Array<{ price: number; qty: number }>,
    asks: Array<{ price: number; qty: number }>,
    levels: number,
  ): OrderbookImbalance {
    const topBids = bids.slice(0, levels);
    const topAsks = asks.slice(0, levels);

    const bidSize = topBids.reduce((s, l) => s + l.qty, 0);
    const askSize = topAsks.reduce((s, l) => s + l.qty, 0);
    const bidUsd = topBids.reduce((s, l) => s + l.qty * l.price, 0);
    const askUsd = topAsks.reduce((s, l) => s + l.qty * l.price, 0);

    const total = bidSize + askSize;
    const totalUsd = bidUsd + askUsd;
    const obi = total > 0 ? (bidSize - askSize) / total : 0;
    const obi_usd = totalUsd > 0 ? (bidUsd - askUsd) / totalUsd : 0;

    return {
      levels,
      bid_size_top5: +bidSize.toFixed(6),
      ask_size_top5: +askSize.toFixed(6),
      obi: +obi.toFixed(4),
      bid_size_usd: Math.round(bidUsd),
      ask_size_usd: Math.round(askUsd),
      obi_usd: +obi_usd.toFixed(4),
    };
  }
}

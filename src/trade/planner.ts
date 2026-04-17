import { Candle, Indicators } from '../analysis/indicators';
import { Structure } from '../analysis/structure';
import { quantize, decimalsOf } from '../risk/sizing';
import { config } from '../config';
import { Direction } from '../signal/generator';

export interface InstrumentSpec {
  symbol: string;
  tickSize: number;
  qtyStep: number;
  minQty: number;
  maxLeverage: number;
}

export interface PlanInput {
  symbol: string;
  direction: Direction;
  entryRef: number;
  c1h: Candle[];
  c15m: Candle[];
  /** 3M candles — used for micro-ATR + tighter SL when available */
  c3m?: Candle[];
  instrument: InstrumentSpec;
  /** Force a specific R:R; defaults to config.trade.minRR (use prefer 3) */
  targetRR?: number;
}

export interface TradePlan {
  symbol: string;
  direction: Direction;
  entry: number;
  /** Limit entry at OB level — better price than market. Null = use market order. */
  limitEntry: number | null;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  atr: number;
  stopDistance: number;
  rationale: string;
}

/**
 * Planner: derive entry / SL / TP using ATR + nearest structural level.
 *
 * SL: max(ATR*mult, distance to last 1H swing, micro-3M wick + buffer) —
 *     three-way protection so SL never sits inside obvious noise.
 * TP: targetRR * stopDistance, capped at the next major S/R level if it's closer.
 */
export function planTrade(i: PlanInput): TradePlan {
  const atr1h = Indicators.atr(i.c1h, 14);
  const atr15 = Indicators.atr(i.c15m, 14);
  const atr = atr1h ?? atr15;
  if (atr === undefined) throw new Error(`ATR unavailable for ${i.symbol}`);

  const { tickSize } = i.instrument;
  const targetRR = i.targetRR ?? config.trade.minRR;

  // Max SL/TP distance as % of price — intraday, prices don't move 6-10%
  // BTC: 2%, alts: 3%
  const isBtc = i.symbol === 'BTCUSDT';
  const maxDistPct = isBtc ? 0.02 : 0.03;
  const maxDist = i.entryRef * maxDistPct;

  const swings = Structure.swings(i.c1h, 3, 4);
  const lastSwingLow = swings.filter((s) => s.type === 'low').pop()?.price;
  const lastSwingHigh = swings.filter((s) => s.type === 'high').pop()?.price;

  // Micro-swing on 3M (last ~30 bars = ~90 minutes) — for fine SL placement
  const micro3m = i.c3m && i.c3m.length >= 30 ? i.c3m.slice(-30) : undefined;
  const microLow = micro3m ? Math.min(...micro3m.map((k) => k.low)) : undefined;
  const microHigh = micro3m ? Math.max(...micro3m.map((k) => k.high)) : undefined;
  const microBuffer = (Indicators.atr(i.c3m ?? [], 14) ?? atr * 0.2) * 0.5;

  let entry = i.entryRef;
  let stopLoss: number;
  let takeProfit: number;
  let rationale = '';

  const atrSlDist = atr * config.trade.atrSlMult;

  if (i.direction === 'Long') {
    const swingDist = lastSwingLow !== undefined ? entry - lastSwingLow : 0;
    const microDist = microLow !== undefined ? entry - microLow + microBuffer : 0;
    // Clamp SL distance to maxDist
    const stopDist = Math.min(
      Math.max(atrSlDist, swingDist > 0 ? swingDist + tickSize : 0, microDist > 0 ? microDist : 0),
      maxDist,
    );
    stopLoss = entry - stopDist;
    // Clamp TP distance to maxDist
    const tpDist = Math.min(stopDist * targetRR, maxDist);
    takeProfit = entry + tpDist;

    const { resistance } = Structure.recentLevels(i.c1h, 80);
    if (resistance > entry && resistance < takeProfit) {
      takeProfit = resistance - tickSize * 2;
    }
    rationale = `ATR ${atrSlDist.toFixed(2)}, swing ${swingDist.toFixed(2)}, 3M ${microDist.toFixed(2)}; cap ${(maxDistPct*100)}%`;
  } else {
    const swingDist = lastSwingHigh !== undefined ? lastSwingHigh - entry : 0;
    const microDist = microHigh !== undefined ? microHigh - entry + microBuffer : 0;
    const stopDist = Math.min(
      Math.max(atrSlDist, swingDist > 0 ? swingDist + tickSize : 0, microDist > 0 ? microDist : 0),
      maxDist,
    );
    stopLoss = entry + stopDist;
    const tpDist = Math.min(stopDist * targetRR, maxDist);
    takeProfit = entry - tpDist;

    const { support } = Structure.recentLevels(i.c1h, 80);
    if (support < entry && support > takeProfit) {
      takeProfit = support + tickSize * 2;
    }
    rationale = `ATR ${atrSlDist.toFixed(2)}, swing ${swingDist.toFixed(2)}, 3M ${microDist.toFixed(2)}; cap ${(maxDistPct*100)}%`;
  }

  // Quantize to tick size
  entry = quantize(entry, tickSize);
  stopLoss = quantize(stopLoss, tickSize);
  takeProfit = quantize(takeProfit, tickSize);

  const stopDistance = Math.abs(entry - stopLoss);
  const rrActual = Math.abs(takeProfit - entry) / stopDistance;

  // Calculate limit entry at OB level (better price than market)
  // If OB exists and price hasn't reached it yet → place limit at OB edge
  let limitEntry: number | null = null;
  const ob = Structure.lastOrderBlock(i.c1h, i.direction === 'Long' ? 'bullish' : 'bearish');
  if (ob) {
    if (i.direction === 'Long') {
      // Limit buy at OB high (top of demand zone) — price must come down to us
      const obEntry = quantize(ob.high, tickSize);
      // Only use limit if OB is below current price (we'd get a better fill)
      if (obEntry < entry && (entry - obEntry) / entry > 0.001) {
        limitEntry = obEntry;
      }
    } else {
      // Limit sell at OB low (bottom of supply zone) — price must come up to us
      const obEntry = quantize(ob.low, tickSize);
      if (obEntry > entry && (obEntry - entry) / entry > 0.001) {
        limitEntry = obEntry;
      }
    }
  }

  return {
    symbol: i.symbol,
    direction: i.direction,
    entry, limitEntry, stopLoss, takeProfit,
    rr: Number(rrActual.toFixed(2)),
    atr,
    stopDistance,
    rationale: rationale + (limitEntry ? ` | limit@OB ${limitEntry}` : ' | market'),
  };
}

export function fmtPrice(v: number, tickSize: number): string {
  return v.toFixed(decimalsOf(tickSize));
}

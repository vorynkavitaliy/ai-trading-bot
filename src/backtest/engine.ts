import { query } from '../lib/db';
import { computeFeatures, CandleRow } from '../data/features';
import { loadCoinglassAt, CoinglassFeatures } from '../data/coinglass-features';
import {
  Action,
  BacktestResult,
  BacktestSettings,
  Bar,
  ClosedTrade,
  OpenPosition,
  Strategy,
  StrategyContext,
} from './types';
import { computeMetrics } from './metrics';
import { log } from '../lib/logger';

const FUNDING_INTERVAL_MS = 8 * 60 * 60_000;

interface DataBundle {
  barsDecision: Bar[];                // bars at decisionTf — main iteration
  bars1h: Bar[];                       // always loaded for ctx.features1h
  bars1m: Bar[];                       // for SL/TP fill resolution
  bars4h?: Bar[];
  bars1d?: Bar[];
  bars1w?: Bar[];
  fundingByTs: Map<number, number>;
}

async function loadBars(symbol: string, tf: string, fromTs: number, toTs: number): Promise<Bar[]> {
  const r = await query<any>(
    `SELECT ts::text, open, high, low, close, volume
     FROM candles WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4
     ORDER BY ts ASC`,
    [symbol, tf, fromTs, toTs]
  );
  return r.rows.map((row: any): Bar => ({
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
  }));
}

async function loadData(symbol: string, startTs: number, endTs: number, decisionTf: string): Promise<DataBundle> {
  // Warmup needed for indicator stability:
  //   1H: 300 bars × 1h ≈ 12.5 days
  //   4H: 300 bars × 4h ≈ 50 days
  //   1D: 200 bars ≈ 200 days
  //   1W: 50 bars ≈ ~1 year
  const warmupHourlyMs = 300 * 60 * 60_000;
  const warmupDailyMs = 250 * 24 * 60 * 60_000;
  const warmupWeeklyMs = 60 * 7 * 24 * 60 * 60_000;

  // Always load 1D + 1W — they are tiny tables (≈365 + 52 rows) and are needed
  // for HTF context (PWL/PWH, daily VP, weekly bias) by structural strategies.
  const wantsMtf = decisionTf === '240m';

  const [bars1h, bars1m, rf, bars4h, bars1d, bars1w] = await Promise.all([
    loadBars(symbol, '60m', startTs - warmupHourlyMs, endTs),
    loadBars(symbol, '1m', startTs - warmupHourlyMs, endTs),
    query<any>(
      `SELECT ts::text, rate::text FROM funding_history
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
      [symbol, startTs - warmupHourlyMs, endTs]
    ),
    wantsMtf ? loadBars(symbol, '240m', startTs - warmupDailyMs, endTs) : Promise.resolve([] as Bar[]),
    loadBars(symbol, '1D', startTs - warmupDailyMs, endTs),
    loadBars(symbol, '1W', startTs - warmupWeeklyMs, endTs),
  ]);

  const fundingByTs = new Map<number, number>();
  for (const row of rf.rows) fundingByTs.set(parseInt(row.ts, 10), parseFloat(row.rate));

  const barsDecision = decisionTf === '240m' ? bars4h : bars1h;
  return {
    barsDecision,
    bars1h,
    bars1m,
    bars4h: wantsMtf ? bars4h : undefined,
    bars1d,
    bars1w,
    fundingByTs,
  };
}

function applySlippage(price: number, side: 'long' | 'short', kind: 'entry' | 'exit', slipPct: number): number {
  // long entry pays more, exit (sell) gets less
  // short entry sells lower, exit (buy) pays more
  const factor = slipPct / 100;
  if (side === 'long') return kind === 'entry' ? price * (1 + factor) : price * (1 - factor);
  return kind === 'entry' ? price * (1 - factor) : price * (1 + factor);
}

function calcQty(equity: number, riskPct: number, entry: number, sl: number, leverage: number): number {
  const riskUsd = equity * (riskPct / 100);
  const stopDist = Math.abs(entry - sl);
  if (stopDist <= 0) return 0;
  let qty = riskUsd / stopDist;
  // Cap by leverage: notional must not exceed equity × leverage
  const maxNotional = equity * leverage;
  const maxQtyByLev = maxNotional / entry;
  if (qty > maxQtyByLev) qty = maxQtyByLev;
  return qty;
}

// Fill resolution per minute: scan 1m bars between entry and SL/TP touch
function resolvePosition(
  pos: OpenPosition,
  bars1m: Bar[],
  startIdx: number,
  endIdx: number,
  funding: Map<number, number>,
  fees: { taker: number; maker: number },
  slipPct: number,
  symbol: string,
  rationale: string,
  riskedUsd: number,
  equityRef: { value: number }
): ClosedTrade | null {
  let fundingPaid = pos.fundingPaidUsd;
  for (let i = startIdx; i <= endIdx && i < bars1m.length; i++) {
    const b = bars1m[i];
    // Apply funding if a funding boundary crossed during this minute
    const fr = funding.get(b.ts);
    if (fr !== undefined) {
      // Bybit pays/receives based on position direction:
      //   long pays positive funding (when rate > 0)
      //   short pays negative funding (when rate < 0)
      const sideSign = pos.side === 'long' ? 1 : -1;
      const positionUsd = pos.qty * b.close;
      fundingPaid += positionUsd * fr * sideSign;
    }

    // Touch order in 1 minute is ambiguous — assume worst-case:
    //   long: low first, then high (SL before TP unless gap up)
    //   short: high first, then low
    // Common backtester convention: SL takes priority over TP within same bar.
    if (pos.side === 'long') {
      if (b.low <= pos.sl) {
        // SL hit. Include banked TP1 partial if it fired earlier.
        const fillPrice = applySlippage(pos.sl, 'long', 'exit', slipPct);
        const exitFee = pos.qty * fillPrice * fees.taker;
        const tailPnl = (fillPrice - pos.entry) * pos.qty;
        const banked = (pos as any).bankedPnl ?? 0;
        const grossPnl = banked + tailPnl;
        const reason: ClosedTrade['exitReason'] = pos.tp1Hit ? 'tp1_then_sl_be' : 'sl';
        const totalFees = pos.openFeesUsd + exitFee;
        const pnlR = (grossPnl - totalFees - fundingPaid) / riskedUsd;
        return {
          side: 'long', symbol, entry: pos.entry, exit: fillPrice,
          entryTs: pos.entryTs, exitTs: b.ts, qty: pos.tp1Hit ? pos.qty * 2 : pos.qty,
          sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          pnlR, exitReason: reason, rationale,
        };
      }
      if (!pos.tp1Hit && b.high >= pos.tp1) {
        // TP1 — close 50%, move SL to breakeven on remaining 50%
        const fillPrice = applySlippage(pos.tp1, 'long', 'exit', slipPct);
        const halfQty = pos.qty / 2;
        const halfPnl = (fillPrice - pos.entry) * halfQty;
        const halfFee = halfQty * fillPrice * fees.maker; // TP1 is a limit order
        pos.openFeesUsd += halfFee;
        // Reduce position
        pos.qty -= halfQty;
        pos.tp1Hit = true;
        pos.sl = pos.entry; // breakeven
        // Track partial pnl as if banked into the trade's outcome at end
        // Simpler: treat TP1 + remainder as one "trade" with weighted pnl.
        // Track "banked" via reducing future exit pnl by this halfPnl baseline.
        // We accumulate via pos.fundingPaidUsd reuse hack? No — store separately.
        (pos as any).bankedPnl = ((pos as any).bankedPnl ?? 0) + halfPnl - halfFee;
        if (pos.tp2 && b.high >= pos.tp2) {
          // TP2 also hit in same bar → close fully
          const tp2Fill = applySlippage(pos.tp2, 'long', 'exit', slipPct);
          const tp2Pnl = (tp2Fill - pos.entry) * pos.qty;
          const tp2Fee = pos.qty * tp2Fill * fees.maker;
          const totalFees = pos.openFeesUsd + tp2Fee;
          const grossPnl = ((pos as any).bankedPnl ?? 0) + tp2Pnl;
          const pnlR = (grossPnl - tp2Fee - fundingPaid) / riskedUsd;
          return {
            side: 'long', symbol, entry: pos.entry, exit: tp2Fill,
            entryTs: pos.entryTs, exitTs: b.ts, qty: pos.qty * 2,
            sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
            pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
            pnlR, exitReason: 'tp2', rationale,
          };
        }
        continue;
      }
      if (pos.tp1Hit && pos.tp2 && b.high >= pos.tp2) {
        const fillPrice = applySlippage(pos.tp2, 'long', 'exit', slipPct);
        const tailPnl = (fillPrice - pos.entry) * pos.qty;
        const tailFee = pos.qty * fillPrice * fees.maker;
        const totalFees = pos.openFeesUsd + tailFee;
        const grossPnl = ((pos as any).bankedPnl ?? 0) + tailPnl;
        const pnlR = (grossPnl - tailFee - fundingPaid) / riskedUsd;
        return {
          side: 'long', symbol, entry: pos.entry, exit: fillPrice,
          entryTs: pos.entryTs, exitTs: b.ts, qty: pos.qty * 2,
          sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          pnlR, exitReason: 'tp2', rationale,
        };
      }
    } else {
      // SHORT side mirror
      if (b.high >= pos.sl) {
        const fillPrice = applySlippage(pos.sl, 'short', 'exit', slipPct);
        const exitFee = pos.qty * fillPrice * fees.taker;
        const tailPnl = (pos.entry - fillPrice) * pos.qty;
        const banked = (pos as any).bankedPnl ?? 0;
        const grossPnl = banked + tailPnl;
        const reason: ClosedTrade['exitReason'] = pos.tp1Hit ? 'tp1_then_sl_be' : 'sl';
        const totalFees = pos.openFeesUsd + exitFee;
        const pnlR = (grossPnl - totalFees - fundingPaid) / riskedUsd;
        return {
          side: 'short', symbol, entry: pos.entry, exit: fillPrice,
          entryTs: pos.entryTs, exitTs: b.ts, qty: pos.tp1Hit ? pos.qty * 2 : pos.qty,
          sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          pnlR, exitReason: reason, rationale,
        };
      }
      if (!pos.tp1Hit && b.low <= pos.tp1) {
        const fillPrice = applySlippage(pos.tp1, 'short', 'exit', slipPct);
        const halfQty = pos.qty / 2;
        const halfPnl = (pos.entry - fillPrice) * halfQty;
        const halfFee = halfQty * fillPrice * fees.maker;
        pos.openFeesUsd += halfFee;
        pos.qty -= halfQty;
        pos.tp1Hit = true;
        pos.sl = pos.entry;
        (pos as any).bankedPnl = ((pos as any).bankedPnl ?? 0) + halfPnl - halfFee;
        if (pos.tp2 && b.low <= pos.tp2) {
          const tp2Fill = applySlippage(pos.tp2, 'short', 'exit', slipPct);
          const tp2Pnl = (pos.entry - tp2Fill) * pos.qty;
          const tp2Fee = pos.qty * tp2Fill * fees.maker;
          const totalFees = pos.openFeesUsd + tp2Fee;
          const grossPnl = ((pos as any).bankedPnl ?? 0) + tp2Pnl;
          const pnlR = (grossPnl - tp2Fee - fundingPaid) / riskedUsd;
          return {
            side: 'short', symbol, entry: pos.entry, exit: tp2Fill,
            entryTs: pos.entryTs, exitTs: b.ts, qty: pos.qty * 2,
            sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
            pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
            pnlR, exitReason: 'tp2', rationale,
          };
        }
        continue;
      }
      if (pos.tp1Hit && pos.tp2 && b.low <= pos.tp2) {
        const fillPrice = applySlippage(pos.tp2, 'short', 'exit', slipPct);
        const tailPnl = (pos.entry - fillPrice) * pos.qty;
        const tailFee = pos.qty * fillPrice * fees.maker;
        const totalFees = pos.openFeesUsd + tailFee;
        const grossPnl = ((pos as any).bankedPnl ?? 0) + tailPnl;
        const pnlR = (grossPnl - tailFee - fundingPaid) / riskedUsd;
        return {
          side: 'short', symbol, entry: pos.entry, exit: fillPrice,
          entryTs: pos.entryTs, exitTs: b.ts, qty: pos.qty * 2,
          sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          pnlR, exitReason: 'tp2', rationale,
        };
      }
    }
  }
  // No SL/TP touch in the scanned window — position remains open.
  // Persist updated funding accumulator so the next call continues correctly.
  pos.fundingPaidUsd = fundingPaid;
  return null;
}

export async function runBacktest(
  strategy: Strategy,
  settings: BacktestSettings
): Promise<BacktestResult> {
  log.info('backtest start', {
    strategy: strategy.name,
    symbol: settings.symbol,
    from: new Date(settings.startTs).toISOString(),
    to: new Date(settings.endTs).toISOString(),
    startEquity: settings.startEquity,
  });
  const decisionTf = settings.decisionTf ?? '60m';
  const data = await loadData(settings.symbol, settings.startTs, settings.endTs, decisionTf);
  const trades: ClosedTrade[] = [];
  const equityCurve: { ts: number; equity: number }[] = [];
  const equityRef = { value: settings.startEquity };
  equityCurve.push({ ts: settings.startTs, equity: equityRef.value });

  const fees = { taker: settings.takerFeeRate, maker: settings.makerFeeRate };
  let position: OpenPosition | null = null;

  // Index 1m bars by ts for fast lookup of position resolution start
  const tsTo1mIdx = new Map<number, number>();
  data.bars1m.forEach((b, i) => tsTo1mIdx.set(b.ts, i));

  // Iteration drives over bars at decisionTf (1H by default; 4H for MTF strategies).
  const allDecision = data.barsDecision;
  const idxStartActive = allDecision.findIndex((b) => b.ts >= settings.startTs);
  if (idxStartActive < 0) {
    log.warn('no decision bars in active window', { symbol: settings.symbol, decisionTf });
    return {
      symbol: settings.symbol, trades, startEquity: settings.startEquity,
      endEquity: equityRef.value,
      metrics: computeMetrics(trades, settings.startEquity, equityCurve),
      equityCurve,
    };
  }

  // Iteration semantics: at iteration `i`, we are at the OPEN time of bar[i]
  // (= close time of bar[i-1]). All bars 0..i-1 are closed and known.
  // Decisions use bar[i-1]. Entry executes at bar[i]'s first 1m bar.
  // Position resolution scans 1m bars in [entry+1m, now-1m].
  for (let i = idxStartActive; i < allDecision.length; i++) {
    const nowBar = allDecision[i];
    const nowTs = nowBar.ts;
    if (nowTs > settings.endTs) break;

    // 1) Resolve open position up to (but not including) nowTs.
    if (position) {
      const pos = position;
      const entry1mIdx = tsTo1mIdx.get(pos.entryTs) ?? data.bars1m.findIndex((b) => b.ts >= pos.entryTs);
      // last 1m bar that ENDED strictly before nowTs:
      const nowIdxLookup = tsTo1mIdx.get(nowTs);
      const endIdx = (nowIdxLookup !== undefined ? nowIdxLookup : data.bars1m.findIndex((b) => b.ts >= nowTs)) - 1;
      // Advance start past previously-scanned bars to prevent funding double-count.
      const startIdx = (pos.lastScanned1mIdx ?? entry1mIdx) + 1;
      if (endIdx >= startIdx) {
        const closed = resolvePosition(
          pos, data.bars1m,
          startIdx, endIdx,
          data.fundingByTs, fees, settings.slippagePct,
          settings.symbol, pos.rationale,
          pos.riskedUsd,
          equityRef
        );
        if (closed) {
          trades.push(closed);
          equityRef.value += closed.pnlUsd - closed.feesUsd - closed.fundingUsd;
          equityCurve.push({ ts: closed.exitTs, equity: equityRef.value });
          position = null;
        } else {
          pos.lastScanned1mIdx = endIdx;
        }
      }
    }

    if (position) continue;
    if (i < 1) continue;

    // 2) Build features from bars 0..i-1 (all CLOSED).
    const decisionBar = allDecision[i - 1];
    const sliceStart = Math.max(0, i - 300);
    const sliceDecision = allDecision.slice(sliceStart, i).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    if (sliceDecision.length < 200) continue;
    const featDecision = computeFeatures(settings.symbol, decisionTf, sliceDecision);

    // Multi-TF features. featDecision is whatever TF we iterate on.
    // featuresD/W are now always computed (cheap) — strategies use them or ignore.
    let feat1h = featDecision;
    let feat4h: any = undefined;
    let featD: any = undefined;
    let featW: any = undefined;
    const cutoff1h = nowTs;                                    // bars closed strictly before nowTs
    if (decisionTf === '240m') {
      feat4h = featDecision;
      const closed1h = data.bars1h.filter((b) => b.ts < cutoff1h);
      const slice1h = closed1h.slice(-300).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (slice1h.length >= 100) feat1h = computeFeatures(settings.symbol, '60m', slice1h);
    }
    if (data.bars1d) {
      const closedD = data.bars1d.filter((b) => b.ts < cutoff1h);
      const sliceD = closedD.slice(-250).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (sliceD.length >= 50) featD = computeFeatures(settings.symbol, '1D', sliceD);
    }
    if (data.bars1w) {
      const closedW = data.bars1w.filter((b) => b.ts < cutoff1h);
      const sliceW = closedW.slice(-60).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (sliceW.length >= 20) featW = computeFeatures(settings.symbol, '1W', sliceW);
    }

    const fundingTs = [...data.fundingByTs.keys()].filter((t) => t <= decisionBar.ts);
    const lastFundingTs = fundingTs.length > 0 ? Math.max(...fundingTs) : null;
    const fundingRate = lastFundingTs ? data.fundingByTs.get(lastFundingTs) : undefined;

    let coinglass: CoinglassFeatures | undefined;
    if (strategy.needsCoinglass) {
      const coin = settings.symbol.replace(/USDT$/, '');
      coinglass = await loadCoinglassAt(coin, settings.symbol, decisionBar.ts);
    }

    // Recent bars at decisionTf — used by strategies for structural SL placement.
    const recentBars = allDecision.slice(Math.max(0, i - 30), i);
    // HTF recent slices: last N closed bars at each TF, strictly before nowTs.
    const bars1hRecent = data.bars1h.filter((b) => b.ts < cutoff1h).slice(-200);
    const bars1dRecent = data.bars1d ? data.bars1d.filter((b) => b.ts < cutoff1h).slice(-60) : [];
    const bars1wRecent = data.bars1w ? data.bars1w.filter((b) => b.ts < cutoff1h).slice(-12) : [];

    const ctx: StrategyContext = {
      symbol: settings.symbol,
      ts: nowTs,
      price: decisionBar.close,
      features1h: feat1h,
      features4h: feat4h,
      featuresD: featD,
      featuresW: featW,
      fundingRate,
      position: null,
      coinglass,
      recentBars,
      bars1hRecent,
      bars1dRecent,
      bars1wRecent,
    };
    const action = strategy.decide(ctx);
    if (action.kind !== 'enter') continue;

    // 3) Open position at nowBar's first 1m bar (= bar[i].ts).
    const next1mIdx = tsTo1mIdx.get(nowTs) ?? data.bars1m.findIndex((b) => b.ts >= nowTs);
    if (next1mIdx < 0) continue;
    const next1m = data.bars1m[next1mIdx];

    const fillPrice = action.orderType === 'market'
      ? applySlippage(next1m.open, action.side, 'entry', settings.slippagePct)
      : action.entryPrice;

    const qty = calcQty(equityRef.value, action.sizePct, fillPrice, action.sl, settings.leverage);
    if (qty <= 0) continue;
    const entryFee = qty * fillPrice * (action.orderType === 'market' ? fees.taker : fees.maker);

    position = {
      side: action.side,
      qty,
      initialQty: qty,
      entry: fillPrice,
      entryTs: next1m.ts,
      sl: action.sl,
      initialSl: action.sl,
      tp1: action.tp1,
      tp2: action.tp2,
      tp1Hit: false,
      rationale: action.rationale,
      openFeesUsd: entryFee,
      fundingPaidUsd: 0,
      riskedUsd: Math.abs(fillPrice - action.sl) * qty,
      lastScanned1mIdx: next1mIdx,
    };
  }

  // Close any leftover position at last bar (true time stop — end of test window)
  if (position) {
    const last1m = data.bars1m[data.bars1m.length - 1];
    const fillPrice = applySlippage(last1m.close, position.side, 'exit', settings.slippagePct);
    const exitFee = position.qty * fillPrice * fees.taker;
    const tailPnl = position.side === 'long'
      ? (fillPrice - position.entry) * position.qty
      : (position.entry - fillPrice) * position.qty;
    const totalFees = position.openFeesUsd + exitFee;
    const grossPnl = ((position as any).bankedPnl ?? 0) + tailPnl;
    const pnlR = (grossPnl - exitFee - position.fundingPaidUsd) / position.riskedUsd;
    trades.push({
      side: position.side, symbol: settings.symbol,
      entry: position.entry, exit: fillPrice,
      entryTs: position.entryTs, exitTs: last1m.ts,
      qty: position.qty * (position.tp1Hit ? 2 : 1),
      sl: position.sl, tp1: position.tp1, tp2: position.tp2,
      pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: position.fundingPaidUsd,
      pnlR, exitReason: 'time_stop', rationale: position.rationale,
    });
    equityRef.value += grossPnl - totalFees - position.fundingPaidUsd;
    equityCurve.push({ ts: last1m.ts, equity: equityRef.value });
  }

  const metrics = computeMetrics(trades, settings.startEquity, equityCurve);
  log.info('backtest complete', {
    symbol: settings.symbol, trades: metrics.trades, totalR: metrics.totalR,
    PF: metrics.profitFactor, MaxDD: metrics.maxDDPct,
  });

  return {
    symbol: settings.symbol,
    trades,
    startEquity: settings.startEquity,
    endEquity: equityRef.value,
    metrics,
    equityCurve,
  };
}

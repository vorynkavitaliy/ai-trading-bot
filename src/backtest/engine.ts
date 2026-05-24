import { query } from '../core/db';
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
import { log } from '../core/logger';

const FUNDING_INTERVAL_MS = 8 * 60 * 60_000;

interface DataBundle {
  barsDecision: Bar[];                // bars at decisionTf — main iteration
  bars1h: Bar[];                       // always loaded for ctx.features1h
  bars1m: Bar[];                       // for SL/TP fill resolution
  bars4h?: Bar[];
  bars1d?: Bar[];
  bars1w?: Bar[];
  btcBars4h?: Bar[];                   // BTC 4H bars when strategy needs cross-pair macro filter
  fundingByTs: Map<number, number>;
}

import { loadBars as loadBarsCanonical } from '../data/candles';

async function loadBars(symbol: string, tf: string, fromTs: number, toTs: number): Promise<Bar[]> {
  return loadBarsCanonical(symbol, tf, { fromTs, toTs });
}

async function loadData(symbol: string, startTs: number, endTs: number, decisionTf: string, needsBtcContext = false): Promise<DataBundle> {
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

  // BTC 4H bars — only when strategy needs cross-pair macro context AND symbol != BTCUSDT.
  // For BTCUSDT backtest the pair bars ARE the BTC bars, so loading separately is redundant.
  let btcBars4h: Bar[] | undefined;
  if (needsBtcContext && symbol !== 'BTCUSDT') {
    btcBars4h = await loadBars('BTCUSDT', '240m', startTs - warmupDailyMs, endTs);
  } else if (needsBtcContext && symbol === 'BTCUSDT') {
    btcBars4h = bars4h;
  }

  return {
    barsDecision,
    bars1h,
    bars1m,
    bars4h: wantsMtf ? bars4h : undefined,
    bars1d,
    bars1w,
    btcBars4h,
    fundingByTs,
  };
}

// Aggregate hourly bars within [periodStart, cutoff) into a single synthetic
// higher-TF bar. Returns null if no hourly bars fall in the window. Used to
// reconstruct the CURRENT incomplete day/week bar's week-to-date H/L at any
// cutoff during the period — avoids look-ahead bias from DB-stored full-period
// snapshots, and matches what live would observe with realtime data.
function aggregateHourlyTo(hourly: Bar[], periodStart: number, cutoff: number): Bar | null {
  let open: number | null = null;
  let high = -Infinity;
  let low = Infinity;
  let close = 0;
  let vol = 0;
  let any = false;
  for (const b of hourly) {
    if (b.ts < periodStart) continue;
    if (b.ts >= cutoff) break;     // hourly bars are sorted ascending
    if (!any) { open = b.open; any = true; }
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    close = b.close;
    vol += b.volume;
  }
  if (!any) return null;
  return { ts: periodStart, open: open!, high, low, close, volume: vol };
}

// UTC period boundaries for the current incomplete day / week containing ts.
function dayStartUtc(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function weekStartUtc(ts: number): number {
  const d = new Date(ts);
  // Bybit weekly bars open on Monday 00:00 UTC. Convert getUTCDay() (Sun=0) so Monday=0.
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysFromMonday);
}

function applySlippage(price: number, side: 'long' | 'short', kind: 'entry' | 'exit', slipPct: number): number {
  // long entry pays more, exit (sell) gets less
  // short entry sells lower, exit (buy) pays more
  const factor = slipPct / 100;
  if (side === 'long') return kind === 'entry' ? price * (1 + factor) : price * (1 - factor);
  return kind === 'entry' ? price * (1 - factor) : price * (1 + factor);
}

function calcQty(equity: number, riskPct: number, entry: number, sl: number, leverage: number, maxNotionalPctOfEquity?: number): number {
  const riskUsd = equity * (riskPct / 100);
  const stopDist = Math.abs(entry - sl);
  if (stopDist <= 0) return 0;
  let qty = riskUsd / stopDist;
  // Cap 1: hard leverage cap (HyroTrader compliance, prevents catastrophe)
  const maxNotionalLev = equity * leverage;
  const maxQtyByLev = maxNotionalLev / entry;
  if (qty > maxQtyByLev) qty = maxQtyByLev;
  // Cap 2 (optional): position-size guard — limit notional to N% of equity.
  // Triggers when stopDist is so tight that risk-based qty inflates the position.
  // Result: actual realized risk on this trade < target riskPct, but absolute loss
  // on slippage stays bounded.
  if (maxNotionalPctOfEquity != null && maxNotionalPctOfEquity > 0) {
    const maxNotionalPos = equity * (maxNotionalPctOfEquity / 100);
    const maxQtyByPos = maxNotionalPos / entry;
    if (qty > maxQtyByPos) qty = maxQtyByPos;
  }
  return qty;
}

// Compute new SL after TP1 fill, given the configured mode.
function newSlAfterTp1(
  side: 'long' | 'short',
  entry: number,
  initialSl: number,
  mode: 'be' | 'be_plus' | 'no_move' | 'halfway',
  bePlusBufferPct: number
): number {
  if (mode === 'no_move') return initialSl;
  if (mode === 'halfway') return (entry + initialSl) / 2;
  if (mode === 'be_plus') {
    return side === 'long'
      ? entry * (1 + bePlusBufferPct / 100)
      : entry * (1 - bePlusBufferPct / 100);
  }
  return entry;  // 'be' default
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
  equityRef: { value: number },
  tp1SlMode: 'be' | 'be_plus' | 'no_move' | 'halfway' = 'be',
  bePlusBufferPct: number = 0.10
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

    // Intrabar resolution: when SL and TP are both touched within the same 1m bar,
    // use the bar's direction (close vs open) as a heuristic for which fired first.
    //   bullish minute (close > open): price went UP first  → for long check TP first, for short check SL first
    //   bearish minute (close < open): price went DOWN first → for long check SL first, for short check TP first
    //   doji  (close == open): keep worst-case (SL first) — symmetric, no information.
    // This replaces the previous "always SL first" worst-case bias which systematically
    // turned wins-that-touched-SL-and-TP-in-same-minute into losses.
    const minuteBullish = b.close > b.open;
    const minuteBearish = b.close < b.open;
    const tpFirst = pos.side === 'long' ? minuteBullish : minuteBearish;

    // Differential slip: TP1/TP2 are limit orders sitting in the book — when price
    // touches them, the maker fee applies and there is no adverse slippage (the
    // limit is the fill price by construction). SL fills are market-trigger market
    // orders — they take the worst within the slippage window. This matches live
    // behaviour and removes a systematic underestimation of TP fills.
    const tpSlipPct = 0;
    // --- Helper closures that perform the actual fill & return ClosedTrade ---
    const fireSl = (): ClosedTrade => {
      const fillPrice = applySlippage(pos.sl, pos.side, 'exit', slipPct);
      const exitFee = pos.qty * fillPrice * fees.taker;
      const tailPnl = pos.side === 'long'
        ? (fillPrice - pos.entry) * pos.qty
        : (pos.entry - fillPrice) * pos.qty;
      const banked = (pos as any).bankedPnl ?? 0;
      const grossPnl = banked + tailPnl;
      const reason: ClosedTrade['exitReason'] = pos.tp1Hit ? 'tp1_then_sl_be' : 'sl';
      const totalFees = pos.openFeesUsd + exitFee;
      const pnlR = (grossPnl - totalFees - fundingPaid) / riskedUsd;
      return {
        side: pos.side, symbol, entry: pos.entry, exit: fillPrice,
        entryTs: pos.entryTs, exitTs: b.ts, qty: pos.tp1Hit ? pos.qty * 2 : pos.qty,
        sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
        pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
        pnlR, exitReason: reason, rationale,
      };
    };
    const fireTp2Tail = (): ClosedTrade => {
      const fillPrice = applySlippage(pos.tp2!, pos.side, 'exit', tpSlipPct);
      const tailPnl = pos.side === 'long'
        ? (fillPrice - pos.entry) * pos.qty
        : (pos.entry - fillPrice) * pos.qty;
      const tailFee = pos.qty * fillPrice * fees.maker;
      const totalFees = pos.openFeesUsd + tailFee;
      const grossPnl = ((pos as any).bankedPnl ?? 0) + tailPnl;
      const pnlR = (grossPnl - tailFee - fundingPaid) / riskedUsd;
      return {
        side: pos.side, symbol, entry: pos.entry, exit: fillPrice,
        entryTs: pos.entryTs, exitTs: b.ts, qty: pos.qty * 2,
        sl: pos.sl, tp1: pos.tp1, tp2: pos.tp2,
        pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
        pnlR, exitReason: 'tp2', rationale,
      };
    };
    // Fill TP1 partial (mutates pos). Returns true if a same-bar TP2 also filled.
    const fireTp1Partial = (): boolean => {
      const fillPrice = applySlippage(pos.tp1, pos.side, 'exit', tpSlipPct);
      const halfQty = pos.qty / 2;
      const halfPnl = pos.side === 'long'
        ? (fillPrice - pos.entry) * halfQty
        : (pos.entry - fillPrice) * halfQty;
      const halfFee = halfQty * fillPrice * fees.maker;
      pos.openFeesUsd += halfFee;
      pos.qty -= halfQty;
      pos.tp1Hit = true;
      pos.sl = newSlAfterTp1(pos.side, pos.entry, pos.initialSl, tp1SlMode, bePlusBufferPct);
      (pos as any).bankedPnl = ((pos as any).bankedPnl ?? 0) + halfPnl - halfFee;
      // Same-bar TP2?
      if (pos.tp2 !== undefined) {
        if (pos.side === 'long' && b.high >= pos.tp2) return true;
        if (pos.side === 'short' && b.low <= pos.tp2) return true;
      }
      return false;
    };

    // Touch detection (raw)
    const slTouched = pos.side === 'long' ? b.low <= pos.sl : b.high >= pos.sl;
    const tp1Touchable = !pos.tp1Hit
      && (pos.side === 'long' ? b.high >= pos.tp1 : b.low <= pos.tp1);
    const tp2TailTouchable = pos.tp1Hit && pos.tp2 !== undefined
      && (pos.side === 'long' ? b.high >= pos.tp2 : b.low <= pos.tp2);

    if (tpFirst) {
      // BULL minute (for long) / BEAR minute (for short): TP fires before SL in same bar.
      if (tp1Touchable) {
        const tp2InSameBar = fireTp1Partial();
        if (tp2InSameBar) return fireTp2Tail();
        // After TP1 partial, SL has moved (no_move/be/be_plus). Check whether
        // the (possibly new) SL still gets hit in this bar — only if the bar
        // ALSO crossed it. For 'no_move' SL is unchanged, so the same low/high
        // applies. For 'be' / 'be_plus' the new SL is near entry — also could be hit.
        const slHitNow = pos.side === 'long' ? b.low <= pos.sl : b.high >= pos.sl;
        if (slHitNow) return fireSl();
        continue;
      }
      if (tp2TailTouchable) return fireTp2Tail();
      if (slTouched) return fireSl();
    } else {
      // BEAR minute (for long) / BULL minute (for short) / doji: SL fires before TP in same bar.
      if (slTouched) return fireSl();
      if (tp1Touchable) {
        const tp2InSameBar = fireTp1Partial();
        if (tp2InSameBar) return fireTp2Tail();
        continue;
      }
      if (tp2TailTouchable) return fireTp2Tail();
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
  const data = await loadData(settings.symbol, settings.startTs, settings.endTs, decisionTf, strategy.needsBtcContext);
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
          equityRef,
          settings.tp1SlMode ?? 'be',
          settings.bePlusBufferPct ?? 0.10
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

    // 2026-05-20: previously `if (position) continue` skipped strategy entirely while
    // position open. Now we still call strategy with position context — strategy may
    // return 'exit' if a reverse-direction setup is detected (thesis flipped).
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
    const cutoff1h = nowTs;
    // D/W bars in DB store full-bar H/L (Bybit snapshot of closed candle, or for
    // recently-inserted bars: frozen at open due to ON CONFLICT DO NOTHING). Both
    // cases are wrong for backtest:
    //   - Historical bars (full H/L): including the current incomplete bar leaks
    //     future H/L to strategy → structural stops artificially wide → inflated WR
    //   - Recent bars (frozen at open): useless data
    // Fix: keep DB bars only for fully-CLOSED periods; reconstruct the current
    // incomplete period's bar from hourly data, capped at cutoff. This gives
    // strategy a faithful week-to-date / day-to-date snapshot.
    const ONE_DAY_MS = 86_400_000;
    const ONE_WEEK_MS = 7 * ONE_DAY_MS;
    if (decisionTf === '240m') {
      feat4h = featDecision;
      const closed1h = data.bars1h.filter((b) => b.ts < cutoff1h);
      const slice1h = closed1h.slice(-300).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (slice1h.length >= 100) feat1h = computeFeatures(settings.symbol, '60m', slice1h);
    }
    if (data.bars1d) {
      const closedD = data.bars1d.filter((b) => b.ts + ONE_DAY_MS <= cutoff1h);
      const curDayStart = dayStartUtc(cutoff1h);
      const synthD = aggregateHourlyTo(data.bars1h, curDayStart, cutoff1h);
      const allD = synthD ? [...closedD, synthD] : closedD;
      const sliceD = allD.slice(-250).map<CandleRow>((b) => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      if (sliceD.length >= 50) featD = computeFeatures(settings.symbol, '1D', sliceD);
    }
    if (data.bars1w) {
      const closedW = data.bars1w.filter((b) => b.ts + ONE_WEEK_MS <= cutoff1h);
      const curWeekStart = weekStartUtc(cutoff1h);
      const synthW = aggregateHourlyTo(data.bars1h, curWeekStart, cutoff1h);
      const allW = synthW ? [...closedW, synthW] : closedW;
      const sliceW = allW.slice(-60).map<CandleRow>((b) => ({
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
    // 200 bars: enough for EMA50 trend on 4H, EMA200 on 1H. Strategies that need
    // only the last N take slice(-N) themselves.
    const recentBars = allDecision.slice(Math.max(0, i - 200), i);
    // HTF recent slices: closed bars + synthetic current-period bar from hourly aggregation.
    // 400 bars = ~16 days of hourly. Strategies that compute "previous closed week
    // H/L" from hourly need >= 14 days of history.
    const bars1hRecent = data.bars1h.filter((b) => b.ts < cutoff1h).slice(-400);
    const closedDRecent = data.bars1d ? data.bars1d.filter((b) => b.ts + ONE_DAY_MS <= cutoff1h) : [];
    const synthDRecent = data.bars1d ? aggregateHourlyTo(data.bars1h, dayStartUtc(cutoff1h), cutoff1h) : null;
    const bars1dRecent = (synthDRecent ? [...closedDRecent, synthDRecent] : closedDRecent).slice(-60);
    const closedWRecent = data.bars1w ? data.bars1w.filter((b) => b.ts + ONE_WEEK_MS <= cutoff1h) : [];
    const synthWRecent = data.bars1w ? aggregateHourlyTo(data.bars1h, weekStartUtc(cutoff1h), cutoff1h) : null;
    const bars1wRecent = (synthWRecent ? [...closedWRecent, synthWRecent] : closedWRecent).slice(-12);
    // BTC 4H bars for cross-pair macro filter (CG-fade altcoin strategies).
    // Only populated when strategy.needsBtcContext = true (engine loaded BTC bars in loadData).
    const btcBars4hRecent = data.btcBars4h
      ? data.btcBars4h.filter((b) => b.ts < cutoff1h).slice(-200)
      : undefined;

    const ctx: StrategyContext = {
      symbol: settings.symbol,
      ts: nowTs,
      price: decisionBar.close,
      features1h: feat1h,
      features4h: feat4h,
      featuresD: featD,
      featuresW: featW,
      fundingRate,
      position,  // 2026-05-20: strategy now sees its own open position for reverse-signal exits
      coinglass,
      recentBars,
      bars1hRecent,
      bars1dRecent,
      bars1wRecent,
      btcBars4hRecent,
    };
    const action = strategy.decide(ctx);

    // Reverse-signal exit: strategy asks to close current position
    if (action.kind === 'exit' && position) {
      const next1mIdx = tsTo1mIdx.get(nowTs) ?? data.bars1m.findIndex((b) => b.ts >= nowTs);
      if (next1mIdx >= 0) {
        const exitBar = data.bars1m[next1mIdx];
        const fillPrice = applySlippage(exitBar.open, position.side, 'exit', settings.slippagePct);
        const exitFee = position.qty * fillPrice * fees.taker;
        const grossPnl = position.side === 'long'
          ? (fillPrice - position.entry) * position.qty
          : (position.entry - fillPrice) * position.qty;
        const totalFees = position.openFeesUsd + exitFee;
        const netPnl = grossPnl - totalFees - position.fundingPaidUsd;
        const pnlR = position.riskedUsd > 0 ? netPnl / position.riskedUsd : 0;
        trades.push({
          side: position.side, symbol: settings.symbol,
          entry: position.entry, exit: fillPrice,
          entryTs: position.entryTs, exitTs: exitBar.ts,
          qty: position.initialQty,
          sl: position.initialSl, tp1: position.tp1, tp2: position.tp2,
          pnlUsd: netPnl, feesUsd: totalFees, fundingUsd: position.fundingPaidUsd,
          pnlR, exitReason: 'strategy_exit', rationale: action.reason,
        });
        equityRef.value += netPnl;
        equityCurve.push({ ts: exitBar.ts, equity: equityRef.value });
        position = null;
      }
      continue;
    }

    // Skip if hold OR if position still open (don't pyramid)
    if (action.kind !== 'enter' || position) continue;

    // 3) Open position at nowBar's first 1m bar (= bar[i].ts).
    const next1mIdx = tsTo1mIdx.get(nowTs) ?? data.bars1m.findIndex((b) => b.ts >= nowTs);
    if (next1mIdx < 0) continue;
    const next1m = data.bars1m[next1mIdx];

    const fillPrice = action.orderType === 'market'
      ? applySlippage(next1m.open, action.side, 'entry', settings.slippagePct)
      : action.entryPrice;

    const qty = calcQty(equityRef.value, action.sizePct, fillPrice, action.sl, settings.leverage, settings.maxNotionalPctOfEquity);
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

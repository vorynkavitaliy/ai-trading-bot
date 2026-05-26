/**
 * Grid/DCA/Martingale backtest engine — separate from engine.ts because the
 * mechanics differ fundamentally: instead of "one entry → one SL/TP" we have
 * "first entry → many DCA fills as price drops → TP from average".
 *
 * 1m-bar resolution for intra-bar fills (a limit order that touched the price
 * inside a 5m bar would have filled, so we walk the underlying 1m bars).
 *
 * Default mechanics (Veles-style):
 *   - Place first order at entryPrice × (1 - indentPct/100) — or market entry.
 *   - Place remaining N-1 limit orders down to entryPrice × (1 - rangePct/100).
 *     Logarithmic distribution: denser closer to first order.
 *   - Each order USD size = previous × (1 + martingalePct/100).
 *   - After each fill, recompute avg entry and TP price = avg × (1 + tpPct/100).
 *   - When a 1m bar's high ≥ TP price → exit ENTIRE position at TP, cycle done.
 *   - Optional safety SL: if cumulative unrealized loss crosses safetyDdPct of
 *     allocated capital → close all (compliance fallback). Default: none (Veles native).
 *   - After cycle close (TP or SL), bot waits for next entry signal.
 *
 * Trade signal: optional callback `shouldEnter(ts, price)`. If null, continuous
 * grid — bot re-enters market immediately after each cycle closes.
 */
import { Bar } from './types';

export interface GridConfig {
  rangePct: number;
  nOrders: number;
  martingalePct: number;
  indentPct: number;             // first order offset below market
  firstOrderEntry: 'market' | 'limit';  // if market, first order = market price at signal
  distribution: 'linear' | 'logarithmic';
  tpPct: number;                 // TP from avg entry
  leverage: number;
  allocatedCapitalUsd: number;   // capital reserved for this grid
  marginUsagePct: number;        // 0.5 = use 50% of allocated capital as margin (rest = safety buffer)
  takerFeeRate: number;          // 0.00055 for Bybit
  makerFeeRate: number;          // 0.0002
  fundingPerCycle?: number;       // optional avg funding bps per cycle (else use real funding rates)
  /** Optional safety SL — close grid if unrealized loss > this % of allocatedCapital */
  safetyDdPctOfCapital?: number;
  /** Optional grid trailing — if price moves up by trailPct after first fill (no TP yet), shift grid up */
  trailPct?: number;
}

export interface GridCycle {
  cycleId: number;
  startTs: number;
  endTs: number;
  firstFillPrice: number;
  fills: { ts: number; price: number; orderUsd: number; qty: number; level: number }[];
  avgEntry: number;
  totalQty: number;
  totalNotionalUsd: number;
  maxDepthLevel: number;
  maxUnrealizedLossUsd: number;
  maxUnrealizedLossPct: number;   // of allocatedCapital
  exitPrice: number;
  exitReason: 'tp' | 'safety_sl' | 'end_of_data';
  pnlUsd: number;                  // realized after fees
  feesUsd: number;
  durationHours: number;
}

export interface GridBacktestResult {
  config: GridConfig;
  cycles: GridCycle[];
  finalCapitalUsd: number;
  maxDrawdownUsd: number;
  maxDrawdownPctOfCapital: number;
  metrics: {
    cycles: number;
    tpCycles: number;
    safetyStops: number;
    winRate: number;
    avgCycleHours: number;
    totalReturnUsd: number;
    totalReturnPct: number;
    avgUnrealizedPctOfCapital: number;
    worstUnrealizedPctOfCapital: number;
    maxDepthLevelReached: number;
    fullDeployCycles: number;
  };
  equityCurve: { ts: number; equity: number }[];
}

function buildGridPriceLevels(refPrice: number, c: GridConfig): number[] {
  const first = refPrice * (1 - c.indentPct / 100);
  const last = refPrice * (1 - c.rangePct / 100);
  const levels: number[] = [];
  if (c.distribution === 'linear') {
    for (let i = 0; i < c.nOrders; i++) levels.push(first + (last - first) * (i / (c.nOrders - 1)));
  } else {
    for (let i = 0; i < c.nOrders; i++) {
      const t = Math.log(1 + i) / Math.log(c.nOrders);
      levels.push(first + (last - first) * t);
    }
  }
  return levels;
}

function buildOrderSizes(c: GridConfig): number[] {
  // Total cumulative notional = marginUsagePct × allocatedCapital × leverage
  const totalNotional = c.allocatedCapitalUsd * c.marginUsagePct * c.leverage;
  const r = 1 + c.martingalePct / 100;
  const sumMult = (Math.pow(r, c.nOrders) - 1) / (r - 1);
  const firstUsd = totalNotional / sumMult;
  const sizes: number[] = [];
  for (let i = 0; i < c.nOrders; i++) sizes.push(firstUsd * Math.pow(r, i));
  return sizes;
}

export interface RunGridOpts {
  shouldEnter?: (ts: number, price: number) => boolean;
}

export async function runGridBacktest(
  bars1m: Bar[],
  c: GridConfig,
  opts: RunGridOpts = {},
): Promise<GridBacktestResult> {
  if (bars1m.length === 0) throw new Error('no 1m bars');

  const cycles: GridCycle[] = [];
  const equityCurve: { ts: number; equity: number }[] = [];
  let capital = c.allocatedCapitalUsd;
  let cycleId = 0;
  let peakCapital = capital;
  let maxDDUsd = 0;

  // Walk 1m bars. State machine: WAITING_SIGNAL → ENTERING → ACTIVE (cycle) → repeat
  type State =
    | { kind: 'waiting' }
    | { kind: 'active'; cycle: GridCycle; orderSizes: number[]; orderPrices: number[]; nextLevel: number };
  let state: State = { kind: 'waiting' };

  const shouldEnter = opts.shouldEnter ?? (() => true);

  for (let i = 0; i < bars1m.length; i++) {
    const b = bars1m[i];

    if (state.kind === 'waiting') {
      if (shouldEnter(b.ts, b.open)) {
        cycleId++;
        const refPrice = b.open;
        const orderPrices = buildGridPriceLevels(refPrice, c);
        const orderSizes = buildOrderSizes(c);
        // First fill: market at b.open (paid taker fee + slippage assumed 0 for clean math at backtest level)
        const firstFillPrice = c.firstOrderEntry === 'market' ? refPrice : orderPrices[0];
        const firstQty = orderSizes[0] / firstFillPrice;
        const fee = orderSizes[0] * (c.firstOrderEntry === 'market' ? c.takerFeeRate : c.makerFeeRate);
        const cycle: GridCycle = {
          cycleId,
          startTs: b.ts,
          endTs: 0,
          firstFillPrice,
          fills: [{ ts: b.ts, price: firstFillPrice, orderUsd: orderSizes[0], qty: firstQty, level: 1 }],
          avgEntry: firstFillPrice,
          totalQty: firstQty,
          totalNotionalUsd: orderSizes[0],
          maxDepthLevel: 1,
          maxUnrealizedLossUsd: 0,
          maxUnrealizedLossPct: 0,
          exitPrice: 0,
          exitReason: 'end_of_data',
          pnlUsd: 0,
          feesUsd: fee,
          durationHours: 0,
        };
        state = { kind: 'active', cycle, orderSizes, orderPrices, nextLevel: 1 };
      }
      continue;
    }

    if (state.kind === 'active') {
      const cycle = state.cycle;

      // Check TP first (price went UP). If bar.high crosses TP, exit at TP price.
      const tpPrice = cycle.avgEntry * (1 + c.tpPct / 100);
      if (b.high >= tpPrice) {
        const exitFee = cycle.totalNotionalUsd * c.makerFeeRate;  // TP is a limit (maker)
        // P&L = (tpPrice - avgEntry) * totalQty
        const grossPnl = (tpPrice - cycle.avgEntry) * cycle.totalQty;
        const netPnl = grossPnl - cycle.feesUsd - exitFee;
        cycle.exitPrice = tpPrice;
        cycle.exitReason = 'tp';
        cycle.pnlUsd = netPnl;
        cycle.feesUsd += exitFee;
        cycle.endTs = b.ts;
        cycle.durationHours = (b.ts - cycle.startTs) / 3600_000;
        capital += netPnl;
        cycles.push(cycle);
        if (capital > peakCapital) peakCapital = capital;
        const dd = peakCapital - capital;
        if (dd > maxDDUsd) maxDDUsd = dd;
        equityCurve.push({ ts: b.ts, equity: capital });
        state = { kind: 'waiting' };
        continue;
      }

      // Check next DCA fill (price went DOWN to or below next level).
      // Process multiple fills in same bar if necessary.
      while (state.kind === 'active' && state.nextLevel < c.nOrders) {
        const nextPrice = state.orderPrices[state.nextLevel];
        if (b.low <= nextPrice) {
          const fillPrice = Math.min(nextPrice, b.open);  // touched or gapped through
          const orderUsd = state.orderSizes[state.nextLevel];
          const fee = orderUsd * c.makerFeeRate;
          const qty = orderUsd / fillPrice;
          cycle.fills.push({ ts: b.ts, price: fillPrice, orderUsd, qty, level: state.nextLevel + 1 });
          cycle.totalQty += qty;
          cycle.totalNotionalUsd += orderUsd;
          cycle.avgEntry = cycle.totalNotionalUsd / cycle.totalQty;
          cycle.maxDepthLevel = state.nextLevel + 1;
          cycle.feesUsd += fee;
          state.nextLevel++;
        } else {
          break;
        }
      }

      // Track max unrealized loss reached (using bar.low as worst point in cycle)
      const worstUnreal = (b.low - cycle.avgEntry) * cycle.totalQty;
      if (worstUnreal < cycle.maxUnrealizedLossUsd) {
        cycle.maxUnrealizedLossUsd = worstUnreal;
        cycle.maxUnrealizedLossPct = worstUnreal / c.allocatedCapitalUsd * 100;
      }

      // Safety SL check
      if (c.safetyDdPctOfCapital != null) {
        const lossLimitUsd = -(c.allocatedCapitalUsd * c.safetyDdPctOfCapital / 100);
        if (worstUnreal <= lossLimitUsd) {
          // Stopped out at price where loss limit hit
          const exitPrice = cycle.avgEntry + lossLimitUsd / cycle.totalQty;
          const exitFee = cycle.totalNotionalUsd * c.takerFeeRate;
          const grossPnl = (exitPrice - cycle.avgEntry) * cycle.totalQty;
          const netPnl = grossPnl - cycle.feesUsd - exitFee;
          cycle.exitPrice = exitPrice;
          cycle.exitReason = 'safety_sl';
          cycle.pnlUsd = netPnl;
          cycle.feesUsd += exitFee;
          cycle.endTs = b.ts;
          cycle.durationHours = (b.ts - cycle.startTs) / 3600_000;
          capital += netPnl;
          cycles.push(cycle);
          if (capital > peakCapital) peakCapital = capital;
          const dd = peakCapital - capital;
          if (dd > maxDDUsd) maxDDUsd = dd;
          equityCurve.push({ ts: b.ts, equity: capital });
          state = { kind: 'waiting' };
          continue;
        }
      }
    }
  }

  // If still active at end-of-data, close at last bar's close
  if (state.kind === 'active') {
    const lastBar = bars1m[bars1m.length - 1];
    const cycle = state.cycle;
    const exitPrice = lastBar.close;
    const exitFee = cycle.totalNotionalUsd * c.takerFeeRate;
    const grossPnl = (exitPrice - cycle.avgEntry) * cycle.totalQty;
    const netPnl = grossPnl - cycle.feesUsd - exitFee;
    cycle.exitPrice = exitPrice;
    cycle.exitReason = 'end_of_data';
    cycle.pnlUsd = netPnl;
    cycle.feesUsd += exitFee;
    cycle.endTs = lastBar.ts;
    cycle.durationHours = (lastBar.ts - cycle.startTs) / 3600_000;
    capital += netPnl;
    cycles.push(cycle);
    equityCurve.push({ ts: lastBar.ts, equity: capital });
  }

  // Metrics
  const tpCycles = cycles.filter(c => c.exitReason === 'tp').length;
  const safetyStops = cycles.filter(c => c.exitReason === 'safety_sl').length;
  // "Full deploy" = grid completely filled (max depth reached the configured number of orders).
  const fullDeploy = cycles.filter(cy => cy.maxDepthLevel === c.nOrders).length;
  const totalReturnUsd = capital - c.allocatedCapitalUsd;
  const totalReturnPct = totalReturnUsd / c.allocatedCapitalUsd * 100;
  const avgUnreal = cycles.length ? cycles.reduce((s, x) => s + x.maxUnrealizedLossPct, 0) / cycles.length : 0;
  const worstUnreal = cycles.length ? Math.min(...cycles.map(x => x.maxUnrealizedLossPct)) : 0;
  const maxDepthReached = cycles.length ? Math.max(...cycles.map(x => x.maxDepthLevel)) : 0;
  const avgCycleHours = cycles.length ? cycles.reduce((s, x) => s + x.durationHours, 0) / cycles.length : 0;

  return {
    config: c,
    cycles,
    finalCapitalUsd: capital,
    maxDrawdownUsd: maxDDUsd,
    maxDrawdownPctOfCapital: maxDDUsd / c.allocatedCapitalUsd * 100,
    metrics: {
      cycles: cycles.length,
      tpCycles,
      safetyStops,
      winRate: cycles.length ? tpCycles / cycles.length * 100 : 0,
      avgCycleHours,
      totalReturnUsd,
      totalReturnPct,
      avgUnrealizedPctOfCapital: avgUnreal,
      worstUnrealizedPctOfCapital: worstUnreal,
      maxDepthLevelReached: maxDepthReached,
      fullDeployCycles: fullDeploy,
    },
    equityCurve,
  };
}

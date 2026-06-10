import { BacktestResult, Trade } from './types';

export interface Metrics {
  trades: number;
  wins: number;
  winRate: number;
  sumR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  avgHoldMinutes: number;
  fillRate: number;
  exitBreakdown: Record<string, number>;
  longTrades: number;
  shortTrades: number;
}

export function computeMetrics(result: BacktestResult): Metrics {
  const trades = [...result.trades].sort((a, b) => a.exitTs - b.exitTs);
  const n = trades.length;

  let wins = 0;
  let sumR = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let holdSum = 0;
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  const exitBreakdown: Record<string, number> = {};
  let longs = 0;

  for (const trade of trades) {
    sumR += trade.netR;
    holdSum += trade.holdMinutes;
    if (trade.netR > 0) {
      wins++;
      grossProfit += trade.netR;
    } else {
      grossLoss -= trade.netR;
    }

    equity += trade.netR;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);

    exitBreakdown[trade.exitReason] = (exitBreakdown[trade.exitReason] ?? 0) + 1;
    if (trade.side === 'long') longs++;
  }

  return {
    trades: n,
    wins,
    winRate: n > 0 ? wins / n : 0,
    sumR,
    expectancyR: n > 0 ? sumR / n : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdownR: maxDD,
    avgHoldMinutes: n > 0 ? holdSum / n : 0,
    fillRate: result.placedOrders > 0 ? result.filledOrders / result.placedOrders : 0,
    exitBreakdown,
    longTrades: longs,
    shortTrades: n - longs,
  };
}

export function formatMetrics(id: string, m: Metrics): string {
  const pf = Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf';
  return [
    `${id}:`,
    `  trades=${m.trades} (L${m.longTrades}/S${m.shortTrades}) WR=${(m.winRate * 100).toFixed(1)}%`,
    `  sumR=${m.sumR.toFixed(2)} expR=${m.expectancyR.toFixed(3)} PF=${pf} maxDD=${m.maxDrawdownR.toFixed(2)}R`,
    `  fillRate=${(m.fillRate * 100).toFixed(0)}% avgHold=${(m.avgHoldMinutes / 60).toFixed(1)}h exits=${JSON.stringify(m.exitBreakdown)}`,
  ].join('\n');
}

export function splitTradesByTs(trades: readonly Trade[], splitTs: number): { is: Trade[]; oos: Trade[] } {
  return {
    is: trades.filter(t => t.placedTs < splitTs),
    oos: trades.filter(t => t.placedTs >= splitTs),
  };
}

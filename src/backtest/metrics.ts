import { BacktestMetrics, ClosedTrade } from './types';

export function computeMetrics(
  trades: ClosedTrade[],
  startEquity: number,
  equityCurve: { ts: number; equity: number }[]
): BacktestMetrics {
  if (trades.length === 0) {
    return {
      trades: 0, wins: 0, losses: 0, winRate: 0,
      totalR: 0, avgR: 0, expectancyR: 0,
      profitFactor: 0, maxDDPct: 0, maxDDUsd: 0,
      netPnlUsd: 0, netPnlPct: 0, sharpe: 0,
      bestTradeR: 0, worstTradeR: 0, avgWinR: 0, avgLossR: 0,
    };
  }
  const wins = trades.filter((t) => t.pnlR > 0);
  const losses = trades.filter((t) => t.pnlR <= 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  const avgR = sumR / trades.length;
  const sumWins = wins.reduce((s, t) => s + t.pnlR, 0);
  const sumLosses = losses.reduce((s, t) => s + t.pnlR, 0);
  const profitFactor = sumLosses === 0 ? Infinity : Math.abs(sumWins / sumLosses);
  const avgWinR = wins.length ? sumWins / wins.length : 0;
  const avgLossR = losses.length ? sumLosses / losses.length : 0;
  const expectancyR = winRate * avgWinR + (1 - winRate) * avgLossR;
  const netPnlUsd = trades.reduce((s, t) => s + t.pnlUsd - t.feesUsd - t.fundingUsd, 0);
  const netPnlPct = (netPnlUsd / startEquity) * 100;

  // Max drawdown from equity curve
  let peak = startEquity;
  let maxDDUsd = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak - point.equity;
    if (dd > maxDDUsd) maxDDUsd = dd;
  }
  const maxDDPct = (maxDDUsd / startEquity) * 100;

  // Sharpe: daily returns (trade-day grouping, simplified)
  const dailyReturns = bucketDaily(trades);
  const mean = avg(dailyReturns);
  const sd = stddev(dailyReturns);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : 0;

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalR: sumR,
    avgR,
    expectancyR,
    profitFactor,
    maxDDPct,
    maxDDUsd,
    netPnlUsd,
    netPnlPct,
    sharpe,
    bestTradeR: Math.max(...trades.map((t) => t.pnlR)),
    worstTradeR: Math.min(...trades.map((t) => t.pnlR)),
    avgWinR,
    avgLossR,
  };
}

function bucketDaily(trades: ClosedTrade[]): number[] {
  const map = new Map<string, number>();
  for (const t of trades) {
    const day = new Date(t.exitTs).toISOString().slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + t.pnlR);
  }
  return [...map.values()];
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function formatMetrics(symbol: string, m: BacktestMetrics): string {
  const fmt = (n: number, d = 2) => n.toFixed(d);
  return [
    `=== ${symbol} ===`,
    `trades: ${m.trades} (W:${m.wins} L:${m.losses})  WR: ${fmt(m.winRate * 100, 1)}%`,
    `totalR: ${fmt(m.totalR, 2)}  avgR: ${fmt(m.avgR, 3)}  expectancy: ${fmt(m.expectancyR, 3)}R/trade`,
    `PF: ${m.profitFactor === Infinity ? '∞' : fmt(m.profitFactor, 2)}  Sharpe: ${fmt(m.sharpe, 2)}`,
    `MaxDD: ${fmt(m.maxDDPct, 2)}% ($${fmt(m.maxDDUsd, 0)})`,
    `Net P&L: $${fmt(m.netPnlUsd, 0)} (${fmt(m.netPnlPct, 2)}%)`,
    `best: ${fmt(m.bestTradeR, 2)}R  worst: ${fmt(m.worstTradeR, 2)}R`,
    `avgWin: ${fmt(m.avgWinR, 2)}R  avgLoss: ${fmt(m.avgLossR, 2)}R`,
  ].join('\n');
}

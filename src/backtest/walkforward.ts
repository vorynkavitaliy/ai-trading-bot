import { runBacktest } from './engine';
import { computeMetrics, formatMetrics } from './metrics';
import {
  BacktestResult,
  BacktestSettings,
  ClosedTrade,
  Strategy,
} from './types';
import { log } from '../lib/logger';

export interface WalkforwardConfig {
  symbol: string;
  startTs: number;          // overall window start
  endTs: number;            // overall window end
  windowDays: number;       // size of each test slice (e.g. 30)
  startEquity: number;
  takerFeeRate: number;
  makerFeeRate: number;
  slippagePct: number;
  riskPctBase: number;
  leverage: number;
}

export interface WalkforwardWindow {
  fromTs: number;
  toTs: number;
  result: BacktestResult;
}

export interface WalkforwardReport {
  strategy: string;
  symbol: string;
  windows: WalkforwardWindow[];
  aggregate: BacktestResult;
}

export async function runWalkforward(
  strategy: Strategy,
  cfg: WalkforwardConfig
): Promise<WalkforwardReport> {
  const windowMs = cfg.windowDays * 24 * 60 * 60_000;
  const windows: WalkforwardWindow[] = [];
  let cursor = cfg.startTs;
  while (cursor < cfg.endTs) {
    const winEnd = Math.min(cursor + windowMs, cfg.endTs);
    const settings: BacktestSettings = {
      symbol: cfg.symbol,
      startTs: cursor,
      endTs: winEnd,
      startEquity: cfg.startEquity,
      takerFeeRate: cfg.takerFeeRate,
      makerFeeRate: cfg.makerFeeRate,
      slippagePct: cfg.slippagePct,
      riskPctBase: cfg.riskPctBase,
      leverage: cfg.leverage,
    };
    const r = await runBacktest(strategy, settings);
    windows.push({ fromTs: cursor, toTs: winEnd, result: r });
    cursor = winEnd;
  }

  // Aggregate: concatenate all trades, recompute metrics on combined PnL.
  const allTrades: ClosedTrade[] = windows.flatMap((w) => w.result.trades);
  // Build aggregated equity curve from start equity through trade-by-trade.
  let eq = cfg.startEquity;
  const aggCurve = [{ ts: cfg.startTs, equity: eq }];
  for (const t of allTrades.sort((a, b) => a.exitTs - b.exitTs)) {
    eq += t.pnlUsd - t.feesUsd - t.fundingUsd;
    aggCurve.push({ ts: t.exitTs, equity: eq });
  }
  const agg: BacktestResult = {
    symbol: cfg.symbol,
    trades: allTrades,
    startEquity: cfg.startEquity,
    endEquity: eq,
    metrics: computeMetrics(allTrades, cfg.startEquity, aggCurve),
    equityCurve: aggCurve,
  };

  log.info('walkforward complete', {
    strategy: strategy.name, symbol: cfg.symbol,
    windows: windows.length, totalTrades: allTrades.length,
    aggregateTotalR: agg.metrics.totalR.toFixed(2),
    aggregatePF: agg.metrics.profitFactor === Infinity ? '∞' : agg.metrics.profitFactor.toFixed(2),
    aggregateMaxDD: agg.metrics.maxDDPct.toFixed(2) + '%',
  });

  return { strategy: strategy.name, symbol: cfg.symbol, windows, aggregate: agg };
}

export function formatWalkforward(rep: WalkforwardReport): string {
  const lines: string[] = [];
  lines.push(`==== walk-forward: ${rep.strategy} on ${rep.symbol} ====`);
  lines.push(`windows: ${rep.windows.length}`);
  for (const w of rep.windows) {
    const m = w.result.metrics;
    lines.push(
      `  [${new Date(w.fromTs).toISOString().slice(0, 10)} → ${new Date(w.toTs).toISOString().slice(0, 10)}] ` +
      `T:${m.trades} WR:${(m.winRate * 100).toFixed(0)}% R:${m.totalR.toFixed(2)} ` +
      `PF:${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)} DD:${m.maxDDPct.toFixed(1)}%`
    );
  }
  lines.push('---- aggregate ----');
  lines.push(formatMetrics(rep.symbol, rep.aggregate.metrics));
  return lines.join('\n');
}

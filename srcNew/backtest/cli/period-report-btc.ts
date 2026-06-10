import { createLogger } from '../../core/logger';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { Trade, DEFAULT_CONFIG } from '../types';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RISK_PCT = 0.5;

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function pctOf(trades: readonly Trade[]): number {
  let equity = 1;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    equity *= 1 + (t.netR * RISK_PCT) / 100;
  }
  return (equity - 1) * 100;
}

function line(label: string, trades: readonly Trade[]): string {
  let sumR = 0;
  let wins = 0;
  for (const t of trades) {
    sumR += t.netR;
    if (t.netR > 0) wins++;
  }
  const wr = trades.length ? ((wins / trades.length) * 100).toFixed(0) : '-';
  const pct = pctOf(trades);
  return `${label}  n=${String(trades.length).padStart(3)}  sumR=${sumR.toFixed(2).padStart(7)}  WR=${String(wr).padStart(3)}%  P&L=${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function tradeLine(t: Trade): string {
  const entry = new Date(t.entryTs).toISOString().slice(0, 16).replace('T', ' ');
  const exit = new Date(t.exitTs).toISOString().slice(0, 16).replace('T', ' ');
  const pnlPct = (t.netR * RISK_PCT).toFixed(2);
  return (
    `  ${entry} -> ${exit}  ${t.side.toUpperCase().padEnd(5)} entry=${t.entryPrice.toFixed(0)} exit=${t.exitPrice.toFixed(0)} ` +
    `${t.exitReason.padEnd(4)} netR=${t.netR >= 0 ? '+' : ''}${t.netR.toFixed(2)} (${t.netR >= 0 ? '+' : ''}${pnlPct}%)`
  );
}

function main(): void {
  const logger = createLogger('period-report');
  const config = { ...DEFAULT_CONFIG, maxHoldDecisionBars: 12 };

  const dataset = loadBtcDataset('4h');
  const minutes = clampMinutesToCgWindow(dataset, config.cgPublishLagMs);
  const fundingProvider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs, 4 * HOUR_MS);
  const strategy = cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 });

  const cg = buildCgView(dataset, config.cgPublishLagMs);
  const result = runBacktest({ strategy, minuteCandles: minutes, cg, config, fundingRateProvider: fundingProvider });
  const trades = [...result.trades].sort((a, b) => a.entryTs - b.entryTs);
  const toTs = minutes[minutes.length - 1].ts;

  logger.info('run done', { trades: trades.length, toIso: new Date(toTs).toISOString() });

  console.log(`\n=== MONTHLY (config D, risk ${RISK_PCT}%/trade) ===`);
  const byMonth = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = monthKey(t.placedTs);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(t);
  }
  for (const [month, list] of [...byMonth.entries()].sort()) {
    console.log(line(month, list));
  }

  console.log('\n=== LAST 4 WEEKS (by week) ===');
  for (let weekEnd = toTs, w = 0; w < 4; w++, weekEnd -= 7 * DAY_MS) {
    const weekStart = weekEnd - 7 * DAY_MS;
    const list = trades.filter(t => t.placedTs >= weekStart && t.placedTs < weekEnd);
    const label = `${new Date(weekStart).toISOString().slice(0, 10)}..${new Date(weekEnd).toISOString().slice(0, 10)}`;
    console.log(line(label, list));
  }

  console.log('\n=== LAST WEEK — TRADE BY TRADE ===');
  const lastWeekStart = toTs - 7 * DAY_MS;
  const lastWeek = trades.filter(t => t.placedTs >= lastWeekStart);
  if (lastWeek.length === 0) console.log('  (no trades placed in the last 7 days)');
  for (const t of lastWeek) console.log(tradeLine(t));

  for (const month of ['2026-04', '2026-05']) {
    console.log(`\n=== ${month} — TRADE BY TRADE ===`);
    const list = byMonth.get(month) ?? [];
    console.log(line(month, list));
    for (const t of list) console.log(tradeLine(t));
  }
}

main();

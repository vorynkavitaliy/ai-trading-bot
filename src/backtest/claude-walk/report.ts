import fs from 'node:fs';
import path from 'node:path';
import { Outcome, QueueEntry } from './types';
import { log } from '../../lib/logger';

const VAULT_BACKTEST = path.resolve(__dirname, '../../../vault/Backtest');

interface AggBy {
  count: number;
  enters: number;
  skips: number;
  wins: number;
  losses: number;
  totalR: number;
  bestR: number;
  worstR: number;
}

function emptyAgg(): AggBy {
  return { count: 0, enters: 0, skips: 0, wins: 0, losses: 0, totalR: 0, bestR: 0, worstR: 0 };
}

function bumpAgg(a: AggBy, o: Outcome) {
  a.count++;
  if (o.decision.kind === 'skip') {
    a.skips++;
    return;
  }
  a.enters++;
  if (!o.trade) return;
  if (o.trade.pnlR > 0) a.wins++;
  else a.losses++;
  a.totalR += o.trade.pnlR;
  if (o.trade.pnlR > a.bestR) a.bestR = o.trade.pnlR;
  if (o.trade.pnlR < a.worstR) a.worstR = o.trade.pnlR;
}

function fmtAgg(label: string, a: AggBy): string {
  if (a.enters === 0) return `${label}: ${a.count} cand. (skip ${a.skips}/${a.count})`;
  const wr = a.wins / a.enters;
  const avgR = a.totalR / a.enters;
  return [
    `${label}:`,
    `  candidates: ${a.count}, enters: ${a.enters}, skips: ${a.skips}`,
    `  W:${a.wins} L:${a.losses} (WR ${(wr * 100).toFixed(1)}%)`,
    `  totalR: ${a.totalR.toFixed(2)}, avgR: ${avgR.toFixed(3)}`,
    `  best: ${a.bestR.toFixed(2)}R, worst: ${a.worstR.toFixed(2)}R`,
  ].join('\n');
}

export async function report() {
  const queuePath = path.join(VAULT_BACKTEST, 'queue.json');
  const outcomesDir = path.join(VAULT_BACKTEST, 'outcomes');
  if (!fs.existsSync(queuePath)) {
    log.error('queue.json not found — nothing to report');
    return;
  }
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueEntry[];
  const outcomes: Outcome[] = [];
  for (const q of queue) {
    const op = path.join(outcomesDir, `${q.id}.json`);
    if (!fs.existsSync(op)) continue;
    outcomes.push(JSON.parse(fs.readFileSync(op, 'utf-8')) as Outcome);
  }

  const total = emptyAgg();
  const bySymbol = new Map<string, AggBy>();
  const bySide = new Map<string, AggBy>();
  const byReason = new Map<string, AggBy>();

  for (const o of outcomes) {
    bumpAgg(total, o);
    if (!bySymbol.has(o.symbol)) bySymbol.set(o.symbol, emptyAgg());
    bumpAgg(bySymbol.get(o.symbol)!, o);
    if (o.decision.kind === 'enter') {
      const sideKey = `${o.symbol}-${o.decision.side}`;
      if (!bySide.has(sideKey)) bySide.set(sideKey, emptyAgg());
      bumpAgg(bySide.get(sideKey)!, o);
    }
    // Reason aggregation: requires looking up queue entry
    const q = queue.find((qe) => qe.id === o.id);
    if (q) {
      for (const r of q.reasons) {
        if (!byReason.has(r)) byReason.set(r, emptyAgg());
        bumpAgg(byReason.get(r)!, o);
      }
    }
  }

  const lines: string[] = [];
  lines.push('==== Claude Walk Report ====');
  lines.push(`queue size: ${queue.length}, outcomes: ${outcomes.length}, pending: ${queue.length - outcomes.length}`);
  lines.push('');
  lines.push(fmtAgg('TOTAL', total));
  lines.push('');
  lines.push('---- by symbol ----');
  for (const [sym, agg] of bySymbol) lines.push(fmtAgg(sym, agg));
  lines.push('');
  lines.push('---- by side (enters only) ----');
  for (const [k, agg] of bySide) lines.push(fmtAgg(k, agg));
  lines.push('');
  lines.push('---- by candidate reason ----');
  for (const [r, agg] of byReason) lines.push(fmtAgg(r, agg));

  const reportPath = path.join(VAULT_BACKTEST, 'report.txt');
  fs.writeFileSync(reportPath, lines.join('\n'));
  log.info('report written', { path: reportPath });
  console.log(lines.join('\n'));
}

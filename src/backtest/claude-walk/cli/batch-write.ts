import fs from 'node:fs';
import path from 'node:path';
import { QueueEntry } from '../backtest/claude-walk/types';
import { log } from '../lib/logger';

interface BatchEntry {
  id: string;
  decision: 'enter_long' | 'enter_short' | 'skip';
  reason?: string;
  entryPrice?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
  sizePct?: number;
  rationale?: string;
}

const VAULT_BACKTEST = path.resolve(__dirname, '../../vault/Backtest');

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: walk-batch-write.ts <path-to-batch.json>');
    process.exit(1);
  }
  const batch = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as BatchEntry[];

  const queuePath = path.join(VAULT_BACKTEST, 'queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueEntry[];
  const queueById = new Map(queue.map((q) => [q.id, q]));

  let written = 0;
  for (const e of batch) {
    const q = queueById.get(e.id);
    if (!q) {
      console.warn(`[skip] ${e.id} not in queue`);
      continue;
    }
    const decisionFile = path.join(VAULT_BACKTEST, 'decisions', `${e.id}.md`);
    const symbol = e.id.split('_')[0];
    const lines = [
      '---',
      `id: ${e.id}`,
      `symbol: ${symbol}`,
      `ts: ${q.ts}`,
      `decidedAt: ${new Date().toISOString()}`,
      `decision: ${e.decision}`,
    ];
    if (e.decision === 'skip') {
      lines.push(`reason: ${e.reason ?? '(no reason)'}`);
    } else {
      lines.push(`entryPrice: ${e.entryPrice}`);
      lines.push(`sl: ${e.sl}`);
      lines.push(`tp1: ${e.tp1}`);
      if (e.tp2 != null) lines.push(`tp2: ${e.tp2}`);
      lines.push(`sizePct: ${e.sizePct ?? 0.6}`);
      lines.push(`rationale: ${e.rationale ?? '(no rationale)'}`);
    }
    lines.push('---', '');
    fs.writeFileSync(decisionFile, lines.join('\n'));
    q.status = 'decided';
    written++;
  }
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  log.info('walk batch written', { count: written });
  console.log(JSON.stringify({ written, total_queue: queue.length }, null, 2));
}

main().catch((e) => {
  log.error('walk-batch-write failed', { err: e?.message ?? String(e) });
  process.exit(1);
});

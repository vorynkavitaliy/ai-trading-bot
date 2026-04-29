import fs from 'node:fs';
import path from 'node:path';
import { QueueEntry } from '../backtest/claude-walk/types';
import { log } from '../lib/logger';

const VAULT_BACKTEST = path.resolve(__dirname, '../../vault/Backtest');

async function main() {
  const minReasons = process.argv[2] ? parseInt(process.argv[2], 10) : 2;
  const queuePath = path.join(VAULT_BACKTEST, 'queue.json');
  const backupPath = path.join(VAULT_BACKTEST, `queue.full.json`);
  if (!fs.existsSync(queuePath)) {
    console.error('queue.json not found — run walk:prepare first');
    process.exit(1);
  }
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueEntry[];
  // Backup the full queue once
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, JSON.stringify(queue, null, 2));
    log.info('full queue backed up', { path: backupPath, total: queue.length });
  }
  const before = queue.length;
  const pruned = queue.filter(e => e.reasons.length >= minReasons);
  fs.writeFileSync(queuePath, JSON.stringify(pruned, null, 2));
  log.info('queue pruned', { before, after: pruned.length, minReasons });
  console.log(JSON.stringify({
    before, after: pruned.length, minReasons,
    backup: backupPath,
    note: 'Snapshot files in vault/Backtest/snapshots/ are not deleted; only queue.json is pruned. To restore, copy queue.full.json over queue.json.',
  }, null, 2));
}

main().catch(e => {
  log.error('walk-prune failed', { err: e?.message ?? String(e) });
  process.exit(1);
});

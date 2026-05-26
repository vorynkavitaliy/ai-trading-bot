/**
 * position-monitor — daemon entry point. One AccountMonitor per AccountKey,
 * signal handling, heartbeat writer.
 *
 * Replaces the 5-min cron position-watcher for sub-second TP1 / naked-SL /
 * dust / DCA detection. Reconcile (5-min) and scan-decide (top-of-hour)
 * remain on cron — this daemon only handles per-position events.
 *
 * Run via systemd unit (infra/position-monitor.service). For dev / debugging
 * use `npm run monitor:dev`.
 */

import fs from 'node:fs';
import { loadAccounts } from '../core/accounts';
import { runMigrations, close as closePg } from '../core/db';
import { log } from '../core/logger';
import { AccountMonitor } from './account-monitor';

const HEARTBEAT_PATH = '/tmp/position-monitor-heartbeat.json';
const HEARTBEAT_INTERVAL_MS = 30_000;

function envPollSec(): number {
  const raw = process.env.POSITION_MONITOR_POLL_SEC;
  if (!raw) return 30;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

interface HeartbeatPayload {
  status: 'running' | 'stopping';
  pid: number;
  startedAt: number;
  writtenAt: number;
  accounts: ReturnType<AccountMonitor['status']>[];
}

function writeHeartbeat(payload: HeartbeatPayload): void {
  try {
    fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify(payload, null, 2));
  } catch (e: any) {
    log.warn('heartbeat write failed', { err: e?.message });
  }
}

async function main(): Promise<void> {
  await runMigrations();
  const accounts = loadAccounts();
  const pollSec = envPollSec();
  const monitors = accounts.map((a) => new AccountMonitor(a, pollSec));
  const startedAt = Date.now();

  let stopping = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info('position-monitor: shutdown', { sig });
    writeHeartbeat({
      status: 'stopping',
      pid: process.pid,
      startedAt,
      writtenAt: Date.now(),
      accounts: monitors.map((m) => m.status()),
    });
    await Promise.allSettled(monitors.map((m) => m.stop()));
    try {
      await closePg();
    } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  await Promise.all(monitors.map((m) => m.start()));
  log.info('position-monitor: started', {
    accounts: accounts.map((a) => `${a.bucket}/${a.keyName}`),
    pollSec,
  });

  writeHeartbeat({
    status: 'running',
    pid: process.pid,
    startedAt,
    writtenAt: Date.now(),
    accounts: monitors.map((m) => m.status()),
  });

  const hbTimer = setInterval(() => {
    writeHeartbeat({
      status: stopping ? 'stopping' : 'running',
      pid: process.pid,
      startedAt,
      writtenAt: Date.now(),
      accounts: monitors.map((m) => m.status()),
    });
  }, HEARTBEAT_INTERVAL_MS);
  hbTimer.unref();
}

if (require.main === module) {
  main().catch((e) => {
    log.error('position-monitor crashed', { err: e?.message ?? String(e), stack: e?.stack });
    process.exit(1);
  });
}

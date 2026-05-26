/**
 * monitor-health — quick liveness probe for the position-monitor daemon.
 *
 * Exit codes:
 *   0 — healthy
 *   1 — heartbeat file missing or stale (> 90s)
 *   2 — at least one account WS disconnected
 *   3 — at least one account has no WS event for > 10 min (likely stuck)
 *
 * Used by heartbeat.ts (Telegram alert path) and operator-side checks via
 * `npm run monitor:health` before `systemctl status position-monitor`.
 */

import fs from 'node:fs';

const HEARTBEAT_PATH = '/tmp/position-monitor-heartbeat.json';
const STALE_AFTER_MS = 90_000;
const NO_EVENT_AFTER_MS = 600_000;

interface HeartbeatPayload {
  status: string;
  pid: number;
  startedAt: number;
  writtenAt: number;
  accounts: Array<{
    account: string;
    wsConnected: boolean;
    lastWsEventAt: number;
    lastRestPollAt: number;
    openSymbols: string[];
  }>;
}

function exitWith(code: number, reason: string): never {
  if (code === 0) console.log(`OK ${reason}`);
  else console.error(`FAIL [${code}] ${reason}`);
  process.exit(code);
}

function readHeartbeat(): HeartbeatPayload | null {
  try {
    const raw = fs.readFileSync(HEARTBEAT_PATH, 'utf-8');
    return JSON.parse(raw) as HeartbeatPayload;
  } catch {
    return null;
  }
}

function main(): void {
  const hb = readHeartbeat();
  if (!hb) exitWith(1, `no heartbeat at ${HEARTBEAT_PATH}`);
  const ageMs = Date.now() - hb.writtenAt;
  if (ageMs > STALE_AFTER_MS) {
    exitWith(1, `heartbeat stale ${Math.round(ageMs / 1000)}s (limit ${STALE_AFTER_MS / 1000}s)`);
  }
  for (const acc of hb.accounts) {
    if (!acc.wsConnected) exitWith(2, `account ${acc.account} WS disconnected`);
  }
  for (const acc of hb.accounts) {
    const sinceLast = Date.now() - acc.lastWsEventAt;
    if (acc.lastWsEventAt > 0 && sinceLast > NO_EVENT_AFTER_MS) {
      exitWith(3, `account ${acc.account} no WS event for ${Math.round(sinceLast / 1000)}s`);
    }
  }
  exitWith(0, `daemon healthy, ${hb.accounts.length} accounts, heartbeat ${Math.round(ageMs / 1000)}s old`);
}

main();

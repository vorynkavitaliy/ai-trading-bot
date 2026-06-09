/**
 * emergency-halt — per-account, per-UTC-day entry halt marker.
 *
 * Written by the position-monitor daemon's DailyDdGuard when an account breaches
 * its intraday drawdown limit and gets flattened. Read by execute.ts before placing
 * an order on that account, so a flattened account stops taking new entries for the
 * rest of the UTC day while healthy accounts keep trading. The marker auto-expires:
 * the filename carries the UTC day, so a stale marker simply no longer matches.
 *
 * Marker path: vault/Watchlist/EMERGENCY-DD-<bucket>-<keyName>-<YYYY-MM-DD>.md
 */
import fs from 'node:fs';
import path from 'node:path';

const WATCHLIST_DIR = path.resolve(__dirname, '..', '..', 'vault', 'Watchlist');

export function utcDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function emergencyHaltPath(bucket: string, keyName: string, day: string = utcDayKey()): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(WATCHLIST_DIR, `EMERGENCY-DD-${safe(bucket)}-${safe(keyName)}-${day}.md`);
}

/** True if this account is emergency-halted for the current UTC day. */
export function isEmergencyHalted(bucket: string, keyName: string): boolean {
  try {
    return fs.existsSync(emergencyHaltPath(bucket, keyName));
  } catch {
    return false;
  }
}

/** Write the halt marker for this account/day. Idempotent. */
export function writeEmergencyHalt(bucket: string, keyName: string, detail: Record<string, unknown>): void {
  const p = emergencyHaltPath(bucket, keyName);
  const body =
    `# EMERGENCY DAILY-DD FLATTEN\n\n` +
    `Account: ${bucket}/${keyName}\n` +
    `Triggered: ${new Date().toISOString()}\n\n` +
    `All positions market-closed; new entries halted for the rest of this UTC day.\n` +
    `Marker auto-expires at UTC midnight (filename carries the day). Operator may delete to override.\n\n` +
    '```json\n' + JSON.stringify(detail, null, 2) + '\n```\n';
  fs.mkdirSync(WATCHLIST_DIR, { recursive: true });
  fs.writeFileSync(p, body);
}

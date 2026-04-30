import fs from 'node:fs';
import { scanAll } from '../scan-summary';
import { notifyHeartbeat } from '../lib/tg-templates';
import { close as closePg } from '../lib/db';
import { close as closeRedis } from '../lib/redis';
import { log } from '../lib/logger';

// State file to prevent double-firing within the same UTC hour.
const HEARTBEAT_STATE_PATH = '/tmp/last-heartbeat-hour.txt';

function currentHourKey(): string {
  return new Date().toISOString().slice(0, 13);   // 'YYYY-MM-DDTHH'
}

function alreadySentThisHour(): boolean {
  try {
    const last = fs.readFileSync(HEARTBEAT_STATE_PATH, 'utf-8').trim();
    return last === currentHourKey();
  } catch { return false; }
}

function markSent(): void {
  try { fs.writeFileSync(HEARTBEAT_STATE_PATH, currentHourKey()); } catch {}
}

const REGIME_RU: Record<string, string> = {
  range: 'диапазон',
  trend_bull: 'тренд (вверх)',
  trend_bear: 'тренд (вниз)',
  transition: 'переход',
};

async function main() {
  const cycleArg = process.argv[2] ?? 'C—';
  const force = process.argv.includes('--force');

  // Self-throttle: only one heartbeat per UTC hour. Trader can call us every cycle;
  // we silently exit if this hour was already covered. Use --force to override.
  if (!force && alreadySentThisHour()) {
    log.info('heartbeat skipped — already sent this hour');
    await closePg();
    await closeRedis();
    return;
  }

  const snap = await scanAll();

  // Aggregate regime distribution across 10-pair v3 universe.
  const regimeCount: Record<string, number> = { range: 0, trend_bull: 0, trend_bear: 0, transition: 0 };
  for (const p of snap.pairs) regimeCount[p.regime] = (regimeCount[p.regime] ?? 0) + 1;
  const dominant = Object.entries(regimeCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'transition';

  await notifyHeartbeat({
    cycle: cycleArg,
    regime: {
      btc: `${REGIME_RU[dominant]} (доминант: ${regimeCount[dominant]}/10)`,
      eth: `пары: range ${regimeCount.range}, тренд ${regimeCount.trend_bull + regimeCount.trend_bear}, переход ${regimeCount.transition}`,
    },
    openPositions: snap.risk.openPositionsCount,
    pnlDayUsd: snap.risk.dailyPnlUsd,
    pnlDayPct: snap.risk.dailyPnlPct,
    triggersInWindow: { fired: 0, total: 0 },
    notes: snap.risk.softKillTriggered ? '⚠️ мягкий стоп активен' :
           snap.risk.inDeadZone ? 'ночное окно 22-00 UTC — входы заблокированы' :
           snap.risk.inFundingWindow ? 'окно фондирования — входы заблокированы' :
           undefined,
  });

  markSent();
  log.info('heartbeat sent', {
    cycle: cycleArg, dominant, regimeCount,
    openPositions: snap.risk.openPositionsCount,
  });
  await closePg();
  await closeRedis();
}

main().catch(async e => {
  log.error('heartbeat failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  try { await closeRedis(); } catch {}
  process.exit(1);
});

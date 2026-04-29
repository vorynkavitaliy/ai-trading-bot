import { scanAll } from '../scan-summary';
import { notifyHeartbeat } from '../lib/tg-templates';
import { close as closePg } from '../lib/db';
import { close as closeRedis } from '../lib/redis';
import { log } from '../lib/logger';

const REGIME_RU: Record<string, string> = {
  range: 'диапазон',
  trend_bull: 'тренд (вверх)',
  trend_bear: 'тренд (вниз)',
  transition: 'переход',
};

async function main() {
  const cycleArg = process.argv[2] ?? 'C—';
  const snap = await scanAll();
  const btc = snap.pairs.find(p => p.symbol === 'BTCUSDT');
  const eth = snap.pairs.find(p => p.symbol === 'ETHUSDT');

  await notifyHeartbeat({
    cycle: cycleArg,
    regime: {
      btc: REGIME_RU[btc?.regime ?? 'transition'] ?? 'переход',
      eth: REGIME_RU[eth?.regime ?? 'transition'] ?? 'переход',
    },
    openPositions: snap.risk.openPositionsCount,
    pnlDayUsd: snap.risk.dailyPnlUsd,
    pnlDayPct: snap.risk.dailyPnlPct,
    triggersInWindow: { fired: 0, total: 0 },        // wired up after strategy.md exists
    notes: snap.risk.softKillTriggered ? '⚠️ мягкий стоп активен' :
           snap.risk.inDeadZone ? 'ночное окно 22-00 UTC — входы заблокированы' :
           snap.risk.inFundingWindow ? 'окно фондирования — входы заблокированы' :
           undefined,
  });

  log.info('heartbeat sent', {
    cycle: cycleArg, btcRegime: btc?.regime, ethRegime: eth?.regime,
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

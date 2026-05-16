import fs from 'node:fs';
import { scanAll } from '../scan-summary';
import { notifyHeartbeat } from '../lib/tg-templates';
import { close as closePg } from '../lib/db';
import { log } from '../lib/logger';
import { loadAccounts } from '../lib/accounts';
import { getRest, withRetry } from '../lib/bybit';
import { RISK } from '../risk-guard';

// Pipeline-staleness thresholds. Cron should hit cycle.log every 5min, scan-decide
// every top-of-hour. Crossing these = the cron pipeline is silently broken.
const CYCLE_LOG_STALE_MIN = 10;     // cron fires every 5min → 10min = missed two ticks
const SCAN_DECIDE_STALE_MIN = 90;   // top-of-hour scan should land within the hour

function fileAgeMinutes(p: string): number | null {
  try {
    const st = fs.statSync(p);
    return Math.round((Date.now() - st.mtimeMs) / 60_000);
  } catch { return null; }
}

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
    return;
  }

  const snap = await scanAll();

  // Aggregate regime distribution across 10-pair v3 universe.
  const regimeCount: Record<string, number> = { range: 0, trend_bull: 0, trend_bear: 0, transition: 0 };
  for (const p of snap.pairs) regimeCount[p.regime] = (regimeCount[p.regime] ?? 0) + 1;
  const dominant = Object.entries(regimeCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'transition';

  // Per-account equity + uPnL (Bybit live)
  const accounts = loadAccounts();
  const accountSummaries: Array<{ name: string; equity: number; uPnl: number }> = [];
  for (const acc of accounts) {
    const c = getRest(acc);
    let equity = 0; let uPnl = 0;
    try {
      const w = await withRetry(() => c.getWalletBalance({ accountType: 'UNIFIED' }), { label: `hb-w-${acc.keyName}` });
      if (w.retCode === 0) equity = parseFloat(w.result?.list?.[0]?.totalEquity ?? '0');
    } catch (e: any) { log.warn('hb wallet fail', { account: acc.keyName, err: e.message }); }
    try {
      const p = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), { label: `hb-pos-${acc.keyName}` });
      if (p.retCode === 0) {
        for (const pos of p.result?.list ?? []) {
          if (parseFloat(pos.size) > 0) uPnl += parseFloat(pos.unrealisedPnl ?? '0');
        }
      }
    } catch (e: any) { log.warn('hb pos fail', { account: acc.keyName, err: e.message }); }
    accountSummaries.push({ name: acc.keyName, equity, uPnl });
  }

  // Look up BTC price (for market context line)
  const btcPair = snap.pairs.find((p) => p.symbol === 'BTCUSDT');
  const btcPrice = btcPair?.price;

  // Total equity + uPnL (sums across accounts)
  const totalEquity = accountSummaries.reduce((s, a) => s + a.equity, 0);
  const totalUpnl = accountSummaries.reduce((s, a) => s + a.uPnl, 0);

  // Pipeline staleness: surface silent cron failures BEFORE "no trades for a day"
  // becomes the first signal something is wrong.
  const scanDecideAgeMin = fileAgeMinutes('/tmp/scan-decide-latest.json');
  const autoExecAgeMin = fileAgeMinutes('/tmp/auto-execute-latest.json');
  const cycleLogAgeMin = fileAgeMinutes('/tmp/cycle.log');
  const stalenessReasons: string[] = [];
  if (cycleLogAgeMin == null) {
    stalenessReasons.push('cycle.log отсутствует — cron ни разу не отрабатывал?');
  } else if (cycleLogAgeMin > CYCLE_LOG_STALE_MIN) {
    stalenessReasons.push(`cycle.log не обновлялся ${cycleLogAgeMin}m (cron мёртв или висит)`);
  }
  if (scanDecideAgeMin != null && scanDecideAgeMin > SCAN_DECIDE_STALE_MIN) {
    stalenessReasons.push(`scan-decide не обновлялся ${scanDecideAgeMin}m (top-of-hour падает)`);
  }
  const staleDegraded = stalenessReasons.length > 0;

  await notifyHeartbeat({
    cycle: cycleArg,
    regimeCount: {
      range: regimeCount.range ?? 0,
      trend: (regimeCount.trend_bull ?? 0) + (regimeCount.trend_bear ?? 0),
      transition: regimeCount.transition ?? 0,
    },
    dominantRegime: dominant,
    openPositions: snap.risk.openPositionsCount,
    maxPositions: RISK.maxParallelPositions,
    totalEquity,
    totalUpnl,
    dayPnlUsd: snap.risk.dailyPnlUsd,
    dayPnlPct: snap.risk.dailyPnlPct,
    accounts: accountSummaries,
    btcPrice,
    triggersInWindow: { fired: 0, total: 0 },
    notes: snap.risk.softKillTriggered ? 'мягкий стоп активен — новые входы заблокированы до конца дня' :
           snap.risk.inFundingWindow ? 'окно фондирования (±10 мин от 00/08/16 UTC) — входы временно заблокированы' :
           undefined,
    staleness: {
      scanDecideAgeMin,
      autoExecAgeMin,
      cycleLogAgeMin,
      degraded: staleDegraded,
      reasons: stalenessReasons,
    },
  });

  markSent();
  log.info('heartbeat sent', {
    cycle: cycleArg, dominant, regimeCount,
    openPositions: snap.risk.openPositionsCount,
  });
  await closePg();
}

main().catch(async e => {
  log.error('heartbeat failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});

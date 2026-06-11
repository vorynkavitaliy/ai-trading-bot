// One-off repair: re-download candles from the exchange and FORCE-overwrite DB rows,
// bypassing the closed-bar immutability guard. Use after a frozen-era regression
// (2026-06-02..06-10: refreshForScan skipped re-fetching forming bars, freezing each
// bar at its first-seen partial state — 240m range capture fell to ~29%).
//
//   npx tsx src/tools/ops/repair-candles.ts <daysBack>   (default 30)
//
// Scope: SYMBOLS × TFS_FOR_SCAN (the live ingestion universe).
import { backfillCandles, SYMBOLS, TFS_FOR_SCAN } from '../../data/backfill';
import { close } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const daysBack = parseInt(process.argv[2] ?? '30', 10);
  const now = Date.now();
  const fromMs = now - daysBack * 24 * 3600_000;
  log.info('=== candle repair start (force overwrite) ===', {
    daysBack, fromIso: new Date(fromMs).toISOString(), symbols: SYMBOLS, tfs: TFS_FOR_SCAN,
  });
  for (const symbol of SYMBOLS) {
    for (const tf of TFS_FOR_SCAN) {
      await backfillCandles(symbol, tf, fromMs, now, true);
    }
  }
  log.info('=== candle repair done ===');
  await close();
}

main().catch(async (e) => {
  log.error('repair-candles failed', { err: e?.message ?? String(e) });
  try { await close(); } catch {}
  process.exit(1);
});

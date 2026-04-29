// Backfill OHLCV (1m/5m/15m/60m/240m/1D/1W) + funding for one or more symbols.
// Usage: npx tsx src/data/cli/backfill-symbol.ts XRPUSDT [DOGEUSDT ...]
// Defaults to 365 days for intraday TFs and 730 days for 1D/1W (matches DEFAULT in v3).

import { backfillCandles, backfillFunding } from '../backfill';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';

const TFS_INTRADAY = ['1m', '5m', '15m', '60m', '240m'];
const TFS_HTF = ['1D', '1W'];
const DAYS_INTRADAY = 365;
const DAYS_HTF = 730;

async function main() {
  const symbols = process.argv.slice(2).map((s) => s.toUpperCase());
  if (symbols.length === 0) {
    console.error('usage: backfill-symbol.ts <SYMBOL> [<SYMBOL>...]');
    process.exit(1);
  }
  const now = Date.now();
  const fromIntraday = now - DAYS_INTRADAY * 24 * 60 * 60_000;
  const fromHtf = now - DAYS_HTF * 24 * 60 * 60_000;
  log.info('=== one-shot backfill ===', { symbols, daysIntraday: DAYS_INTRADAY, daysHtf: DAYS_HTF });

  for (const symbol of symbols) {
    for (const tf of TFS_INTRADAY) {
      log.info('--- candles ---', { symbol, tf });
      await backfillCandles(symbol, tf, fromIntraday, now);
    }
    for (const tf of TFS_HTF) {
      log.info('--- candles ---', { symbol, tf });
      await backfillCandles(symbol, tf, fromHtf, now);
    }
    log.info('--- funding ---', { symbol });
    await backfillFunding(symbol, fromIntraday, now);
  }

  await closePg();
  log.info('=== one-shot backfill done ===');
}

main().catch(async (e) => {
  log.error('backfill-symbol failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});

/**
 * Long-running daemon entry point (single-process alternative to /loop).
 * Runs 3-min scan cycle for every symbol in WATCHLIST + 30-min full-report.
 *
 * For production prefer the "one-terminal-per-pair" model via
 * `/loop 3m /trade-scan SYMBOL` — better isolation, deeper per-pair focus.
 */
import { Bot } from './orchestrator';
import { config } from './config';
import cron from 'node-cron';

async function main() {
  const bot = new Bot();
  await bot.start({ announce: true });

  console.log(`[Bot] watching ${config.watchlist.length} pairs: ${config.watchlist.join(', ')}`);

  // Per-pair scan loop
  let busy = false;
  cron.schedule('*/3 * * * *', async () => {
    if (busy) return;
    busy = true;
    try {
      for (const sym of config.watchlist) {
        await bot.scanPair(sym).catch((e) => console.error(`[scan ${sym}]`, e.message));
      }
    } finally {
      busy = false;
    }
  });

  // Full report every 30 min
  cron.schedule('*/30 * * * *', () => {
    bot.fullReport().catch((e) => console.error('[fullReport]', e.message));
  });

  // Initial pass
  for (const sym of config.watchlist) {
    await bot.scanPair(sym).catch((e) => console.error(`[scan ${sym}]`, e.message));
  }

  const shutdown = async (sig: string) => {
    console.log(`\n[Bot] received ${sig}, shutting down`);
    await bot.stop(sig, { announce: true });
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error(err); process.exit(1); });

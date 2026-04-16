/**
 * Pair scanner — entry point for /trade-scan.
 *
 *   tsx src/scan.ts BTCUSDT              → one pair (scanPair)
 *   tsx src/scan.ts all                  → all 8 pairs parallel: analyze → rank → execute best
 *   tsx src/scan.ts BTCUSDT ETHUSDT      → specific pairs parallel
 *   tsx src/scan.ts all --report         → + Telegram full report
 *
 * Multi-pair mode uses scanAll():
 *   Phase 1 — analyze all pairs in parallel (~5-10s total)
 *   Phase 2 — rank signals by confluence (strongest first)
 *   Phase 3 — execute in priority order, respecting slot limits
 */
import { Bot } from './orchestrator';
import { config } from './config';

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const report = process.argv.includes('--report');

  if (args.length === 0) {
    console.error('Usage: tsx src/scan.ts <SYMBOL|SYMBOL1 SYMBOL2...|all> [--report]');
    process.exit(1);
  }

  const symbols = args[0].toLowerCase() === 'all'
    ? [...config.watchlist]
    : args.map((s) => s.toUpperCase());

  const bot = new Bot();
  await bot.start();

  try {
    const t0 = Date.now();
    console.log(`\n═══ Scan cycle: ${symbols.join(', ')} (${new Date().toISOString()}) ═══\n`);

    if (symbols.length === 1) {
      // Single pair — use direct scanPair
      const symbol = symbols[0];
      const result = await bot.scanPair(symbol, { reportTelegram: report });
      printResult(symbol, result);
    } else {
      // Multi-pair — analyze all → rank → execute best
      const results = await bot.scanAll(symbols, { reportTelegram: report });

      // Print executed first, then skipped
      const executed = results.filter((r) => r.executed);
      const rest = results.filter((r) => !r.executed);

      for (const r of [...executed, ...rest]) {
        printResult(r.symbol, r);
      }

      if (executed.length) {
        console.log(`\n🎯 Исполнено: ${executed.map((r) => r.symbol).join(', ')}`);
      }
    }

    if (report) {
      await bot.fullReport();
    }

    console.log(`\n═══ Cycle complete (${((Date.now() - t0) / 1000).toFixed(1)}s) ═══\n`);
  } finally {
    await bot.stop('scan complete');
  }
}

function printResult(symbol: string, result: { signal: any; executed: boolean; skipReason?: string; plan?: any }) {
  if (result.signal) {
    const s = result.signal;
    const icon = result.executed ? '✅' : (s.direction !== 'None' ? '⏳' : '—');
    console.log(
      `${icon} [${symbol}] regime=${s.regime} | L:${s.long.total}/4 S:${s.short.total}/4 | ` +
      `dir=${s.direction} | exec=${result.executed}` +
      (result.skipReason ? ` | ${result.skipReason}` : '')
    );
    if (result.plan) {
      console.log(
        `   entry=${result.plan.entry} sl=${result.plan.stopLoss} tp=${result.plan.takeProfit} rr=${result.plan.rr}`
      );
    }
  } else {
    console.log(`— [${symbol}] ${result.skipReason ?? 'no signal'}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

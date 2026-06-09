/**
 * candle-freshness — latest candle timestamp per (symbol, tf) vs now.
 * Answers "is market data fresh, or is the bot operating on stale candles?"
 *
 * Run: npx tsx src/tools/diagnostics/candle-freshness.ts
 */

import { query, close as closePg } from '../../core/db';

async function main(): Promise<void> {
  const nowMs = Date.now();
  const { rows } = await query<{ symbol: string; tf: string; maxts: string; n: string }>(
    `SELECT symbol, tf, MAX(ts)::text AS maxts, COUNT(*)::text AS n
     FROM candles
     WHERE symbol IN ('BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ARBUSDT')
     GROUP BY symbol, tf
     ORDER BY symbol, tf`,
  );
  console.log(`now = ${new Date(nowMs).toISOString()}  (${nowMs})`);
  for (const r of rows) {
    const ms = Number(r.maxts);
    const ageH = (nowMs - ms) / 3_600_000;
    const flag = ageH > 24 ? ' 🟥 STALE' : ageH > 2 ? ' 🟧' : ' ✅';
    console.log(`  ${r.symbol} ${r.tf}: last bar ${new Date(ms).toISOString()} (${ageH.toFixed(1)}h ago, ${r.n} bars)${flag}`);
  }
  await closePg();
}

main().catch((e) => { console.error(e); process.exit(1); });

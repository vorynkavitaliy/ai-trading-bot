/**
 * cooldowns — show per-pair cooldown status, and optionally clear the STRATEGY
 * cooldown for given symbols.
 *
 *   npx tsx src/tools/admin/cooldowns.ts                      # show all
 *   npx tsx src/tools/admin/cooldowns.ts ETHUSDT SOLUSDT XRPUSDT  # clear those + show
 *
 * Two cooldown classes:
 *   - strategy CD (same-direction, ~6h) → strategy_cooldowns table → CLEARABLE here.
 *   - risk-guard CD (post-SL 12h / post-any-close 4h / max-SL-day) → DERIVED live
 *     from the trades table → NOT clearable without rewriting trade history; shown
 *     read-only with time remaining.
 */

import { query, close as closePg } from '../../core/db';
import { tradeRepo } from '../../data/trade-repo';
import { tier1Pairs } from '../../runtime/pair-strategies';
import { RISK } from '../../runtime/risk-guard';

const SL_CD_H = 12;
const ANY_CD_H = 4;
const MAX_SL_DAY = 2;

async function main(): Promise<void> {
  const toClear = process.argv.slice(2).map((s) => s.toUpperCase());

  if (toClear.length > 0) {
    const del = await query(
      `DELETE FROM strategy_cooldowns WHERE symbol = ANY($1::text[])`,
      [toClear],
    );
    console.log(`✅ cleared strategy CD for ${toClear.join(', ')} — deleted ${del.rowCount ?? 0} row(s)\n`);
  }

  const now = Date.now();
  const sessionStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());

  const stratRows = await query<{ symbol: string; side: string; last_entry_ts: string }>(
    `SELECT symbol, side, last_entry_ts FROM strategy_cooldowns`,
  );
  const strat = new Map(stratRows.rows.map((r) => [r.symbol, { side: r.side, ageH: (now - Number(r.last_entry_ts)) / 3_600_000 }]));

  console.log('=== cooldown status (pair: strategy | risk-guard) ===');
  for (const symbol of tier1Pairs()) {
    const slTs = await tradeRepo.lastSlCloseTs(symbol);
    const lastTs = await tradeRepo.lastCloseTs(symbol);
    const slToday = await tradeRepo.countSlInSession(symbol, sessionStart);

    const parts: string[] = [];
    const s = strat.get(symbol);
    if (s && s.ageH < 6) parts.push(`strategy ${s.side} ${s.ageH.toFixed(1)}h/6h`);
    if (slTs && (now - slTs) < SL_CD_H * 3_600_000) parts.push(`post-SL ${((now - slTs) / 3_600_000).toFixed(1)}h/${SL_CD_H}h`);
    else if (lastTs && (now - lastTs) < ANY_CD_H * 3_600_000) parts.push(`post-close ${((now - lastTs) / 3_600_000).toFixed(1)}h/${ANY_CD_H}h`);
    if (slToday >= MAX_SL_DAY) parts.push(`${slToday} SL today (cap ${MAX_SL_DAY})`);

    if (parts.length) console.log(`  ⛔ ${symbol}: ${parts.join(' | ')}`);
  }
  console.log('  (пары не в списке — свободны)');

  // Rolling entry-cap window detail: which entries occupy the cap and when each ages out.
  const windowStartMs = Math.max(now - RISK.entryCapWindowHours * 3_600_000, RISK.entryCapEpochMs);
  const ents = await query<{ symbol: string; side: string; opened: string }>(
    `SELECT symbol, side, MIN(opened_at)::text AS opened
     FROM trades
     WHERE opened_at IS NOT NULL AND EXTRACT(EPOCH FROM opened_at) * 1000 >= $1
     GROUP BY symbol, side, date_trunc('second', opened_at)
     ORDER BY opened`,
    [windowStartMs],
  );
  console.log(`\n=== entry-cap ${RISK.maxEntriesPerWindow}/${RISK.entryCapWindowHours}h: ${ents.rows.length} в окне ===`);
  for (const e of ents.rows) {
    const ageOut = new Date(new Date(e.opened).getTime() + RISK.entryCapWindowHours * 3_600_000).toISOString().slice(11, 16);
    console.log(`  ${e.symbol} ${e.side}  opened ${e.opened.slice(11, 16)} UTC  → выпадет из окна ~${ageOut} UTC`);
  }

  await closePg();
}

main().catch((e) => { console.error(e); process.exit(1); });

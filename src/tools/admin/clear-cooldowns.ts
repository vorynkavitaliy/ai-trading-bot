/**
 * clear-cooldowns — operator tool to lift all entry cooldowns.
 *
 * Clears the DB-persisted strategy same-direction cooldown (strategy_cooldowns
 * table, the 6h gate). Then REPORTS the risk-guard cooldowns that are derived
 * live from the trades table (post-SL 12h, post-any-close 4h, max-SL/day) — these
 * are NOT separate state and cannot be "cleared" without rewriting trade history,
 * so we only surface whether any are currently active per pair.
 *
 * Run: npx tsx src/tools/admin/clear-cooldowns.ts
 */

import { query, close as closePg } from '../../core/db';
import { tradeRepo } from '../../data/trade-repo';
import { tier1Pairs } from '../../runtime/pair-strategies';

const COOLDOWN_AFTER_SL_HOURS = 12;
const COOLDOWN_AFTER_ANY_CLOSE_HOURS = 4;
const MAX_SL_PER_PAIR_PER_DAY = 2;

async function main(): Promise<void> {
  const now = new Date();

  const before = await query<{ symbol: string; side: string; last_entry_ts: string }>(
    `SELECT symbol, side, last_entry_ts FROM strategy_cooldowns ORDER BY symbol, side`,
  );
  console.log(`=== strategy_cooldowns (6h same-direction) — ${before.rows.length} row(s) before ===`);
  for (const r of before.rows) {
    const ageH = ((now.getTime() - Number(r.last_entry_ts)) / 3_600_000).toFixed(1);
    console.log(`   ${r.symbol} ${r.side} — last entry ${ageH}h ago`);
  }
  const del = await query(`DELETE FROM strategy_cooldowns`);
  console.log(`✅ DELETED ${del.rowCount ?? 0} row(s) from strategy_cooldowns — strategy cooldown cleared.\n`);

  console.log('=== risk-guard cooldowns (derived from trades, NOT cleared — status only) ===');
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let anyActive = false;
  for (const symbol of tier1Pairs()) {
    const slTs = await tradeRepo.lastSlCloseTs(symbol);
    const lastTs = await tradeRepo.lastCloseTs(symbol);
    const slToday = await tradeRepo.countSlInSession(symbol, sessionStart);

    const slCdActive = slTs !== null && (now.getTime() - slTs) < COOLDOWN_AFTER_SL_HOURS * 3_600_000;
    const anyCdActive = lastTs !== null && (now.getTime() - lastTs) < COOLDOWN_AFTER_ANY_CLOSE_HOURS * 3_600_000;
    const dayCapHit = slToday >= MAX_SL_PER_PAIR_PER_DAY;

    if (slCdActive || anyCdActive || dayCapHit) {
      anyActive = true;
      const parts: string[] = [];
      if (slCdActive) parts.push(`post-SL ${((now.getTime() - slTs!) / 3_600_000).toFixed(1)}h/${COOLDOWN_AFTER_SL_HOURS}h`);
      if (anyCdActive) parts.push(`post-close ${((now.getTime() - lastTs!) / 3_600_000).toFixed(1)}h/${COOLDOWN_AFTER_ANY_CLOSE_HOURS}h`);
      if (dayCapHit) parts.push(`${slToday} SL today (cap ${MAX_SL_PER_PAIR_PER_DAY})`);
      console.log(`   ⛔ ${symbol}: ${parts.join(', ')}`);
    }
  }
  if (!anyActive) {
    console.log('   ✅ ни на одной паре risk-guard КД не активен (все истекли по времени).');
  } else {
    console.log('\n   ⚠ Активные risk-guard КД выше — выведены из реальных закрытий. Снять их без');
    console.log('     фальсификации истории сделок нельзя; они истекут сами по времени.');
  }

  await closePg();
}

main().catch((e) => { console.error(e); process.exit(1); });

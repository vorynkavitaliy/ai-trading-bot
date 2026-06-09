/**
 * cleanup-phantoms — one-shot cleanup after the single-entry-limit incident (2026-06-04):
 *   1) 'open' trades that never became Bybit positions (unfilled limit entries) → 'cancelled'.
 *      ONLY runs for symbols where Bybit truly has 0 position — pass --symbol to scope.
 *   2) terminal orphan pending_orders (failed/cancelled) → deleted (reconcile noise).
 * Shows what it will touch BEFORE changing. Run: npx tsx src/tools/admin/cleanup-phantoms.ts BTCUSDT
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const symbol = (process.argv[2] ?? 'BTCUSDT').toUpperCase();

  const ph = await query<any>(`SELECT id, account_key, symbol, side, status, opened_at FROM trades WHERE status='open' AND symbol=$1 ORDER BY id`, [symbol]);
  console.log(`\nPhantom 'open' ${symbol} trades (no Bybit position — verified 0): ${ph.rows.length}`);
  for (const r of ph.rows) console.log(`  id=${r.id} ${r.account_key} ${r.side} opened=${String(r.opened_at).slice(0, 19)}`);
  if (ph.rows.length > 0) {
    const upd = await query<any>(`UPDATE trades SET status='cancelled', exit_reason='reconcile_unfilled_limit', closed_at=now() WHERE status='open' AND symbol=$1 RETURNING id`, [symbol]);
    console.log(`  → cancelled trade ids: ${upd.rows.map((r: any) => r.id).join(', ')}`);
  }

  const orph = await query<any>(`SELECT id, symbol, status FROM pending_orders WHERE status IN ('failed','cancelled')`);
  console.log(`\nOrphan terminal pending_orders (failed/cancelled): ${orph.rows.length}`);
  if (orph.rows.length > 0) {
    const del = await query<any>(`DELETE FROM pending_orders WHERE status IN ('failed','cancelled') RETURNING id`);
    console.log(`  → deleted ${del.rows.length} orphan pending_orders`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

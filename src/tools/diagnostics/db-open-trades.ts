// Show all DB-open trades (status='open') for diagnostics
import { query, close as closePg } from '../../core/db';

async function main() {
  const r = await query<any>(`
    SELECT id, account_bucket, account_key, symbol, side, qty, entry_price, sl, tp1,
           opened_at, status FROM trades WHERE status = 'open' ORDER BY opened_at DESC
  `, []);
  console.log(`${r.rows.length} DB-open trades:`);
  for (const t of r.rows) {
    console.log(`  id=${t.id} ${t.account_bucket}/${t.account_key} ${t.symbol} ${t.side} qty=${t.qty} entry=${t.entry_price} opened=${t.opened_at}`);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

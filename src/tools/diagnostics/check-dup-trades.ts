// One-off diagnostic: investigate duplicate open-trade rows for ARB/BNB/SOL.
// Lists every open trade with its linked pending_order and matching Bybit
// position size, so we can confirm the stack-and-sum vs. duplicate-row hypothesis.
import { query, close as closePg } from '../../core/db';

async function main() {
  console.log('--- open trades grouped by (account, symbol) ---');
  const grouped = await query<any>(`
    SELECT account_bucket, account_key, symbol, side,
           COUNT(*)::int AS n,
           SUM(qty)::text AS sum_qty,
           ARRAY_AGG(id ORDER BY id) AS ids,
           ARRAY_AGG(qty::text ORDER BY id) AS qtys,
           ARRAY_AGG(entry_price::text ORDER BY id) AS entries,
           ARRAY_AGG(opened_at ORDER BY id) AS opened_ats
    FROM trades WHERE status = 'open'
    GROUP BY account_bucket, account_key, symbol, side
    ORDER BY symbol, account_key
  `, []);

  for (const g of grouped.rows) {
    console.log(`\n${g.account_bucket}/${g.account_key} ${g.symbol} ${g.side}  N=${g.n}  sum_qty=${g.sum_qty}`);
    for (let i = 0; i < g.ids.length; i++) {
      console.log(`  id=${g.ids[i]} qty=${g.qtys[i]} entry=${g.entries[i]} opened=${g.opened_ats[i].toISOString?.() ?? g.opened_ats[i]}`);
    }
  }

  console.log('\n--- linked pending_orders for these open trades ---');
  const linked = await query<any>(`
    SELECT po.id AS po_id, po.symbol, po.account_bucket, po.account_key, po.side,
           po.status, po.qty::text AS po_qty, po.entry_price::text AS po_entry,
           po.order_link_id, po.bybit_order_id,
           po.trade_id, po.requested_at, po.resolved_at
    FROM pending_orders po
    INNER JOIN trades t ON po.trade_id = t.id
    WHERE t.status = 'open'
    ORDER BY po.symbol, po.account_key, po.requested_at
  `, []);

  for (const r of linked.rows) {
    console.log(`po_id=${r.po_id} trade_id=${r.trade_id} ${r.account_bucket}/${r.account_key} ${r.symbol} ${r.side} status=${r.status} qty=${r.po_qty} entry=${r.po_entry} linkId=${r.order_link_id}`);
  }

  console.log('\n--- unlinked pending_orders (trade_id NULL) in last 24h ---');
  const orphans = await query<any>(`
    SELECT id, symbol, account_bucket, account_key, side, status,
           qty::text, entry_price::text, order_link_id, bybit_order_id,
           requested_at, resolved_at, last_error
    FROM pending_orders
    WHERE trade_id IS NULL
      AND requested_at > NOW() - INTERVAL '24 hours'
    ORDER BY requested_at DESC
  `, []);
  for (const r of orphans.rows) {
    console.log(`po_id=${r.id} ${r.account_bucket}/${r.account_key} ${r.symbol} ${r.side} status=${r.status} qty=${r.qty} entry=${r.entry_price} linkId=${r.order_link_id} byOID=${r.bybit_order_id} req=${r.requested_at.toISOString?.() ?? r.requested_at} resolved=${r.resolved_at?.toISOString?.() ?? r.resolved_at} err=${r.last_error}`);
  }

  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * Pull full row(s) of a trade for audit. Helps inspect realized_r anomalies.
 *
 * Usage:
 *   npx tsx src/tools/diagnostics/trade-detail.ts BNBUSDT 2026-05-19T01:00
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const symbol = process.argv[2];
  const tsPrefix = process.argv[3];
  if (!symbol || !tsPrefix) { console.error('usage: trade-detail.ts SYMBOL TS_PREFIX'); process.exit(1); }

  const { rows } = await query<any>(
    `SELECT id, account_bucket, account_key, symbol, side, order_type, qty, initial_qty,
            entry_price, exit_price, sl, tp1, tp2, status, exit_reason,
            pnl_usd, realized_r, fees_usd, funding_usd,
            tp1_filled_at, tp1_realized_pnl_usd, tp1_filled_qty,
            opened_at, closed_at, rationale
     FROM trades
     WHERE symbol = $1 AND opened_at::text LIKE $2
     ORDER BY opened_at ASC`,
    [symbol, tsPrefix + '%']
  );
  if (rows.length === 0) { console.log('no trades'); await closePg(); return; }

  for (const t of rows) {
    console.log('═'.repeat(78));
    console.log(`id=${t.id}  ${t.account_bucket}/${t.account_key}  ${t.symbol}  ${t.side}  ${t.order_type}`);
    console.log(`  opened:        ${t.opened_at}`);
    console.log(`  closed:        ${t.closed_at}`);
    console.log(`  status / exit: ${t.status} / ${t.exit_reason}`);
    console.log();
    console.log(`  initial_qty:   ${t.initial_qty}`);
    console.log(`  qty (now):     ${t.qty}`);
    console.log(`  entry_price:   ${t.entry_price}`);
    console.log(`  exit_price:    ${t.exit_price}`);
    console.log(`  sl:            ${t.sl}`);
    console.log(`  tp1:           ${t.tp1}`);
    console.log(`  tp2:           ${t.tp2}`);
    console.log();
    console.log(`  tp1_filled_at:    ${t.tp1_filled_at}`);
    console.log(`  tp1_filled_qty:   ${t.tp1_filled_qty}`);
    console.log(`  tp1_realized_pnl: ${t.tp1_realized_pnl_usd}`);
    console.log();
    console.log(`  pnl_usd:       ${t.pnl_usd}`);
    console.log(`  realized_r:    ${t.realized_r}`);
    console.log(`  fees_usd:      ${t.fees_usd}`);
    console.log(`  funding_usd:   ${t.funding_usd}`);
    console.log();
    // Compute expected R from data
    const entry = parseFloat(t.entry_price);
    const sl = parseFloat(t.sl);
    const exit = parseFloat(t.exit_price);
    const qty0 = parseFloat(t.initial_qty ?? t.qty);
    const stopDist = Math.abs(entry - sl);
    const riskUsd = stopDist * qty0;
    console.log(`  >> derived stopDist=${stopDist.toFixed(4)}  risked_usd=${riskUsd.toFixed(2)}`);
    console.log(`  >> recorded pnl_usd / risked_usd = ${(parseFloat(t.pnl_usd) / riskUsd).toFixed(3)}R`);
    if (t.tp1_realized_pnl_usd != null) {
      const tailPnl = parseFloat(t.pnl_usd) - parseFloat(t.tp1_realized_pnl_usd);
      console.log(`  >> tp1_partial pnl   = ${parseFloat(t.tp1_realized_pnl_usd).toFixed(2)}  → ${(parseFloat(t.tp1_realized_pnl_usd)/riskUsd).toFixed(3)}R`);
      console.log(`  >> tail (after TP1)  = ${tailPnl.toFixed(2)}  → ${(tailPnl/riskUsd).toFixed(3)}R`);
    }
    console.log(`  rationale: ${t.rationale}`);
  }

  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

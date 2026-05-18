// Diagnostic: dump last N closed trades with full context for cluster analysis.
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const limit = Number(process.argv[2] ?? 40);
  const r = await query<any>(
    `SELECT id, account_bucket, account_key, symbol, side, status,
            entry_price::text, exit_price::text, sl::text,
            tp1::text, tp2::text, qty::text,
            realized_r::text, pnl_usd::text, exit_reason,
            opened_at::text, closed_at::text
     FROM trades
     WHERE status = 'closed'
     ORDER BY closed_at DESC
     LIMIT $1`,
    [limit]
  );
  console.log(`=== last ${r.rows.length} closed trades ===\n`);
  let slCount = 0;
  let tp1Count = 0;
  let tp2Count = 0;
  let otherCount = 0;
  let totalR = 0;
  let totalUsd = 0;
  for (const t of r.rows) {
    const opened = new Date(t.opened_at).toISOString().replace('T', ' ').slice(0, 16);
    const closed = t.closed_at ? new Date(t.closed_at).toISOString().replace('T', ' ').slice(0, 16) : '       —';
    const pnlR = t.realized_r ? parseFloat(t.realized_r).toFixed(2).padStart(6) : '   —';
    const pnlUsd = t.pnl_usd ? parseFloat(t.pnl_usd).toFixed(0).padStart(6) : '    —';
    const reason = (t.exit_reason ?? '—').padEnd(10);
    if (t.exit_reason === 'sl') slCount++;
    else if (t.exit_reason === 'tp1') tp1Count++;
    else if (t.exit_reason === 'tp2') tp2Count++;
    else otherCount++;
    if (t.realized_r) totalR += parseFloat(t.realized_r);
    if (t.pnl_usd) totalUsd += parseFloat(t.pnl_usd);
    console.log(
      `  ${opened}→${closed}  ${t.symbol.padEnd(10)} ${t.side.toUpperCase().padEnd(5)} ` +
      `${t.account_bucket}/${t.account_key.padEnd(8)}  ` +
      `${reason}  R=${pnlR}  $${pnlUsd}  entry=${t.entry_price}→exit=${t.exit_price}  sl=${t.sl}`
    );
  }
  console.log(`\n=== summary === sl=${slCount} tp1=${tp1Count} tp2=${tp2Count} other=${otherCount}`);
  console.log(`totalR=${totalR.toFixed(2)}  totalUsd=${totalUsd.toFixed(0)}`);
  await closePg();
}

main().catch(async (e) => {
  log.error('recent-closed failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});

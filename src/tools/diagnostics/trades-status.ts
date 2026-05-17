// Diagnostic: dump last 24h of trades with status + PnL.
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const r = await query<any>(
    `SELECT id, account_bucket, account_key, symbol, side, status,
            entry_price::text, exit_price::text, sl::text,
            tp1::text, tp2::text, qty::text,
            realized_r::text, pnl_usd::text, exit_reason,
            opened_at::text, closed_at::text
     FROM trades
     WHERE opened_at >= NOW() - INTERVAL '48 hours'
     ORDER BY opened_at DESC`
  );
  console.log(`=== ${r.rows.length} trades in last 48h ===\n`);
  for (const t of r.rows) {
    const opened = new Date(t.opened_at).toISOString().replace('T', ' ').slice(0, 16);
    const closed = t.closed_at ? new Date(t.closed_at).toISOString().replace('T', ' ').slice(0, 16) : '       —';
    const status = t.status.padEnd(7);
    const pnlR = t.realized_r ? parseFloat(t.realized_r).toFixed(2).padStart(6) : '   —';
    const pnlUsd = t.pnl_usd ? parseFloat(t.pnl_usd).toFixed(0).padStart(6) : '    —';
    console.log(
      `  ${opened}  ${t.symbol.padEnd(10)} ${t.side.toUpperCase().padEnd(5)} ` +
      `${t.account_bucket}/${t.account_key.padEnd(8)}  ` +
      `qty=${parseFloat(t.qty).toFixed(2).padStart(8)}  ` +
      `${status}  ${(t.exit_reason ?? '—').padEnd(10)}  ` +
      `R=${pnlR}  $${pnlUsd}  closed=${closed}`
    );
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('trades-status failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});

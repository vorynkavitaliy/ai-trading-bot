// Show today's P&L (UTC day): realized closed + unrealized open + breakdown.
import { getDayPnl, formatDayPnl } from '../../core/pnl';
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const p = await getDayPnl();
  console.log(formatDayPnl(p));
  console.log('');

  // Per-trade breakdown for today
  const r = await query<any>(
    `SELECT symbol, side, account_bucket, account_key,
            entry_price::text, exit_price::text,
            qty::text, realized_r::text, pnl_usd::text, exit_reason,
            opened_at::text, closed_at::text
     FROM trades
     WHERE status = 'closed'
       AND closed_at >= to_timestamp($1 / 1000.0)
     ORDER BY closed_at`,
    [p.sessionStartTs]
  );
  if (r.rows.length === 0) {
    console.log('No trades closed today yet.');
  } else {
    console.log('Closed today:');
    for (const t of r.rows) {
      const opened = new Date(t.opened_at).toISOString().slice(11, 16);
      const closed = new Date(t.closed_at).toISOString().slice(11, 16);
      const pnl = parseFloat(t.pnl_usd ?? '0');
      const r2 = parseFloat(t.realized_r ?? '0');
      const pnlSign = pnl >= 0 ? '+' : '−';
      const rSign = r2 >= 0 ? '+' : '';
      console.log(
        `  ${opened}-${closed}  ${t.symbol.padEnd(10)} ${t.side.toUpperCase().padEnd(5)} ` +
        `${t.account_bucket}/${t.account_key.padEnd(8)}  ` +
        `${rSign}${r2.toFixed(2)}R  ${pnlSign}$${Math.abs(pnl).toFixed(0)}  ` +
        `(${t.exit_reason ?? '—'})`
      );
    }
  }

  await closePg();
}

main().catch(async (e) => {
  log.error('pnl-day failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});

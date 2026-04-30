/**
 * Close a trade row in DB after detecting external/server-side close.
 *
 * Usage:
 *   npx tsx src/scripts/close-trade.ts <trade_id> <exit_price> <closed_reason> [closed_at_iso]
 *
 * - Computes realized_r = (exit - entry) / (entry - sl)  [LONG]
 *                      = (entry - exit) / (sl - entry)  [SHORT]
 * - Computes pnl_usd from qty × (exit - entry) for LONG, qty × (entry - exit) for SHORT.
 * - Sets status='closed', closed_at, exit_price, pnl_usd, realized_r in `trades` table.
 * - Note: closed_reason column does not exist on trades; encoded into vault Trade .md only.
 *
 * vault/Trades/{date}_{symbol}_{dir}.md frontmatter is NOT updated by this script —
 * caller (the trader) updates it via the Edit tool to keep one source of truth.
 */
import { query, close } from '../lib/db';

async function main() {
  const tradeIdStr = process.argv[2];
  const exitPriceStr = process.argv[3];
  const closedReason = process.argv[4];
  const closedAtIso = process.argv[5] ?? new Date().toISOString();

  if (!tradeIdStr || !exitPriceStr || !closedReason) {
    console.error('usage: npx tsx src/scripts/close-trade.ts <trade_id> <exit_price> <closed_reason> [closed_at_iso]');
    process.exit(1);
  }

  const tradeId = Number(tradeIdStr);
  const exitPrice = Number(exitPriceStr);
  if (!Number.isFinite(tradeId) || !Number.isFinite(exitPrice)) {
    console.error('trade_id and exit_price must be numeric');
    process.exit(1);
  }

  const r = await query(
    `SELECT id, symbol, side, qty, entry_price, sl FROM trades WHERE id = $1`,
    [tradeId]
  );
  if (r.rowCount === 0) {
    console.error(`trade ${tradeId} not found`);
    process.exit(1);
  }
  const row = r.rows[0] as {
    id: number;
    symbol: string;
    side: string;
    qty: string;
    entry_price: string;
    sl: string;
  };

  const qty = Number(row.qty);
  const entry = Number(row.entry_price);
  const slV = Number(row.sl);
  const isLong = row.side === 'Buy';

  const pnl = isLong ? qty * (exitPrice - entry) : qty * (entry - exitPrice);
  const stopDist = isLong ? entry - slV : slV - entry;
  const realizedR = stopDist === 0 ? 0 : (isLong ? exitPrice - entry : entry - exitPrice) / stopDist;

  await query(
    `UPDATE trades
       SET status = 'closed',
           exit_price = $1,
           closed_at = $2,
           pnl_usd = $3,
           realized_r = $4
     WHERE id = $5`,
    [exitPrice, closedAtIso, pnl.toFixed(8), realizedR.toFixed(4), tradeId]
  );

  console.log(JSON.stringify({
    ok: true,
    trade_id: tradeId,
    symbol: row.symbol,
    side: row.side,
    qty: qty,
    entry: entry,
    exit: exitPrice,
    sl: slV,
    pnl_usd: Number(pnl.toFixed(8)),
    realized_r: Number(realizedR.toFixed(4)),
    closed_reason: closedReason,
    closed_at: closedAtIso,
  }, null, 2));

  await close();
}

main().catch(async (e) => {
  console.error(e);
  await close();
  process.exit(1);
});

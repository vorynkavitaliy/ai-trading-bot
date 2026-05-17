/**
 * Overwrite a trade row's pnl_usd with the exact Bybit-reported value
 * (post-fees, post-funding), keeping realized_r intact.
 *
 * Usage: npx tsx src/scripts/patch-trade-pnl.ts <trade_id> <pnl_usd>
 */
import { query, close } from '../../core/db';

async function main() {
  const tradeId = Number(process.argv[2]);
  const pnl = Number(process.argv[3]);
  if (!Number.isFinite(tradeId) || !Number.isFinite(pnl)) {
    console.error('usage: npx tsx src/scripts/patch-trade-pnl.ts <trade_id> <pnl_usd>');
    process.exit(1);
  }
  await query(`UPDATE trades SET pnl_usd = $1 WHERE id = $2`, [pnl.toFixed(8), tradeId]);
  console.log(JSON.stringify({ ok: true, trade_id: tradeId, pnl_usd: pnl }));
  await close();
}

main().catch(async (e) => {
  console.error(e);
  await close();
  process.exit(1);
});

// Operator data correction: set exit_reason on CLOSED trades whose label was
// mis-inferred (inferExitReason's 1% price-proximity heuristic can label an
// operator manual close 'sl' when the exit lands near the stop level — wrong
// label AND a wrong 12h cooldown). Allowed values only; prints before/after.
//
//   npx tsx src/tools/admin/set-exit-reason.ts <reason> <id> [id...]
import { query, close } from '../../core/db';

const ALLOWED = new Set(['sl', 'tp1', 'tp2', 'manual', 'time_stop', 'external']);

async function main() {
  const reason = process.argv[2];
  const ids = process.argv.slice(3).map((s) => parseInt(s, 10)).filter(Number.isFinite);
  if (!reason || !ALLOWED.has(reason) || ids.length === 0) {
    console.error('usage: npx tsx src/tools/admin/set-exit-reason.ts <sl|tp1|tp2|manual|time_stop|external> <id> [id...]');
    process.exit(1);
  }
  const before = await query(
    `SELECT id, symbol, account_key, status, exit_reason FROM trades WHERE id = ANY($1)`, [ids]);
  for (const r of before.rows) console.log('before:', JSON.stringify(r));
  const res = await query(
    `UPDATE trades SET exit_reason = $1 WHERE id = ANY($2) AND status = 'closed'`,
    [reason, ids]);
  console.log(`updated ${res.rowCount} closed rows -> exit_reason='${reason}'`);
  await close();
}

main().catch(async (e) => {
  console.error('set-exit-reason failed:', e?.message ?? String(e));
  try { await close(); } catch {}
  process.exit(1);
});

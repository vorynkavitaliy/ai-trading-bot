/**
 * One-shot backfill: recompute realized_r for closed trades that had TP1 partial fill.
 *
 * Bug (2026-05-23 audit): reconcile.ts:188 used `t.qty` (remaining qty after TP1
 * close) instead of `initial_qty` to compute riskedUsd → realized_r inflated ~2×
 * on any trade where TP1 fired.
 *
 * Fix in code: reconcile.ts now uses initial_qty (committed alongside).
 * This script corrects historic rows so reports and dashboards show real R.
 *
 * Safe to run multiple times — idempotent. Only updates rows where:
 *   status='closed' AND tp1_filled_at IS NOT NULL AND initial_qty IS NOT NULL
 * Other rows (SL-only, pre-migration-005) are left as-is.
 *
 * Run: npx tsx src/tools/admin/backfill-realized-r.ts
 *      (use --dry-run to preview without modifying)
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfill realized_r ${dryRun ? '(DRY RUN)' : ''} ===`);

  // Find affected rows: closed, had TP1 partial, have initial_qty set.
  const { rows } = await query<any>(
    `SELECT id, symbol, side, qty::text, initial_qty::text, entry_price::text, sl::text,
            pnl_usd::text, realized_r::text AS old_r, tp1_filled_qty::text
     FROM trades
     WHERE status = 'closed'
       AND tp1_filled_at IS NOT NULL
       AND initial_qty IS NOT NULL
       AND entry_price IS NOT NULL
       AND sl IS NOT NULL
       AND pnl_usd IS NOT NULL
     ORDER BY id ASC`
  );

  console.log(`Found ${rows.length} closed trades with TP1 partial to recompute.`);

  let changed = 0;
  let unchanged = 0;
  const samples: any[] = [];
  for (const r of rows) {
    const entry = parseFloat(r.entry_price);
    const sl = parseFloat(r.sl);
    const stopDist = Math.abs(entry - sl);
    const initialQty = parseFloat(r.initial_qty);
    if (stopDist <= 0 || initialQty <= 0) { unchanged++; continue; }
    const riskedUsd = stopDist * initialQty;
    const pnlUsd = parseFloat(r.pnl_usd);
    const newR = pnlUsd / riskedUsd;
    const oldR = parseFloat(r.old_r ?? '0');
    if (Math.abs(newR - oldR) < 0.0005) { unchanged++; continue; }

    if (samples.length < 8) {
      samples.push({ id: r.id, symbol: r.symbol, side: r.side, oldR: oldR.toFixed(3), newR: newR.toFixed(3), pnl: pnlUsd.toFixed(2) });
    }
    if (!dryRun) {
      await query(`UPDATE trades SET realized_r = $1 WHERE id = $2`, [newR, r.id]);
    }
    changed++;
  }

  console.log(`\nWould change: ${changed} rows`);
  console.log(`Unchanged:    ${unchanged} rows`);
  console.log('\nSamples:');
  for (const s of samples) {
    console.log(`  id=${s.id}  ${s.symbol} ${s.side}  pnl=$${s.pnl}  R: ${s.oldR} → ${s.newR}`);
  }

  if (dryRun) console.log('\n(dry-run — no DB writes performed)');
  else console.log(`\n✓ Updated ${changed} rows.`);
  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

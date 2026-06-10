// Reset the once-per-4H decision latch (decided_anchors). Operator/maintenance tool:
// use after changing decision inputs (e.g. CG read semantics) so the current anchor
// re-decides on the next scan instead of waiting for the next 4H boundary.
import { query, close } from '../../core/db';

async function main() {
  const r = await query(`DELETE FROM decided_anchors`);
  console.log(`decided_anchors cleared: ${r.rowCount} rows`);
  await close();
}

main().catch(async (e) => {
  console.error('clear-decided-anchors failed:', e?.message ?? String(e));
  try { await close(); } catch {}
  process.exit(1);
});

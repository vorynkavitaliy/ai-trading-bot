// Read-only SQL runner for diagnostics: npx tsx src/tools/diagnostics/sql-read.ts "SELECT ..."
// Refuses anything that is not a single SELECT/WITH statement. Prints rows as JSON lines.
import { query, close } from '../../core/db';

async function main() {
  const sql = process.argv[2];
  if (!sql) {
    console.error('usage: npx tsx src/tools/diagnostics/sql-read.ts "SELECT ..."');
    process.exit(1);
  }
  const norm = sql.trim().toLowerCase();
  if (!norm.startsWith('select') && !norm.startsWith('with')) {
    console.error('refused: only SELECT/WITH statements allowed');
    process.exit(1);
  }
  const r = await query(sql);
  for (const row of r.rows) console.log(JSON.stringify(row));
  console.error(`-- ${r.rowCount} rows`);
  await close();
}

main().catch(async (e) => {
  console.error('sql-read failed:', e?.message ?? String(e));
  try { await close(); } catch {}
  process.exit(1);
});

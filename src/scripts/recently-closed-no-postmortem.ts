// Diagnostic helper for cycle.sh: reports count of trades closed in the last 75min
// that lack a Postmortem markdown file. cycle.sh uses this to set a trigger flag
// that the Claude tmux session checks on its next /loop poll.

import fs from 'node:fs';
import path from 'node:path';
import { query, close as closePg } from '../lib/db';

async function main() {
  const r = await query<any>(
    `SELECT id, symbol, side, status, closed_at::text
     FROM trades
     WHERE status = 'closed'
       AND closed_at IS NOT NULL
       AND closed_at >= NOW() - INTERVAL '75 minutes'`
  );
  let pending = 0;
  for (const t of r.rows) {
    const date = new Date(t.closed_at).toISOString().slice(0, 10);
    const dir = (t.side ?? '').toLowerCase() === 'buy' ? 'LONG' : 'SHORT';
    const expected = path.resolve(__dirname, `../../vault/Postmortem/${date}_${t.symbol}_${dir}.md`);
    if (!fs.existsSync(expected)) pending++;
  }
  process.stdout.write(String(pending));
  await closePg();
}

main().catch(async () => {
  // On error, output 0 so cycle.sh doesn't set a false flag.
  process.stdout.write('0');
  try { await closePg(); } catch {}
});

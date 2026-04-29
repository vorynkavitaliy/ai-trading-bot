import { runNewsFetch } from '../news/run';
import { close as closePg } from '../lib/db';
import { log } from '../lib/logger';

async function main() {
  const r = await runNewsFetch();
  console.log(JSON.stringify(r, null, 2));
  await closePg();
}

main().catch(async (e) => {
  log.error('news-fetch failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});

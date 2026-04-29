import { getFeatures, recentFunding } from '../data/features';
import { close as closePg } from '../lib/db';
import { close as closeRedis } from '../lib/redis';
import { log } from '../lib/logger';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const TFS = ['5m', '15m', '60m', '240m'];

async function main() {
  for (const symbol of SYMBOLS) {
    for (const tf of TFS) {
      const f = await getFeatures(symbol, tf, undefined, false);
      console.log(JSON.stringify({ kind: 'features', ...f }, null, 2));
    }
    const fr = await recentFunding(symbol, 3);
    console.log(JSON.stringify({ kind: 'funding', symbol, recent: fr }, null, 2));
  }
  await closePg();
  await closeRedis();
}

main().catch(async (e) => {
  log.error('features-run failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  try { await closeRedis(); } catch {}
  process.exit(1);
});

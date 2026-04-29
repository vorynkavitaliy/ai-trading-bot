import { prepareAll } from '../prepare';
import { close as closePg } from '../../../lib/db';
import { log } from '../../../lib/logger';

async function main() {
  const days = parseInt(process.argv[2] ?? '85', 10);
  const symbolsArg = process.argv[3] ?? 'BTCUSDT,ETHUSDT';
  const symbols = symbolsArg.split(',').map((s) => s.trim());
  await prepareAll(symbols, days);
  await closePg();
}

main().catch(async (e) => {
  log.error('claude-walk prepare failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});

/**
 * add-pair-candle-refresh — probe + refresh candles for NEW screen candidates.
 *
 * Probe (default): print count + date range per TF (1m/60m/240m) for each candidate —
 *   the backtest engine NEEDS 1m for SL/TP fill resolution, so this checks feasibility.
 * Refresh (arg 'write'): backfill each TF from its last bar (or 370d back if empty) to now.
 *
 * Run: npx tsx src/backtest/cli/add-pair-candle-refresh.ts            (probe only)
 *      npx tsx src/backtest/cli/add-pair-candle-refresh.ts write      (probe + backfill)
 *      npx tsx src/backtest/cli/add-pair-candle-refresh.ts write AVAXUSDT SUIUSDT
 */
import { query, close as closePg } from '../../core/db';
import { backfillCandles } from '../../data/backfill';
import { TF_MS } from '../../data/bybit-public';

const DEFAULT = ['AVAXUSDT', 'DOTUSDT', 'NEARUSDT', 'SUIUSDT', 'OPUSDT'];
const TFS = ['1m', '60m', '240m'];
const DAY = 86_400_000;

async function cov(symbol: string, tf: string) {
  const r = await query<{ n: string; lo: string | null; hi: string | null }>(
    `SELECT count(*) n, min(ts) lo, max(ts) hi FROM candles WHERE symbol=$1 AND tf=$2`, [symbol, tf]);
  const n = Number(r.rows[0].n), lo = r.rows[0].lo ? Number(r.rows[0].lo) : null, hi = r.rows[0].hi ? Number(r.rows[0].hi) : null;
  return { n, lo, hi };
}
const d = (ts: number | null) => ts == null ? '—' : new Date(ts).toISOString().slice(0, 10);

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('write');
  const syms = args.filter(a => a.endsWith('USDT'));
  const candidates = syms.length ? syms : DEFAULT;
  const now = Date.now();

  console.log(`\n=== candle coverage ${write ? '+ REFRESH' : '(probe)'} · ${candidates.join(' ')} ===`);
  for (const s of candidates) {
    const parts: string[] = [];
    for (const tf of TFS) {
      const c = await cov(s, tf);
      const ageDays = c.hi ? Math.round((now - c.hi) / DAY) : null;
      parts.push(`${tf}: ${String(c.n).padStart(6)} [${d(c.lo)}→${d(c.hi)}${ageDays != null ? ` ${ageDays}d stale` : ''}]`);
    }
    console.log(`${s.padEnd(10)} ${parts.join('  ')}`);
  }

  if (write) {
    console.log(`\n--- refreshing to ${d(now)} ---`);
    for (const s of candidates) {
      for (const tf of TFS) {
        const c = await cov(s, tf);
        const from = c.hi ? c.hi + TF_MS[tf] : now - 370 * DAY;
        if (from >= now) { console.log(`${s} ${tf}: fresh, skip`); continue; }
        await backfillCandles(s, tf, from, now);
        const after = await cov(s, tf);
        console.log(`${s} ${tf}: ${c.n} → ${after.n} (+${after.n - c.n}), now →${d(after.hi)}`);
      }
    }
  }
  await closePg();
  console.log('\ndone.');
}

main().catch(e => { console.error(e); process.exit(1); });

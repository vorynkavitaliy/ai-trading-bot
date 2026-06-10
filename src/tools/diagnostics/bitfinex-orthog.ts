/**
 * bitfinex-orthog — orthogonality of the two strongest-magnitude Bitfinex signals
 * vs trailing same-horizon price return (lagged-momentum repackaging check).
 * Computed per IS/OOS half so we see whether the signal IS just momentum.
 *
 * Run: npx tsx src/tools/diagnostics/bitfinex-orthog.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY_MS = 86_400_000;
function rank(xs: number[]): number[] { const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length).fill(0); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
function pearson(a: number[], b: number[]): number { const n = a.length; if (n < 3) return NaN; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } const den = Math.sqrt(da * db); return den === 0 ? NaN : num / den; }
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }
function fmt(x: number): string { return isNaN(x) ? 'NaN' : (x >= 0 ? '+' : '') + x.toFixed(4); }

async function dailyCloses(): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const m = new Map<number, number>();
  for (const row of r.rows) { const ts = parseInt(row.ts, 10); const d = Math.floor(ts / DAY_MS) * DAY_MS; if ((ts - d) / 3600_000 === 20) m.set(d, parseFloat(row.close)); }
  return m;
}
function trail(closes: Map<number, number>, day: number, h: number): number | null { const c0 = closes.get(day - h * DAY_MS); const c1 = closes.get(day); if (c0 == null || c1 == null || c0 <= 0) return null; return (c1 - c0) / c0; }

async function check(name: string, sig: Map<number, number>, closes: Map<number, number>, h: number) {
  const days = [...sig.keys()].sort((a, b) => a - b);
  const rows: { d: number; s: number; t: number }[] = [];
  for (const d of days) { const s = sig.get(d)!; if (isNaN(s)) continue; const t = trail(closes, d, h); if (t == null) continue; rows.push({ d, s, t }); }
  const mid = Math.floor(rows.length / 2);
  const isC = spearman(rows.slice(0, mid).map(x => x.s), rows.slice(0, mid).map(x => x.t));
  const oosC = spearman(rows.slice(mid).map(x => x.s), rows.slice(mid).map(x => x.t));
  const allC = spearman(rows.map(x => x.s), rows.map(x => x.t));
  console.log(`${name} vs trailing ${h}d return:  IS=${fmt(isC)}  OOS=${fmt(oosC)}  ALL=${fmt(allC)}  (n=${rows.length})`);
}

async function main() {
  console.log('\n=== Orthogonality vs trailing price return (lagged-momentum check) ===\n');
  const closes = await dailyCloses();
  const ls = await cgGet<any[]>('/bitfinex-margin-long-short', { symbol: 'BTC', interval: '1d', limit: 2000 });
  const ratio = new Map<number, number>();
  for (const x of ls.data) { const d = Math.floor(x.time * 1000 / DAY_MS) * DAY_MS; if (x.short_quantity > 0) ratio.set(d, x.long_quantity / x.short_quantity); }
  await check('A ls_ratio(long/short)', ratio, closes, 7);

  const bor = await cgGet<any[]>('/borrow-interest-rate/history', { exchange: 'Binance', symbol: 'BTC', interval: '1d', limit: 4500 });
  const brate = new Map<number, number>();
  for (const x of bor.data) { const d = Math.floor(x.time * 1000 / DAY_MS) * DAY_MS; brate.set(d, x.interest_rate); }
  await check('E borrow_rate(Binance)', brate, closes, 7);
  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? e); process.exit(1); });

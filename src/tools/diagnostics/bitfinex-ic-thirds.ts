/**
 * bitfinex-ic-thirds — robustness check on the IS/OOS sign-flip found in
 * bitfinex-ic.ts. Splits the aligned series into 3 equal chronological thirds
 * and reports Spearman IC per third for the two strongest-magnitude signals
 * (ls_ratio @7d and borrow_rate @7d). If the sign is regime-dependent (not a
 * stable edge) the thirds will disagree.
 *
 * Run: npx tsx src/tools/diagnostics/bitfinex-ic-thirds.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY_MS = 86_400_000;

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length; if (n < 3) return NaN; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db); return den === 0 ? NaN : num / den;
}
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }
function fmt(x: number): string { return isNaN(x) ? 'NaN' : (x >= 0 ? '+' : '') + x.toFixed(4); }

async function dailyCloses(): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const map = new Map<number, number>();
  for (const row of r.rows) { const ts = parseInt(row.ts, 10); const dayStart = Math.floor(ts / DAY_MS) * DAY_MS; const hod = (ts - dayStart) / 3600_000; if (hod === 20) map.set(dayStart, parseFloat(row.close)); }
  return map;
}
function fwd(closes: Map<number, number>, day: number, h: number): number | null {
  const c0 = closes.get(day); const c1 = closes.get(day + h * DAY_MS); if (c0 == null || c1 == null || c0 <= 0) return null; return (c1 - c0) / c0;
}

async function analyze(name: string, sigByDay: Map<number, number>, closes: Map<number, number>, h: number) {
  const days = [...sigByDay.keys()].sort((a, b) => a - b);
  const aligned: { d: number; s: number; f: number }[] = [];
  for (const d of days) { const s = sigByDay.get(d)!; if (isNaN(s)) continue; const f = fwd(closes, d, h); if (f == null) continue; aligned.push({ d, s, f }); }
  const n = aligned.length; const t = Math.floor(n / 3);
  const parts = [aligned.slice(0, t), aligned.slice(t, 2 * t), aligned.slice(2 * t)];
  const ics = parts.map(p => spearman(p.map(x => x.s), p.map(x => x.f)));
  const spans = parts.map(p => p.length ? `${new Date(p[0].d).toISOString().slice(0, 10)}..${new Date(p[p.length - 1].d).toISOString().slice(0, 10)}` : '-');
  const allSame = ics.every(x => Math.sign(x) === Math.sign(ics[0]));
  console.log(`${name} @${h}d  N=${n}`);
  console.log(`  T1 ${spans[0]}  IC=${fmt(ics[0])}`);
  console.log(`  T2 ${spans[1]}  IC=${fmt(ics[1])}`);
  console.log(`  T3 ${spans[2]}  IC=${fmt(ics[2])}`);
  console.log(`  same-sign across thirds: ${allSame ? 'YES' : 'NO (regime-dependent)'}`);
}

async function main() {
  console.log('\n=== Bitfinex margin L/S + borrow: thirds robustness ===\n');
  const closes = await dailyCloses();

  const ls = await cgGet<any[]>('/bitfinex-margin-long-short', { symbol: 'BTC', interval: '1d', limit: 2000 });
  const ratio = new Map<number, number>();
  for (const x of ls.data) { const d = Math.floor(x.time * 1000 / DAY_MS) * DAY_MS; if (x.short_quantity > 0) ratio.set(d, x.long_quantity / x.short_quantity); }
  await analyze('A ls_ratio(long/short)', ratio, closes, 7);

  const bor = await cgGet<any[]>('/borrow-interest-rate/history', { exchange: 'Binance', symbol: 'BTC', interval: '1d', limit: 4500 });
  const brate = new Map<number, number>();
  for (const x of bor.data) { const d = Math.floor(x.time * 1000 / DAY_MS) * DAY_MS; brate.set(d, x.interest_rate); }
  await analyze('E borrow_rate(Binance)', brate, closes, 7);

  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? e); process.exit(1); });

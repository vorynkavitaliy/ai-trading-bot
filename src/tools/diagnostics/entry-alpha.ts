/**
 * entry-alpha — measure the CEILING of entry-quality improvement available on a lower
 * timeframe after each HTF (4H) fade signal. Answers "is there juice in HTF-signal +
 * LTF-entry refinement before we build it?"
 *
 * For each backtest trade (from a DUMP=1 mirror run), look at 1m bars in the window after
 * the actual entry and compute:
 *   - ceilingR: the BEST achievable entry vs the actual fill, in R (hindsight upper bound).
 *       short → how much HIGHER could we have sold; long → how much LOWER could we have bought.
 *   - filled25 / filled50: would a realistic limit 0.25R / 0.50R better than fill have been
 *       reached within the window (i.e. is a modest-better entry actually obtainable)?
 * ceilingR is a hindsight ceiling, NOT a tradeable result — it bounds the opportunity.
 *
 * Run: npx tsx src/tools/diagnostics/entry-alpha.ts <dump-file> [windowMin=60]
 */
import fs from 'node:fs';
import { query, close as closePg } from '../../core/db';

interface T { symbol: string; side: string; entry: number; sl: number; entryTs: number; }

async function main(): Promise<void> {
  const file = process.argv[2];
  const windowMin = parseInt(process.argv[3] ?? '60', 10);
  if (!file) { console.error('usage: entry-alpha.ts <dump-file> [windowMin]'); process.exit(1); }
  const text = fs.readFileSync(file, 'utf-8');
  const trades: T[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/raw:\s*(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const t = JSON.parse(m[1]);
      if (t.symbol && t.entryTs && t.sl != null && t.entry != null && t.side) {
        trades.push({ symbol: t.symbol, side: t.side, entry: t.entry, sl: t.sl, entryTs: t.entryTs });
      }
    } catch { /* skip */ }
  }
  if (!trades.length) { console.log(`no trades parsed from ${file}`); await closePg(); return; }

  const WIN = windowMin * 60_000;
  const rows: Array<{ sym: string; side: string; ceilingR: number; f25: boolean; f50: boolean }> = [];
  for (const t of trades) {
    const { rows: bars } = await query<{ high: string; low: string }>(
      `SELECT high::text, low::text FROM candles WHERE symbol=$1 AND tf='1m' AND ts >= $2 AND ts < $3 ORDER BY ts`,
      [t.symbol, t.entryTs, t.entryTs + WIN],
    );
    if (!bars.length) continue;
    const isShort = t.side === 'short';
    const stopDist = Math.abs(t.entry - t.sl);
    let best = t.entry;
    for (const b of bars) { const h = parseFloat(b.high), l = parseFloat(b.low); best = isShort ? Math.max(best, h) : Math.min(best, l); }
    const ceilingR = stopDist > 0 ? Math.abs(best - t.entry) / stopDist : 0;
    const reach = (k: number) => {
      const lim = isShort ? t.entry + k * stopDist : t.entry - k * stopDist;
      return bars.some((b) => (isShort ? parseFloat(b.high) >= lim : parseFloat(b.low) <= lim));
    };
    rows.push({ sym: t.symbol, side: t.side, ceilingR, f25: reach(0.25), f50: reach(0.50) });
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const pct = (b: boolean[]) => (b.filter(Boolean).length / Math.max(1, b.length) * 100);
  const cs = rows.map((r) => r.ceilingR);

  console.log(`\nENTRY-ALPHA CEILING — ${rows.length} trades, ${windowMin}min window after entry`);
  console.log(`(ceilingR = best obtainable entry vs actual fill, in R; HINDSIGHT upper bound)\n`);
  console.log(`  ceiling improvement:  mean ${mean(cs).toFixed(3)}R   median ${median(cs).toFixed(3)}R   max ${Math.max(...cs).toFixed(2)}R`);
  console.log(`  trades w/ ceiling >0.10R: ${pct(rows.map(r => r.ceilingR > 0.10)).toFixed(0)}%   >0.25R: ${pct(rows.map(r => r.ceilingR > 0.25)).toFixed(0)}%   >0.50R: ${pct(rows.map(r => r.ceilingR > 0.50)).toFixed(0)}%`);
  console.log(`  realistic limit fills within window:  0.25R-better ${pct(rows.map(r => r.f25)).toFixed(0)}%   0.50R-better ${pct(rows.map(r => r.f50)).toFixed(0)}%`);
  console.log(`\n  → interpretation: a 0.25R-better limit that fills X% of the time adds ~+0.25R on those`);
  console.log(`    AND skips/needs-fallback on the other (100−X)% — net edge depends on that tradeoff.\n`);

  const byPair = new Map<string, typeof rows>();
  for (const r of rows) { const a = byPair.get(r.sym) ?? []; a.push(r); byPair.set(r.sym, a); }
  console.log(`── BY PAIR ──`);
  for (const [sym, arr] of byPair) {
    console.log(`  ${sym.padEnd(8)} n=${String(arr.length).padStart(3)}  ceilMeanR ${mean(arr.map(x => x.ceilingR)).toFixed(3)}  fill0.25 ${pct(arr.map(x => x.f25)).toFixed(0)}%  fill0.50 ${pct(arr.map(x => x.f50)).toFixed(0)}%`);
  }
  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

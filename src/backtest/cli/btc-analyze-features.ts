/**
 * Step 3 of BTC WR-uplift research (2026-05-24).
 *
 * Reads /tmp/btc-trades-enriched.json. For each feature, split trades by win/loss
 * and side (long/short) and report:
 *   - mean, std, n for wins vs losses
 *   - Mann-Whitney-like rank difference (we approximate via mean comparison + Cohen's d)
 *   - Quartile WR: bin trades into Q1..Q4 by feature, report WR per quartile
 *
 * The third report is the most useful for filter design: if Q4 has WR 75% and
 * Q1 has WR 40%, threshold "trade only if feature >= Q3-cutoff" is promising.
 *
 * Output: human-readable text to stdout, plus a JSON summary to
 * /tmp/btc-feature-analysis.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Trade {
  entryTs: number;
  entryIso: string;
  side: 'long' | 'short';
  pnlR: number;
  win: boolean;
  features: Record<string, number | null>;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}
function std(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function cohensD(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  const sa = std(a), sb = std(b);
  const pooled = Math.sqrt(((a.length - 1) * sa * sa + (b.length - 1) * sb * sb) / (a.length + b.length - 2));
  return pooled > 0 ? (ma - mb) / pooled : 0;
}
function quartile(arr: number[]): [number, number, number] {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p: number) => s[Math.floor(p * (s.length - 1))];
  return [q(0.25), q(0.5), q(0.75)];
}

function reportFeature(name: string, trades: Trade[], side: 'long' | 'short' | 'all') {
  const sel = side === 'all' ? trades : trades.filter(t => t.side === side);
  const withVal = sel.filter(t => t.features[name] != null);
  const wins = withVal.filter(t => t.win);
  const losses = withVal.filter(t => !t.win);
  const winVals = wins.map(t => t.features[name] as number);
  const lossVals = losses.map(t => t.features[name] as number);

  if (winVals.length < 5 || lossVals.length < 5) return null;

  const mw = mean(winVals), ml = mean(lossVals);
  const d = cohensD(winVals, lossVals);
  const allVals = withVal.map(t => t.features[name] as number);
  const [q1, q2, q3] = quartile(allVals);

  // WR per quartile
  const buckets: Trade[][] = [[], [], [], []];
  for (const t of withVal) {
    const v = t.features[name] as number;
    if (v <= q1) buckets[0].push(t);
    else if (v <= q2) buckets[1].push(t);
    else if (v <= q3) buckets[2].push(t);
    else buckets[3].push(t);
  }
  const qWR = buckets.map(b => b.length ? (b.filter(t => t.win).length / b.length * 100) : NaN);
  const qN = buckets.map(b => b.length);
  const qSumR = buckets.map(b => b.reduce((s, t) => s + t.pnlR, 0));

  return { name, side, n: withVal.length, mw, ml, d, q1, q2, q3, qWR, qN, qSumR };
}

function printReport(rows: ReturnType<typeof reportFeature>[]) {
  console.log('feature                       side  n   mean_win  mean_loss   d       Q1WR%  Q2WR%  Q3WR%  Q4WR%   sumR_Q4');
  for (const r of rows) {
    if (!r) continue;
    const fmt = (x: number, pad = 8) => (Number.isNaN(x) ? '   nan'.padStart(pad) : x.toFixed(3).padStart(pad));
    const fmtWR = (x: number) => (Number.isNaN(x) ? '  nan' : x.toFixed(0).padStart(3) + '%');
    console.log(
      r.name.padEnd(30) +
      r.side.padEnd(5) +
      String(r.n).padStart(4) + '  ' +
      fmt(r.mw) + '  ' +
      fmt(r.ml) + '   ' +
      r.d.toFixed(2).padStart(5) + '   ' +
      `${fmtWR(r.qWR[0])}  ${fmtWR(r.qWR[1])}  ${fmtWR(r.qWR[2])}  ${fmtWR(r.qWR[3])}   ` +
      r.qSumR[3].toFixed(2).padStart(6) + ` (n=${r.qN[3]})`
    );
  }
}

async function main() {
  const raw = JSON.parse(readFileSync('/tmp/btc-trades-enriched.json', 'utf8'));
  const trades: Trade[] = raw.trades;

  const longTrades = trades.filter(t => t.side === 'long');
  const shortTrades = trades.filter(t => t.side === 'short');
  console.log(`Loaded ${trades.length} trades: ${longTrades.length} long, ${shortTrades.length} short`);
  console.log(`Base WR: long=${(longTrades.filter(t => t.win).length / longTrades.length * 100).toFixed(1)}%, short=${(shortTrades.filter(t => t.win).length / shortTrades.length * 100).toFixed(1)}%, all=${(trades.filter(t => t.win).length / trades.length * 100).toFixed(1)}%`);

  const features = Object.keys(trades[0].features);

  // Report per-side because LONG trades and SHORT trades have flipped feature
  // semantics (e.g. CB premium positive helps longs, negative helps shorts).
  const sides: ('all' | 'long' | 'short')[] = ['all', 'long', 'short'];
  const allReports: any[] = [];

  for (const side of sides) {
    const subset = side === 'all' ? trades : trades.filter(t => t.side === side);
    if (subset.length < 10) continue;
    console.log(`\n========== SIDE = ${side.toUpperCase()} (n=${subset.length}, baseWR=${(subset.filter(t => t.win).length / subset.length * 100).toFixed(1)}%) ==========`);
    const rows = features.map(f => reportFeature(f, trades, side));
    printReport(rows);
    allReports.push({ side, rows: rows.filter(r => r) });
  }

  writeFileSync('/tmp/btc-feature-analysis.json', JSON.stringify(allReports, null, 2));
  console.log('\nwrote /tmp/btc-feature-analysis.json');
}

main().catch(e => { console.error(e); process.exit(1); });

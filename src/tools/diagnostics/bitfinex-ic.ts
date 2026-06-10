/**
 * bitfinex-ic — IC / quintile-spread analysis for Bitfinex margin long/short
 * and Binance spot borrow rate (Bitfinex borrow returns 0 rows) vs forward BTC
 * returns. Daily data -> 1d/3d/7d horizons. IS/OOS split at midpoint.
 *
 * Signals tested (daily, contrarian fade hypotheses):
 *   A) ls_ratio = long_qty / short_qty           (high = crowded long -> fade short)
 *   B) long_share = long_qty / (long+short)       (same idea, bounded)
 *   C) ls_ratio_pct = 90d-rolling percentile of ls_ratio (extreme-relative)
 *   D) dLong = 1d pct change in long_qty          (margin longs piling in)
 *   E) borrow_rate (Binance spot)                 (high = crowded spot leverage -> fade)
 *   F) borrow_rate_pct = 90d-rolling percentile of borrow rate
 *
 * Forward return horizons computed from daily UTC closes built from 240m bars.
 * Orthogonality: corr(best signal, funding_oi pct) + corr(best signal, trailing
 * same-horizon return).
 *
 * Run: npx tsx src/tools/diagnostics/bitfinex-ic.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY_MS = 86_400_000;

// ---------- stats helpers ----------
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // average rank, 1-based
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length; if (n < 3) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }
function mean(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }

function rollingPct(vals: number[], win: number): number[] {
  // percentile of vals[i] within trailing window [i-win+1 .. i] inclusive
  const out: number[] = new Array(vals.length).fill(NaN);
  for (let i = 0; i < vals.length; i++) {
    const lo = Math.max(0, i - win + 1);
    const window = vals.slice(lo, i + 1);
    if (window.length < Math.min(20, win)) continue;
    const cur = vals[i];
    let below = 0; for (const w of window) if (w < cur) below++;
    out[i] = below / (window.length - 1 || 1);
  }
  return out;
}

// ---------- forward returns from daily closes ----------
interface DailyClose { ts: number; close: number; }

async function dailyCloses(): Promise<DailyClose[]> {
  // Build daily UTC closes from 240m bars (deepest coverage 2020->now).
  // Daily close = the 240m bar that closes at 24:00 UTC i.e. ts where (ts/DAY)%1==0
  // 240m bars are stamped at bar-OPEN. The bar covering 20:00-24:00 UTC opens at ts%DAY==72000000 (20h).
  // Daily close price = close of the 20:00 UTC 4h bar.
  const r = await query<any>(
    `SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const map = new Map<number, number>(); // dayStartTs -> close
  for (const row of r.rows) {
    const ts = parseInt(row.ts, 10);
    const dayStart = Math.floor(ts / DAY_MS) * DAY_MS;
    const hourOfDay = (ts - dayStart) / 3600_000;
    if (hourOfDay === 20) map.set(dayStart, parseFloat(row.close)); // 20:00 bar closes the UTC day
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([ts, close]) => ({ ts, close }));
}

// ---------- data fetch ----------
async function fetchMarginLS(): Promise<{ time: number; long: number; short: number }[]> {
  const r = await cgGet<any[]>('/bitfinex-margin-long-short', { symbol: 'BTC', interval: '1d', limit: 2000 });
  return (r.data || []).map(x => ({ time: x.time * 1000, long: x.long_quantity, short: x.short_quantity }));
}
async function fetchBorrow(exchange: string): Promise<{ time: number; rate: number }[]> {
  const r = await cgGet<any[]>('/borrow-interest-rate/history', { exchange, symbol: 'BTC', interval: '1d', limit: 4500 });
  return (r.data || []).map(x => ({ time: x.time * 1000, rate: x.interest_rate }));
}
async function fundingPctSeries(): Promise<Map<number, number>> {
  // daily funding_oi_weighted close + 90d rolling percentile, keyed by dayStart
  const r = await query<any>(
    `SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`, []);
  if (r.rows.length === 0) return new Map();
  // collapse to one value per UTC day (last of day)
  const byDay = new Map<number, number>();
  for (const row of r.rows) {
    const ts = parseInt(row.ts, 10);
    const day = Math.floor(ts / DAY_MS) * DAY_MS;
    byDay.set(day, parseFloat(row.fr_close));
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const vals = days.map(d => byDay.get(d)!);
  const pct = rollingPct(vals, 90);
  const out = new Map<number, number>();
  for (let i = 0; i < days.length; i++) if (!isNaN(pct[i])) out.set(days[i], pct[i]);
  return out;
}

// ---------- IC engine ----------
interface SigDef { name: string; values: Map<number, number>; }

function fwdReturn(closes: DailyClose[], hDays: number): Map<number, number> {
  // forward return over hDays from each day's close, keyed by dayStart
  const byDay = new Map<number, number>();
  for (const c of closes) byDay.set(c.ts, c.close);
  const days = closes.map(c => c.ts);
  const out = new Map<number, number>();
  for (const d of days) {
    const future = d + hDays * DAY_MS;
    const fc = byDay.get(future);
    const c0 = byDay.get(d);
    if (fc != null && c0 != null && c0 > 0) out.set(d, (fc - c0) / c0);
  }
  return out;
}
function trailingReturn(closes: DailyClose[], hDays: number): Map<number, number> {
  const byDay = new Map<number, number>();
  for (const c of closes) byDay.set(c.ts, c.close);
  const out = new Map<number, number>();
  for (const c of closes) {
    const past = c.ts - hDays * DAY_MS;
    const pc = byDay.get(past);
    if (pc != null && pc > 0) out.set(c.ts, (c.close - pc) / pc);
  }
  return out;
}

function alignDays(sig: Map<number, number>, fwd: Map<number, number>): { days: number[]; s: number[]; f: number[] } {
  const days: number[] = []; const s: number[] = []; const f: number[] = [];
  for (const [d, v] of sig.entries()) {
    if (isNaN(v)) continue;
    const fv = fwd.get(d);
    if (fv == null || isNaN(fv)) continue;
    days.push(d); s.push(v); f.push(fv);
  }
  // sort by day
  const order = days.map((d, i) => i).sort((a, b) => days[a] - days[b]);
  return { days: order.map(i => days[i]), s: order.map(i => s[i]), f: order.map(i => f[i]) };
}

function quintileSpread(s: number[], f: number[]): { q1: number; q5: number; spread: number; monotone: boolean } {
  const idx = s.map((v, i) => i).sort((a, b) => s[a] - s[b]);
  const n = idx.length;
  const buckets: number[][] = [[], [], [], [], []];
  for (let k = 0; k < n; k++) {
    let q = Math.floor((k / n) * 5); if (q > 4) q = 4;
    buckets[q].push(f[idx[k]]);
  }
  const means = buckets.map(b => b.length ? mean(b) : NaN);
  let monotoneUp = true, monotoneDown = true;
  for (let i = 1; i < 5; i++) { if (means[i] < means[i - 1]) monotoneUp = false; if (means[i] > means[i - 1]) monotoneDown = false; }
  return { q1: means[0], q5: means[4], spread: means[4] - means[0], monotone: monotoneUp || monotoneDown };
}

function fmt(x: number): string { return isNaN(x) ? 'NaN' : (x >= 0 ? '+' : '') + x.toFixed(4); }
function pct(x: number): string { return isNaN(x) ? 'NaN' : (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%'; }

async function main() {
  console.log('\n=== Bitfinex margin L/S + spot borrow IC analysis ===\n');

  const closes = await dailyCloses();
  console.log(`daily closes (from 240m, 20:00 UTC): ${closes.length}  span ${new Date(closes[0].ts).toISOString().slice(0, 10)}..${new Date(closes[closes.length - 1].ts).toISOString().slice(0, 10)}`);

  const ls = await fetchMarginLS();
  console.log(`margin L/S daily rows: ${ls.length}  span ${new Date(ls[0].time).toISOString().slice(0, 10)}..${new Date(ls[ls.length - 1].time).toISOString().slice(0, 10)}`);

  const borrowBin = await fetchBorrow('Binance');
  console.log(`borrow(Binance) daily rows: ${borrowBin.length}  span ${new Date(borrowBin[0].time).toISOString().slice(0, 10)}..${new Date(borrowBin[borrowBin.length - 1].time).toISOString().slice(0, 10)}`);

  const fundPct = await fundingPctSeries();
  console.log(`funding_oi pct days available: ${fundPct.size}`);

  // normalize margin times to UTC dayStart
  const lsByDay = new Map<number, { long: number; short: number }>();
  for (const x of ls) lsByDay.set(Math.floor(x.time / DAY_MS) * DAY_MS, { long: x.long, short: x.short });
  const lsDays = [...lsByDay.keys()].sort((a, b) => a - b);

  // build signal series
  const ratioVals = lsDays.map(d => { const r = lsByDay.get(d)!; return r.short > 0 ? r.long / r.short : NaN; });
  const shareVals = lsDays.map(d => { const r = lsByDay.get(d)!; const t = r.long + r.short; return t > 0 ? r.long / t : NaN; });
  const longVals = lsDays.map(d => lsByDay.get(d)!.long);
  const dLongVals = longVals.map((v, i) => i === 0 ? NaN : (longVals[i - 1] > 0 ? (v - longVals[i - 1]) / longVals[i - 1] : NaN));
  const ratioPct = rollingPct(ratioVals.map(v => isNaN(v) ? 0 : v), 90);

  const sigRatio = new Map<number, number>(); lsDays.forEach((d, i) => { if (!isNaN(ratioVals[i])) sigRatio.set(d, ratioVals[i]); });
  const sigShare = new Map<number, number>(); lsDays.forEach((d, i) => { if (!isNaN(shareVals[i])) sigShare.set(d, shareVals[i]); });
  const sigRatioPct = new Map<number, number>(); lsDays.forEach((d, i) => { if (!isNaN(ratioPct[i])) sigRatioPct.set(d, ratioPct[i]); });
  const sigDLong = new Map<number, number>(); lsDays.forEach((d, i) => { if (!isNaN(dLongVals[i])) sigDLong.set(d, dLongVals[i]); });

  const borrowByDay = new Map<number, number>();
  for (const x of borrowBin) borrowByDay.set(Math.floor(x.time / DAY_MS) * DAY_MS, x.rate);
  const bDays = [...borrowByDay.keys()].sort((a, b) => a - b);
  const bVals = bDays.map(d => borrowByDay.get(d)!);
  const bPct = rollingPct(bVals, 90);
  const sigBorrow = new Map<number, number>(); bDays.forEach((d, i) => sigBorrow.set(d, bVals[i]));
  const sigBorrowPct = new Map<number, number>(); bDays.forEach((d, i) => { if (!isNaN(bPct[i])) sigBorrowPct.set(d, bPct[i]); });

  const signals: SigDef[] = [
    { name: 'A ls_ratio (long/short)', values: sigRatio },
    { name: 'B long_share', values: sigShare },
    { name: 'C ls_ratio_pct90', values: sigRatioPct },
    { name: 'D dLong_1d', values: sigDLong },
    { name: 'E borrow_rate(Binance)', values: sigBorrow },
    { name: 'F borrow_pct90(Binance)', values: sigBorrowPct },
  ];

  const horizons = [1, 3, 7];

  // determine global day span for IS/OOS midpoint (use union of all signal days w/ fwd)
  console.log('\n--- IC table (Spearman signal vs forward return) ---');
  console.log('signal                          | hzn | N(IS/OOS) |   IC_IS   |  IC_OOS  | sameSign | qSpread_IS | qSpread_OOS');
  console.log('-'.repeat(120));

  // track best for orthogonality
  let best: { name: string; h: number; values: Map<number, number>; days: number[]; icIS: number; icOOS: number } | null = null;

  for (const sig of signals) {
    for (const h of horizons) {
      const fwd = fwdReturn(closes, h);
      const al = alignDays(sig.values, fwd);
      if (al.days.length < 40) {
        console.log(`${sig.name.padEnd(31)} | ${String(h).padStart(2)}d | ${al.days.length} total (thin)`);
        continue;
      }
      // split at midpoint by day
      const mid = Math.floor(al.days.length / 2);
      const sIS = al.s.slice(0, mid), fIS = al.f.slice(0, mid);
      const sOOS = al.s.slice(mid), fOOS = al.f.slice(mid);
      const icIS = spearman(sIS, fIS);
      const icOOS = spearman(sOOS, fOOS);
      const qIS = quintileSpread(sIS, fIS);
      const qOOS = quintileSpread(sOOS, fOOS);
      const same = (Math.sign(icIS) === Math.sign(icOOS)) ? 'YES' : 'no';
      console.log(`${sig.name.padEnd(31)} | ${String(h).padStart(2)}d | ${String(mid).padStart(3)}/${String(al.days.length - mid).padStart(3)}  | ${fmt(icIS).padStart(8)} | ${fmt(icOOS).padStart(8)} |   ${same.padEnd(4)}  | ${pct(qIS.spread).padStart(9)}  | ${pct(qOOS.spread).padStart(9)}`);

      // candidate for best: strongest |IC_OOS| among same-sign with |IC|>=0.05 both
      const passes = same === 'YES' && Math.abs(icIS) >= 0.05 && Math.abs(icOOS) >= 0.05;
      if (passes) {
        if (!best || Math.abs(icOOS) > Math.abs(best.icOOS)) {
          best = { name: `${sig.name} @${h}d`, h, values: sig.values, days: al.days, icIS, icOOS };
        }
      }
    }
  }

  // ---- orthogonality of best ----
  console.log('\n--- orthogonality ---');
  if (!best) {
    console.log('No signal cleared |IC|>=0.05 same-sign on BOTH halves. No best candidate for orthogonality.');
    // still report orthogonality for the nominally strongest by |IC_OOS| even if not passing, for context
  } else {
    console.log(`best passing signal: ${best.name}  IC_IS=${fmt(best.icIS)} IC_OOS=${fmt(best.icOOS)}`);
    // corr vs funding_oi pct (same days)
    const fpDays: number[] = []; const sv: number[] = []; const fv: number[] = [];
    for (const d of best.days) {
      const s = best.values.get(d); const fp = fundPct.get(d);
      if (s != null && !isNaN(s) && fp != null && !isNaN(fp)) { fpDays.push(d); sv.push(s); fv.push(fp); }
    }
    if (sv.length >= 20) console.log(`corr(best, funding_oi_pct) Spearman = ${fmt(spearman(sv, fv))}  (n=${sv.length})`);
    else console.log(`corr(best, funding_oi_pct): insufficient overlap (n=${sv.length})`);

    // corr vs trailing same-horizon return
    const tr = trailingReturn(closes, best.h);
    const td: number[] = []; const ts2: number[] = []; const tt: number[] = [];
    for (const d of best.days) {
      const s = best.values.get(d); const t = tr.get(d);
      if (s != null && !isNaN(s) && t != null && !isNaN(t)) { td.push(d); ts2.push(s); tt.push(t); }
    }
    if (ts2.length >= 20) console.log(`corr(best, trailing ${best.h}d return) Spearman = ${fmt(spearman(ts2, tt))}  (n=${ts2.length})  [lagged-momentum check]`);
    else console.log(`corr(best, trailing return): insufficient overlap (n=${ts2.length})`);
  }

  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? e); process.exit(1); });

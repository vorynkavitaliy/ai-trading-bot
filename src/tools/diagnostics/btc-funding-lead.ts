/**
 * btc-funding-lead — focused confirmation of the one cross-asset candidate:
 * does BTC's funding_oi (raw) at time t predict an ALT's forward 48h return,
 * stably on both halves, with a tradeable quintile spread — and is it ADDITIVE
 * to the alt's own funding fade (i.e. distinct edge, not the same thing)?
 *
 * Reports, per alt, split IS/OOS:
 *   - IC(BTC funding_oi, alt fwd48h)         [the lead signal]
 *   - IC(alt funding_oi, alt fwd48h)         [own fade, for comparison]
 *   - quintile fwd48h% spread of BTC-funding buckets (Q5=BTC most-positive funding)
 *   - "both agree" bucket: alt fwd48h mean when BTC funding HIGH AND alt funding HIGH
 *     (expect most negative — strongest short) vs BOTH LOW (expect most positive)
 *
 * Run: npx tsx src/tools/diagnostics/btc-funding-lead.ts
 */
import { query, close as closePg } from '../../core/db';

type Row = { ts: number; val: number };
const ALTS = ['SOLUSDT', 'ARBUSDT', 'INJUSDT', 'XRPUSDT', 'LINKUSDT'];

function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) { while (j < series.length && series[j].ts <= barTs[i]) j++; out[i] = j > 0 ? series[j - 1].val : null; }
  return out;
}
function alignByTs(altTs: number[], btcTs: number[], btcVal: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(altTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < altTs.length; i++) { while (j < btcTs.length && btcTs[j] <= altTs[i]) j++; out[i] = j > 0 ? btcVal[j - 1] : null; }
  return out;
}
function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length); for (let k = 0; k < idx.length; k++) r[idx[k][1]] = k + 1; return r;
}
function spearman(x: (number | null)[], y: (number | null)[]): number {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } }
  const n = xs.length; if (n < 40) return NaN;
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return num / Math.sqrt(dx * dy);
}
function quintileSpread(sig: (number | null)[], fwd: (number | null)[]): number {
  const pairs: [number, number][] = [];
  for (let i = 0; i < sig.length; i++) { const a = sig[i], b = fwd[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) pairs.push([a, b]); }
  pairs.sort((a, b) => a[0] - b[0]); const n = pairs.length; if (n < 50) return NaN;
  const q: number[] = [];
  for (let bk = 0; bk < 5; bk++) { const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5); let s = 0; for (let i = lo; i < hi; i++) s += pairs[i][1]; q.push((s / (hi - lo)) * 100); }
  return q[4] - q[0];
}
async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}
function rollingPct(vals: (number | null)[], lb: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const cur = vals[i]; if (cur == null || !isFinite(cur)) continue;
    let cnt = 0, le = 0;
    for (let k = Math.max(0, i - lb + 1); k <= i; k++) { const v = vals[k]; if (v == null || !isFinite(v)) continue; cnt++; if (v <= cur) le++; }
    if (cnt >= 20) out[i] = le / cnt;
  }
  return out;
}
const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : ' NaN').padStart(6);

async function main() {
  // BTC
  const btcC = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const btcTs = btcC.rows.map((r: any) => Number(r.ts));
  const btcClose = btcC.rows.map((r: any) => parseFloat(r.close));
  const btcFund = alignLatest(btcTs, await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts`, []));
  const btcFundPct = rollingPct(btcFund, 180);

  console.log(`\n══ BTC-FUNDING-LEAD confirmation (BTC funding_oi at t → ALT fwd48h) ══`);
  console.log(`NEG IC ⇒ high BTC funding precedes alt DROP. Want same-sign IS&OOS for ALL alts + tradeable spread.\n`);
  console.log('alt'.padEnd(9) + '│ IC(BTCfund→altF48)  │ IC(altOwnFund→altF48)│ BTCfund Q5−Q1 f48% │ both-HIGH / both-LOW mean f48%');
  console.log('─'.repeat(108));

  for (const alt of ALTS) {
    const coin = alt.replace('USDT', '');
    const c = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [alt]);
    const ts = c.rows.map((r: any) => Number(r.ts));
    const close = c.rows.map((r: any) => parseFloat(r.close));
    const N = ts.length;
    const altFund = alignLatest(ts, await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]));
    const altFundPct = rollingPct(altFund, 180);
    const aBtcFund = alignByTs(ts, btcTs, btcFund);
    const aBtcFundPct = alignByTs(ts, btcTs, btcFundPct);
    const fwd48: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + 12 < N; i++) if (close[i] > 0) fwd48[i] = (close[i + 12] - close[i]) / close[i];

    const cgIdx = ts.map((_, i) => i).filter(i => altFund[i] != null);
    const midTs = cgIdx.length ? ts[cgIdx[Math.floor(cgIdx.length / 2)]] : ts[Math.floor(N / 2)];
    const half = (arr: (number | null)[], h: 'IS' | 'OOS') => arr.map((v, i) => ((h === 'IS' ? ts[i] < midTs : ts[i] >= midTs) ? v : null));

    const icBtcIS = spearman(half(aBtcFund, 'IS'), fwd48);
    const icBtcOOS = spearman(half(aBtcFund, 'OOS'), fwd48);
    const icOwnIS = spearman(half(altFund, 'IS'), fwd48);
    const icOwnOOS = spearman(half(altFund, 'OOS'), fwd48);
    const qIS = quintileSpread(half(aBtcFund, 'IS'), fwd48);
    const qOOS = quintileSpread(half(aBtcFund, 'OOS'), fwd48);

    // both-agree buckets using percentiles (BTC pct & alt pct both >=0.7 or both <=0.3), full sample
    let hiSum = 0, hiN = 0, loSum = 0, loN = 0;
    for (let i = 0; i < N; i++) {
      const bp = aBtcFundPct[i], ap = altFundPct[i], r = fwd48[i];
      if (bp == null || ap == null || r == null) continue;
      if (bp >= 0.7 && ap >= 0.7) { hiSum += r; hiN++; }
      if (bp <= 0.3 && ap <= 0.3) { loSum += r; loN++; }
    }
    const hiMean = hiN ? (hiSum / hiN) * 100 : NaN;
    const loMean = loN ? (loSum / loN) * 100 : NaN;
    const btcStable = isFinite(icBtcIS) && isFinite(icBtcOOS) && Math.sign(icBtcIS) === Math.sign(icBtcOOS) && Math.abs(icBtcIS) >= 0.03 && Math.abs(icBtcOOS) >= 0.05;

    console.log(
      alt.padEnd(9) + '│ ' + f(icBtcIS) + '/' + f(icBtcOOS) + (btcStable ? ' ✓' : '  ') + '   │ ' +
      f(icOwnIS) + '/' + f(icOwnOOS) + '   │ ' +
      (isFinite(qIS) ? f(qIS) : ' NaN') + '/' + (isFinite(qOOS) ? f(qOOS) : ' NaN') + '  │ ' +
      (isFinite(hiMean) ? (hiMean >= 0 ? '+' : '') + hiMean.toFixed(2) : 'NaN').padStart(6) + ` (n${hiN}) / ` +
      (isFinite(loMean) ? (loMean >= 0 ? '+' : '') + loMean.toFixed(2) : 'NaN').padStart(6) + ` (n${loN})`,
    );
  }
  console.log(`\nbothHIGH = BTC funding pct≥.7 AND alt funding pct≥.7 (crowd-long both) → expect NEG fwd48 (short).`);
  console.log(`bothLOW  = both ≤.3 (crowd-short both) → expect POS fwd48 (long). Gap = directional payoff of the joint-crowd gate.`);
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

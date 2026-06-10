/**
 * btc-gate-additive — is the BTC-funding agreement gate ADDITIVE to the alt's own
 * funding fade, or redundant? Compare alt fwd48h directional payoff:
 *   (1) alt funding ALONE: alt pct≥.7 (short) vs ≤.3 (long)  → gap_own
 *   (2) alt funding + BTC funding AGREE: both≥.7 vs both≤.3  → gap_joint
 * If gap_joint > gap_own on BOTH IS and OOS for most alts, the BTC condition adds
 * conviction (selects the trades where both crowds are stretched the same way).
 * Reports IS and OOS separately. Read-only.
 *
 * Run: npx tsx src/tools/diagnostics/btc-gate-additive.ts
 */
import { query, close as closePg } from '../../core/db';
type Row = { ts: number; val: number };
const ALTS = ['SOLUSDT', 'ARBUSDT', 'INJUSDT', 'XRPUSDT', 'LINKUSDT'];

function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0; for (let i = 0; i < barTs.length; i++) { while (j < series.length && series[j].ts <= barTs[i]) j++; out[i] = j > 0 ? series[j - 1].val : null; } return out;
}
function alignByTs(altTs: number[], btcTs: number[], btcVal: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(altTs.length).fill(null);
  let j = 0; for (let i = 0; i < altTs.length; i++) { while (j < btcTs.length && btcTs[j] <= altTs[i]) j++; out[i] = j > 0 ? btcVal[j - 1] : null; } return out;
}
async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}
function rollingPct(vals: (number | null)[], lb: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const cur = vals[i]; if (cur == null || !isFinite(cur)) continue; let cnt = 0, le = 0;
    for (let k = Math.max(0, i - lb + 1); k <= i; k++) { const v = vals[k]; if (v == null || !isFinite(v)) continue; cnt++; if (v <= cur) le++; }
    if (cnt >= 20) out[i] = le / cnt;
  }
  return out;
}
// mean fwd48 (%) over bars passing a mask within a half
function meanFwd(mask: boolean[], fwd: (number | null)[], inH: boolean[]): { m: number; n: number } {
  let s = 0, n = 0; for (let i = 0; i < mask.length; i++) { if (mask[i] && inH[i] && fwd[i] != null) { s += fwd[i]!; n++; } } return { m: n ? (s / n) * 100 : NaN, n };
}
const p2 = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : ' NaN').padStart(6);

async function main() {
  const btcC = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const btcTs = btcC.rows.map((r: any) => Number(r.ts));
  const btcFundPct = rollingPct(alignLatest(btcTs, await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts`, [])), 180);

  console.log(`\n══ IS the BTC-funding agreement gate ADDITIVE to alt own-funding fade? (fwd48h directional gap) ══`);
  console.log(`gap = mean fwd48 of SHORT-bucket(crowd-long) − LONG-bucket(crowd-short). MORE NEGATIVE short / MORE POSITIVE long ⇒ bigger gap ⇒ better.`);
  console.log(`Want gap_joint > gap_own (BTC condition adds conviction) on BOTH IS and OOS.\n`);
  console.log('alt'.padEnd(9) + '│   gap_own IS / OOS    │  gap_joint IS / OOS   │ joint better? IS/OOS');
  console.log('─'.repeat(82));

  for (const alt of ALTS) {
    const coin = alt.replace('USDT', '');
    const c = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [alt]);
    const ts = c.rows.map((r: any) => Number(r.ts));
    const close = c.rows.map((r: any) => parseFloat(r.close));
    const N = ts.length;
    const altFundPct = rollingPct(alignLatest(ts, await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin])), 180);
    const aBtcPct = alignByTs(ts, btcTs, btcFundPct);
    const fwd48: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + 12 < N; i++) if (close[i] > 0) fwd48[i] = (close[i + 12] - close[i]) / close[i];

    const cgIdx = ts.map((_, i) => i).filter(i => altFundPct[i] != null);
    const midTs = cgIdx.length ? ts[cgIdx[Math.floor(cgIdx.length / 2)]] : ts[Math.floor(N / 2)];
    const isH = ts.map(t => t < midTs), oosH = ts.map(t => t >= midTs);

    const ownShort = altFundPct.map(v => v != null && v >= 0.7);
    const ownLong = altFundPct.map(v => v != null && v <= 0.3);
    const jointShort = altFundPct.map((v, i) => v != null && v >= 0.7 && aBtcPct[i] != null && aBtcPct[i]! >= 0.7);
    const jointLong = altFundPct.map((v, i) => v != null && v <= 0.3 && aBtcPct[i] != null && aBtcPct[i]! <= 0.3);

    const gap = (sh: boolean[], lo: boolean[], h: boolean[]) => meanFwd(lo, fwd48, h).m - meanFwd(sh, fwd48, h).m; // long − short; positive = correct direction
    const gapOwnIS = gap(ownShort, ownLong, isH), gapOwnOOS = gap(ownShort, ownLong, oosH);
    const gapJtIS = gap(jointShort, jointLong, isH), gapJtOOS = gap(jointShort, jointLong, oosH);

    console.log(
      alt.padEnd(9) + '│  ' + p2(gapOwnIS) + ' / ' + p2(gapOwnOOS) + '     │  ' + p2(gapJtIS) + ' / ' + p2(gapJtOOS) + '     │ ' +
      (gapJtIS > gapOwnIS ? 'YES' : 'no ') + ' / ' + (gapJtOOS > gapOwnOOS ? 'YES' : 'no '),
    );
  }
  console.log(`\n(positive gap = crowd-short bucket outperforms crowd-long bucket, i.e. fade pays. joint uses BTC+alt funding both stretched same way.)`);
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

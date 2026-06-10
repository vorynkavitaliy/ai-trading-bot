/**
 * regime-btcdown-verify — the only regime cut that survived was BTC-DOWN (EMA20<EMA50 on BTC 4H):
 * funding-fade IC is consistently MORE NEGATIVE in BTC-DOWN than BTC-UP across pairs, on both halves.
 * This script quantifies the LIFT: for each pair+signal it reports the fwd-24h quintile spread
 * (Q5-Q1, % return of fading the top vs bottom signal quintile) UNCONDITIONAL vs BTC-DOWN-only vs
 * BTC-UP-only, split IS/OOS. If BTC-DOWN consistently makes the (negative) spread MORE negative on
 * BOTH halves => a robust regime FILTER for the funding fade. Read-only.
 */
import { query, close as closePg } from '../../core/db';

type Row = { ts: number; val: number };
function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) { while (j < series.length && series[j].ts <= barTs[i]) j++; out[i] = j > 0 ? series[j - 1].val : null; }
  return out;
}
async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}
function emaSeries(values: number[], period: number): (number | null)[] {
  const N = values.length; const out: (number | null)[] = new Array(N).fill(null); if (N < period) return out;
  const k = 2 / (period + 1); let e = 0; for (let i = 0; i < period; i++) e += values[i]; e /= period; out[period - 1] = e;
  for (let i = period; i < N; i++) { e = values[i] * k + e * (1 - k); out[i] = e; } return out;
}
// quintile spread restricted to mask
function qSpread(sig: (number | null)[], fwd: (number | null)[], mask: boolean[]): { spread: number; n: number; topMean: number; botMean: number } {
  const pairs: [number, number][] = [];
  for (let i = 0; i < sig.length; i++) { if (!mask[i]) continue; const a = sig[i], b = fwd[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) pairs.push([a, b]); }
  pairs.sort((x, y) => x[0] - y[0]); const n = pairs.length;
  if (n < 40) return { spread: NaN, n, topMean: NaN, botMean: NaN };
  const lo = Math.floor(n / 5), hiStart = Math.floor(4 * n / 5);
  let bot = 0; for (let i = 0; i < lo; i++) bot += pairs[i][1]; bot /= lo;
  let top = 0; for (let i = hiStart; i < n; i++) top += pairs[i][1]; top /= (n - hiStart);
  return { spread: (top - bot) * 100, n, topMean: top * 100, botMean: bot * 100 };
}

const PAIRS = ['ADAUSDT', 'LINKUSDT'];

async function main() {
  const btcCndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const btcTs = btcCndl.rows.map((r: any) => Number(r.ts));
  const btcClose = btcCndl.rows.map((r: any) => parseFloat(r.close));
  const e20 = emaSeries(btcClose, 20), e50 = emaSeries(btcClose, 50);
  const btcUpByTs = new Map<number, boolean | null>();
  for (let i = 0; i < btcTs.length; i++) btcUpByTs.set(btcTs[i], e20[i] != null && e50[i] != null ? e20[i]! > e50[i]! : null);

  console.log(`\nFwd-24h fade quintile spread (Q5-Q1, %). Fade signal => want NEGATIVE spread (top quintile underperforms).`);
  console.log(`Robust BTC-DOWN filter => BTC-DOWN spread more negative than UNCOND on BOTH IS and OOS.\n`);
  console.log('pair    signal      half │  UNCOND (n)      │  BTC-DOWN (n)    │  BTC-UP (n)      │ down-vs-uncond');
  console.log('─'.repeat(110));

  for (const pair of PAIRS) {
    const coin = pair.replace(/USDT$/, '');
    const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
    const barTs = cndl.rows.map((r: any) => Number(r.ts));
    const close = cndl.rows.map((r: any) => parseFloat(r.close));
    const N = barTs.length;
    const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
    const fundVol = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_vol_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
    const aFundOi = alignLatest(barTs, fundOi), aFundVol = alignLatest(barTs, fundVol);
    const fwd24: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + 6 < N; i++) if (close[i] > 0) fwd24[i] = (close[i + 6] - close[i]) / close[i];
    const cgIdx = barTs.map((_, i) => i).filter(i => aFundOi[i] != null);
    const midTs = cgIdx.length ? barTs[cgIdx[Math.floor(cgIdx.length / 2)]] : barTs[Math.floor(N / 2)];
    const isHalf = barTs.map(t => t < midTs);
    const btcUp: (boolean | null)[] = barTs.map(t => btcUpByTs.has(t) ? btcUpByTs.get(t)! : null);

    for (const [sname, vals] of [['funding_oi', aFundOi], ['funding_vol', aFundVol]] as [string, (number | null)[]][]) {
      for (const half of ['IS', 'OOS'] as const) {
        const inHalf = (i: number) => half === 'IS' ? isHalf[i] : !isHalf[i];
        const mAll = barTs.map((_, i) => inHalf(i));
        const mDown = barTs.map((_, i) => inHalf(i) && btcUp[i] === false);
        const mUp = barTs.map((_, i) => inHalf(i) && btcUp[i] === true);
        const all = qSpread(vals, fwd24, mAll), down = qSpread(vals, fwd24, mDown), up = qSpread(vals, fwd24, mUp);
        const f = (r: { spread: number; n: number }) => (isFinite(r.spread) ? (r.spread >= 0 ? '+' : '') + r.spread.toFixed(2) : 'NaN').padStart(7) + ' (' + String(r.n).padStart(4) + ')';
        const lift = isFinite(down.spread) && isFinite(all.spread) ? (down.spread - all.spread) : NaN;
        const verdict = isFinite(lift) ? (lift < -0.1 ? '↓ better fade' : lift > 0.1 ? '↑ worse' : '~flat') : '';
        console.log(
          (sname === 'funding_oi' && half === 'IS' ? pair : '').padEnd(8) +
          (half === 'IS' ? sname : '').padEnd(12) + half.padEnd(4) + ' │ ' +
          f(all) + '   │ ' + f(down) + '   │ ' + f(up) + '   │ ' +
          (isFinite(lift) ? (lift >= 0 ? '+' : '') + lift.toFixed(2) : 'NaN') + '  ' + verdict,
        );
      }
    }
    console.log('─'.repeat(110));
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

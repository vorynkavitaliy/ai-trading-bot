/**
 * spot-flow-sol-robust — robustness drill on the surviving SOL candidate
 * (spot_taker_imb, the parameter-free per-bar spot taker imbalance) and spot_cvd_z.
 * Splits the 360d history into 4 quarters and reports IC per quarter (regime check),
 * plus quintile mean fwd-returns (direction + monotonicity) on each half.
 * Also re-runs the same drill on BTC and ETH for the same signal to contextualize.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/spot-flow-sol-robust.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const COINS = ['SOL', 'BTC', 'ETH'];
const H = 6; // 24h, the horizon where spot_taker_imb was cleanest on SOL
const ROLL = 180;

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function pearson(a: number[], b: number[]): number { const n = a.length; if (n < 3) return NaN; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db); }
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }
function cleanPair(a: number[], b: number[]): [number[], number[]] { const A: number[] = [], B: number[] = []; for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { A.push(a[i]); B.push(b[i]); } return [A, B]; }
function rollingZ(xs: number[]): number[] { const out = new Array(xs.length).fill(NaN); for (let i = 0; i < xs.length; i++) { const win = xs.slice(Math.max(0, i - ROLL + 1), i + 1); if (win.length < 20) continue; let m = 0; for (const v of win) m += v; m /= win.length; let s = 0; for (const v of win) s += (v - m) * (v - m); s = Math.sqrt(s / win.length); out[i] = s === 0 ? 0 : (xs[i] - m) / s; } return out; }
function quintileMeans(sig: number[], ret: number[]): number[] { const A: number[] = [], B: number[] = []; for (let i = 0; i < sig.length; i++) if (Number.isFinite(sig[i]) && Number.isFinite(ret[i])) { A.push(sig[i]); B.push(ret[i]); } const idx = A.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const q = 5; const means: number[] = []; for (let k = 0; k < q; k++) { const lo = Math.floor((k * idx.length) / q), hi = Math.floor(((k + 1) * idx.length) / q); let sum = 0, c = 0; for (let t = lo; t < hi; t++) { sum += B[idx[t][1]]; c++; } means.push(c ? sum / c : NaN); } return means; }

async function fetchSpot(coin: string) { const r = await cgGet<any>('/spot/aggregated-cvd/history', { exchange_list: 'Binance', symbol: coin, interval: '4h', limit: 3000 }); return (r.data ?? []).map((d: any) => ({ time: d.time, buy: d.agg_taker_buy_vol, sell: d.agg_taker_sell_vol })); }
async function closes(pair: string): Promise<Map<number, number>> { const r = await query<any>(`SELECT ts, close::float c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]); const m = new Map<number, number>(); for (const x of r.rows) m.set(Number(x.ts), x.c as number); return m; }

async function main() {
  console.log(`=== spot-flow-sol-robust  (horizon=${H} bars = 24h) ===\n`);
  for (const coin of COINS) {
    const pair = coin + 'USDT';
    const [spot, cl] = await Promise.all([fetchSpot(coin), closes(pair)]);
    const rows = spot.filter((s: any) => cl.has(s.time));
    const times = rows.map((r: any) => r.time);
    const closeArr = times.map((t: number) => cl.get(t)!);
    const n = times.length;
    const imb = rows.map((r: any) => { const d = r.buy + r.sell; return d === 0 ? 0 : (r.buy - r.sell) / d; });
    const net = rows.map((r: any) => r.buy - r.sell); const cvdZ = rollingZ(net);
    const fwd: number[] = new Array(n).fill(NaN); for (let i = 0; i + H < n; i++) fwd[i] = closeArr[i + H] / closeArr[i] - 1;

    console.log(`--- ${coin} (n=${n}, ${(((times[n-1]-times[0])/86400000)).toFixed(0)}d) ---`);
    // quarter ICs
    for (const [label, sig] of [['spot_taker_imb', imb], ['spot_cvd_z', cvdZ]] as [string, number[]][]) {
      const qSize = Math.floor(n / 4); const qics: string[] = [];
      for (let qi = 0; qi < 4; qi++) {
        const lo = qi * qSize, hi = qi === 3 ? n : (qi + 1) * qSize;
        const [x, y] = cleanPair(sig.slice(lo, hi), fwd.slice(lo, hi));
        qics.push(spearman(x, y).toFixed(4).padStart(8));
      }
      // half ICs
      const mid = Math.floor(n / 2);
      const [xi, yi] = cleanPair(sig.slice(0, mid), fwd.slice(0, mid));
      const [xo, yo] = cleanPair(sig.slice(mid), fwd.slice(mid));
      console.log(`  ${label.padEnd(15)} quarter ICs: ${qics.join(' ')}   |  IS=${spearman(xi, yi).toFixed(4)} OOS=${spearman(xo, yo).toFixed(4)}`);
      const qmIS = quintileMeans(sig.slice(0, mid), fwd.slice(0, mid)).map(v => (v * 100).toFixed(2) + '%');
      const qmOOS = quintileMeans(sig.slice(mid), fwd.slice(mid)).map(v => (v * 100).toFixed(2) + '%');
      console.log(`  ${' '.repeat(15)} quintile fwd-ret IS : [${qmIS.join(', ')}]`);
      console.log(`  ${' '.repeat(15)} quintile fwd-ret OOS: [${qmOOS.join(', ')}]`);
    }
    console.log('');
  }
  process.exit(0);
}
main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });

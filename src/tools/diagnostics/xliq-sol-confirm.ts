/**
 * xliq-sol-confirm — final confirmation of the SOL cvdDelta@24h FOLLOW survivor.
 *  - quintile fwd-ret table both halves (tradable spread, directional?)
 *  - extend to ETH/BNB/XRP (other liquid alts) to see if it's a SOL fluke or a
 *    high-volume-alt order-flow-momentum pattern.
 *  - also test 12h horizon for SOL (shorter is often where flow momentum lives).
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close } from '../../core/db';

const EX = 'Binance,OKX,Bybit';

function spearman(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 8) return NaN;
  const rank = (arr: number[]): number[] => { const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array<number>(arr.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const rx = rank(xs), ry = rank(ys); const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0; for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  return (vx === 0 || vy === 0) ? NaN : cov / Math.sqrt(vx * vy);
}
function qmeans(xs: number[], ys: number[]): number[] {
  const n = xs.length; const order = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]).map(p => p[1]); const q = Math.floor(n / 5); const m: number[] = [];
  for (let b = 0; b < 5; b++) { const lo = b * q, hi = b === 4 ? n : (b + 1) * q; let s = 0; for (let i = lo; i < hi; i++) s += ys[order[i]]; m.push((s / (hi - lo)) * 100); } return m;
}

async function run(sym: string, cgSym: string, Hh: number) {
  const bars = await loadBars(sym, '240m', { limit: 4500 });
  if (!bars.length) { console.log(`  ${sym}: no candles`); return; }
  const cb = new Map<number, number>(); for (const b of bars) cb.set(b.ts, b.close);
  const takR = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', { symbol: cgSym, exchange_list: EX, interval: '4h', limit: 4500 });
  const tak = new Map<number, [number, number]>(); for (const r of takR.data || []) tak.set(r.time, [+r.aggregated_buy_volume_usd, +r.aggregated_sell_volume_usd]);
  const ts = bars.map(b => b.ts).sort((a, b) => a - b);
  const A: { ts: number; close: number; buy: number; sell: number }[] = [];
  for (const t of ts) { const k = tak.get(t), c = cb.get(t); if (k && c !== undefined) A.push({ ts: t, close: c, buy: k[0], sell: k[1] }); }
  const N = A.length; if (N < 200) { console.log(`  ${sym}: thin aligned (${N})`); return; }
  const cvd = A.map(a => { const s = a.buy + a.sell; return s > 0 ? (a.buy - a.sell) / s : 0; });
  const k = Hh / 4; const fwd = A.map((a, i) => i + k < N ? (A[i + k].close - a.close) / a.close : NaN);
  const valid: number[] = []; for (let i = 0; i + k < N; i++) if (Number.isFinite(cvd[i]) && Number.isFinite(fwd[i])) valid.push(i);
  const mid = Math.floor(N / 2); const is = valid.filter(i => i < mid), oos = valid.filter(i => i >= mid);
  const icIS = spearman(is.map(i => cvd[i]), is.map(i => fwd[i])), icOOS = spearman(oos.map(i => cvd[i]), oos.map(i => fwd[i]));
  const qIS = qmeans(is.map(i => cvd[i]), is.map(i => fwd[i])), qOOS = qmeans(oos.map(i => cvd[i]), oos.map(i => fwd[i]));
  console.log(`  ${sym.padEnd(9)} H${Hh}  icIS=${icIS.toFixed(3)} icOOS=${icOOS.toFixed(3)}  spreadIS=${(qIS[4]-qIS[0]).toFixed(2)}% spreadOOS=${(qOOS[4]-qOOS[0]).toFixed(2)}%`);
  console.log(`           qIS =[${qIS.map(x=>x.toFixed(2)).join(', ')}]`);
  console.log(`           qOOS=[${qOOS.map(x=>x.toFixed(2)).join(', ')}]`);
}

async function main() {
  console.log('=== SOL cvdDelta — multi-horizon ===');
  for (const H of [12, 24, 48]) await run('SOLUSDT', 'SOL', H);
  console.log('\n=== cvdDelta@24h across liquid alts (is SOL a fluke?) ===');
  for (const [s, c] of [['SOLUSDT','SOL'],['ETHUSDT','ETH'],['BNBUSDT','BNB'],['XRPUSDT','XRP'],['ADAUSDT','ADA'],['LINKUSDT','LINK'],['BTCUSDT','BTC']] as [string,string][]) await run(s, c, 24);
  await close();
}

main().catch(async e => { console.error('crashed', e?.message ?? String(e)); await close(); process.exit(1); });

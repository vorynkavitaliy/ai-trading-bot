/**
 * xliq-quarters — apply a STRICTER stability gate to the whole family: for every
 * (pair, signal, horizon) compute IC in 4 chronological quarters and flag only
 * those where all 4 quarters share the same sign AND median |IC| across quarters
 * >= 0.05. This kills midpoint-straddle false positives.
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close } from '../../core/db';

const EX = 'Binance,OKX,Bybit';
const ZWIN = 30;

function spearman(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 8) return NaN;
  const rank = (arr: number[]): number[] => { const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array<number>(arr.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const rx = rank(xs), ry = rank(ys); const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0; for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  return (vx === 0 || vy === 0) ? NaN : cov / Math.sqrt(vx * vy);
}

async function fetch2(sym: string) {
  const liqR = await cgGet<any[]>('/futures/liquidation/aggregated-history', { symbol: sym, exchange_list: EX, interval: '4h', limit: 4500 });
  const takR = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', { symbol: sym, exchange_list: EX, interval: '4h', limit: 4500 });
  const liq = new Map<number, [number, number]>(); for (const r of liqR.data || []) liq.set(r.time, [+r.aggregated_long_liquidation_usd, +r.aggregated_short_liquidation_usd]);
  const tak = new Map<number, [number, number]>(); for (const r of takR.data || []) tak.set(r.time, [+r.aggregated_buy_volume_usd, +r.aggregated_sell_volume_usd]);
  return { liq, tak };
}

async function run(sym: string, cgSym: string, out: string[]) {
  const bars = await loadBars(sym, '240m', { limit: 4500 });
  const cb = new Map<number, number>(); for (const b of bars) cb.set(b.ts, b.close);
  const { liq, tak } = await fetch2(cgSym);
  const ts = bars.map(b => b.ts).sort((a, b) => a - b);
  const A: { ts: number; close: number; ll: number; sl: number; buy: number; sell: number }[] = [];
  for (const t of ts) { const l = liq.get(t), k = tak.get(t), c = cb.get(t); if (l && k && c !== undefined) A.push({ ts: t, close: c, ll: l[0], sl: l[1], buy: k[0], sell: k[1] }); }
  const N = A.length; if (N < 200) return;

  const z = (s: number[], i: number) => { const lo = Math.max(0, i - ZWIN); const w = s.slice(lo, i); if (w.length < 10) return NaN; const m = w.reduce((a, b) => a + b, 0) / w.length; const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length); return sd === 0 ? NaN : (s[i] - m) / sd; };
  const ll = A.map(a => a.ll), sl = A.map(a => a.sl);
  const cvdRaw = A.map(a => { const s = a.buy + a.sell; return s > 0 ? (a.buy - a.sell) / s : 0; });

  const sigs: { name: string; vals: number[] }[] = [
    { name: 'zLongLiq', vals: A.map((_, i) => z(ll, i)) },
    { name: 'zShortLiq', vals: A.map((_, i) => z(sl, i)) },
    { name: 'liqImbalance', vals: A.map(a => { const s = a.ll + a.sl; return s > 0 ? (a.ll - a.sl) / s : NaN; }) },
    { name: 'cvdDelta', vals: cvdRaw },
    { name: 'zCvdDelta', vals: A.map((_, i) => z(cvdRaw, i)) },
    { name: 'cvd6barSum', vals: A.map((_, i) => { let s = 0; for (let k = Math.max(0, i - 5); k <= i; k++) s += cvdRaw[k]; return s; }) },
  ];

  for (const Hh of [24, 48]) {
    const k = Hh / 4;
    const fwd = A.map((a, i) => i + k < N ? (A[i + k].close - a.close) / a.close : NaN);
    for (const sg of sigs) {
      const valid: number[] = []; for (let i = ZWIN; i + k < N; i++) if (Number.isFinite(sg.vals[i]) && Number.isFinite(fwd[i])) valid.push(i);
      if (valid.length < 200) continue;
      const qics: number[] = [];
      for (let q = 0; q < 4; q++) { const idx = valid.filter(i => Math.floor((i / N) * 4) === q); if (idx.length < 25) { qics.push(NaN); continue; } qics.push(spearman(idx.map(i => sg.vals[i]), idx.map(i => fwd[i]))); }
      const fin = qics.filter(Number.isFinite);
      const sameSign = fin.length === 4 && fin.every(x => Math.sign(x) === Math.sign(fin[0]));
      const med = [...fin.map(Math.abs)].sort((a, b) => a - b)[Math.floor(fin.length / 2)];
      const tag = sameSign && med >= 0.05 ? '  <-- STABLE' : '';
      out.push(`${sym.padEnd(9)} ${sg.name.padEnd(13)} H${Hh}  Q=[${qics.map(x => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : 'NaN').padStart(5)).join(' ')}]  sameSign=${sameSign?'Y':'.'}${tag}`);
    }
  }
}

async function main() {
  const out: string[] = [];
  for (const [s, c] of [['BTCUSDT', 'BTC'], ['SOLUSDT', 'SOL'], ['ADAUSDT', 'ADA'], ['LINKUSDT', 'LINK']] as [string, string][]) {
    try { await run(s, c, out); } catch (e: any) { out.push(`${s} ERR ${e?.message}`); }
  }
  console.log('=== 4-quarter sign stability (the strict gate) ===');
  console.log('pair      signal        H    Q1    Q2    Q3    Q4');
  for (const l of out) console.log(l);
  const stable = out.filter(l => l.includes('STABLE'));
  console.log(`\nSTABLE (all-4-quarters same sign & median|IC|>=0.05): ${stable.length ? '\n' + stable.join('\n') : 'NONE'}`);
  await close();
}

main().catch(async e => { console.error('crashed', e?.message ?? String(e)); await close(); process.exit(1); });

/**
 * xliq-deep — drill into the two BTC candidates that passed the both-halves screen:
 *   (1) liqImbalance (long-short)/(sum) -> NEGATIVE IC (continuation) @24h/48h
 *   (2) cvdDelta_6barSum -> POSITIVE IC (momentum) @24h
 *
 * Tests:
 *   - quartile (4-way) time split: IC in each of 4 chronological quarters (real
 *     stability, not just the midpoint that could straddle a regime).
 *   - quintile fwd-ret table (all 5 bucket means) on both halves.
 *   - ORTHOGONALITY: how correlated is the signal with (a) the trailing 24h price
 *     return (is liqImbalance just lagged momentum?), and (b) the existing
 *     funding/ls fade proxy. Plus partial check: does the signal still rank-predict
 *     fwd-ret AFTER we residualize out trailing return?
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close } from '../../core/db';

const EX = 'Binance,OKX,Bybit';

function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 8) return NaN;
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(arr.length);
    let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  return (vx === 0 || vy === 0) ? NaN : cov / Math.sqrt(vx * vy);
}

function quintileMeans(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const order = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
  const q = Math.floor(n / 5); const means: number[] = [];
  for (let b = 0; b < 5; b++) { const lo = b * q, hi = b === 4 ? n : (b + 1) * q; let s = 0; for (let i = lo; i < hi; i++) s += ys[order[i]]; means.push((s / (hi - lo)) * 100); }
  return means;
}

async function main() {
  const sym = 'BTCUSDT', cgSym = 'BTC';
  const bars = await loadBars(sym, '240m', { limit: 4500 });
  const closeByTs = new Map<number, number>(); for (const b of bars) closeByTs.set(b.ts, b.close);

  const liqR = await cgGet<any[]>('/futures/liquidation/aggregated-history', { symbol: cgSym, exchange_list: EX, interval: '4h', limit: 4500 });
  const takR = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', { symbol: cgSym, exchange_list: EX, interval: '4h', limit: 4500 });
  const liq = new Map<number, [number, number]>(); for (const r of liqR.data || []) liq.set(r.time, [+r.aggregated_long_liquidation_usd, +r.aggregated_short_liquidation_usd]);
  const tak = new Map<number, [number, number]>(); for (const r of takR.data || []) tak.set(r.time, [+r.aggregated_buy_volume_usd, +r.aggregated_sell_volume_usd]);

  const tsSorted = bars.map(b => b.ts).sort((a, b) => a - b);
  const A: { ts: number; close: number; ll: number; sl: number; buy: number; sell: number }[] = [];
  for (const ts of tsSorted) { const l = liq.get(ts), t = tak.get(ts), c = closeByTs.get(ts); if (l && t && c !== undefined) A.push({ ts, close: c, ll: l[0], sl: l[1], buy: t[0], sell: t[1] }); }
  const N = A.length;
  console.log(`aligned=${N}  ${new Date(A[0].ts).toISOString().slice(0,10)} -> ${new Date(A[N-1].ts).toISOString().slice(0,10)}`);

  // signals
  const liqImb = A.map(a => { const s = a.ll + a.sl; return s > 0 ? (a.ll - a.sl) / s : NaN; });
  const cvdRaw = A.map(a => { const s = a.buy + a.sell; return s > 0 ? (a.buy - a.sell) / s : 0; });
  const cvd6 = A.map((_, i) => { let s = 0; for (let k = Math.max(0, i - 5); k <= i; k++) s += cvdRaw[k]; return s; });
  // trailing 24h return (close[i] vs close[i-6]) — for orthogonality
  const trail24 = A.map((a, i) => i >= 6 ? (a.close - A[i - 6].close) / A[i - 6].close : NaN);

  const candidates: { name: string; vals: number[]; H: number }[] = [
    { name: 'liqImbalance', vals: liqImb, H: 24 },
    { name: 'liqImbalance', vals: liqImb, H: 48 },
    { name: 'cvd6barSum', vals: cvd6, H: 24 },
  ];

  for (const c of candidates) {
    const k = c.H / 4;
    const fwd = A.map((a, i) => i + k < N ? (A[i + k].close - a.close) / a.close : NaN);
    const valid: number[] = [];
    for (let i = 6; i + k < N; i++) if (Number.isFinite(c.vals[i]) && Number.isFinite(fwd[i]) && Number.isFinite(trail24[i])) valid.push(i);

    // 4-way chronological split
    const quarter = (q: number) => valid.filter(i => Math.floor((i / N) * 4) === q);
    console.log(`\n### ${c.name} H=${c.H}h  n=${valid.length}`);
    const qics: number[] = [];
    for (let q = 0; q < 4; q++) {
      const idx = quarter(q); if (idx.length < 30) { console.log(`  Q${q+1}: thin (${idx.length})`); qics.push(NaN); continue; }
      const ic = spearman(idx.map(i => c.vals[i]), idx.map(i => fwd[i])); qics.push(ic);
      const span = `${new Date(A[idx[0]].ts).toISOString().slice(0,10)}..${new Date(A[idx[idx.length-1]].ts).toISOString().slice(0,10)}`;
      console.log(`  Q${q+1} (${span}) n=${idx.length}  IC=${ic.toFixed(3)}`);
    }
    const signs = qics.filter(Number.isFinite).map(Math.sign);
    const consistent = signs.length === 4 && signs.every(s => s === signs[0]);
    console.log(`  -> 4-quarter sign consistency: ${consistent ? 'ALL SAME ('+(signs[0]>0?'+':'-')+')' : 'MIXED ' + qics.map(x=>x.toFixed(2)).join('/')}`);

    // quintile table both halves
    const mid = Math.floor(N / 2);
    const isIdx = valid.filter(i => i < mid), oosIdx = valid.filter(i => i >= mid);
    const qmIS = quintileMeans(isIdx.map(i => c.vals[i]), isIdx.map(i => fwd[i]));
    const qmOOS = quintileMeans(oosIdx.map(i => c.vals[i]), oosIdx.map(i => fwd[i]));
    console.log(`  quintile fwd-ret% IS : [${qmIS.map(x=>x.toFixed(2)).join(', ')}]  (Q1=low signal .. Q5=high)`);
    console.log(`  quintile fwd-ret% OOS: [${qmOOS.map(x=>x.toFixed(2)).join(', ')}]`);

    // orthogonality: signal vs trailing 24h return
    const corrTrail = spearman(valid.map(i => c.vals[i]), valid.map(i => trail24[i]));
    console.log(`  corr(signal, trailing-24h-return) = ${corrTrail.toFixed(3)}  ${Math.abs(corrTrail)>0.5?'(HIGH — largely lagged momentum)':'(modest)'}`);

    // residualized IC: rank-regress signal on trailing return, take residual ranks vs fwd ret.
    // Cheap proxy: within terciles of trail24, recompute IC of signal->fwd (controls for momentum regime).
    const sortByTrail = [...valid].sort((a, b) => trail24[a] - trail24[b]);
    const t3 = Math.floor(sortByTrail.length / 3);
    const tercIcs: number[] = [];
    for (let b = 0; b < 3; b++) { const lo = b*t3, hi = b===2?sortByTrail.length:(b+1)*t3; const seg = sortByTrail.slice(lo, hi); tercIcs.push(spearman(seg.map(i=>c.vals[i]), seg.map(i=>fwd[i]))); }
    console.log(`  IC within trailing-return terciles (momentum-controlled): [${tercIcs.map(x=>x.toFixed(3)).join(', ')}]`);
  }

  // also: how correlated is liqImbalance with cvd (are they the same edge)?
  const mid = Math.floor(N/2);
  const valid: number[] = []; for (let i=6;i<N;i++) if (Number.isFinite(liqImb[i])) valid.push(i);
  console.log(`\ncorr(liqImbalance, cvdDelta_raw) = ${spearman(valid.map(i=>liqImb[i]), valid.map(i=>cvdRaw[i])).toFixed(3)}`);
  console.log(`corr(liqImbalance, cvd6barSum)  = ${spearman(valid.map(i=>liqImb[i]), valid.map(i=>cvd6[i])).toFixed(3)}`);

  await close();
}

main().catch(async e => { console.error('crashed', e?.message ?? String(e)); await close(); process.exit(1); });

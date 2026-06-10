/**
 * xliq-cvd-ortho — the two strict-gate survivors are SOL cvdDelta@24h and
 * ADA cvd6barSum@24h (both POSITIVE IC = taker order-flow momentum). Decide if
 * they are NEW info or just lagged price momentum / the existing funding-ls fade.
 *
 * For each survivor (and the raw cvdDelta for ADA too):
 *  - corr(signal, trailing-24h return) — is it lagged price?
 *  - momentum-controlled IC (within terciles of trailing return)
 *  - IC of a PURE price-momentum signal (trailing-24h return -> fwd 24h) on same
 *    bars, to see if CVD beats plain price momentum.
 *  - corr(cvdDelta, funding) proxy via CG funding history (orthogonality to the
 *    current fade family).
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

async function analyze(sym: string, cgSym: string, useSixBar: boolean) {
  const bars = await loadBars(sym, '240m', { limit: 4500 });
  const cb = new Map<number, number>(); for (const b of bars) cb.set(b.ts, b.close);
  const takR = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', { symbol: cgSym, exchange_list: EX, interval: '4h', limit: 4500 });
  const tak = new Map<number, [number, number]>(); for (const r of takR.data || []) tak.set(r.time, [+r.aggregated_buy_volume_usd, +r.aggregated_sell_volume_usd]);
  // funding for orthogonality (CG funding OI-weighted history if available)
  let fundMap = new Map<number, number>();
  try {
    const f = await cgGet<any[]>('/futures/funding-rate/oi-weight-history', { symbol: cgSym, interval: '4h', limit: 4500 });
    for (const r of f.data || []) { const t = r.time ?? r.t; const v = r.close ?? r.funding_rate ?? r.fundingRate; if (t != null && v != null) fundMap.set(+t, +v); }
  } catch { /* optional */ }

  const ts = bars.map(b => b.ts).sort((a, b) => a - b);
  const A: { ts: number; close: number; buy: number; sell: number }[] = [];
  for (const t of ts) { const k = tak.get(t), c = cb.get(t); if (k && c !== undefined) A.push({ ts: t, close: c, buy: k[0], sell: k[1] }); }
  const N = A.length;
  const cvdRaw = A.map(a => { const s = a.buy + a.sell; return s > 0 ? (a.buy - a.sell) / s : 0; });
  const cvd6 = A.map((_, i) => { let s = 0; for (let k = Math.max(0, i - 5); k <= i; k++) s += cvdRaw[k]; return s; });
  const sig = useSixBar ? cvd6 : cvdRaw;
  const sigName = useSixBar ? 'cvd6barSum' : 'cvdDelta';
  const trail24 = A.map((a, i) => i >= 6 ? (a.close - A[i - 6].close) / A[i - 6].close : NaN);
  const k = 6; // 24h
  const fwd = A.map((a, i) => i + k < N ? (A[i + k].close - a.close) / a.close : NaN);

  const valid: number[] = []; for (let i = 6; i + k < N; i++) if (Number.isFinite(sig[i]) && Number.isFinite(fwd[i]) && Number.isFinite(trail24[i])) valid.push(i);

  console.log(`\n### ${sym} ${sigName} @24h  n=${valid.length}`);
  const icRaw = spearman(valid.map(i => sig[i]), valid.map(i => fwd[i]));
  const icMom = spearman(valid.map(i => trail24[i]), valid.map(i => fwd[i]));
  const corrTrail = spearman(valid.map(i => sig[i]), valid.map(i => trail24[i]));
  console.log(`  IC(signal->fwd24h)            = ${icRaw.toFixed(3)}`);
  console.log(`  IC(plain trailing24h->fwd24h) = ${icMom.toFixed(3)}   (pure price-momentum baseline)`);
  console.log(`  corr(signal, trailing24h ret) = ${corrTrail.toFixed(3)}  ${Math.abs(corrTrail) > 0.5 ? '(LAGGED PRICE)' : Math.abs(corrTrail) > 0.3 ? '(partly price)' : '(fairly orthogonal to price)'}`);

  // momentum-controlled IC (tercile of trailing return)
  const sb = [...valid].sort((a, b) => trail24[a] - trail24[b]); const t3 = Math.floor(sb.length / 3); const terc: number[] = [];
  for (let b = 0; b < 3; b++) { const lo = b * t3, hi = b === 2 ? sb.length : (b + 1) * t3; const seg = sb.slice(lo, hi); terc.push(spearman(seg.map(i => sig[i]), seg.map(i => fwd[i]))); }
  console.log(`  momentum-controlled IC (terciles) = [${terc.map(x => x.toFixed(3)).join(', ')}]  ${terc.every(x => Math.sign(x) === Math.sign(icRaw) && Math.abs(x) > 0.02) ? '(survives control)' : '(weak/mixed under control)'}`);

  // orthogonality to funding fade family
  if (fundMap.size > 50) {
    const fvalid = valid.filter(i => fundMap.has(A[i].ts));
    if (fvalid.length > 100) {
      const cf = spearman(fvalid.map(i => sig[i]), fvalid.map(i => fundMap.get(A[i].ts)!));
      console.log(`  corr(signal, funding-OI)      = ${cf.toFixed(3)}  (n=${fvalid.length})  ${Math.abs(cf) > 0.4 ? '(overlaps fade family)' : '(orthogonal to funding fade)'}`);
    } else console.log(`  funding overlap: thin (${fvalid.length})`);
  } else console.log(`  funding: not fetched (${fundMap.size} rows)`);
}

async function main() {
  await analyze('SOLUSDT', 'SOL', false);   // SOL cvdDelta@24h
  await analyze('ADAUSDT', 'ADA', true);     // ADA cvd6barSum@24h
  await analyze('ADAUSDT', 'ADA', false);    // ADA raw cvdDelta@24h for comparison
  await analyze('BTCUSDT', 'BTC', false);    // BTC cvdDelta raw — was it stable? (sanity)
  await close();
}

main().catch(async e => { console.error('crashed', e?.message ?? String(e)); await close(); process.exit(1); });

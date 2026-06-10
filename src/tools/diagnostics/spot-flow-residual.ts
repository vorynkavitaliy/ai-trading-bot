/**
 * spot-flow-residual — for the candidate signals that cleared the same-sign |IC|>=0.05
 * bar, measure (a) corr vs trailing same-horizon price return and vs funding_oi pct,
 * and (b) the IC of the signal RESIDUALIZED against trailing return (remove lagged
 * momentum). A real spot-flow edge survives residualization; a price-proxy collapses.
 *
 * Also reports a within-coin combined IC and the per-bar (non-windowed) spot_taker_imb
 * separately since it is the least momentum-contaminated candidate.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/spot-flow-residual.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const COINS = ['BTC', 'ETH', 'SOL'];
const HORIZONS = [3, 6, 12];
const ROLL = 180;
const SLOPE_H = 6;

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length; if (n < 3) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }
function clean3(a: number[], b: number[], c: number[]): [number[], number[], number[]] {
  const A: number[] = [], B: number[] = [], C: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i]) && Number.isFinite(c[i])) { A.push(a[i]); B.push(b[i]); C.push(c[i]); }
  return [A, B, C];
}
// OLS residual of y on x (single regressor + intercept)
function residualize(y: number[], x: number[]): number[] {
  const n = y.length;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
  const b = sxx === 0 ? 0 : sxy / sxx; const a = my - b * mx;
  return y.map((yi, i) => yi - (a + b * x[i]));
}
function rollingZ(xs: number[]): number[] {
  const out = new Array(xs.length).fill(NaN);
  for (let i = 0; i < xs.length; i++) {
    const start = Math.max(0, i - ROLL + 1); const win = xs.slice(start, i + 1);
    if (win.length < 20) continue;
    let m = 0; for (const v of win) m += v; m /= win.length;
    let s = 0; for (const v of win) s += (v - m) * (v - m); s = Math.sqrt(s / win.length);
    out[i] = s === 0 ? 0 : (xs[i] - m) / s;
  }
  return out;
}

async function fetchCvd(coin: string, spot: boolean) {
  const path = spot ? '/spot/aggregated-cvd/history' : '/futures/aggregated-cvd/history';
  const r = await cgGet<any>(path, { exchange_list: 'Binance', symbol: coin, interval: '4h', limit: 3000 });
  return (r.data ?? []).map((d: any) => ({ time: d.time, buy: d.agg_taker_buy_vol, sell: d.agg_taker_sell_vol, cvd: d.cum_vol_delta }));
}
async function fundingPct(coin: string): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts, fr_close::float fr FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts ASC`, [coin]);
  const rows = r.rows.map((x: any) => ({ ts: Number(x.ts), fr: x.fr as number }));
  const out = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const win = rows.slice(Math.max(0, i - ROLL + 1), i + 1).map(w => w.fr); const cur = rows[i].fr;
    let le = 0; for (const v of win) if (v <= cur) le++; out.set(rows[i].ts, le / win.length);
  }
  return out;
}
async function closes(pair: string): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts, close::float c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const m = new Map<number, number>(); for (const x of r.rows) m.set(Number(x.ts), x.c as number); return m;
}

async function main() {
  console.log('=== spot-flow-residual (orthogonality + momentum-stripped IC) ===\n');
  for (const coin of COINS) {
    const pair = coin + 'USDT';
    const [spot, perp, fpm, cl] = await Promise.all([fetchCvd(coin, true), fetchCvd(coin, false), fundingPct(coin), closes(pair)]);
    const perpByT = new Map<number, any>(); for (const p of perp) perpByT.set(p.time, p);
    const rows = spot.filter((s: any) => perpByT.has(s.time) && cl.has(s.time));
    const times = rows.map((r: any) => r.time);
    const closeArr = times.map((t: number) => cl.get(t)!);
    const n = times.length; const mid = Math.floor(n / 2);

    const spotImb = rows.map((r: any) => { const d = r.buy + r.sell; return d === 0 ? 0 : (r.buy - r.sell) / d; });
    const perpImb = rows.map((r: any) => { const p = perpByT.get(r.time); const d = p.buy + p.sell; return d === 0 ? 0 : (p.buy - p.sell) / d; });
    const spotNet = rows.map((r: any) => r.buy - r.sell);
    const spotCvdZ = rollingZ(spotNet);
    const spotMinusPerp = spotImb.map((v: number, i: number) => v - perpImb[i]);
    const slopeRaw = rows.map((r: any, i: number) => i >= SLOPE_H ? r.cvd - rows[i - SLOPE_H].cvd : NaN);
    const spotCvdSlope = rollingZ(slopeRaw.map((v: number) => Number.isFinite(v) ? v : 0)).map((z, i) => i >= SLOPE_H ? z : NaN);
    const fundArr = times.map((t: number) => fpm.has(t) ? fpm.get(t)! : NaN);

    const signals: Record<string, number[]> = { spot_taker_imb: spotImb, spot_cvd_z: spotCvdZ, spot_minus_perp: spotMinusPerp, spot_cvd_slope: spotCvdSlope };

    console.log(`--- ${coin} (n=${n}) ---`);
    console.log('signal           h   corr(sig,fund)  corr(sig,trailRet)  rawIC_IS  rawIC_OOS  residIC_IS  residIC_OOS');
    for (const [name, sig] of Object.entries(signals)) {
      for (const h of HORIZONS) {
        const fwd: number[] = new Array(n).fill(NaN);
        for (let i = 0; i + h < n; i++) fwd[i] = closeArr[i + h] / closeArr[i] - 1;
        const trail: number[] = new Array(n).fill(NaN);
        for (let i = h; i < n; i++) trail[i] = closeArr[i] / closeArr[i - h] - 1;

        // orthogonality (full sample)
        const [sf, ff] = (() => { const A: number[] = [], B: number[] = []; for (let i = 0; i < n; i++) if (Number.isFinite(sig[i]) && Number.isFinite(fundArr[i])) { A.push(sig[i]); B.push(fundArr[i]); } return [A, B]; })();
        const corrFund = spearman(sf, ff);
        const [st, tt] = (() => { const A: number[] = [], B: number[] = []; for (let i = 0; i < n; i++) if (Number.isFinite(sig[i]) && Number.isFinite(trail[i])) { A.push(sig[i]); B.push(trail[i]); } return [A, B]; })();
        const corrTrail = spearman(st, tt);

        // raw IC IS/OOS
        const rawICis = (() => { const a = sig.slice(0, mid), b = fwd.slice(0, mid); const [x, y] = cleanPair(a, b); return spearman(x, y); })();
        const rawICoos = (() => { const a = sig.slice(mid), b = fwd.slice(mid); const [x, y] = cleanPair(a, b); return spearman(x, y); })();

        // residualized IC: residualize signal on trailing return (per half), then IC vs fwd
        const residICis = residICHalf(sig, trail, fwd, 0, mid);
        const residICoos = residICHalf(sig, trail, fwd, mid, n);

        console.log(`${name.padEnd(16)} ${String(h).padStart(2)}  ${corrFund.toFixed(3).padStart(13)}  ${corrTrail.toFixed(3).padStart(17)}  ${fmt(rawICis)}  ${fmt(rawICoos)}   ${fmt(residICis)}   ${fmt(residICoos)}`);
      }
    }
    console.log('');
  }
  process.exit(0);
}

function cleanPair(a: number[], b: number[]): [number[], number[]] {
  const A: number[] = [], B: number[] = []; for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { A.push(a[i]); B.push(b[i]); } return [A, B];
}
function residICHalf(sig: number[], trail: number[], fwd: number[], lo: number, hi: number): number {
  const s: number[] = [], t: number[] = [], f: number[] = [];
  for (let i = lo; i < hi; i++) if (Number.isFinite(sig[i]) && Number.isFinite(trail[i]) && Number.isFinite(fwd[i])) { s.push(sig[i]); t.push(trail[i]); f.push(fwd[i]); }
  if (s.length < 30) return NaN;
  const resid = residualize(s, t); // signal with trailing-momentum component removed
  return spearman(resid, f);
}
function fmt(v: number): string { return (Number.isFinite(v) ? v.toFixed(4) : 'NaN').padStart(9); }

main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });

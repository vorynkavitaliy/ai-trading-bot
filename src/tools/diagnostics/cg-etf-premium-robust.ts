/**
 * cg-etf-premium-robust — robustness profile for the ETF premMean FOLLOW edge:
 *   1. Full quintile profile (Q1..Q5 mean fwd3 / fwd7) per half — monotonicity check.
 *   2. Rolling 3-window IC (thirds) at fwd3/fwd7 — not one-regime driven.
 *   3. Sign-based long/short spread (top-quintile long minus bottom-quintile short) per half.
 * Read-only.
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';

const DAY = 86400000;
const utcDayKey = (ms: number) => Math.floor(ms / DAY) * DAY;
function rank(xs: number[]) { const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length).fill(0); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
function pearson(a: number[], b: number[]) { const n = a.length; if (n < 3) return NaN; const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } const d = Math.sqrt(da * db); return d === 0 ? NaN : num / d; }
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

async function buildDailyClose(symbol: string) { const bars = await loadBars(symbol, '240m', { fromTs: Date.UTC(2024, 0, 1), toTs: Date.now() }); const byDay = new Map<number, { ts: number; close: number }>(); for (const b of bars) { const dk = utcDayKey(b.ts); const p = byDay.get(dk); if (!p || b.ts > p.ts) byDay.set(dk, { ts: b.ts, close: b.close }); } const out = new Map<number, number>(); for (const [dk, v] of byDay) out.set(dk, v.close); return out; }
const fwd = (dc: Map<number, number>, dk: number, h: number) => { const a = dc.get(dk), b = dc.get(dk + h * DAY); return a && b ? b / a - 1 : null; };

function quintiles(sig: number[], ret: number[]) {
  const pairs = sig.map((s, i) => [s, ret[i]] as [number, number]).filter(p => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const n = pairs.length; const q = Math.floor(n / 5); const out: number[] = [];
  for (let i = 0; i < 5; i++) { const slice = pairs.slice(i * q, i === 4 ? n : (i + 1) * q).map(p => p[1]); out.push(mean(slice)); }
  return out;
}

async function main() {
  const dc = await buildDailyClose('BTCUSDT');
  const pd: any = await cgGet<any>('/etf/bitcoin/premium-discount/history', {});
  const rows = pd.data as Array<{ timestamp: number; list: Array<{ ticker: string; premium_discount_details: number }> }>;
  const recs: { dk: number; prem: number; f3: number | null; f7: number | null }[] = [];
  for (const row of rows) {
    const dk = utcDayKey(row.timestamp);
    const vals = (row.list || []).map(e => e.premium_discount_details).filter(v => typeof v === 'number' && isFinite(v));
    if (!vals.length) continue;
    recs.push({ dk, prem: mean(vals), f3: fwd(dc, dk, 3), f7: fwd(dc, dk, 7) });
  }
  recs.sort((a, b) => a.dk - b.dk);

  for (const hz of ['f3', 'f7'] as const) {
    const ps = recs.filter(r => r[hz] != null).map(r => ({ dk: r.dk, sig: r.prem, ret: r[hz]! }));
    const mid = Math.floor(ps.length / 2);
    const is = ps.slice(0, mid), oos = ps.slice(mid);
    const qIS = quintiles(is.map(p => p.sig), is.map(p => p.ret));
    const qOOS = quintiles(oos.map(p => p.sig), oos.map(p => p.ret));
    console.log(`\n=== ${hz} quintile mean fwd return (Q1=low prem .. Q5=high prem) ===`);
    console.log('IS :', qIS.map(v => (v * 100).toFixed(2) + '%').join('  '), ` spread=${((qIS[4]-qIS[0])*100).toFixed(2)}%`);
    console.log('OOS:', qOOS.map(v => (v * 100).toFixed(2) + '%').join('  '), ` spread=${((qOOS[4]-qOOS[0])*100).toFixed(2)}%`);
    // rolling thirds IC
    const t = Math.floor(ps.length / 3);
    const w1 = ps.slice(0, t), w2 = ps.slice(t, 2 * t), w3 = ps.slice(2 * t);
    console.log(`thirds IC: w1=${spearman(w1.map(p=>p.sig),w1.map(p=>p.ret)).toFixed(4)} w2=${spearman(w2.map(p=>p.sig),w2.map(p=>p.ret)).toFixed(4)} w3=${spearman(w3.map(p=>p.sig),w3.map(p=>p.ret)).toFixed(4)} (n/3=${t})`);
    const dates = (w: typeof ps) => `${new Date(w[0].dk).toISOString().slice(0,10)}..${new Date(w[w.length-1].dk).toISOString().slice(0,10)}`;
    console.log(`thirds spans: w1[${dates(w1)}] w2[${dates(w2)}] w3[${dates(w3)}]`);
  }
  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

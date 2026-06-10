/**
 * cg-basis-verify — adversarial follow-up on the BTC basis-pct180 -> 48h FOLLOW
 * candidate (the only stable-across-halves signal). Three checks:
 *   1. Residual IC: regress fwd-ret on trailing-48h-ret, take residual, then
 *      Spearman(basis-pct, residual) on BOTH halves. If the edge vanishes, it was
 *      lagged momentum repackaged. If it survives, it's genuinely new info.
 *   2. Thirds split (3 contiguous time blocks) — is the IC present in all three,
 *      or driven by one regime block?
 *   3. Directional quintile detail: mean fwd-ret of top vs bottom basis-pct quintile
 *      in each half (the actual tradable spread + its sign stability).
 * Also repeats the residual + thirds check for the FADE candidates (ADA/LINK/ETH
 * basis-level 48h) for completeness.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const BAR_MS = 4 * 3600 * 1000;

async function fetchBasis(pair: string): Promise<{ ts: number; level: number }[]> {
  const r = await cgGet<any[]>('/futures/basis/history', { exchange: 'Binance', symbol: pair, interval: '4h', limit: 4500 });
  const out: { ts: number; level: number }[] = [];
  for (const row of (r as any).data as any[]) {
    const ts = Number(row.time), level = Number(row.close_basis);
    if (Number.isFinite(ts) && Number.isFinite(level)) out.push({ ts, level });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
async function loadCloses(pair: string): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  const r = await query<any>(`SELECT ts::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  for (const row of r.rows) m.set(parseInt(row.ts, 10), parseFloat(row.close));
  return m;
}
function rank(arr: number[]): number[] {
  const idx = arr.map((v, i) => [v, i] as [number, number]); idx.sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length).fill(0); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length; if (n < 3) return NaN; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  const den = Math.sqrt(da * db); return den === 0 ? NaN : num / den;
}
function spearman(x: number[], y: number[]): number { return pearson(rank(x), rank(y)); }
// OLS slope+intercept of y on x; returns residuals y - yhat
function residualize(y: number[], x: number[]): number[] {
  const n = y.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const b = sxx === 0 ? 0 : sxy / sxx; const a = my - b * mx;
  return y.map((yi, i) => yi - (a + b * x[i]));
}
function pctTrailing(series: number[], win: number): (number | null)[] {
  const out: (number | null)[] = series.map(() => null);
  for (let i = 0; i < series.length; i++) {
    const window: number[] = [];
    for (let k = i - win; k < i; k++) { if (k < 0) continue; const v = series[k]; if (Number.isFinite(v)) window.push(v); }
    if (window.length < Math.floor(win / 2)) continue;
    const v = series[i]; let cnt = 0; for (const w of window) if (w <= v) cnt++; out[i] = cnt / window.length;
  }
  return out;
}
function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

interface Row { ts: number; sig: number; fwd: number; trail: number; close: number; }

async function buildRows(pair: string, sigKind: 'pct180' | 'level', H: number): Promise<Row[]> {
  const basis = await fetchBasis(pair);
  const closes = await loadCloses(pair);
  const aligned = basis.filter(b => closes.has(b.ts));
  const levels = aligned.map(a => a.level);
  const sigSeries: (number | null)[] = sigKind === 'pct180' ? pctTrailing(levels, 180) : levels.map(v => v);
  const rows: Row[] = [];
  for (let i = 0; i < aligned.length; i++) {
    const s = sigSeries[i]; if (s == null || !Number.isFinite(s)) continue;
    const c0 = aligned[i].close ?? closes.get(aligned[i].ts)!;
    const cH = closes.get(aligned[i].ts + H * BAR_MS);
    if (cH == null) continue;
    const fwd = cH / c0 - 1;
    if (i < H) continue;
    const cTrail0 = closes.get(aligned[i].ts - H * BAR_MS);
    if (cTrail0 == null) continue;
    const trail = c0 / cTrail0 - 1;
    rows.push({ ts: aligned[i].ts, sig: s, fwd, trail, close: c0 });
  }
  return rows;
}

function icBlock(rows: Row[]): { ic: number; resIC: number; topMinusBot: number; n: number } {
  const sig = rows.map(r => r.sig), fwd = rows.map(r => r.fwd), trail = rows.map(r => r.trail);
  const ic = spearman(sig, fwd);
  const resid = residualize(fwd, trail); // forward ret with trailing-momentum component removed
  const resIC = spearman(sig, resid);
  // quintile spread
  const idx = sig.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const q = Math.floor(rows.length / 5);
  let bot = 0, top = 0; for (let i = 0; i < q; i++) bot += fwd[idx[i][1]]; for (let i = rows.length - q; i < rows.length; i++) top += fwd[idx[i][1]];
  return { ic, resIC, topMinusBot: top / q - bot / q, n: rows.length };
}

async function verifyOne(pair: string, sigKind: 'pct180' | 'level', H: number) {
  console.log(`\n\n===== ${pair}  signal=${sigKind}  H=${H} bars (${H * 4}h) =====`);
  const rows = await buildRows(pair, sigKind, H);
  console.log(`usable rows=${rows.length}  span=${new Date(rows[0].ts).toISOString().slice(0,10)}..${new Date(rows[rows.length-1].ts).toISOString().slice(0,10)}`);

  // halves
  const mid = Math.floor(rows.length / 2);
  const halves = [['IS(older)', rows.slice(0, mid)], ['OOS(recent)', rows.slice(mid)]] as const;
  console.log(`\n${pad('block',14)} ${pad('n',6)} ${pad('IC',9)} ${pad('residIC',9)} ${pad('top-bot%',10)}`);
  console.log('-'.repeat(55));
  for (const [name, blk] of halves) {
    const b = icBlock(blk as Row[]);
    console.log(`${pad(name,14)} ${pad(String(b.n),6)} ${pad(b.ic.toFixed(4),9)} ${pad(b.resIC.toFixed(4),9)} ${pad((b.topMinusBot*100).toFixed(3),10)}`);
  }

  // thirds
  console.log(`\n-- thirds (regime check) --`);
  const t = Math.floor(rows.length / 3);
  const thirds = [['T1', rows.slice(0, t)], ['T2', rows.slice(t, 2 * t)], ['T3', rows.slice(2 * t)]] as const;
  for (const [name, blk] of thirds) {
    const b = icBlock(blk as Row[]);
    const span = `${new Date((blk as Row[])[0].ts).toISOString().slice(5,10)}..${new Date((blk as Row[])[(blk as Row[]).length-1].ts).toISOString().slice(5,10)}`;
    console.log(`${pad(name,14)} ${pad(String(b.n),6)} ${pad(b.ic.toFixed(4),9)} ${pad(b.resIC.toFixed(4),9)} ${pad((b.topMinusBot*100).toFixed(3),10)} ${span}`);
  }
}

async function main() {
  // basis-level FADE archetype across the WHOLE book at 48h — thirds consistency.
  await verifyOne('BTCUSDT', 'level', 12);
  await verifyOne('SOLUSDT', 'level', 12);
  await verifyOne('ADAUSDT', 'level', 12);
  await verifyOne('LINKUSDT', 'level', 12);
  await verifyOne('ETHUSDT', 'level', 12);
  process.exit(0);
}
main().catch(e => { console.error('cg-basis-verify crashed', e?.message ?? String(e)); process.exit(1); });

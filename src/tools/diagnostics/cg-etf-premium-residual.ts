/**
 * cg-etf-premium-residual — decisive orthogonality test for the ETF premium FOLLOW edge.
 *
 * The premium signal correlates ~+0.20 with trailing price return (lagged-momentum risk).
 * This residualizes premium against trailing returns (1d+3d+7d) and re-checks whether the
 * RESIDUAL premium still predicts forward 3d/7d returns on BOTH halves. If the edge
 * survives residualization with same-sign IC>=0.05 on both halves, it is orthogonal new
 * info. If it collapses, the premium edge is lagged momentum repackaged.
 *
 * Also reports: raw trailing-momentum's own forward IC (the thing premium might be
 * proxying) for a head-to-head.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/cg-etf-premium-residual.ts
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';

const DAY = 86400000;
function utcDayKey(ms: number): number { return Math.floor(ms / DAY) * DAY; }

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length; if (n < 3) return NaN;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db); return den === 0 ? NaN : num / den;
}
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }

// OLS residual of y on design X (with intercept). Returns residuals aligned to y.
function olsResidual(y: number[], X: number[][]): number[] {
  const n = y.length; const k = X[0].length + 1;
  const Xa = X.map(row => [1, ...row]);
  // normal equations (k x k) via Gaussian elimination
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += Xa[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += Xa[i][a] * Xa[i][b];
    }
  }
  // solve XtX beta = Xty
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < k; col++) {
    let piv = col; for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col]; if (Math.abs(d) < 1e-12) continue;
    for (let c = col; c <= k; c++) M[col][c] /= d;
    for (let r = 0; r < k; r++) { if (r === col) continue; const f = M[r][col]; for (let c = col; c <= k; c++) M[r][c] -= f * M[col][c]; }
  }
  const beta = M.map(row => row[k]);
  const resid = new Array(n);
  for (let i = 0; i < n; i++) { let pred = 0; for (let a = 0; a < k; a++) pred += beta[a] * Xa[i][a]; resid[i] = y[i] - pred; }
  return resid;
}

async function buildDailyClose(symbol: string): Promise<Map<number, number>> {
  const bars = await loadBars(symbol, '240m', { fromTs: Date.UTC(2024, 0, 1), toTs: Date.now() });
  const byDay = new Map<number, { ts: number; close: number }>();
  for (const b of bars) { const dk = utcDayKey(b.ts); const prev = byDay.get(dk); if (!prev || b.ts > prev.ts) byDay.set(dk, { ts: b.ts, close: b.close }); }
  const out = new Map<number, number>(); for (const [dk, v] of byDay) out.set(dk, v.close); return out;
}
function fwd(dc: Map<number, number>, dk: number, h: number): number | null { const a = dc.get(dk), b = dc.get(dk + h * DAY); return a && b ? b / a - 1 : null; }
function trail(dc: Map<number, number>, dk: number, h: number): number | null { const a = dc.get(dk - h * DAY), b = dc.get(dk); return a && b ? b / a - 1 : null; }

async function main() {
  const dc = await buildDailyClose('BTCUSDT');
  const pd: any = await cgGet<any>('/etf/bitcoin/premium-discount/history', {});
  const pdRows = pd.data as Array<{ timestamp: number; list: Array<{ ticker: string; premium_discount_details: number }> }>;

  // premMean per day
  const recs: { dk: number; prem: number; t1: number; t3: number; t7: number; f3: number | null; f7: number | null }[] = [];
  for (const row of pdRows) {
    const dk = utcDayKey(row.timestamp);
    const vals = (row.list || []).map(e => e.premium_discount_details).filter(v => typeof v === 'number' && isFinite(v));
    if (!vals.length) continue;
    const prem = vals.reduce((s, v) => s + v, 0) / vals.length;
    const t1 = trail(dc, dk, 1), t3 = trail(dc, dk, 3), t7 = trail(dc, dk, 7);
    if (t1 == null || t3 == null || t7 == null) continue;
    recs.push({ dk, prem, t1, t3, t7, f3: fwd(dc, dk, 3), f7: fwd(dc, dk, 7) });
  }
  recs.sort((a, b) => a.dk - b.dk);

  function report(label: string, sigKey: (r: typeof recs[0]) => number, fwdKey: 'f3' | 'f7') {
    const ps = recs.filter(r => r[fwdKey] != null).map(r => ({ dk: r.dk, sig: sigKey(r), ret: r[fwdKey]! }));
    const mid = Math.floor(ps.length / 2);
    const is = ps.slice(0, mid), oos = ps.slice(mid);
    const icIS = spearman(is.map(p => p.sig), is.map(p => p.ret));
    const icOOS = spearman(oos.map(p => p.sig), oos.map(p => p.ret));
    console.log(`${label.padEnd(34)} n=${ps.length} icIS=${icIS.toFixed(4)} icOOS=${icOOS.toFixed(4)} sameSign=${Math.sign(icIS)===Math.sign(icOOS)}`);
  }

  console.log('=== RAW premium FOLLOW edge ===');
  report('premMean -> fwd3', r => r.prem, 'f3');
  report('premMean -> fwd7', r => r.prem, 'f7');

  console.log('\n=== RAW trailing momentum -> fwd (what premium may proxy) ===');
  report('trail3 -> fwd3', r => r.t3, 'f3');
  report('trail7 -> fwd7', r => r.t7, 'f7');
  report('trail1 -> fwd3', r => r.t1, 'f3');

  // Residualize premium on trailing 1d+3d+7d returns (full sample), then re-test forward IC by half.
  const prem = recs.map(r => r.prem);
  const X = recs.map(r => [r.t1, r.t3, r.t7]);
  const residAll = olsResidual(prem, X);
  recs.forEach((r, i) => (r as any).residPrem = residAll[i]);
  // correlation check residual vs trailing (should be ~0)
  const corrResidTrail3 = pearson(recs.map(r => (r as any).residPrem), recs.map(r => r.t3));
  console.log(`\nresidPrem vs trail3 corr=${corrResidTrail3.toFixed(4)} (should be ~0 by construction)`);

  console.log('\n=== RESIDUAL premium (momentum-removed) FOLLOW edge ===');
  report('residPrem -> fwd3', r => (r as any).residPrem, 'f3');
  report('residPrem -> fwd7', r => (r as any).residPrem, 'f7');

  // Also: does premium beat trailing momentum head-to-head? Residualize fwd on trailing, IC of premium on that residual fwd.
  const f3recs = recs.filter(r => r.f3 != null);
  const residF3 = olsResidual(f3recs.map(r => r.f3!), f3recs.map(r => [r.t1, r.t3, r.t7]));
  f3recs.forEach((r, i) => (r as any).residF3 = residF3[i]);
  {
    const ps = f3recs.map(r => ({ dk: r.dk, sig: r.prem, ret: (r as any).residF3 as number }));
    const mid = Math.floor(ps.length / 2);
    const is = ps.slice(0, mid), oos = ps.slice(mid);
    console.log('\n=== premium -> (fwd3 residualized on trailing momentum) ===');
    console.log(`premium -> residFwd3  n=${ps.length} icIS=${spearman(is.map(p=>p.sig),is.map(p=>p.ret)).toFixed(4)} icOOS=${spearman(oos.map(p=>p.sig),oos.map(p=>p.ret)).toFixed(4)}`);
  }

  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

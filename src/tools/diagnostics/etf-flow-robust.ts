/**
 * etf-flow-robust — stress the two "interesting" ETF-flow readings found in
 * etf-flow-ic.ts to decide robust vs regime-artifact. Read-only.
 *
 *  (a) 3-way contiguous time split (thirds) — a real edge holds sign across all
 *      three sub-periods, a regime artifact does not.
 *  (b) contemporaneous-return control: regress out same-day return. ETF net flow
 *      is reported the morning AFTER the trading day, so "flow follows price" can
 *      manufacture a spurious fwd-IC if price autocorrelates. We compute the
 *      partial Spearman IC of flow vs fwd-ret AFTER ranking out the contemporaneous
 *      (prior-day) return — i.e. does flow add anything beyond price momentum?
 *  (c) orthogonality: correlation of the daily-net-flow signal with the price
 *      momentum it could be a proxy for (trailing 3d return), per half.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY_MS = 86_400_000;

interface FlowRow { ts: number; flow: number; }

async function fetchFlow(path: string): Promise<FlowRow[]> {
  const r = await cgGet<any>(path, {});
  const data = (r as any).data as any[];
  const out: FlowRow[] = [];
  for (const row of data) {
    const ts = Number(row.timestamp);
    const flow = row.flow_usd == null ? null : Number(row.flow_usd);
    if (!Number.isFinite(ts) || flow == null || !Number.isFinite(flow)) continue;
    out.push({ ts: Math.floor(ts / DAY_MS) * DAY_MS, flow });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

async function loadDailyCloses(symbol: string): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  const r = await query<any>(
    `SELECT DISTINCT ON (floor(ts/86400000)) floor(ts/86400000)*86400000 AS day_ms, close
       FROM candles WHERE symbol = $1 AND tf = '240m'
      ORDER BY floor(ts/86400000), ts DESC`,
    [symbol],
  );
  for (const row of r.rows) m.set(Number(row.day_ms), parseFloat(row.close));
  return m;
}

function rank(arr: number[]): number[] {
  const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length).fill(0);
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
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  const den = Math.sqrt(da * db); return den === 0 ? NaN : num / den;
}
function spearman(x: number[], y: number[]): number { return pearson(rank(x), rank(y)); }

// partial Spearman of x,y controlling for z: rank everything, residualize rank(x)
// and rank(y) on rank(z) via OLS, correlate residuals.
function partialSpearman(x: number[], y: number[], z: number[]): number {
  const rx = rank(x), ry = rank(y), rz = rank(z);
  const resid = (r: number[]): number[] => {
    const n = r.length;
    let mz = 0, mr = 0; for (let i = 0; i < n; i++) { mz += rz[i]; mr += r[i]; } mz /= n; mr /= n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (rz[i] - mz) * (r[i] - mr); den += (rz[i] - mz) ** 2; }
    const b = den === 0 ? 0 : num / den;
    return r.map((v, i) => v - (mr + b * (rz[i] - mz)));
  };
  return pearson(resid(rx), resid(ry));
}

function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function cumN(flows: number[], N: number): (number | null)[] {
  return flows.map((_, i) => { if (i < N - 1) return null; let s = 0; for (let k = i - N + 1; k <= i; k++) s += flows[k]; return s; });
}

async function analyze(label: string, flowPath: string, symbol: string) {
  console.log(`\n\n########## ${label} robustness (${symbol}) ##########`);
  const flowRows = await fetchFlow(flowPath);
  const closes = await loadDailyCloses(symbol);
  let n = flowRows.length; while (n > 0 && flowRows[n - 1].flow === 0) n--;
  const rows = flowRows.slice(0, n);
  const aligned: { ts: number; flow: number }[] = [];
  for (const fr of rows) if (closes.has(fr.ts)) aligned.push({ ts: fr.ts, flow: fr.flow });
  aligned.sort((a, b) => a.ts - b.ts);
  console.log(`aligned days=${aligned.length}, span ${new Date(aligned[0].ts).toISOString().slice(0,10)}..${new Date(aligned[aligned.length-1].ts).toISOString().slice(0,10)}`);

  const ts = aligned.map(a => a.ts);
  const flow = aligned.map(a => a.flow);
  const cum3 = cumN(flow, 3);
  const cum7 = cumN(flow, 7);

  const fwdRet = (i: number, H: number): number | null => {
    const c0 = closes.get(ts[i]); const cH = closes.get(ts[i] + H * DAY_MS);
    if (c0 == null || cH == null) return null; return cH / c0 - 1;
  };
  const priorRet = (i: number, H: number): number | null => {
    const c0 = closes.get(ts[i]); const cP = closes.get(ts[i] - H * DAY_MS);
    if (c0 == null || cP == null) return null; return c0 / cP - 1;
  };

  const tested: { name: string; vals: (number | null)[]; H: number }[] = [
    { name: 'daily-net-flow', vals: flow.map(v => v), H: 1 },
    { name: 'daily-net-flow', vals: flow.map(v => v), H: 3 },
    { name: 'cum3-net-flow', vals: cum3, H: 3 },
    { name: 'cum7-net-flow', vals: cum7, H: 5 },
  ];

  for (const t of tested) {
    // build pairs with signal, fwdret, priorret(1d) for the control
    const pairs: { i: number; s: number; r: number; pr: number }[] = [];
    for (let i = 0; i < aligned.length; i++) {
      const s = t.vals[i]; if (s == null) continue;
      const r = fwdRet(i, t.H); if (r == null) continue;
      const pr = priorRet(i, 1); if (pr == null) continue;
      pairs.push({ i, s, r, pr });
    }
    if (pairs.length < 90) { console.log(`\n${t.name} H=${t.H}d: too few (${pairs.length})`); continue; }
    const third = Math.floor(pairs.length / 3);
    const segs = [pairs.slice(0, third), pairs.slice(third, 2 * third), pairs.slice(2 * third)];
    const ic3 = segs.map(seg => spearman(seg.map(p => p.s), seg.map(p => p.r)));
    const icFull = spearman(pairs.map(p => p.s), pairs.map(p => p.r));
    // partial: flow vs fwdret controlling prior-day return (price momentum proxy)
    const icPartial = partialSpearman(pairs.map(p => p.s), pairs.map(p => p.r), pairs.map(p => p.pr));
    // orthogonality: signal vs prior-3d return correlation (is flow a momentum proxy?)
    const orthoPairs: { s: number; m: number }[] = [];
    for (const p of pairs) { const m = priorRet(p.i, 3); if (m != null) orthoPairs.push({ s: p.s, m }); }
    const flowVsMom = spearman(orthoPairs.map(p => p.s), orthoPairs.map(p => p.m));

    const sameSignAll3 = ic3.every(v => Number.isFinite(v)) && (ic3.every(v => v > 0) || ic3.every(v => v < 0));
    console.log(`\n${t.name} H=${t.H}d  N=${pairs.length}`);
    console.log(`  thirds IC: [${ic3.map(v => v.toFixed(4)).join(', ')}]  all-same-sign=${sameSignAll3 ? 'YES' : 'no'}`);
    console.log(`  full IC=${icFull.toFixed(4)}  partial-IC(ctrl prior1d ret)=${icPartial.toFixed(4)}  signal~prior3dRet corr=${flowVsMom.toFixed(4)}`);
  }
}

async function main() {
  await analyze('BITCOIN ETF FLOW', '/etf/bitcoin/flow-history', 'BTCUSDT');
  await analyze('ETHEREUM ETF FLOW', '/etf/ethereum/flow-history', 'ETHUSDT');
  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

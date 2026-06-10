/**
 * etf-flow-timing — establish WHEN flow_usd[T] is knowable, to confirm tradability.
 * ETF net flow for a US trading session is published AFTER the close. We test which
 * lag of price return the flow is most correlated with:
 *   ret(T-1->T)  = the session the flow supposedly measures (contemporaneous)
 *   ret(T->T+1)  = the forward bet
 * If flow[T] correlates strongest with ret(T-1->T) and that knowledge only arrives
 * at/after the T 00:00 boundary, the earliest tradable entry is the T close. We also
 * report best-correlated lag to detect whether CG's timestamp is the session date
 * (so flow[T] reflects the T-1->T move) — which would mean entering at T close is
 * fine, but the "follow" IC may just be price momentum bleeding forward.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';
const DAY_MS = 86_400_000;

async function main() {
  const r = await cgGet<any>('/etf/bitcoin/flow-history', {});
  const data = (r as any).data as any[];
  const rows: { ts: number; flow: number; price: number }[] = [];
  for (const row of data) {
    const ts = Number(row.timestamp);
    const flow = Number(row.flow_usd);
    const price = Number(row.price_usd);
    if (Number.isFinite(ts) && Number.isFinite(flow)) rows.push({ ts: Math.floor(ts / DAY_MS) * DAY_MS, flow, price });
  }
  rows.sort((a, b) => a.ts - b.ts);
  let n = rows.length; while (n > 0 && rows[n - 1].flow === 0) n--;
  const R = rows.slice(0, n);

  const closes = new Map<number, number>();
  const cr = await query<any>(
    `SELECT DISTINCT ON (floor(ts/86400000)) floor(ts/86400000)*86400000 AS day_ms, close
       FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY floor(ts/86400000), ts DESC`,
  );
  for (const x of cr.rows) closes.set(Number(x.day_ms), parseFloat(x.close));

  function rank(arr: number[]): number[] {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const out = new Array(arr.length).fill(0); let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const a = (i + j) / 2 + 1; for (let k = i; k <= j; k++) out[idx[k][1]] = a; i = j + 1; }
    return out;
  }
  function pear(a: number[], b: number[]): number { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let nu = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; nu += xa * xb; da += xa * xa; db += xb * xb; } const d = Math.sqrt(da * db); return d === 0 ? NaN : nu / d; }
  function sp(x: number[], y: number[]): number { return pear(rank(x), rank(y)); }

  function corrAtLag(lag: number): { ic: number; n: number } {
    // ret over (T+lag-1 -> T+lag) vs flow[T]. lag=0 => ret(T-1->T) contemporaneous session.
    const f: number[] = [], ret: number[] = [];
    for (const x of R) {
      const c1 = closes.get(x.ts + (lag) * DAY_MS);
      const c0 = closes.get(x.ts + (lag - 1) * DAY_MS);
      if (c1 == null || c0 == null) continue;
      f.push(x.flow); ret.push(c1 / c0 - 1);
    }
    return { ic: sp(f, ret), n: f.length };
  }
  console.log('flow[T] vs return over day window (rank-IC); lag=0 is the T-1->T session move:');
  for (let lag = -2; lag <= 4; lag++) {
    const { ic, n } = corrAtLag(lag);
    const winLabel = `ret(T${lag - 1 >= 0 ? '+' : ''}${lag - 1 === 0 ? '' : lag - 1} -> T${lag >= 0 ? '+' : ''}${lag === 0 ? '' : lag})`;
    console.log(`  lag=${lag >= 0 ? '+' : ''}${lag}  ${winLabel.padEnd(22)} IC=${ic.toFixed(4)}  N=${n}`);
  }
  console.log('\nIf IC peaks at lag=0 (T-1->T move), CG timestamp = the session date the flow measures.');
  console.log('That move is already realized by the T 00:00 close, so earliest honest entry = T close; the lag>=1 IC is the tradable forward edge.');
  process.exit(0);
}
main().catch(e => { console.error(e?.message ?? String(e)); process.exit(1); });

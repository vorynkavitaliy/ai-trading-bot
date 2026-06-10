/**
 * etf-flow-ic — IS/OOS Spearman rank-IC + quintile fwd-return spread of ETF net
 * flow signals vs OUR-candle daily forward returns. Read-only, no live-path edits.
 *
 * Archetypes (per task):
 *   - flow-follow      : daily net flow_usd            -> fwd ret  (FOLLOW: +flow => +ret)
 *   - flow-cum3        : 3d cumulative net flow         -> fwd ret
 *   - flow-cum7        : 7d cumulative net flow         -> fwd ret
 *   - flow-mom-z5      : zscore of trailing-5d cum flow -> fwd 3d ret (momentum)
 *   - flow-exhaustion  : single-day flow (FADE reading reported via sign of IC)
 *
 * Horizons: 1d, 3d, 5d. Both FOLLOW (as-is) and FADE (negate) read off the same IC sign.
 * Split: IS = older half, OOS = recent half, at midpoint of aligned sample.
 *
 * Forward return: close[t+H] / close[t] - 1 using OUR 1D candles aligned to the
 * ETF flow day timestamp (both at 00:00 UTC). Signal known at close of day t.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY_MS = 86_400_000;

interface FlowRow { ts: number; flow: number; price: number; }

async function fetchFlow(path: string): Promise<FlowRow[]> {
  const r = await cgGet<any>(path, {});
  const data = (r as any).data as any[];
  const out: FlowRow[] = [];
  for (const row of data) {
    const ts = Number(row.timestamp);
    const flow = row.flow_usd == null ? null : Number(row.flow_usd);
    const price = row.price_usd == null ? null : Number(row.price_usd);
    if (!Number.isFinite(ts)) continue;
    if (flow == null || !Number.isFinite(flow)) continue;
    out.push({ ts, flow, price: Number.isFinite(price as number) ? (price as number) : NaN });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// Map of 00:00-UTC-day-ms -> close, from OUR candles. We aggregate 240m candles
// to a UTC daily close (the last 240m candle whose ts < next day) to get full
// history independent of the 1D table coverage, then fall back to 1D table.
async function loadDailyCloses(symbol: string): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  // Prefer 240m -> daily close (last bar of each UTC day) for max coverage.
  const r = await query<any>(
    `SELECT DISTINCT ON (floor(ts/86400000)) floor(ts/86400000)*86400000 AS day_ms, close
       FROM candles
      WHERE symbol = $1 AND tf = '240m'
      ORDER BY floor(ts/86400000), ts DESC`,
    [symbol],
  );
  for (const row of r.rows) m.set(Number(row.day_ms), parseFloat(row.close));
  return m;
}

// ---- stats ----
function rank(arr: number[]): number[] {
  const idx = arr.map((v, i) => [v, i] as [number, number]);
  idx.sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank for ties
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

function spearman(x: number[], y: number[]): number {
  return pearson(rank(x), rank(y));
}

// top-vs-bottom quintile mean fwd-return spread (FOLLOW orientation: topQ - bottomQ)
function quintileSpread(sig: number[], ret: number[]): { top: number; bot: number; spread: number; nq: number } {
  const idx = sig.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const n = idx.length;
  const q = Math.floor(n / 5);
  if (q < 3) return { top: NaN, bot: NaN, spread: NaN, nq: q };
  let bot = 0, top = 0;
  for (let i = 0; i < q; i++) bot += ret[idx[i][1]];
  for (let i = n - q; i < n; i++) top += ret[idx[i][1]];
  bot /= q; top /= q;
  return { top, bot, spread: top - bot, nq: q };
}

interface SignalDef { name: string; horizon: number; build: (flows: number[]) => (number | null)[]; }

// build daily net-flow array helpers
function cumN(flows: number[], N: number): (number | null)[] {
  return flows.map((_, i) => {
    if (i < N - 1) return null;
    let s = 0;
    for (let k = i - N + 1; k <= i; k++) s += flows[k];
    return s;
  });
}
function zscoreTrailing(series: (number | null)[], win: number): (number | null)[] {
  // zscore of series value vs trailing `win` of the same series (excludes look-ahead)
  const out: (number | null)[] = series.map(() => null);
  for (let i = 0; i < series.length; i++) {
    if (series[i] == null) continue;
    const window: number[] = [];
    for (let k = i - win + 1; k <= i; k++) {
      if (k < 0) break;
      const v = series[k];
      if (v == null) { window.length = 0; break; }
      window.push(v);
    }
    if (window.length < win) continue;
    const m = window.reduce((a, b) => a + b, 0) / window.length;
    const sd = Math.sqrt(window.reduce((a, b) => a + (b - m) * (b - m), 0) / window.length);
    out[i] = sd === 0 ? 0 : (series[i] as number - m) / sd;
  }
  return out;
}

function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

async function analyze(label: string, flowPath: string, symbol: string) {
  console.log(`\n\n########## ${label}  (flow=${flowPath}, candles=${symbol}) ##########`);
  const flowRows = await fetchFlow(flowPath);
  const closes = await loadDailyCloses(symbol);

  // Align: for each flow day, need close[day] and close[day+H].
  // Drop the final row if flow==0 AND it's the latest (unsettled today) — generic: drop trailing rows whose flow==0 contiguous at the very end.
  let n = flowRows.length;
  while (n > 0 && flowRows[n - 1].flow === 0) n--;
  const rows = flowRows.slice(0, n);
  console.log(`flow rows total=${flowRows.length}, after trimming trailing-zero(unsettled)=${rows.length}`);
  if (rows.length) {
    console.log(`flow span: ${new Date(rows[0].ts).toISOString().slice(0,10)} .. ${new Date(rows[rows.length-1].ts).toISOString().slice(0,10)}`);
  }

  // Build a contiguous daily index keyed by day-ms present in BOTH flow and candle closes.
  // We only keep flow days that have a candle close (overlap window).
  const aligned: { ts: number; flow: number; close: number }[] = [];
  for (const fr of rows) {
    const dayMs = Math.floor(fr.ts / DAY_MS) * DAY_MS;
    const c = closes.get(dayMs);
    if (c != null && Number.isFinite(c)) aligned.push({ ts: dayMs, flow: fr.flow, close: c });
  }
  aligned.sort((a, b) => a.ts - b.ts);
  console.log(`aligned (flow day has our candle close): ${aligned.length}`);
  if (aligned.length) {
    console.log(`overlap span: ${new Date(aligned[0].ts).toISOString().slice(0,10)} .. ${new Date(aligned[aligned.length-1].ts).toISOString().slice(0,10)}`);
  }
  if (aligned.length < 80) {
    console.log(`*** DATA-INSUFFICIENT: aligned sample ${aligned.length} < 80, cannot split IS/OOS meaningfully.`);
    return;
  }

  const flowSeries = aligned.map(a => a.flow);
  const tsSeries = aligned.map(a => a.ts);

  // forward return uses the DENSE daily-close map (crypto trades 24/7, so every
  // calendar day has a close), indexing by actual calendar day t+H. ETF flows
  // exist only on US trading days, but the price series is continuous — so a flow
  // on Friday has a well-defined 1d/3d/5d fwd return into the weekend. This avoids
  // the sparse-index drift bug that was nuking the 3d/5d horizons.
  function fwdRet(i: number, H: number): number | null {
    const t0 = tsSeries[i];
    const c0 = closes.get(t0);
    const cH = closes.get(t0 + H * DAY_MS);
    if (c0 == null || cH == null || !Number.isFinite(c0) || !Number.isFinite(cH)) return null;
    return cH / c0 - 1;
  }

  // signal definitions
  const cum3 = cumN(flowSeries, 3);
  const cum7 = cumN(flowSeries, 7);
  const cum5 = cumN(flowSeries, 5);
  const z5 = zscoreTrailing(cum5, 20); // zscore of trailing-5d cum flow vs prior 20-window

  const signals: { name: string; vals: (number | null)[] }[] = [
    { name: 'daily-net-flow', vals: flowSeries.map(v => v) },
    { name: 'cum3-net-flow', vals: cum3 },
    { name: 'cum7-net-flow', vals: cum7 },
    { name: 'z5-cum5-flow-mom', vals: z5 },
  ];
  const horizons = [1, 3, 5];

  // header
  console.log(`\n${pad('signal',20)} ${pad('H',4)} ${pad('N_IS',6)} ${pad('IC_IS',9)} ${pad('N_OOS',6)} ${pad('IC_OOS',9)} ${pad('spreadIS%',11)} ${pad('spreadOOS%',11)} robust?`);
  console.log('-'.repeat(110));

  const findings: any[] = [];
  for (const sg of signals) {
    for (const H of horizons) {
      // build paired (signal, fwdret) where both defined
      const pairs: { idx: number; s: number; r: number }[] = [];
      for (let i = 0; i < aligned.length; i++) {
        const s = sg.vals[i];
        if (s == null || !Number.isFinite(s)) continue;
        const r = fwdRet(i, H);
        if (r == null || !Number.isFinite(r)) continue;
        pairs.push({ idx: i, s, r });
      }
      if (pairs.length < 60) {
        console.log(`${pad(sg.name,20)} ${pad(String(H)+'d',4)} too few pairs (${pairs.length})`);
        continue;
      }
      // IS = older half, OOS = recent half by aligned index midpoint
      const mid = Math.floor(pairs.length / 2);
      const is = pairs.slice(0, mid);
      const oos = pairs.slice(mid);
      const icIS = spearman(is.map(p => p.s), is.map(p => p.r));
      const icOOS = spearman(oos.map(p => p.s), oos.map(p => p.r));
      const qIS = quintileSpread(is.map(p => p.s), is.map(p => p.r));
      const qOOS = quintileSpread(oos.map(p => p.s), oos.map(p => p.r));
      const sameSign = Number.isFinite(icIS) && Number.isFinite(icOOS) && Math.sign(icIS) === Math.sign(icOOS) && icIS !== 0;
      const magOk = Math.abs(icIS) >= 0.05 && Math.abs(icOOS) >= 0.05;
      const quintSameSign = Number.isFinite(qIS.spread) && Number.isFinite(qOOS.spread) && Math.sign(qIS.spread) === Math.sign(qOOS.spread);
      const robust = (sameSign && magOk) || (quintSameSign && Math.abs(qIS.spread) > 0.003 && Math.abs(qOOS.spread) > 0.003 && sameSign);
      console.log(
        `${pad(sg.name,20)} ${pad(String(H)+'d',4)} ${pad(String(is.length),6)} ${pad(icIS.toFixed(4),9)} ${pad(String(oos.length),6)} ${pad(icOOS.toFixed(4),9)} ${pad((qIS.spread*100).toFixed(3),11)} ${pad((qOOS.spread*100).toFixed(3),11)} ${robust ? 'YES' : ''}`,
      );
      findings.push({ signal: sg.name, H, icIS, icOOS, qIS: qIS.spread, qOOS: qOOS.spread, nIS: is.length, nOOS: oos.length, robust, sameSign, magOk, quintSameSign });
    }
  }

  // full-sample IC for context (sign = FOLLOW if +, FADE if -)
  console.log(`\n-- full-sample IC (context; +IC => FOLLOW edge, -IC => FADE edge) --`);
  for (const sg of signals) {
    for (const H of horizons) {
      const s: number[] = [], r: number[] = [];
      for (let i = 0; i < aligned.length; i++) {
        const sv = sg.vals[i];
        if (sv == null || !Number.isFinite(sv)) continue;
        const rv = fwdRet(i, H);
        if (rv == null || !Number.isFinite(rv)) continue;
        s.push(sv); r.push(rv);
      }
      if (s.length < 30) continue;
      const ic = spearman(s, r);
      console.log(`  ${pad(sg.name,20)} ${pad(String(H)+'d',4)} N=${pad(String(s.length),5)} IC_full=${ic.toFixed(4)} ${ic > 0 ? '(FOLLOW)' : '(FADE)'}`);
    }
  }

  return findings;
}

async function main() {
  await analyze('BITCOIN ETF FLOW', '/etf/bitcoin/flow-history', 'BTCUSDT');
  await analyze('ETHEREUM ETF FLOW', '/etf/ethereum/flow-history', 'ETHUSDT');
  await analyze('SOLANA ETF FLOW', '/etf/solana/flow-history', 'SOLUSDT');
  process.exit(0);
}
main().catch(e => { console.error('etf-flow-ic crashed', e?.message ?? String(e)); process.exit(1); });

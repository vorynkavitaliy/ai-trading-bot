/**
 * macro-dom-rel-stress — stress the ONE survivor: BTC dominance LEVEL ->
 * (BTC minus equal-wt alt) fwd relative return. Question: is the negative IC a
 * repeatable conditional signal, or just one secular dominance drift over the
 * window? Decompose into QUARTERS and detrend the dominance level.
 */
import { query } from '../../core/db';
import { cgGet } from '../../core/coinglass';

const ALTS = ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'ATOMUSDT', 'ARBUSDT', 'INJUSDT'];
const DAY = 86400000;

async function loadDailyCloses(symbol: string): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts, close FROM candles WHERE symbol=$1 AND tf='1D' ORDER BY ts ASC`, [symbol]);
  const m = new Map<number, number>();
  for (const row of r.rows) {
    const d = new Date(Number(row.ts));
    m.set(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), parseFloat(row.close));
  }
  return m;
}
function dayKey(t: number): number { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

function spearman(x: number[], y: number[]): number {
  const n = x.length; if (n < 8) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n).fill(0); let i = 0;
    while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

async function main() {
  const winStart = Date.parse('2024-05-25T00:00:00Z');
  const btc = await loadDailyCloses('BTCUSDT');
  const alts = await Promise.all(ALTS.map(loadDailyCloses));

  const dom = await cgGet<any>('/index/bitcoin-dominance', {});
  const rows = (dom.data as any[]).map((r) => ({ ts: Number(r.timestamp), dom: Number(r.bitcoin_dominance) }))
    .filter((r) => r.ts >= winStart).sort((a, b) => a.ts - b.ts);

  const H = 9;
  // build aligned (raw dom level, detrended dom level via 30d=10-step MA, relRet, ts)
  const lvl: number[] = [], det: number[] = [], rel: number[] = [], ts: number[] = [];
  const win = 10; // ~30d
  for (let i = 0; i < rows.length; i++) {
    const k0 = dayKey(rows[i].ts);
    const b0 = btc.get(k0), b1 = btc.get(k0 + H * DAY);
    if (b0 === undefined || b1 === undefined || b0 <= 0) continue;
    const btcRet = b1 / b0 - 1;
    const ar: number[] = [];
    for (const m of alts) { const a0 = m.get(k0), a1 = m.get(k0 + H * DAY); if (a0 !== undefined && a1 !== undefined && a0 > 0) ar.push(a1 / a0 - 1); }
    if (ar.length < 3) continue;
    const altMean = ar.reduce((s, v) => s + v, 0) / ar.length;
    // detrend: dom minus trailing MA over prior `win` points
    let ma = NaN;
    if (i >= win) { let s = 0; for (let j = i - win; j < i; j++) s += rows[j].dom; ma = s / win; }
    lvl.push(rows[i].dom);
    det.push(Number.isNaN(ma) ? NaN : rows[i].dom - ma);
    rel.push(btcRet - altMean);
    ts.push(rows[i].ts);
  }

  console.log(`=== Dominance level -> BTC-minus-alt ${H}d relative; n=${lvl.length} ===`);
  console.log(`dom level range ${Math.min(...lvl).toFixed(2)}..${Math.max(...lvl).toFixed(2)}`);

  // QUARTER decomposition of the RAW LEVEL signal
  console.log('\n--- IC per ~quarter (raw dom level) ---');
  const q = Math.floor(lvl.length / 4);
  for (let qi = 0; qi < 4; qi++) {
    const a = qi * q, b = qi === 3 ? lvl.length : (qi + 1) * q;
    const ic = spearman(lvl.slice(a, b), rel.slice(a, b));
    const t0 = new Date(ts[a]).toISOString().slice(0, 10), t1 = new Date(ts[b - 1]).toISOString().slice(0, 10);
    const domLo = Math.min(...lvl.slice(a, b)).toFixed(1), domHi = Math.max(...lvl.slice(a, b)).toFixed(1);
    console.log(`  Q${qi + 1} ${t0}..${t1} (n=${b - a}) IC=${ic.toFixed(3)}  domRange ${domLo}..${domHi}`);
  }

  // DETRENDED signal IS/OOS (removes secular drift; tests conditional repeatability)
  const dIdx = det.map((v, i) => i).filter((i) => !Number.isNaN(det[i]));
  const dLvl = dIdx.map((i) => det[i]), dRel = dIdx.map((i) => rel[i]), dTs = dIdx.map((i) => ts[i]);
  const mid = Math.floor(dLvl.length / 2);
  console.log('\n--- DETRENDED dom (level minus 30d MA) -> relative ---');
  console.log(`  IC all=${spearman(dLvl, dRel).toFixed(3)}  IS=${spearman(dLvl.slice(0, mid), dRel.slice(0, mid)).toFixed(3)}  OOS=${spearman(dLvl.slice(mid), dRel.slice(mid)).toFixed(3)}  (n=${dLvl.length})`);

  // Also: does RAW LEVEL just track a monotone dominance-down, alts-up drift?
  // Correlate dom level with calendar index (time) to see secular structure.
  const tIdx = ts.map((_, i) => i);
  console.log(`\n  corr(dom level, time-index) Spearman=${spearman(lvl, tIdx).toFixed(3)}  (near +-1 => signal IS the trend)`);
  console.log(`  corr(rel ${H}d, time-index) Spearman=${spearman(rel, tIdx).toFixed(3)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });

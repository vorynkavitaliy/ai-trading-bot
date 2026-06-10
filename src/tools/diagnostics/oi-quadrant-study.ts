/**
 * oi-quadrant-study — OPEN INTEREST DYNAMICS family.
 *
 * Archetype A: OI x PRICE 4-quadrant regime.
 *   dOI = OI close %-change over the 4H bar; dP = price close %-change over the bar.
 *   Quadrant:
 *     Q1 price↑ OI↑ = new longs (continuation up, FOLLOW)
 *     Q2 price↓ OI↑ = new shorts (continuation down, FOLLOW)
 *     Q3 price↑ OI↓ = short covering (weak rally, FADE)
 *     Q4 price↓ OI↓ = long liquidation (capitulation, FADE/bounce)
 *   Test: forward return over H bars (24h=6, 48h=12) conditional on quadrant.
 *
 * Archetype B: OI-momentum standalone signal = z-score of dOI over a rolling window.
 *   Test Spearman rank-IC of (signal_t -> fwd return over H), FOLLOW and FADE reading.
 *
 * Data: cg_oi_aggregated (4H, cross-exchange OI close) JOINed to candles(240m) on ts.
 * Forward returns use the project's OWN price candles (tradable).
 * IS = older half, OOS = recent half, split at midpoint of aligned series.
 *
 * Read-only. No live-path files touched.
 */
import { query } from '../../core/db';

const FOUR_H = 4 * 3600 * 1000;

interface Row { ts: number; oi: number; px: number; }

// CG symbol -> candle symbol
const PAIRS: { cg: string; candle: string }[] = [
  { cg: 'BTC', candle: 'BTCUSDT' },
  { cg: 'SOL', candle: 'SOLUSDT' },
  { cg: 'ADA', candle: 'ADAUSDT' },
  { cg: 'LINK', candle: 'LINKUSDT' },
];

const HORIZONS = [6, 12]; // bars: 24h, 48h
const ZWIN = 30; // rolling window for dOI z-score (~5 days of 4H bars)
const ROLL_PCT_WIN = 180; // 30d rolling for percentile context (not core)

async function loadAligned(cg: string, candle: string): Promise<Row[]> {
  // OI rows
  const oiR = await query<any>(
    `SELECT ts::text AS ts, oi_close::text AS oi FROM cg_oi_aggregated WHERE symbol=$1 ORDER BY ts ASC`,
    [cg],
  );
  // candle 240m closes, keyed by ts
  const cR = await query<any>(
    `SELECT ts::text AS ts, close::text AS px FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`,
    [candle],
  );
  const pxByTs = new Map<number, number>();
  for (const r of cR.rows) pxByTs.set(Number(r.ts), Number(r.px));

  const out: Row[] = [];
  for (const r of oiR.rows) {
    const ts = Number(r.ts);
    const px = pxByTs.get(ts);
    if (px === undefined) continue; // require exact bar alignment
    const oi = Number(r.oi);
    if (!Number.isFinite(oi) || !Number.isFinite(px) || oi <= 0 || px <= 0) continue;
    out.push({ ts, oi, px });
  }
  return out;
}

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 10) return NaN;
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
    const r = new Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = ra[i] - ma, xb = rb[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}

function quantileLabel(vals: number[], idx: number, sortedRef: number[]): number {
  // returns quintile 0..4 of vals[idx] relative to sortedRef
  const v = vals[idx];
  let lo = 0, hi = sortedRef.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sortedRef[m] < v) lo = m + 1; else hi = m; }
  const pct = lo / sortedRef.length;
  return Math.min(4, Math.floor(pct * 5));
}

function mean(a: number[]): number { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }

interface QuadStat { n: number; meanFwd: number; winRate: number; }

function analyze(rows: Row[], label: string) {
  const n = rows.length;
  if (n < 100) { console.log(`\n### ${label}: only ${n} aligned bars — data-insufficient`); return; }

  // precompute dOI, dP at bar t (close_t vs close_{t-1})
  const dOI: number[] = new Array(n).fill(NaN);
  const dP: number[] = new Array(n).fill(NaN);
  for (let t = 1; t < n; t++) {
    dOI[t] = (rows[t].oi - rows[t - 1].oi) / rows[t - 1].oi;
    dP[t] = (rows[t].px - rows[t - 1].px) / rows[t - 1].px;
  }
  // fwd returns from close_t to close_{t+H}
  const fwd: Record<number, number[]> = {};
  for (const H of HORIZONS) {
    const f = new Array(n).fill(NaN);
    for (let t = 0; t + H < n; t++) f[t] = (rows[t + H].px - rows[t].px) / rows[t].px;
    fwd[H] = f;
  }
  // dOI z-score rolling
  const z: number[] = new Array(n).fill(NaN);
  for (let t = ZWIN; t < n; t++) {
    const w = dOI.slice(t - ZWIN, t).filter(Number.isFinite);
    if (w.length < ZWIN / 2) continue;
    const m = mean(w);
    const sd = Math.sqrt(mean(w.map(x => (x - m) ** 2)));
    z[t] = sd > 0 ? (dOI[t] - m) / sd : NaN;
  }

  const mid = Math.floor(n / 2);
  const halves: [string, number, number][] = [['IS', 0, mid], ['OOS', mid, n]];

  console.log(`\n### ${label}  (aligned bars=${n}, IS=[0,${mid}) OOS=[${mid},${n}))`);
  console.log(`  span: ${new Date(rows[0].ts).toISOString().slice(0,10)} -> ${new Date(rows[mid].ts).toISOString().slice(0,10)} -> ${new Date(rows[n-1].ts).toISOString().slice(0,10)}`);

  // ---------- Archetype A: quadrant fwd return ----------
  for (const H of HORIZONS) {
    console.log(`  -- Quadrant fwd return, H=${H} bars (${H*4}h) --`);
    for (const [hlabel, lo, hi] of halves) {
      const stats: Record<string, number[]> = { Q1: [], Q2: [], Q3: [], Q4: [] };
      for (let t = lo; t < hi; t++) {
        if (!Number.isFinite(dOI[t]) || !Number.isFinite(dP[t]) || !Number.isFinite(fwd[H][t])) continue;
        const oiUp = dOI[t] > 0, pUp = dP[t] > 0;
        const q = pUp && oiUp ? 'Q1' : (!pUp && oiUp ? 'Q2' : (pUp && !oiUp ? 'Q3' : 'Q4'));
        stats[q].push(fwd[H][t]);
      }
      const fmt = (arr: number[]) => arr.length ? `n=${String(arr.length).padStart(4)} mean=${(mean(arr)*100).toFixed(3)}% wr=${(arr.filter(x=>x>0).length/arr.length*100).toFixed(1)}%` : 'n=0';
      console.log(`     ${hlabel}: Q1(P↑OI↑newLong) ${fmt(stats.Q1)}`);
      console.log(`         Q2(P↓OI↑newShort) ${fmt(stats.Q2)}`);
      console.log(`         Q3(P↑OI↓shortCov) ${fmt(stats.Q3)}`);
      console.log(`         Q4(P↓OI↓liquid)   ${fmt(stats.Q4)}`);
    }
  }

  // ---------- Archetype B: dOI z-score IC (FOLLOW reading: sign of IC) ----------
  for (const H of HORIZONS) {
    console.log(`  -- dOI z-score -> fwd return IC, H=${H} bars --`);
    for (const [hlabel, lo, hi] of halves) {
      const sig: number[] = [], ret: number[] = [];
      for (let t = lo; t < hi; t++) {
        if (Number.isFinite(z[t]) && Number.isFinite(fwd[H][t])) { sig.push(z[t]); ret.push(fwd[H][t]); }
      }
      const ic = spearman(sig, ret);
      console.log(`     ${hlabel}: n=${sig.length} IC(follow)=${ic.toFixed(4)} (FADE=${(-ic).toFixed(4)})`);
    }
  }

  // ---------- Archetype B2: signed-OI momentum = dOI z * sign(dP) ----------
  // Captures "OI building in the direction of the move" (continuation) as one scalar.
  for (const H of HORIZONS) {
    console.log(`  -- signed dOI-mom (z*sign(dP)) -> fwd return IC, H=${H} bars --`);
    for (const [hlabel, lo, hi] of halves) {
      const sig: number[] = [], ret: number[] = [];
      for (let t = lo; t < hi; t++) {
        if (Number.isFinite(z[t]) && Number.isFinite(dP[t]) && Number.isFinite(fwd[H][t])) {
          sig.push(z[t] * Math.sign(dP[t])); ret.push(fwd[H][t]);
        }
      }
      const ic = spearman(sig, ret);
      // quintile spread
      const sorted = [...sig].sort((a, b) => a - b);
      const buckets: number[][] = [[], [], [], [], []];
      for (let i = 0; i < sig.length; i++) buckets[quantileLabel(sig, i, sorted)].push(ret[i]);
      const top = mean(buckets[4]) * 100, bot = mean(buckets[0]) * 100;
      console.log(`     ${hlabel}: n=${sig.length} IC=${ic.toFixed(4)}  Qtop=${top.toFixed(3)}% Qbot=${bot.toFixed(3)}% spread=${(top-bot).toFixed(3)}%`);
    }
  }

  // ---------- Archetype C: raw dP momentum (CONTROL - is OI adding anything?) ----------
  for (const H of HORIZONS) {
    console.log(`  -- CONTROL: raw dP -> fwd return IC, H=${H} bars --`);
    for (const [hlabel, lo, hi] of halves) {
      const sig: number[] = [], ret: number[] = [];
      for (let t = lo; t < hi; t++) {
        if (Number.isFinite(dP[t]) && Number.isFinite(fwd[H][t])) { sig.push(dP[t]); ret.push(fwd[H][t]); }
      }
      console.log(`     ${hlabel}: n=${sig.length} IC=${spearman(sig, ret).toFixed(4)}`);
    }
  }
}

async function main() {
  for (const p of PAIRS) {
    const rows = await loadAligned(p.cg, p.candle);
    analyze(rows, `${p.candle} (cg=${p.cg})`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

/**
 * oi-quadrant-pooled — pool the OI x price quadrant fwd-return test across the
 * 4-pair book (BTC/SOL/ADA/LINK), IS vs OOS, to give each quadrant more n and
 * see if any quadrant has a cross-pair-stable directional payoff.
 * Returns are demeaned per-half-per-pair (subtract that pair-half's mean fwd ret)
 * so the down-trending recent half doesn't dominate — we want the quadrant's
 * RELATIVE edge, which is what a long/short strategy actually captures.
 */
import { query } from '../../core/db';

const PAIRS: { cg: string; candle: string }[] = [
  { cg: 'BTC', candle: 'BTCUSDT' },
  { cg: 'SOL', candle: 'SOLUSDT' },
  { cg: 'ADA', candle: 'ADAUSDT' },
  { cg: 'LINK', candle: 'LINKUSDT' },
];
const HORIZONS = [6, 12];

interface Row { ts: number; oi: number; px: number; }

async function loadAligned(cg: string, candle: string): Promise<Row[]> {
  const oiR = await query<any>(`SELECT ts::text AS ts, oi_close::text AS oi FROM cg_oi_aggregated WHERE symbol=$1 ORDER BY ts ASC`, [cg]);
  const cR = await query<any>(`SELECT ts::text AS ts, close::text AS px FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [candle]);
  const pxByTs = new Map<number, number>();
  for (const r of cR.rows) pxByTs.set(Number(r.ts), Number(r.px));
  const out: Row[] = [];
  for (const r of oiR.rows) {
    const ts = Number(r.ts), px = pxByTs.get(ts);
    if (px === undefined) continue;
    const oi = Number(r.oi);
    if (oi > 0 && px > 0) out.push({ ts, oi, px });
  }
  return out;
}
function mean(a: number[]): number { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }

async function main() {
  for (const H of HORIZONS) {
    // accumulate demeaned fwd returns per quadrant per half across pairs
    const acc: Record<string, Record<string, number[]>> = {
      IS: { Q1: [], Q2: [], Q3: [], Q4: [] },
      OOS: { Q1: [], Q2: [], Q3: [], Q4: [] },
    };
    for (const p of PAIRS) {
      const rows = await loadAligned(p.cg, p.candle);
      const n = rows.length;
      const mid = Math.floor(n / 2);
      for (const [hlabel, lo, hi] of [['IS', 1, mid], ['OOS', mid, n]] as [string, number, number][]) {
        // collect this pair-half fwd returns to compute the half mean
        const recs: { q: string; r: number }[] = [];
        for (let t = lo; t < hi && t + H < n; t++) {
          const dOI = (rows[t].oi - rows[t - 1].oi) / rows[t - 1].oi;
          const dP = (rows[t].px - rows[t - 1].px) / rows[t - 1].px;
          const fr = (rows[t + H].px - rows[t].px) / rows[t].px;
          if (!Number.isFinite(dOI) || !Number.isFinite(dP) || !Number.isFinite(fr)) continue;
          const q = dP > 0 && dOI > 0 ? 'Q1' : (dP <= 0 && dOI > 0 ? 'Q2' : (dP > 0 && dOI <= 0 ? 'Q3' : 'Q4'));
          recs.push({ q, r: fr });
        }
        const hm = mean(recs.map(x => x.r));
        for (const rec of recs) acc[hlabel][rec.q].push(rec.r - hm); // demeaned
      }
    }
    console.log(`\n=== POOLED quadrant, H=${H} bars (${H*4}h), demeaned-per-pair-half (RELATIVE edge) ===`);
    const names: Record<string, string> = { Q1: 'P↑OI↑ newLong', Q2: 'P↓OI↑ newShort', Q3: 'P↑OI↓ shortCov', Q4: 'P↓OI↓ liquid' };
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
      const is = acc.IS[q], oos = acc.OOS[q];
      const im = mean(is) * 100, om = mean(oos) * 100;
      const sameSign = Number.isFinite(im) && Number.isFinite(om) && Math.sign(im) === Math.sign(om);
      console.log(`  ${q} ${names[q].padEnd(16)} IS n=${String(is.length).padStart(5)} relMean=${im.toFixed(4)}%   OOS n=${String(oos.length).padStart(5)} relMean=${om.toFixed(4)}%   ${sameSign ? 'SAME-SIGN' : 'flip'}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

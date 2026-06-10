/**
 * cg-basis-ic — IS/OOS Spearman rank-IC + quintile fwd-return spread of Coinglass
 * Futures Basis (spot-perp) signals vs OUR 4H candle forward returns. Read-only.
 *
 * Endpoint: /futures/basis/history (exchange=Binance, symbol=<PAIR>, interval=4h).
 * Row shape: {time(ms), open_basis, close_basis, open_change, close_change}.
 *   close_basis  = spot-perp basis as % (e.g. 0.06 = +0.06%)  -> basis LEVEL
 *   close_change = annualized basis % (≈ close_basis * factor) -> same info, scaled
 *   We use close_basis as the LEVEL and compute our own bar-to-bar CHANGE / z-score.
 *
 * Archetypes (per task):
 *   - basis LEVEL high  -> leveraged-long excess -> FADE (expect -ret).  IC<0 => fade edge.
 *   - basis LEVEL low/neg -> capitulation        -> LONG (expect +ret).  same IC sign.
 *   - basis CHANGE (rising) as FADE and as FOLLOW (read off IC sign).
 *   - basis z-score (level vs trailing window) as the normalized extreme.
 *
 * Horizons (4h data): 12h=3bars, 24h=6bars, 48h=12bars. fwd = close[t+H]/close[t]-1.
 * Split: IS = older half, OOS = recent half at midpoint of aligned sample.
 *
 * Orthogonality for the single best signal:
 *   - corr vs funding_oi percentile (the live fade) — same-window percentile.
 *   - corr vs trailing same-horizon price return (lagged-momentum repackaging check).
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const BAR_MS = 4 * 3600 * 1000;

interface PairSpec { pair: string; coin: string; }
const PAIRS: PairSpec[] = [
  { pair: 'BTCUSDT', coin: 'BTC' },
  { pair: 'SOLUSDT', coin: 'SOL' },
  { pair: 'ADAUSDT', coin: 'ADA' },
  { pair: 'LINKUSDT', coin: 'LINK' },
  { pair: 'ETHUSDT', coin: 'ETH' },
];

// ---------- data fetch ----------
interface BasisRow { ts: number; level: number; change: number; }

async function fetchBasis(pair: string): Promise<BasisRow[]> {
  const r = await cgGet<any[]>('/futures/basis/history', { exchange: 'Binance', symbol: pair, interval: '4h', limit: 4500 });
  const arr = (r as any).data as any[];
  const out: BasisRow[] = [];
  for (const row of arr) {
    const ts = Number(row.time);
    const level = row.close_basis == null ? null : Number(row.close_basis);
    const change = row.close_change == null ? null : Number(row.close_change);
    if (!Number.isFinite(ts) || level == null || !Number.isFinite(level)) continue;
    out.push({ ts, level, change: Number.isFinite(change as number) ? (change as number) : NaN });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

async function loadCloses(pair: string): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  const r = await query<any>(
    `SELECT ts::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair],
  );
  for (const row of r.rows) m.set(parseInt(row.ts, 10), parseFloat(row.close));
  return m;
}

// funding_oi history for orthogonality (symbol = coin), as ts->fr_close map
async function loadFunding(coin: string): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  const r = await query<any>(
    `SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts ASC`, [coin],
  );
  for (const row of r.rows) m.set(parseInt(row.ts, 10), parseFloat(row.fr_close));
  return m;
}

// ---------- stats ----------
function rank(arr: number[]): number[] {
  const idx = arr.map((v, i) => [v, i] as [number, number]);
  idx.sort((a, b) => a[0] - b[0]);
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
  const n = a.length;
  if (n < 3) return NaN;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}
function spearman(x: number[], y: number[]): number { return pearson(rank(x), rank(y)); }

function quintileSpread(sig: number[], ret: number[]): { spread: number; nq: number } {
  const idx = sig.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const n = idx.length;
  const q = Math.floor(n / 5);
  if (q < 3) return { spread: NaN, nq: q };
  let bot = 0, top = 0;
  for (let i = 0; i < q; i++) bot += ret[idx[i][1]];
  for (let i = n - q; i < n; i++) top += ret[idx[i][1]];
  return { spread: top / q - bot / q, nq: q };
}

// z-score of value vs trailing `win` of the same series (no look-ahead)
function zscoreTrailing(series: (number | null)[], win: number): (number | null)[] {
  const out: (number | null)[] = series.map(() => null);
  for (let i = 0; i < series.length; i++) {
    if (series[i] == null) continue;
    const window: number[] = [];
    for (let k = i - win + 1; k <= i; k++) {
      if (k < 0) { window.length = 0; break; }
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

// trailing percentile of value vs prior `win` (no look-ahead), 0..1
function pctTrailing(series: (number | null)[], win: number): (number | null)[] {
  const out: (number | null)[] = series.map(() => null);
  for (let i = 0; i < series.length; i++) {
    if (series[i] == null) continue;
    const window: number[] = [];
    for (let k = i - win; k < i; k++) {
      if (k < 0) continue;
      const v = series[k];
      if (v != null && Number.isFinite(v)) window.push(v);
    }
    if (window.length < Math.floor(win / 2)) continue;
    const v = series[i] as number;
    let cnt = 0;
    for (const w of window) if (w <= v) cnt++;
    out[i] = cnt / window.length;
  }
  return out;
}

function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

const HORIZONS = [3, 6, 12]; // bars: 12h, 24h, 48h
const HLABEL: Record<number, string> = { 3: '12h', 6: '24h', 12: '48h' };

interface Finding {
  pair: string; signal: string; H: number;
  icIS: number; icOOS: number; qIS: number; qOOS: number;
  nIS: number; nOOS: number; robust: boolean;
  // best-signal extras filled later
}

async function analyze(spec: PairSpec): Promise<{ findings: Finding[]; aligned: any[]; }> {
  const { pair, coin } = spec;
  console.log(`\n\n########## ${pair} (coin=${coin}) ##########`);
  const basis = await fetchBasis(pair);
  const closes = await loadCloses(pair);
  const funding = await loadFunding(coin);

  // align basis bar ts -> our candle close at same ts
  const aligned: { ts: number; level: number; change: number; close: number; fund: number | null }[] = [];
  for (const b of basis) {
    const c = closes.get(b.ts);
    if (c == null || !Number.isFinite(c)) continue;
    // funding at or just before ts (cg_funding stored at same 4h grid typically)
    let fund: number | null = funding.get(b.ts) ?? null;
    aligned.push({ ts: b.ts, level: b.level, change: b.change, close: c, fund });
  }
  aligned.sort((a, b) => a.ts - b.ts);
  console.log(`basis rows=${basis.length}, aligned(has candle)=${aligned.length}`);
  if (aligned.length) {
    console.log(`overlap: ${new Date(aligned[0].ts).toISOString().slice(0,10)} .. ${new Date(aligned[aligned.length-1].ts).toISOString().slice(0,10)}`);
  }
  if (aligned.length < 200) {
    console.log(`*** DATA-INSUFFICIENT: aligned ${aligned.length} < 200`);
    return { findings: [], aligned };
  }

  const tsSeries = aligned.map(a => a.ts);
  const levelSeries = aligned.map(a => a.level);
  // bar-to-bar change of LEVEL (basis delta)
  const dLevel: (number | null)[] = aligned.map((a, i) => i === 0 ? null : a.level - aligned[i - 1].level);
  // 3-bar (12h) change of level
  const d3Level: (number | null)[] = aligned.map((a, i) => i < 3 ? null : a.level - aligned[i - 3].level);
  const zLevel = zscoreTrailing(levelSeries, 30); // ~5d trailing window
  const pctLevel = pctTrailing(levelSeries, 180); // ~30d trailing percentile (mirrors live percentile windows)

  function fwdRet(i: number, H: number): number | null {
    const c0 = aligned[i].close;
    const cH = closes.get(tsSeries[i] + H * BAR_MS);
    if (c0 == null || cH == null || !Number.isFinite(c0) || !Number.isFinite(cH)) return null;
    return cH / c0 - 1;
  }

  const signals: { name: string; vals: (number | null)[] }[] = [
    { name: 'basis-level', vals: levelSeries.map(v => v) },
    { name: 'basis-pct180', vals: pctLevel },
    { name: 'basis-z30', vals: zLevel },
    { name: 'basis-dLevel-1', vals: dLevel },
    { name: 'basis-dLevel-3', vals: d3Level },
  ];

  console.log(`\n${pad('signal',16)} ${pad('H',5)} ${pad('N_IS',6)} ${pad('IC_IS',9)} ${pad('N_OOS',6)} ${pad('IC_OOS',9)} ${pad('spIS%',9)} ${pad('spOOS%',9)} robust`);
  console.log('-'.repeat(100));

  const findings: Finding[] = [];
  for (const sg of signals) {
    for (const H of HORIZONS) {
      const pairsArr: { idx: number; s: number; r: number }[] = [];
      for (let i = 0; i < aligned.length; i++) {
        const s = sg.vals[i];
        if (s == null || !Number.isFinite(s)) continue;
        const r = fwdRet(i, H);
        if (r == null || !Number.isFinite(r)) continue;
        pairsArr.push({ idx: i, s, r });
      }
      if (pairsArr.length < 120) {
        console.log(`${pad(sg.name,16)} ${pad(HLABEL[H],5)} too few pairs (${pairsArr.length})`);
        continue;
      }
      const mid = Math.floor(pairsArr.length / 2);
      const is = pairsArr.slice(0, mid);
      const oos = pairsArr.slice(mid);
      const icIS = spearman(is.map(p => p.s), is.map(p => p.r));
      const icOOS = spearman(oos.map(p => p.s), oos.map(p => p.r));
      const qIS = quintileSpread(is.map(p => p.s), is.map(p => p.r)).spread;
      const qOOS = quintileSpread(oos.map(p => p.s), oos.map(p => p.r)).spread;
      const sameSign = Number.isFinite(icIS) && Number.isFinite(icOOS) && Math.sign(icIS) === Math.sign(icOOS) && icIS !== 0;
      const magOk = Math.abs(icIS) >= 0.05 && Math.abs(icOOS) >= 0.05;
      const quintRobust = Number.isFinite(qIS) && Number.isFinite(qOOS) && Math.sign(qIS) === Math.sign(qOOS) && Math.abs(qIS) > 0.003 && Math.abs(qOOS) > 0.003;
      const robust = (sameSign && magOk) || (sameSign && quintRobust);
      console.log(
        `${pad(sg.name,16)} ${pad(HLABEL[H],5)} ${pad(String(is.length),6)} ${pad(icIS.toFixed(4),9)} ${pad(String(oos.length),6)} ${pad(icOOS.toFixed(4),9)} ${pad((qIS*100).toFixed(3),9)} ${pad((qOOS*100).toFixed(3),9)} ${robust ? 'YES' : ''}`,
      );
      findings.push({ pair, signal: sg.name, H, icIS, icOOS, qIS, qOOS, nIS: is.length, nOOS: oos.length, robust });
    }
  }

  return { findings, aligned: aligned.map((a, i) => ({ ...a, idx: i, levelSeries, pctLevel, zLevel, dLevel, d3Level })) };
}

async function main() {
  const all: Finding[] = [];
  const ctx: Record<string, any> = {};
  for (const spec of PAIRS) {
    const { findings, aligned } = await analyze(spec);
    all.push(...findings);
    ctx[spec.pair] = aligned;
    await new Promise(r => setTimeout(r, 400));
  }

  // ---- summary: robust findings ----
  console.log(`\n\n=== ROBUST FINDINGS (same-sign both halves, |IC|>=0.05 OR quintile-robust) ===`);
  const robust = all.filter(f => f.robust);
  if (!robust.length) console.log('NONE clear the discipline bar.');
  for (const f of robust) {
    const dir = f.icOOS < 0 ? 'FADE' : 'FOLLOW';
    console.log(`${pad(f.pair,8)} ${pad(f.signal,16)} ${pad(HLABEL[f.H],5)} IC_IS=${f.icIS.toFixed(4)} IC_OOS=${f.icOOS.toFixed(4)} spIS=${(f.qIS*100).toFixed(3)}% spOOS=${(f.qOOS*100).toFixed(3)}% -> ${dir}`);
  }

  // ---- near-misses (same sign both halves, |IC|>=0.04 on at least OOS) for context ----
  console.log(`\n=== NEAR-MISSES (same-sign both halves, |IC_OOS|>=0.04) ===`);
  for (const f of all) {
    if (f.robust) continue;
    const same = Math.sign(f.icIS) === Math.sign(f.icOOS) && f.icIS !== 0;
    if (same && Math.abs(f.icOOS) >= 0.04) {
      console.log(`${pad(f.pair,8)} ${pad(f.signal,16)} ${pad(HLABEL[f.H],5)} IC_IS=${f.icIS.toFixed(4)} IC_OOS=${f.icOOS.toFixed(4)}`);
    }
  }

  // ---- best signal per pair (max |min(|IC_IS|,|IC_OOS|)| among same-sign) ----
  console.log(`\n=== STRONGEST SAME-SIGN SIGNAL PER PAIR (by min|IC| across halves) ===`);
  const byPair: Record<string, Finding[]> = {};
  for (const f of all) (byPair[f.pair] ??= []).push(f);
  const orthoTargets: { pair: string; f: Finding }[] = [];
  for (const [pair, fs] of Object.entries(byPair)) {
    const cand = fs.filter(f => Math.sign(f.icIS) === Math.sign(f.icOOS) && f.icIS !== 0);
    if (!cand.length) { console.log(`${pad(pair,8)} no same-sign signal`); continue; }
    cand.sort((a, b) => Math.min(Math.abs(b.icIS), Math.abs(b.icOOS)) - Math.min(Math.abs(a.icIS), Math.abs(a.icOOS)));
    const best = cand[0];
    console.log(`${pad(pair,8)} ${pad(best.signal,16)} ${pad(HLABEL[best.H],5)} IC_IS=${best.icIS.toFixed(4)} IC_OOS=${best.icOOS.toFixed(4)} min|IC|=${Math.min(Math.abs(best.icIS),Math.abs(best.icOOS)).toFixed(4)}`);
    orthoTargets.push({ pair, f: best });
  }

  // ---- orthogonality for each pair's best signal ----
  console.log(`\n\n=== ORTHOGONALITY (best same-sign signal per pair) ===`);
  console.log(`${pad('pair',8)} ${pad('signal',16)} ${pad('H',5)} ${pad('corr_vs_fundPct',16)} ${pad('corr_vs_trailRet',16)} note`);
  console.log('-'.repeat(90));
  for (const { pair, f } of orthoTargets) {
    const aligned = ctx[pair] as any[];
    if (!aligned || !aligned.length) { console.log(`${pad(pair,8)} no ctx`); continue; }
    // reconstruct the signal series
    const sigVals: (number | null)[] =
      f.signal === 'basis-level' ? aligned.map(a => a.level) :
      f.signal === 'basis-pct180' ? aligned[0].pctLevel :
      f.signal === 'basis-z30' ? aligned[0].zLevel :
      f.signal === 'basis-dLevel-1' ? aligned[0].dLevel :
      f.signal === 'basis-dLevel-3' ? aligned[0].d3Level : aligned.map(a => a.level);

    // funding percentile (trailing 180) for the same aligned grid
    const fundSeries: (number | null)[] = aligned.map(a => a.fund);
    const fundPct = pctTrailing(fundSeries, 180);
    // trailing same-horizon price return: ret over the PRIOR H bars (lagged momentum)
    const trailRet: (number | null)[] = aligned.map((a, i) => {
      if (i < f.H) return null;
      const c0 = aligned[i - f.H].close, c1 = a.close;
      if (!Number.isFinite(c0) || !Number.isFinite(c1) || c0 === 0) return null;
      return c1 / c0 - 1;
    });

    // pair up where signal + each target defined
    const sA: number[] = [], fA: number[] = [], tA: number[] = [];
    for (let i = 0; i < aligned.length; i++) {
      const s = sigVals[i];
      if (s == null || !Number.isFinite(s)) continue;
      const fp = fundPct[i], tr = trailRet[i];
      if (fp != null && Number.isFinite(fp)) { /* collect later jointly */ }
    }
    // joint-defined for fund corr
    const sf1: number[] = [], ff: number[] = [];
    for (let i = 0; i < aligned.length; i++) {
      const s = sigVals[i], fp = fundPct[i];
      if (s == null || !Number.isFinite(s) || fp == null || !Number.isFinite(fp)) continue;
      sf1.push(s); ff.push(fp);
    }
    const sf2: number[] = [], tt: number[] = [];
    for (let i = 0; i < aligned.length; i++) {
      const s = sigVals[i], tr = trailRet[i];
      if (s == null || !Number.isFinite(s) || tr == null || !Number.isFinite(tr)) continue;
      sf2.push(s); tt.push(tr);
    }
    const cFund = sf1.length >= 30 ? spearman(sf1, ff) : NaN;
    const cTrail = sf2.length >= 30 ? spearman(sf2, tt) : NaN;
    const note = (Math.abs(cTrail) > 0.5 ? 'HIGH lagged-mom overlap' : Math.abs(cFund) > 0.5 ? 'HIGH funding overlap' : 'orthogonal-ish');
    console.log(`${pad(pair,8)} ${pad(f.signal,16)} ${pad(HLABEL[f.H],5)} ${pad((Number.isFinite(cFund)?cFund.toFixed(4):'NA')+` (n=${sf1.length})`,16)} ${pad((Number.isFinite(cTrail)?cTrail.toFixed(4):'NA')+` (n=${sf2.length})`,16)} ${note}`);
  }

  process.exit(0);
}
main().catch(e => { console.error('cg-basis-ic crashed', e?.message ?? String(e)); process.exit(1); });

/**
 * OVERLAY D — PER-PAIR BEST-SIGNAL SELECTION (signal swap test).
 *
 * For each live fade pair, rank the candidate CG fade signals by FADE QUALITY of the
 * entries the strategy would actually fire (percentile-extreme of the signal over a
 * rolling 180×4H window — identical to cg-fade.ts), measured on the forward 24h/48h
 * return signed by the fade side (long => +fwd, short => -fwd). Split IS (older half) /
 * OOS (recent half). An overlay (signal swap) "survives" only if a NON-live candidate
 * beats the pair's live signal on BOTH halves.
 *
 * Candidates: funding_oi, funding_vol, ls_top_position, ls_top_account, and the two
 * confluences (funding+ls_top_account [=S4], funding+ls_top_position [=S5]).
 *
 * We evaluate every candidate at the SAME thresholds the pair runs live (apples-to-apples
 * "what if we just swap the signal"), and also at a common .75/.25 so the ranking is not
 * an artifact of one pair's threshold choice.
 *
 * Reads candles + cg_* tables. Read-only. Forward returns from project 4H candles.
 *
 * Run: npx tsx src/tools/diagnostics/overlay-d-signal-selection.ts
 */
import { query, close as closePg } from '../../core/db';
import { percentile } from '../../core/indicators';

type Row = { ts: number; val: number };

interface PairCfg { pair: string; live: string; pctHi: number; pctLo: number; }

// Live per-pair config (from src/runtime/pair-strategies.ts).
//   BTC = ls_top_position fade .85/.15   (S1, useBtcTrend)
//   SOL = funding_oi fade .70/.30        (S3)
//   ADA = funding_oi fade .75/.25        (S3)
//   LINK = funding+ls_top_account conf .70/.30 (S4)
const PAIRS: PairCfg[] = [
  { pair: 'BTCUSDT', live: 'ls_top_position', pctHi: 0.85, pctLo: 0.15 },
  { pair: 'SOLUSDT', live: 'funding_oi', pctHi: 0.70, pctLo: 0.30 },
  { pair: 'ADAUSDT', live: 'funding_oi', pctHi: 0.75, pctLo: 0.25 },
  { pair: 'LINKUSDT', live: 'conf_f_ta', pctHi: 0.70, pctLo: 0.30 },
];

const WINDOW = 180;        // rolling percentile window (30d at 4H) — matches strategy
const K24 = 6, K48 = 12;   // forward bars: 24h, 48h

async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows
    .map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) }))
    .filter((r: Row) => isFinite(r.val))
    .sort((a: Row, b: Row) => a.ts - b.ts);
}

// latest signal value at ts' <= barTs[i] (no look-ahead)
function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) {
    while (j < series.length && series[j].ts <= barTs[i]) j++;
    out[i] = j > 0 ? series[j - 1].val : null;
  }
  return out;
}

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  for (let k = 0; k < idx.length; k++) r[idx[k][1]] = k + 1;
  return r;
}
function spearman(x: (number | null)[], y: (number | null)[]): number {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); }
  }
  const n = xs.length;
  if (n < 30) return NaN;
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return num / Math.sqrt(dx * dy);
}

// Rolling-percentile fade side at each bar i for a single-signal candidate.
function fadeSideSingle(aligned: (number | null)[], i: number, pctHi: number, pctLo: number): 'long' | 'short' | null {
  if (i < WINDOW) return null;
  const cur = aligned[i];
  if (cur == null) return null;
  const win: number[] = [];
  for (let k = i - WINDOW; k < i; k++) { const v = aligned[k]; if (v != null) win.push(v); }
  if (win.length < WINDOW * 0.8) return null;
  const pct = percentile(win, cur);
  if (pct >= pctHi) return 'short';
  if (pct <= pctLo) return 'long';
  return null;
}

// Confluence fade: both component signals extreme same direction (S4/S5).
function fadeSideConf(a1: (number | null)[], a2: (number | null)[], i: number, pctHi: number, pctLo: number): 'long' | 'short' | null {
  if (i < WINDOW) return null;
  const c1 = a1[i], c2 = a2[i];
  if (c1 == null || c2 == null) return null;
  const w1: number[] = [], w2: number[] = [];
  for (let k = i - WINDOW; k < i; k++) { if (a1[k] != null) w1.push(a1[k] as number); if (a2[k] != null) w2.push(a2[k] as number); }
  if (w1.length < WINDOW * 0.8 || w2.length < WINDOW * 0.8) return null;
  const p1 = percentile(w1, c1), p2 = percentile(w2, c2);
  if (p1 >= pctHi && p2 >= pctHi) return 'short';
  if (p1 <= pctLo && p2 <= pctLo) return 'long';
  return null;
}

interface FadeStat { n: number; mean24: number; mean48: number; wr24: number; }
function emptyStat(): FadeStat { return { n: 0, mean24: NaN, mean48: NaN, wr24: NaN }; }

// Aggregate fade-entry forward returns over an index range [lo,hi).
function fadeStats(
  sides: ('long' | 'short' | null)[],
  fwd24: (number | null)[],
  fwd48: (number | null)[],
  lo: number, hi: number,
): FadeStat {
  let n = 0, s24 = 0, s48 = 0, win = 0, n24 = 0;
  for (let i = lo; i < hi; i++) {
    const sd = sides[i];
    if (!sd) continue;
    n++;
    const sgn = sd === 'long' ? 1 : -1;
    const f24 = fwd24[i], f48 = fwd48[i];
    if (f24 != null && isFinite(f24)) { const r = sgn * f24; s24 += r; n24++; if (r > 0) win++; }
    if (f48 != null && isFinite(f48)) s48 += sgn * f48;
  }
  return {
    n,
    mean24: n24 > 0 ? (s24 / n24) * 100 : NaN,
    mean48: n24 > 0 ? (s48 / n24) * 100 : NaN, // denom n24 ok (48h fwd nearly same coverage)
    wr24: n24 > 0 ? (win / n24) * 100 : NaN,
  };
}

interface CandResult {
  name: string;
  isStat: FadeStat; oosStat: FadeStat;
  ic24is: number; ic24oos: number;
  bothPos: boolean;     // mean24 > 0 on BOTH halves (fade works both halves)
}

async function evalPair(cfg: PairCfg, thrHi: number, thrLo: number, splitFrac = 0.5): Promise<{ mid: string; cands: CandResult[] }> {
  const pair = cfg.pair;
  const coin = pair.replace(/USDT$/, '').replace(/USD$/, '');

  const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const barTs = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));
  const N = barTs.length;

  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const fundVol = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_vol_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const lsPos = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const lsAcc = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);

  const aFundOi = alignLatest(barTs, fundOi);
  const aFundVol = alignLatest(barTs, fundVol);
  const aLsPos = alignLatest(barTs, lsPos);
  const aLsAcc = alignLatest(barTs, lsAcc);

  const fwd = (Kk: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + Kk < N; i++) if (close[i] > 0) out[i] = (close[i + Kk] - close[i]) / close[i];
    return out;
  };
  const fwd24 = fwd(K24), fwd48 = fwd(K48);

  // IS/OOS split at midpoint of bars that actually have CG data
  const cgIdx = barTs.map((_, i) => i).filter(i => aFundOi[i] != null || aLsPos[i] != null);
  const midIdxInCg = cgIdx.length ? cgIdx[Math.floor(cgIdx.length * splitFrac)] : Math.floor(N * splitFrac);
  const midTs = barTs[midIdxInCg];

  // Build fade-side arrays for each candidate
  const sidesFor = (kind: string): ('long' | 'short' | null)[] => {
    const out: ('long' | 'short' | null)[] = new Array(N).fill(null);
    for (let i = 0; i < N; i++) {
      if (kind === 'funding_oi') out[i] = fadeSideSingle(aFundOi, i, thrHi, thrLo);
      else if (kind === 'funding_vol') out[i] = fadeSideSingle(aFundVol, i, thrHi, thrLo);
      else if (kind === 'ls_top_position') out[i] = fadeSideSingle(aLsPos, i, thrHi, thrLo);
      else if (kind === 'ls_top_account') out[i] = fadeSideSingle(aLsAcc, i, thrHi, thrLo);
      else if (kind === 'conf_f_ta') out[i] = fadeSideConf(aFundOi, aLsAcc, i, thrHi, thrLo);
      else if (kind === 'conf_f_tp') out[i] = fadeSideConf(aFundOi, aLsPos, i, thrHi, thrLo);
    }
    return out;
  };

  const alignedFor: Record<string, (number | null)[]> = {
    funding_oi: aFundOi, funding_vol: aFundVol, ls_top_position: aLsPos, ls_top_account: aLsAcc,
  };

  const CANDS = ['funding_oi', 'funding_vol', 'ls_top_position', 'ls_top_account', 'conf_f_ta', 'conf_f_tp'];
  const split = (arr: (number | null)[], half: 'IS' | 'OOS') =>
    arr.map((v, i) => ((half === 'IS' ? barTs[i] < midTs : barTs[i] >= midTs) ? v : null));

  const results: CandResult[] = [];
  for (const c of CANDS) {
    const sides = sidesFor(c);
    // index split
    const isHi = barTs.findIndex(t => t >= midTs); // first OOS index
    const oosLo = isHi < 0 ? N : isHi;
    const isStat = fadeStats(sides, fwd24, fwd48, WINDOW, oosLo);
    const oosStat = fadeStats(sides, fwd24, fwd48, Math.max(oosLo, WINDOW), N);
    // IC context (single signals only; confluence has no single ranking var)
    let ic24is = NaN, ic24oos = NaN;
    if (alignedFor[c]) {
      ic24is = spearman(split(alignedFor[c], 'IS'), fwd24);
      ic24oos = spearman(split(alignedFor[c], 'OOS'), fwd24);
    }
    const bothPos = isFinite(isStat.mean24) && isFinite(oosStat.mean24) && isStat.mean24 > 0 && oosStat.mean24 > 0;
    results.push({ name: c, isStat, oosStat, ic24is, ic24oos, bothPos });
  }
  return { mid: new Date(midTs).toISOString().slice(0, 10), cands: results };
}

function fmt(v: number, w = 6): string { return (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : 'NaN').padStart(w); }

async function main() {
  const out: any = {};
  for (const cfg of PAIRS) {
    console.log(`\n${'═'.repeat(108)}`);
    console.log(`PAIR ${cfg.pair}   LIVE = ${cfg.live} @ ${cfg.pctHi}/${cfg.pctLo}`);
    out[cfg.pair] = { live: cfg.live, pctLive: `${cfg.pctHi}/${cfg.pctLo}`, runs: {} };

    for (const [tag, hi, lo] of [['LIVE-thresholds', cfg.pctHi, cfg.pctLo], ['common .75/.25', 0.75, 0.25]] as [string, number, number][]) {
      const { mid, cands } = await evalPair(cfg, hi, lo);
      console.log(`\n  ── ${tag} (thr ${hi}/${lo}) ── IS < ${mid} <= OOS ──`);
      console.log('  ' + 'signal'.padEnd(16) + '│ ' +
        'IS  n  meanFade24%  meanFade48%  WR24'.padEnd(40) + '│ ' +
        'OOS n  meanFade24%  meanFade48%  WR24'.padEnd(40) + '│ IC24 IS/OOS │ both+');
      console.log('  ' + '─'.repeat(126));
      // rank by min(IS,OOS) mean24 (both-halves fade quality), only among bothPos
      const ranked = [...cands].sort((a, b) => {
        const ma = Math.min(a.isStat.mean24, a.oosStat.mean24);
        const mb = Math.min(b.isStat.mean24, b.oosStat.mean24);
        const va = isFinite(ma) ? ma : -1e9, vb = isFinite(mb) ? mb : -1e9;
        return vb - va;
      });
      const runRows: any[] = [];
      for (const r of ranked) {
        const liveMark = r.name === cfg.live ? ' ◀LIVE' : '';
        const bothMark = r.bothPos ? '  ✓' : '';
        console.log('  ' + r.name.padEnd(16) + '│ ' +
          (String(r.isStat.n).padStart(3) + '  ' + fmt(r.isStat.mean24) + '      ' + fmt(r.isStat.mean48) + '     ' + fmt(r.isStat.wr24, 5)).padEnd(40) + '│ ' +
          (String(r.oosStat.n).padStart(3) + '  ' + fmt(r.oosStat.mean24) + '      ' + fmt(r.oosStat.mean48) + '     ' + fmt(r.oosStat.wr24, 5)).padEnd(40) + '│ ' +
          fmt(r.ic24is * 100, 5) + '/' + fmt(r.ic24oos * 100, 5) + ' │' + bothMark + liveMark);
        runRows.push({
          signal: r.name, isN: r.isStat.n, oosN: r.oosStat.n,
          isMean24: round2(r.isStat.mean24), oosMean24: round2(r.oosStat.mean24),
          isMean48: round2(r.isStat.mean48), oosMean48: round2(r.oosStat.mean48),
          isWR24: round2(r.isStat.wr24), oosWR24: round2(r.oosStat.wr24),
          bothPos: r.bothPos, isLive: r.name === cfg.live,
        });
      }
      out[cfg.pair].runs[tag] = { mid, rows: runRows };
    }
  }
  // ── Split-sensitivity robustness for the two candidate findings ─────────────
  // ADA: does conf_f_ta still strictly beat funding_oi on BOTH halves at 40/60 + 60/40?
  // BTC: does any swap still beat live ls_top_position on BOTH halves at 40/60 + 60/40?
  console.log(`\n${'═'.repeat(108)}`);
  console.log(`ROBUSTNESS — split sensitivity (meanFade24% IS|OOS) at 40/60 and 60/40 splits`);
  for (const cfg of PAIRS.filter(c => c.pair === 'ADAUSDT' || c.pair === 'BTCUSDT')) {
    for (const sf of [0.4, 0.6]) {
      const { mid, cands } = await evalPair(cfg, cfg.pctHi, cfg.pctLo, sf);
      const live = cands.find(c => c.name === cfg.live)!;
      console.log(`\n  ${cfg.pair} split=${sf} (mid ${mid})  LIVE ${cfg.live}: IS ${fmt(live.isStat.mean24)} | OOS ${fmt(live.oosStat.mean24)}`);
      for (const c of cands) {
        if (c.name === cfg.live) continue;
        const beatsBoth = isFinite(c.isStat.mean24) && isFinite(c.oosStat.mean24) &&
          c.isStat.mean24 > live.isStat.mean24 && c.oosStat.mean24 > live.oosStat.mean24;
        console.log('    ' + c.name.padEnd(16) + 'IS ' + fmt(c.isStat.mean24) + ' | OOS ' + fmt(c.oosStat.mean24) +
          (beatsBoth ? '   ⇐ beats live BOTH halves' : ''));
      }
    }
  }

  console.log(`\n\nJSON_DUMP_START`);
  console.log(JSON.stringify(out));
  console.log(`JSON_DUMP_END`);
  await closePg();
}
function round2(v: number): number | null { return isFinite(v) ? Math.round(v * 100) / 100 : null; }

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

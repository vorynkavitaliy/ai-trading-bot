/**
 * lever-screen-b1ic — batch B1 signal-edge IC-stability screen for the broader-pair lever.
 * For each READY candidate pair, computes Spearman rank-IC of the 3 fade signals we trade
 * (funding_oi_weighted, ls_top_position, ls_top_account) vs forward 24h & 48h 4H-bar returns,
 * split IS(older half)/OOS(recent half). A signal is a STABLE FADE if IC<0 with |IC|≥0.05 in
 * BOTH halves on the 48h horizon (the maxHold horizon of the live book). Prints the best
 * stable-fade signal per pair and a compact PASS/FAIL verdict.
 *
 * Read-only. Run: npx tsx src/backtest/cli/lever-screen-b1ic.ts [PAIR...]
 */
import { query, close as closePg } from '../../core/db';

type Row = { ts: number; val: number };

function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) { while (j < series.length && series[j].ts <= barTs[i]) j++; out[i] = j > 0 ? series[j - 1].val : null; }
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
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } }
  const n = xs.length; if (n < 30) return NaN;
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return num / Math.sqrt(dx * dy);
}
async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}

const READY = ['ARBUSDT', 'ATOMUSDT', 'INJUSDT', 'LTCUSDT', 'TAOUSDT', 'BNBUSDT', 'APTUSDT', 'DOGEUSDT', 'XRPUSDT', 'HYPEUSDT', 'ETHUSDT'];

async function scanPair(pair: string) {
  const coin = pair.replace(/USDT$/, '');
  const cndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const barTs = cndl.rows.map((r: any) => Number(r.ts));
  const close = cndl.rows.map((r: any) => parseFloat(r.close));
  const N = barTs.length;

  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const lsPos = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const lsAcc = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [pair]);
  const aFundOi = alignLatest(barTs, fundOi), aLsPos = alignLatest(barTs, lsPos), aLsAcc = alignLatest(barTs, lsAcc);

  const fwd = (K: number): (number | null)[] => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) if (close[i] > 0) o[i] = (close[i + K] - close[i]) / close[i]; return o; };
  const fwd24 = fwd(6), fwd48 = fwd(12);

  const cgIdx = barTs.map((_, i) => i).filter(i => aFundOi[i] != null || aLsPos[i] != null);
  const midTs = cgIdx.length ? barTs[cgIdx[Math.floor(cgIdx.length / 2)]] : barTs[Math.floor(N / 2)];
  const split = (arr: (number | null)[], half: 'IS' | 'OOS') => arr.map((v, i) => (half === 'IS' ? barTs[i] < midTs : barTs[i] >= midTs) ? v : null);

  const SIGS: { name: string; vals: (number | null)[] }[] = [
    { name: 'funding_oi', vals: aFundOi },
    { name: 'ls_top_position', vals: aLsPos },
    { name: 'ls_top_account', vals: aLsAcc },
  ];

  let best: { name: string; is48: number; oos48: number; is24: number; oos24: number; score: number } | null = null;
  const lines: string[] = [];
  for (const s of SIGS) {
    const is48 = spearman(split(s.vals, 'IS'), fwd48), oos48 = spearman(split(s.vals, 'OOS'), fwd48);
    const is24 = spearman(split(s.vals, 'IS'), fwd24), oos24 = spearman(split(s.vals, 'OOS'), fwd24);
    const stableFade48 = isFinite(is48) && isFinite(oos48) && is48 < 0 && oos48 < 0 && Math.abs(is48) >= 0.05 && Math.abs(oos48) >= 0.05;
    const f = (v: number) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(3) : ' NaN').padStart(6);
    lines.push(`    ${s.name.padEnd(16)} IC48 ${f(is48)}/${f(oos48)} · IC24 ${f(is24)}/${f(oos24)} ${stableFade48 ? '◀ STABLE FADE' : ''}`);
    if (stableFade48) {
      const score = -(is48 + oos48); // bigger = stronger fade
      if (!best || score > best.score) best = { name: s.name, is48, oos48, is24, oos24, score };
    }
  }
  return { pair, bars: N, withCg: cgIdx.length, best, lines };
}

async function main() {
  const pairs = process.argv.slice(2).map(s => s.toUpperCase());
  const list = pairs.length ? pairs : READY;
  console.log('══ B1 SIGNAL-EDGE IC STABILITY (fade signals, 48h horizon = book maxHold) ══');
  console.log('Stable fade = IC<0 & |IC|≥0.05 in BOTH IS & OOS halves on fwd-48h.\n');
  const survivors: Array<{ pair: string; sig: string; is48: number; oos48: number; score: number }> = [];
  for (const p of list) {
    const r = await scanPair(p);
    const verdict = r.best ? `PASS ✅ [${r.best.name}] score ${r.best.score.toFixed(3)}` : 'FAIL ❌ (no stable fade)';
    console.log(`${p.padEnd(10)} bars=${r.bars} withCG=${r.withCg} → ${verdict}`);
    for (const l of r.lines) console.log(l);
    if (r.best) survivors.push({ pair: p, sig: r.best.name, is48: r.best.is48, oos48: r.best.oos48, score: r.best.score });
  }
  survivors.sort((a, b) => b.score - a.score);
  console.log('\n══ B1 SURVIVORS (ranked by fade strength) ══');
  if (!survivors.length) console.log('  NONE — no candidate has a two-half-stable fade signal.');
  for (const s of survivors) console.log(`  ${s.pair.padEnd(10)} ${s.sig.padEnd(16)} IC48 IS ${s.is48.toFixed(3)} / OOS ${s.oos48.toFixed(3)}  score ${s.score.toFixed(3)}`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

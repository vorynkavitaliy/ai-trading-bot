/**
 * cg-altseason-robust — robustness confirmation for the altseason-ic findings:
 *  (1) 3-block (terciles of time) Spearman-IC for the headline signals, to show
 *      whether sign is stable across regimes or flips (single-midpoint can hide).
 *  (2) confirm bmo_chg7d is a trailing-momentum proxy by reporting corr of the
 *      RAW bmo_level and bmo_chg7d vs trailing return at several windows.
 *  (3) altseason_level both as level and as a fade signal (extreme high/low) —
 *      monotone quintile table per block.
 *
 * READ-ONLY. Run: npx tsx src/tools/diagnostics/cg-altseason-robust.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY = 86400000;

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
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
  if (da === 0 || db === 0) return NaN; return num / Math.sqrt(da * db);
}
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

async function dailyCloses(symbol: string): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts, close FROM candles WHERE symbol=$1 AND tf='60m' ORDER BY ts ASC`, [symbol]);
  const m = new Map<number, number>();
  for (const row of r.rows) m.set(Math.floor(Number(row.ts) / DAY) * DAY, parseFloat(row.close));
  return m;
}
function fwdRet(c: Map<number, number>, d: number, h: number): number | null {
  const a = c.get(d), b = c.get(d + h * DAY); if (a == null || b == null || a <= 0) return null; return b / a - 1;
}
function trailRet(c: Map<number, number>, d: number, h: number): number | null {
  const a = c.get(d - h * DAY), b = c.get(d); if (a == null || b == null || a <= 0) return null; return b / a - 1;
}

function f3(x: number): string { return isNaN(x) ? ' NaN ' : (x >= 0 ? '+' : '') + x.toFixed(3); }
function pct(x: number): string { return isNaN(x) ? ' NaN' : (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%'; }

async function main() {
  const btc = await dailyCloses('BTCUSDT');
  const eth = await dailyCloses('ETHUSDT');
  const ethbtc = new Map<number, number>();
  for (const [d, c] of eth) { const b = btc.get(d); if (b) ethbtc.set(d, c / b); }

  const alt = (await cgGet<any[]>('/index/altcoin-season', {})).data;
  const altByDay = new Map<number, number>();
  for (const r of alt) altByDay.set(Math.floor(Number(r.timestamp) / DAY) * DAY, Number(r.altcoin_index));

  const bmo = (await cgGet<any[]>('/index/bitcoin-macro-oscillator', {})).data;
  const bmoByDay = new Map<number, number>();
  for (const r of bmo) bmoByDay.set(Math.floor(Number(r.timestamp) / DAY) * DAY, Number(r.bmo_value));
  const bmoChg = new Map<number, number>();
  for (const [d, v] of bmoByDay) { const p = bmoByDay.get(d - 7 * DAY); if (p != null) bmoChg.set(d, v - p); }

  const priceDays = [...btc.keys()].sort((a, b) => a - b);
  const f = priceDays[0], l = priceDays[priceDays.length - 1];
  const t1 = f + Math.floor((l - f) / 3), t2 = f + Math.floor(2 * (l - f) / 3);
  const allDays: number[] = []; for (let d = f; d <= l; d += DAY) allDays.push(d);
  const blockOf = (d: number) => d < t1 ? 0 : d < t2 ? 1 : 2;
  console.log(`\nBlocks: B0 ${new Date(f).toISOString().slice(0,10)}..${new Date(t1).toISOString().slice(0,10)}  B1 ..${new Date(t2).toISOString().slice(0,10)}  B2 ..${new Date(l).toISOString().slice(0,10)}\n`);

  function tercileIC(sig: Map<number, number>, closes: Map<number, number>, h: number): number[] {
    const S: number[][] = [[], [], []], F: number[][] = [[], [], []];
    for (const d of allDays) {
      const s = sig.get(d); if (s == null || isNaN(s)) continue;
      const fr = fwdRet(closes, d, h); if (fr == null) continue;
      const b = blockOf(d); S[b].push(s); F[b].push(fr);
    }
    return [0, 1, 2].map(b => spearman(S[b], F[b]));
  }

  console.log('=== 3-block Spearman-IC (sign-stability across regimes) ===');
  console.log('signal               asset    h    B0      B1      B2     allSameSign');
  const tests: [string, Map<number, number>, string, Map<number, number>][] = [
    ['altseason_level', altByDay, 'BTC', btc],
    ['altseason_level', altByDay, 'ETH/BTC', ethbtc],
    ['bmo_chg7d', bmoChg, 'BTC', btc],
    ['bmo_level', bmoByDay, 'BTC', btc],
  ];
  for (const [name, sig, an, closes] of tests) {
    for (const h of [5, 7, 9]) {
      const ics = tercileIC(sig, closes, h);
      const signs = ics.filter(x => !isNaN(x)).map(Math.sign);
      const same = signs.length === 3 && signs.every(s => s === signs[0]);
      console.log(`${name.padEnd(20)} ${an.padEnd(8)} ${h}  ${f3(ics[0])}  ${f3(ics[1])}  ${f3(ics[2])}   ${same ? 'YES' : 'no (flips)'}`);
    }
  }

  console.log('\n=== bmo trailing-momentum proxy confirmation (corr vs trailing BTC return) ===');
  for (const [nm, sig] of [['bmo_level', bmoByDay], ['bmo_chg7d', bmoChg]] as [string, Map<number, number>][]) {
    for (const h of [3, 5, 7, 9]) {
      const a: number[] = [], b: number[] = [];
      for (const d of allDays) { const s = sig.get(d); if (s == null) continue; const t = trailRet(btc, d, h); if (t == null) continue; a.push(s); b.push(t); }
      console.log(`corr(${nm.padEnd(10)}, trailing ${h}d BTC ret) = ${f3(spearman(a, b))}  n=${a.length}`);
    }
  }

  console.log('\n=== altseason_level quintile fwd-ret table per block (BTC, h=7d) ===');
  for (const b of [0, 1, 2]) {
    const pairs: [number, number][] = [];
    for (const d of allDays) {
      if (blockOf(d) !== b) continue;
      const s = altByDay.get(d); if (s == null) continue;
      const fr = fwdRet(btc, d, 7); if (fr == null) continue;
      pairs.push([s, fr]);
    }
    pairs.sort((x, y) => x[0] - y[0]);
    const q = Math.floor(pairs.length / 5);
    const qm = [0, 1, 2, 3, 4].map(i => pct(mean(pairs.slice(i * q, (i + 1) * q).map(p => p[1]))));
    console.log(`B${b} (n=${pairs.length}): Q1lowAlt=${qm[0]} Q2=${qm[1]} Q3=${qm[2]} Q4=${qm[3]} Q5highAlt=${qm[4]}`);
  }

  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.stack ?? e?.message); process.exit(1); });

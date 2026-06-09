/**
 * eth-ta-priceaction — ANGLE 3 deeper price-action edge scan.
 *
 * Tests PRICE-ACTION features NOT in ta-edge-scan.ts:
 *   - Donchian breakout position (20 & 55 bar): where is close in the n-bar range, [-1..+1]
 *   - N-bar high/low breakout flag: did close make a new 20/55-bar extreme (momentum/ORB)
 *   - ADX(14) trend-strength: bucketed read + raw IC
 *   - ATR-percentile vol-regime (rolling 100-bar pctile of ATR%)
 *   - n-bar-return reversal: prior 6-bar move in ATR units (after a -3..-5 ATR drop, bounce?)
 *
 * Same Spearman rank-IC IS/OOS split methodology as ta-edge-scan.ts. A real edge =
 * SAME-SIGN IS & OOS and |IC| ≳ 0.05 on the FULL 5yr 4H series. Also prints a
 * conditional reversal table (fwd-24h return bucketed by prior-6bar ATR move).
 *
 * Run: npx tsx src/tools/diagnostics/eth-ta-priceaction.ts [ETHUSDT] [240m]
 */
import { query, close as closePg } from '../../core/db';

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(vals.length);
  for (let k = 0; k < idx.length; k++) r[idx[k][1]] = k + 1;
  return r;
}
function spearman(x: (number | null)[], y: (number | null)[]): { ic: number; n: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) { xs.push(a); ys.push(b); } }
  const n = xs.length; if (n < 30) return { ic: NaN, n };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return { ic: num / Math.sqrt(dx * dy), n };
}
function qSpread(sig: (number | null)[], fwd: (number | null)[]): number {
  const p: [number, number][] = [];
  for (let i = 0; i < sig.length; i++) { const a = sig[i], b = fwd[i]; if (a != null && b != null && isFinite(a) && isFinite(b)) p.push([a, b]); }
  p.sort((a, b) => a[0] - b[0]); const n = p.length; if (n < 30) return NaN;
  const q = (bk: number) => { const lo = Math.floor(bk * n / 5), hi = Math.floor((bk + 1) * n / 5); let s = 0; for (let i = lo; i < hi; i++) s += p[i][1]; return s / (hi - lo); };
  return (q(4) - q(0)) * 100;
}

async function main() {
  const pair = (process.argv[2] ?? 'ETHUSDT').toUpperCase();
  const tf = process.argv[3] ?? '240m';
  const c = await query<any>(`SELECT ts, open::float o, high::float h, low::float l, close::float cl FROM candles WHERE symbol=$1 AND tf=$2 ORDER BY ts ASC`, [pair, tf]);
  const ts = c.rows.map((r: any) => Number(r.ts));
  const close = c.rows.map((r: any) => r.cl), high = c.rows.map((r: any) => r.h), low = c.rows.map((r: any) => r.l);
  const N = close.length;
  if (N < 400) { console.log(`too few bars (${N})`); await closePg(); return; }

  // ATR(14) Wilder
  const atr14: (number | null)[] = new Array(N).fill(null);
  let tr = 0;
  for (let i = 1; i < N; i++) {
    const t = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (i <= 14) { tr += t / 14; if (i === 14) atr14[i] = tr; } else { tr = (tr * 13 + t) / 14; atr14[i] = tr; }
  }

  // ADX(14)
  const adx14: (number | null)[] = new Array(N).fill(null);
  {
    let sTR = 0, sPDM = 0, sNDM = 0; const dxArr: number[] = [];
    let adxPrev: number | null = null;
    for (let i = 1; i < N; i++) {
      const up = high[i] - high[i - 1], dn = low[i - 1] - low[i];
      const pDM = up > dn && up > 0 ? up : 0;
      const nDM = dn > up && dn > 0 ? dn : 0;
      const t = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
      if (i <= 14) { sTR += t; sPDM += pDM; sNDM += nDM; }
      else { sTR = sTR - sTR / 14 + t; sPDM = sPDM - sPDM / 14 + pDM; sNDM = sNDM - sNDM / 14 + nDM; }
      if (i >= 14 && sTR > 0) {
        const pDI = 100 * sPDM / sTR, nDI = 100 * sNDM / sTR;
        const dx = pDI + nDI === 0 ? 0 : 100 * Math.abs(pDI - nDI) / (pDI + nDI);
        dxArr.push(dx);
        if (dxArr.length >= 14) {
          if (adxPrev == null) { adxPrev = dxArr.slice(-14).reduce((s, v) => s + v, 0) / 14; }
          else { adxPrev = (adxPrev * 13 + dx) / 14; }
          adx14[i] = adxPrev;
        }
      }
    }
  }

  // Donchian position (20 & 55): (close - mid)/(half-range) ∈ [-1,+1]
  const donch = (win: number): (number | null)[] => {
    const o: (number | null)[] = new Array(N).fill(null);
    for (let i = win; i < N; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let k = i - win; k < i; k++) { if (high[k] > hh) hh = high[k]; if (low[k] < ll) ll = low[k]; }
      const rng = hh - ll; if (rng > 0) o[i] = (close[i] - (hh + ll) / 2) / (rng / 2);
    }
    return o;
  };
  const donch20 = donch(20), donch55 = donch(55);

  // Breakout flag: close > prior-N-bar high (+1), < prior-N-bar low (-1), else 0
  const breakout = (win: number): (number | null)[] => {
    const o: (number | null)[] = new Array(N).fill(null);
    for (let i = win; i < N; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let k = i - win; k < i; k++) { if (high[k] > hh) hh = high[k]; if (low[k] < ll) ll = low[k]; }
      o[i] = close[i] > hh ? 1 : close[i] < ll ? -1 : 0;
    }
    return o;
  };
  const brk20 = breakout(20), brk55 = breakout(55);

  // ATR-percentile vol-regime: rolling 100-bar percentile of ATR%/close
  const atrPctile: (number | null)[] = new Array(N).fill(null);
  {
    const win = 100;
    for (let i = 0; i < N; i++) {
      if (atr14[i] == null || close[i] <= 0) continue;
      const cur = atr14[i]! / close[i];
      if (i < win) continue;
      let cnt = 0, tot = 0;
      for (let k = i - win; k < i; k++) { if (atr14[k] != null && close[k] > 0) { tot++; if (atr14[k]! / close[k] <= cur) cnt++; } }
      if (tot > 30) atrPctile[i] = cnt / tot;
    }
  }

  // n-bar return in ATR units (prior 6-bar move) — reversal feature
  const ret6Atr: (number | null)[] = new Array(N).fill(null);
  for (let i = 6; i < N; i++) { if (atr14[i] != null && atr14[i]! > 0) ret6Atr[i] = (close[i] - close[i - 6]) / atr14[i]!; }

  const fwd = (K: number): (number | null)[] => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) if (close[i] > 0) o[i] = (close[i + K] - close[i]) / close[i]; return o; };
  const f12 = fwd(3), f24 = fwd(6), f48 = fwd(12);

  const mid = Math.floor(N / 2);
  const splitTs = ts[mid];
  const slice = <T,>(a: T[], from: number, to: number) => a.slice(from, to);

  // For breakout/donch/momentum features POS IC = trend-follow (high feature precedes up-move).
  // For ret6Atr reversal: NEG IC = big move precedes opposite (mean-revert).
  const inds: { name: string; v: (number | null)[]; kind: 'mom' | 'rev' }[] = [
    { name: 'donch20_pos', v: donch20, kind: 'mom' },
    { name: 'donch55_pos', v: donch55, kind: 'mom' },
    { name: 'breakout20', v: brk20, kind: 'mom' },
    { name: 'breakout55', v: brk55, kind: 'mom' },
    { name: 'adx14', v: adx14, kind: 'mom' },
    { name: 'atr_pctile', v: atrPctile, kind: 'mom' },
    { name: 'ret6_atr', v: ret6Atr, kind: 'rev' },
  ];

  console.log(`\n══ ETH PRICE-ACTION EDGE SCAN: ${pair} (${tf}) ══`);
  console.log(`bars=${N}  full ${new Date(ts[0]).toISOString().slice(0, 10)} → ${new Date(ts[N - 1]).toISOString().slice(0, 10)}  ·  IS<${new Date(splitTs).toISOString().slice(0, 10)}<=OOS`);
  console.log(`mom features: POS IC ⇒ trend/breakout-follow works. rev (ret6_atr): NEG IC ⇒ mean-revert.`);
  console.log(`Real edge: SAME-SIGN IS & OOS, |IC(24/48 avg)|≳0.05.\n`);
  console.log(`feature          kind │ IC12h IC24h IC48h (IS) │ IC12h IC24h IC48h (OOS)│ Q5-Q1 24h IS/OOS │ read`);
  console.log(`${'─'.repeat(118)}`);
  for (const ind of inds) {
    const isF = (arr: (number | null)[]) => slice(arr, 0, mid);
    const oosF = (arr: (number | null)[]) => slice(arr, mid, N);
    const icIS = [spearman(isF(ind.v), isF(f12)).ic, spearman(isF(ind.v), isF(f24)).ic, spearman(isF(ind.v), isF(f48)).ic];
    const icOOS = [spearman(oosF(ind.v), oosF(f12)).ic, spearman(oosF(ind.v), oosF(f24)).ic, spearman(oosF(ind.v), oosF(f48)).ic];
    const qIS = qSpread(isF(ind.v), isF(f24)), qOOS = qSpread(oosF(ind.v), oosF(f24));
    const avgIS = (icIS[1] + icIS[2]) / 2, avgOOS = (icOOS[1] + icOOS[2]) / 2;
    const stable = Math.sign(avgIS) === Math.sign(avgOOS) && Math.abs(avgIS) > 0.045 && Math.abs(avgOOS) > 0.045;
    let read = '—';
    if (stable) read = ind.kind === 'mom' ? (avgOOS > 0 ? '🔺 TREND/BRK (stable)' : '🔻 FADE-BRK (stable)') : (avgOOS < 0 ? '🔻 MEAN-REV (stable)' : '🔺 CONT (stable)');
    else if (Math.sign(avgIS) !== Math.sign(avgOOS) && Math.abs(avgIS) > 0.045 && Math.abs(avgOOS) > 0.045) read = '⚠ flips IS↔OOS';
    const f3 = (a: number[]) => a.map(x => (x >= 0 ? '+' : '') + x.toFixed(3)).join(' ');
    console.log(`  ${ind.name.padEnd(14)} ${ind.kind.padEnd(4)} │ ${f3(icIS)} │ ${f3(icOOS)} │ ${(qIS >= 0 ? '+' : '') + qIS.toFixed(2)} / ${(qOOS >= 0 ? '+' : '') + qOOS.toFixed(2)} │ ${read}`);
  }

  // Conditional reversal table: fwd-24h return bucketed by prior-6bar ATR move, IS vs OOS
  console.log(`\n── Conditional reversal: avg fwd-24h % by prior-6bar move (ATR units) ──`);
  console.log(`bucket            │   IS avg fwd24h (n)  │  OOS avg fwd24h (n)`);
  const buckets: [string, (v: number) => boolean][] = [
    ['<= -4 ATR (crash) ', v => v <= -4],
    ['-4..-2 ATR        ', v => v > -4 && v <= -2],
    ['-2..-0.5 ATR      ', v => v > -2 && v <= -0.5],
    ['-0.5..+0.5 ATR    ', v => v > -0.5 && v < 0.5],
    ['+0.5..+2 ATR      ', v => v >= 0.5 && v < 2],
    ['+2..+4 ATR        ', v => v >= 2 && v < 4],
    ['>= +4 ATR (spike) ', v => v >= 4],
  ];
  for (const [lbl, pred] of buckets) {
    let isS = 0, isN = 0, oosS = 0, oosN = 0;
    for (let i = 0; i < N; i++) {
      const v = ret6Atr[i], fr = f24[i]; if (v == null || fr == null) continue;
      if (!pred(v)) continue;
      if (i < mid) { isS += fr; isN++; } else { oosS += fr; oosN++; }
    }
    const isAvg = isN ? (isS / isN * 100) : NaN, oosAvg = oosN ? (oosS / oosN * 100) : NaN;
    console.log(`  ${lbl} │ ${(isAvg >= 0 ? '+' : '') + isAvg.toFixed(3)}%  (${String(isN).padStart(4)}) │ ${(oosAvg >= 0 ? '+' : '') + oosAvg.toFixed(3)}%  (${String(oosN).padStart(4)})`);
  }
  console.log(`\n(stable mean-rev ⇒ crash buckets show POS fwd both halves; trend ⇒ spike buckets POS both halves.)`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

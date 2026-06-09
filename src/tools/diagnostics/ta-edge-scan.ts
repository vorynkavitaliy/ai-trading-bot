/**
 * ta-edge-scan — does any TECHNICAL indicator (no CG, pure price) predict a pair's
 * forward return, STABLY across both history halves? Mirrors signal-edge-scan but for
 * TA on the FULL candle history (ETH has ~1900d vs ~377d CG → far more robust split).
 *
 * For each indicator computes Spearman rank-IC vs forward 12h/24h/48h returns + a
 * quintile fwd-return spread, split IS (older half) / OOS (recent half). A real edge
 * needs SAME-SIGN IS & OOS and |IC| ≳ 0.05. Sign read for OSCILLATORS (rsi/zscore/%b):
 * NEG IC = high indicator precedes DROP → FADE/mean-reversion works; POS = FOLLOW.
 * For MOMENTUM features: POS IC = trend-follow works; NEG = reversal.
 *
 * Run: npx tsx src/tools/diagnostics/ta-edge-scan.ts [ETHUSDT] [240m]
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

function sma(a: number[], i: number, n: number): number | null { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += a[k]; return s / n; }
function std(a: number[], i: number, n: number, mean: number): number | null { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += (a[k] - mean) ** 2; return Math.sqrt(s / n); }

async function main() {
  const pair = (process.argv[2] ?? 'ETHUSDT').toUpperCase();
  const tf = process.argv[3] ?? '240m';
  const c = await query<any>(`SELECT ts, open::float o, high::float h, low::float l, close::float cl FROM candles WHERE symbol=$1 AND tf=$2 ORDER BY ts ASC`, [pair, tf]);
  const ts = c.rows.map((r: any) => Number(r.ts));
  const close = c.rows.map((r: any) => r.cl), high = c.rows.map((r: any) => r.h), low = c.rows.map((r: any) => r.l);
  const N = close.length;
  if (N < 400) { console.log(`too few bars (${N})`); await closePg(); return; }

  // EMA(50) series, RSI(14), ATR(14)
  const ema50: (number | null)[] = new Array(N).fill(null);
  const kE = 2 / (50 + 1); let e: number | null = null;
  for (let i = 0; i < N; i++) { e = e == null ? close[i] : close[i] * kE + e * (1 - kE); if (i >= 49) ema50[i] = e; }
  const rsi14: (number | null)[] = new Array(N).fill(null);
  let avgG = 0, avgL = 0;
  for (let i = 1; i < N; i++) {
    const ch = close[i] - close[i - 1], g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= 14) { avgG += g / 14; avgL += l / 14; if (i === 14) rsi14[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL); }
    else { avgG = (avgG * 13 + g) / 14; avgL = (avgL * 13 + l) / 14; rsi14[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL); }
  }
  const atr14: (number | null)[] = new Array(N).fill(null);
  let tr = 0;
  for (let i = 1; i < N; i++) {
    const t = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (i <= 14) { tr += t / 14; if (i === 14) atr14[i] = tr; } else { tr = (tr * 13 + t) / 14; atr14[i] = tr; }
  }

  // Indicators
  const zscore20: (number | null)[] = new Array(N).fill(null);
  const bbPctB: (number | null)[] = new Array(N).fill(null);
  const distEma50: (number | null)[] = new Array(N).fill(null);
  const mom6: (number | null)[] = new Array(N).fill(null);
  const mom12: (number | null)[] = new Array(N).fill(null);
  const mom30: (number | null)[] = new Array(N).fill(null);
  const atrRet6: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const m = sma(close, i, 20); const sd = m != null ? std(close, i, 20, m) : null;
    if (m != null && sd != null && sd > 0) { zscore20[i] = (close[i] - m) / sd; bbPctB[i] = (close[i] - m) / (2 * sd); }
    if (ema50[i] != null && ema50[i]! > 0) distEma50[i] = (close[i] - ema50[i]!) / ema50[i]! * 100;
    if (i >= 6 && close[i - 6] > 0) mom6[i] = (close[i] - close[i - 6]) / close[i - 6] * 100;
    if (i >= 12 && close[i - 12] > 0) mom12[i] = (close[i] - close[i - 12]) / close[i - 12] * 100;
    if (i >= 30 && close[i - 30] > 0) mom30[i] = (close[i] - close[i - 30]) / close[i - 30] * 100;
    if (i >= 6 && atr14[i] != null && atr14[i]! > 0) atrRet6[i] = (close[i] - close[i - 6]) / atr14[i]!;
  }

  const fwd = (K: number): (number | null)[] => { const o: (number | null)[] = new Array(N).fill(null); for (let i = 0; i + K < N; i++) if (close[i] > 0) o[i] = (close[i + K] - close[i]) / close[i]; return o; };
  const f12 = fwd(3), f24 = fwd(6), f48 = fwd(12);

  const mid = Math.floor(N / 2);
  const splitTs = ts[mid];
  const slice = <T,>(a: T[], from: number, to: number) => a.slice(from, to);
  const inds: { name: string; v: (number | null)[]; kind: 'osc' | 'mom' }[] = [
    { name: 'rsi14', v: rsi14, kind: 'osc' },
    { name: 'zscore20', v: zscore20, kind: 'osc' },
    { name: 'bb_pctB', v: bbPctB, kind: 'osc' },
    { name: 'dist_ema50%', v: distEma50, kind: 'osc' },
    { name: 'atr_ret_6', v: atrRet6, kind: 'osc' },
    { name: 'mom_24h(6)', v: mom6, kind: 'mom' },
    { name: 'mom_48h(12)', v: mom12, kind: 'mom' },
    { name: 'mom_5d(30)', v: mom30, kind: 'mom' },
  ];

  console.log(`\n══ TA-EDGE SCAN: ${pair} (${tf}) ══`);
  console.log(`bars=${N}  full history ${new Date(ts[0]).toISOString().slice(0, 10)} → ${new Date(ts[N - 1]).toISOString().slice(0, 10)}  ·  IS<${new Date(splitTs).toISOString().slice(0, 10)}<=OOS`);
  console.log(`IC vs forward return. OSC (rsi/z/%b/dist/atr): NEG ⇒ high precedes DROP ⇒ FADE/mean-rev. MOM: POS ⇒ trend-follow.`);
  console.log(`Real edge: SAME-SIGN IS & OOS, |IC|≳0.05.\n`);
  console.log(`indicator        kind │ IC12h IC24h IC48h (IS) │ IC12h IC24h IC48h (OOS)│ Q5-Q1 24h IS/OOS │ read`);
  console.log(`${'─'.repeat(115)}`);
  for (const ind of inds) {
    const isF = (arr: (number | null)[]) => slice(arr, 0, mid);
    const oosF = (arr: (number | null)[]) => slice(arr, mid, N);
    const icIS = [spearman(isF(ind.v), isF(f12)).ic, spearman(isF(ind.v), isF(f24)).ic, spearman(isF(ind.v), isF(f48)).ic];
    const icOOS = [spearman(oosF(ind.v), oosF(f12)).ic, spearman(oosF(ind.v), oosF(f24)).ic, spearman(oosF(ind.v), oosF(f48)).ic];
    const qIS = qSpread(isF(ind.v), isF(f24)), qOOS = qSpread(oosF(ind.v), oosF(f24));
    const avgIS = (icIS[1] + icIS[2]) / 2, avgOOS = (icOOS[1] + icOOS[2]) / 2;
    const stable = Math.sign(avgIS) === Math.sign(avgOOS) && Math.abs(avgIS) > 0.04 && Math.abs(avgOOS) > 0.04;
    let read = '—';
    if (stable) read = ind.kind === 'osc' ? (avgOOS < 0 ? '🔻 FADE (stable)' : '🔺 FOLLOW (stable)') : (avgOOS > 0 ? '🔺 TREND (stable)' : '🔻 REVERSAL (stable)');
    else if (Math.sign(avgIS) !== Math.sign(avgOOS) && Math.abs(avgIS) > 0.04 && Math.abs(avgOOS) > 0.04) read = '⚠ flips IS↔OOS';
    const f3 = (a: number[]) => a.map(x => (x >= 0 ? '+' : '') + x.toFixed(3)).join(' ');
    console.log(`  ${ind.name.padEnd(14)} ${ind.kind.padEnd(4)} │ ${f3(icIS)} │ ${f3(icOOS)} │ ${(qIS >= 0 ? '+' : '') + qIS.toFixed(2)} / ${(qOOS >= 0 ? '+' : '') + qOOS.toFixed(2)} │ ${read}`);
  }
  console.log(`\n(Q5-Q1 = avg fwd-24h % of top-indicator quintile minus bottom.)`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

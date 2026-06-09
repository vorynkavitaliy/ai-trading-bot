/**
 * eth-breakout-fade — ANGLE 3 confirmation backtest.
 *
 * The only price-action feature with same-sign IC across both ETH 240m halves was
 * the N-bar BREAKOUT flag (NEG IC ⇒ fade): close making a new 20/55-bar extreme
 * tends to revert over the next 24-48h. This tests whether that correlation makes
 * MONEY, two-sided (long AND short), in BOTH history halves, single-entry, ATR SL/TP.
 *
 * Self-contained price-only sim (no CG, no engine portfolio) so we can run the FULL
 * 5yr 4H series with a clean IS/OOS split. Realistic frictions: taker fee 0.055% +
 * slip on entry and exit. ETH is liquid → slip 0.05% headline, 0.25% stress.
 *
 *   Entry rule: at a 4H bar close, if close > prior-N-bar high → SHORT (fade up-break);
 *               if close < prior-N-bar low → LONG (fade down-break).
 *   SL = entry ± slAtr·ATR14, TP = entry ∓ tpAtr·ATR14, maxHold bars, one position at a time.
 *   Cooldown: no new entry for `cdBars` bars after a close (avoids stacking same break).
 *
 * Run: npx tsx src/backtest/cli/eth-breakout-fade.ts [ETHUSDT] [N=20] [slip=0.05]
 */
import { query, close as closePg } from '../../core/db';

const FEE = 0.00055; // taker each side

interface Trade { side: 'long' | 'short'; entryTs: number; r: number; }

function runSim(
  ts: number[], open: number[], high: number[], low: number[], close: number[], atr: (number | null)[],
  from: number, to: number, N: number, slAtr: number, tpAtr: number, maxHold: number, slipPct: number, cdBars: number,
): Trade[] {
  const trades: Trade[] = [];
  let i = Math.max(from, N + 15);
  let cdUntil = 0;
  while (i < to - 1) {
    if (i < cdUntil) { i++; continue; }
    const a = atr[i];
    if (a == null || a <= 0) { i++; continue; }
    // prior N-bar extreme (excluding current bar)
    let hh = -Infinity, ll = Infinity;
    for (let k = i - N; k < i; k++) { if (high[k] > hh) hh = high[k]; if (low[k] < ll) ll = low[k]; }
    let side: 'long' | 'short' | null = null;
    if (close[i] > hh) side = 'short';      // fade upside breakout
    else if (close[i] < ll) side = 'long';  // fade downside breakout
    if (!side) { i++; continue; }

    // enter at NEXT bar open (no look-ahead), apply slip
    const ei = i + 1;
    if (ei >= to) break;
    const slipE = open[ei] * slipPct / 100;
    const entry = side === 'long' ? open[ei] + slipE : open[ei] - slipE;
    const sl = side === 'long' ? entry - slAtr * a : entry + slAtr * a;
    const tp = side === 'long' ? entry + tpAtr * a : entry - tpAtr * a;
    const stopDist = Math.abs(entry - sl);

    let exitPx: number | null = null;
    let j = ei;
    for (; j < Math.min(ei + maxHold, to); j++) {
      // intrabar: assume SL checked before TP (conservative)
      if (side === 'long') {
        if (low[j] <= sl) { exitPx = sl - open[j] * slipPct / 100; break; }
        if (high[j] >= tp) { exitPx = tp; break; }
      } else {
        if (high[j] >= sl) { exitPx = sl + open[j] * slipPct / 100; break; }
        if (low[j] <= tp) { exitPx = tp; break; }
      }
    }
    if (exitPx == null) { // time exit at bar j close
      const jj = Math.min(ei + maxHold, to) - 1;
      exitPx = close[jj]; j = jj;
    }
    const gross = side === 'long' ? (exitPx - entry) : (entry - exitPx);
    const feeCost = (entry + Math.abs(exitPx)) * FEE;
    const net = gross - feeCost;
    const r = net / stopDist;
    trades.push({ side, entryTs: ts[i], r });
    cdUntil = j + cdBars;
    i = j + 1;
  }
  return trades;
}

function stats(tr: Trade[]) {
  const n = tr.length;
  if (!n) return { n: 0, wr: 0, pf: 0, sumR: 0, avgR: 0 };
  const wins = tr.filter(t => t.r > 0);
  const gp = wins.reduce((s, t) => s + t.r, 0);
  const gl = tr.filter(t => t.r <= 0).reduce((s, t) => s + Math.abs(t.r), 0);
  const sumR = tr.reduce((s, t) => s + t.r, 0);
  return { n, wr: wins.length / n * 100, pf: gl > 0 ? gp / gl : Infinity, sumR, avgR: sumR / n };
}

async function main() {
  const pair = (process.argv[2] ?? 'ETHUSDT').toUpperCase();
  const N = parseInt(process.argv[3] ?? '20');
  const slip = parseFloat(process.argv[4] ?? '0.05');
  const tf = '240m';
  const c = await query<any>(`SELECT ts, open::float o, high::float h, low::float l, close::float cl FROM candles WHERE symbol=$1 AND tf=$2 ORDER BY ts ASC`, [pair, tf]);
  const ts = c.rows.map((r: any) => Number(r.ts));
  const open = c.rows.map((r: any) => r.o), high = c.rows.map((r: any) => r.h), low = c.rows.map((r: any) => r.l), close = c.rows.map((r: any) => r.cl);
  const M = close.length;
  const atr: (number | null)[] = new Array(M).fill(null);
  let trr = 0;
  for (let i = 1; i < M; i++) { const t = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])); if (i <= 14) { trr += t / 14; if (i === 14) atr[i] = trr; } else { trr = (trr * 13 + t) / 14; atr[i] = trr; } }

  const mid = Math.floor(M / 2);
  const slAtr = 1.5, tpAtr = 2.0, maxHold = 12, cdBars = 3;

  console.log(`\n══ ETH BREAKOUT-FADE BACKTEST: ${pair} ${tf}  N=${N}  SL=${slAtr}atr TP=${tpAtr}atr maxHold=${maxHold} cd=${cdBars}  slip=${slip}% ══`);
  console.log(`full ${new Date(ts[0]).toISOString().slice(0,10)} → ${new Date(ts[M-1]).toISOString().slice(0,10)}  ·  IS<${new Date(ts[mid]).toISOString().slice(0,10)}<=OOS  fee=${(FEE*100).toFixed(3)}%/side`);
  console.log(`\nhalf  side  │ trades   WR     PF    sumR   avgR`);
  console.log('─'.repeat(60));

  for (const [hl, from, to] of [['IS ', 0, mid], ['OOS', mid, M]] as [string, number, number][]) {
    const all = runSim(ts, open, high, low, close, atr, from, to, N, slAtr, tpAtr, maxHold, slip, cdBars);
    const L = all.filter(t => t.side === 'long'), S = all.filter(t => t.side === 'short');
    for (const [lbl, set] of [['both ', all], ['long ', L], ['short', S]] as [string, Trade[]][]) {
      const s = stats(set);
      console.log(`${hl}   ${lbl} │ ${String(s.n).padStart(5)}  ${s.wr.toFixed(1).padStart(5)}  ${(isFinite(s.pf)?s.pf.toFixed(2):'inf').padStart(5)}  ${s.sumR.toFixed(2).padStart(7)}  ${s.avgR.toFixed(3).padStart(6)}`);
    }
    console.log('─'.repeat(60));
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

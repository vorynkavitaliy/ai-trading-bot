/**
 * eth-relval-spread — ANGLE 5: minimal ETH/BTC spread (ratio) reversion backtest,
 * NET of double transaction cost (two legs). z>=+thr → SHORT spread (short ETH /
 * long BTC); z<=-thr → LONG spread (long ETH / short BTC). Exit when z crosses 0
 * or after maxHold bars. Equal-notional, beta≈1.
 *
 * Cost model: each leg pays taker fee + slip on entry AND exit. A round-trip
 * spread trade touches the market 4 times (2 legs × open+close). We charge
 * legCostPct per leg-touch on the leg notional; total cost = 4 × legCostPct in
 * ratio terms (both legs same notional). R is defined off the entry-time z move
 * relative to a fixed ratio-vol unit so PF/sumR are comparable to the book.
 *
 * Reports sumR / PF / return / trades / WR for IS (older half) and OOS (recent
 * half) and overall, both gross and net. Read-only on DB.
 *
 * Run: npx tsx src/backtest/cli/eth-relval-spread.ts [zThr=1.5] [maxHold=12] [legCostPct=0.045]
 */
import { query, close as closePg } from '../../core/db';

function rollingZ(series: number[], win: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  for (let i = 0; i < series.length; i++) {
    if (i < win) continue;
    let s = 0, s2 = 0;
    for (let k = i - win; k < i; k++) { s += series[k]; s2 += series[k] * series[k]; }
    const mean = s / win; const varr = s2 / win - mean * mean; const sd = Math.sqrt(Math.max(varr, 1e-18));
    out[i] = sd > 0 ? (series[i] - mean) / sd : null;
  }
  return out;
}
async function loadCloses(symbol: string): Promise<Map<number, number>> {
  const { rows } = await query<any>(`SELECT ts, close::text AS c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [symbol]);
  const m = new Map<number, number>();
  for (const r of rows) { const c = parseFloat(r.c); if (isFinite(c) && c > 0) m.set(Number(r.ts), c); }
  return m;
}

type Trade = { entryIdx: number; exitIdx: number; dir: 1 | -1; grossRet: number; netRet: number; ts: number };

async function main() {
  const zThr = parseFloat(process.argv[2] ?? '1.5');
  const maxHold = parseInt(process.argv[3] ?? '12', 10); // 12 bars = 48h
  const legCostPct = parseFloat(process.argv[4] ?? '0.045'); // per leg-touch %, liquid major ≈ 0.03-0.05
  const win = 90;

  const ethM = await loadCloses('ETHUSDT');
  const btcM = await loadCloses('BTCUSDT');
  const ts: number[] = [];
  for (const t of ethM.keys()) if (btcM.has(t)) ts.push(t);
  ts.sort((a, b) => a - b);
  const ratio = ts.map(t => ethM.get(t)! / btcM.get(t)!);
  const z = rollingZ(ratio, win);
  const N = ratio.length;
  const midIdx = Math.floor(N / 2);

  // round-trip cost in ratio-return terms: 4 leg-touches each legCostPct on equal notional.
  // A spread of two equal-notional legs has cost = (open+close on ETH) + (open+close on BTC)
  // = 4 × legCostPct as a fraction of one leg notional ≈ ratio-return drag.
  const rtCost = 4 * legCostPct / 100;

  const trades: Trade[] = [];
  let i = win;
  while (i < N - 1) {
    const zi = z[i];
    if (zi == null) { i++; continue; }
    let dir: 1 | -1 | 0 = 0;
    // SHORT spread when ratio rich (z high) → we profit if ratio falls → grossRet = -(ratioChange)
    if (zi >= zThr) dir = -1;       // short spread
    else if (zi <= -zThr) dir = 1;  // long spread
    if (dir === 0) { i++; continue; }

    const entryR = ratio[i];
    let exit = -1;
    for (let k = i + 1; k <= Math.min(i + maxHold, N - 1); k++) {
      const zk = z[k];
      // exit on z crossing 0 (mean reached) or end of hold
      if (zk != null && ((dir === -1 && zk <= 0) || (dir === 1 && zk >= 0))) { exit = k; break; }
      if (k === Math.min(i + maxHold, N - 1)) { exit = k; break; }
    }
    if (exit < 0) break;
    const exitR = ratio[exit];
    const ratioChange = (exitR - entryR) / entryR;
    // long spread profits when ratio rises; short spread profits when ratio falls
    const grossRet = dir === 1 ? ratioChange : -ratioChange;
    const netRet = grossRet - rtCost;
    trades.push({ entryIdx: i, exitIdx: exit, dir: dir as 1 | -1, grossRet, netRet, ts: ts[i] });
    i = exit + 1; // no overlapping positions
  }

  // R unit: normalize each trade's pnl by the per-trade ratio std move so PF/sumR are sane.
  // Use a fixed unit = median absolute ratioChange over all trades as 1R proxy.
  const absMoves = trades.map(t => Math.abs(t.grossRet)).sort((a, b) => a - b);
  const unit = absMoves.length ? (absMoves[Math.floor(absMoves.length / 2)] || 0.005) : 0.005;

  const summarize = (sub: Trade[], label: string, useNet: boolean) => {
    const key = useNet ? 'netRet' : 'grossRet';
    const n = sub.length;
    if (!n) { console.log(`${label.padEnd(18)} | n=0`); return; }
    let wins = 0, gp = 0, gl = 0, sumR = 0;
    let longN = 0, longR = 0, shortN = 0, shortR = 0;
    for (const t of sub) {
      const r = (t as any)[key] as number;
      const R = r / unit;
      sumR += R;
      if (r > 0) { wins++; gp += r; } else gl += -r;
      if (t.dir === 1) { longN++; longR += R; } else { shortN++; shortR += R; }
    }
    const pf = gl > 0 ? gp / gl : Infinity;
    const ret = sub.reduce((s, t) => s + ((t as any)[key] as number), 0) * 100; // sum of ratio-returns ≈ cumulative spread return %
    console.log(`${label.padEnd(18)} | n=${String(n).padStart(3)} WR ${(100*wins/n).toFixed(1).padStart(5)}% PF ${(isFinite(pf)?pf.toFixed(2):'inf').padStart(5)} sumR ${sumR.toFixed(1).padStart(7)} ret ${ret.toFixed(2).padStart(7)}%  [L ${longN}:${longR.toFixed(1)}R  S ${shortN}:${shortR.toFixed(1)}R]`);
  };

  const isT = trades.filter(t => t.entryIdx < midIdx);
  const oosT = trades.filter(t => t.entryIdx >= midIdx);

  console.log(`\n══ ETH/BTC SPREAD REVERSION BACKTEST ══`);
  console.log(`zThr=${zThr} maxHold=${maxHold} bars win=${win} legCost=${legCostPct}%/touch → round-trip cost ${(rtCost*100).toFixed(3)}% per spread trade (4 touches)`);
  console.log(`1R unit = median |gross ratio move| = ${(unit*100).toFixed(3)}%`);
  console.log(`IS < ${new Date(ts[midIdx]).toISOString().slice(0,10)} <= OOS\n`);
  console.log('GROSS (no cost):');
  summarize(isT, 'IS', false); summarize(oosT, 'OOS', false); summarize(trades, 'FULL', false);
  console.log('\nNET (double cost):');
  summarize(isT, 'IS', true); summarize(oosT, 'OOS', true); summarize(trades, 'FULL', true);

  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

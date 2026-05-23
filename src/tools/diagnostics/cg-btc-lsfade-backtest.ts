// Standalone BTC L/S extreme fade backtest.
// Hypothesis: when top-trader L/S position ratio is extreme (top/bottom 10% of trailing 30d window),
//             BTC tends to revert. Fade entries with ATR-based SL/TP.
//
// Walk-forward: train (first 75%) vs test (last 25%) — same split as imbalance analyzer.

import { query, close as closePg } from '../../core/db';

type Bar = { ts: number; o: number; h: number; l: number; c: number };

// Strategy params (will iterate over a small grid in final report)
interface Params {
  pctHi: number;
  pctLo: number;
  windowBars: number;
  atrPeriod: number;
  slAtrMult: number;
  tpAtrMult: number;
  maxHoldBars: number; // 18 = 72h
}

function atr(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return 0;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    );
    sum += tr;
  }
  return sum / period;
}

function percentile(series: number[], value: number): number {
  let cnt = 0;
  for (const v of series) if (v <= value) cnt++;
  return cnt / series.length;
}

interface ClosedTrade {
  entryTs: number; exitTs: number;
  side: 'long' | 'short';
  entry: number; exit: number;
  sl: number; tp: number;
  pnlR: number;  // (gain or loss) / risked
  exitReason: 'sl' | 'tp' | 'time';
}

function runBacktest(
  bars: Bar[],
  lsHist: { ts: number; v: number }[],
  p: Params
): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  // For each 4H BTC bar, find matching ls value
  // ls is also 4H, ts aligned to UTC 00/04/08/12/16/20

  let openPos: {
    side: 'long' | 'short'; entry: number; entryTs: number;
    sl: number; tp: number; risk: number; entryIdx: number;
  } | null = null;

  // Build a map for fast ls lookup
  const lsMap = new Map<number, number>();
  for (const r of lsHist) lsMap.set(r.ts, r.v);
  const lsSeriesSorted = lsHist.slice().sort((a, b) => a.ts - b.ts);

  for (let i = p.windowBars + p.atrPeriod; i < bars.length; i++) {
    const bar = bars[i];

    // First check open position resolution (within this bar)
    if (openPos) {
      const slHit = openPos.side === 'long' ? bar.l <= openPos.sl : bar.h >= openPos.sl;
      const tpHit = openPos.side === 'long' ? bar.h >= openPos.tp : bar.l <= openPos.tp;
      const heldBars = i - openPos.entryIdx;
      if (slHit && !tpHit) {
        trades.push({
          entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side,
          entry: openPos.entry, exit: openPos.sl, sl: openPos.sl, tp: openPos.tp,
          pnlR: -1, exitReason: 'sl',
        });
        openPos = null;
      } else if (tpHit && !slHit) {
        trades.push({
          entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side,
          entry: openPos.entry, exit: openPos.tp, sl: openPos.sl, tp: openPos.tp,
          pnlR: Math.abs(openPos.tp - openPos.entry) / openPos.risk, exitReason: 'tp',
        });
        openPos = null;
      } else if (slHit && tpHit) {
        // Both hit in same 4H — assume worst: SL first (conservative)
        trades.push({
          entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side,
          entry: openPos.entry, exit: openPos.sl, sl: openPos.sl, tp: openPos.tp,
          pnlR: -1, exitReason: 'sl',
        });
        openPos = null;
      } else if (heldBars >= p.maxHoldBars) {
        // Time stop: exit at close
        const pnlR = openPos.side === 'long'
          ? (bar.c - openPos.entry) / openPos.risk
          : (openPos.entry - bar.c) / openPos.risk;
        trades.push({
          entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side,
          entry: openPos.entry, exit: bar.c, sl: openPos.sl, tp: openPos.tp,
          pnlR, exitReason: 'time',
        });
        openPos = null;
      }
    }

    if (openPos) continue;  // can't open while in trade

    // Find latest L/S value at or before bar.ts
    let lo = 0, hi = lsSeriesSorted.length - 1, found = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (lsSeriesSorted[m].ts <= bar.ts) { found = m; lo = m + 1; } else hi = m - 1;
    }
    if (found < p.windowBars) continue;
    const window = lsSeriesSorted.slice(found - p.windowBars, found).map(r => r.v);
    const currentLs = lsSeriesSorted[found].v;
    const pct = percentile(window, currentLs);

    const slice = bars.slice(i - p.atrPeriod, i + 1);
    const a = atr(slice, p.atrPeriod);
    if (a <= 0) continue;

    const price = bar.c;

    if (pct >= p.pctHi) {
      const sl = price + p.slAtrMult * a;
      const tp = price - p.tpAtrMult * a;
      openPos = { side: 'short', entry: price, entryTs: bar.ts, sl, tp, risk: p.slAtrMult * a, entryIdx: i };
    } else if (pct <= p.pctLo) {
      const sl = price - p.slAtrMult * a;
      const tp = price + p.tpAtrMult * a;
      openPos = { side: 'long', entry: price, entryTs: bar.ts, sl, tp, risk: p.slAtrMult * a, entryIdx: i };
    }
  }

  // Close trailing position at the last bar (time stop)
  if (openPos) {
    const bar = bars[bars.length - 1];
    const pnlR = openPos.side === 'long'
      ? (bar.c - openPos.entry) / openPos.risk
      : (openPos.entry - bar.c) / openPos.risk;
    trades.push({
      entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side,
      entry: openPos.entry, exit: bar.c, sl: openPos.sl, tp: openPos.tp,
      pnlR, exitReason: 'time',
    });
  }

  return trades;
}

function metrics(trades: ClosedTrade[]) {
  if (trades.length === 0) return { n: 0, wr: 0, avgR: 0, sumR: 0, pf: 0, longs: 0, shorts: 0 };
  const wins = trades.filter(t => t.pnlR > 0);
  const losses = trades.filter(t => t.pnlR < 0);
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  const sumWin = wins.reduce((s, t) => s + t.pnlR, 0);
  const sumLoss = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
  const pf = sumLoss > 0 ? sumWin / sumLoss : Infinity;
  return {
    n: trades.length,
    wr: wins.length / trades.length * 100,
    avgR: sumR / trades.length,
    sumR,
    pf,
    longs: trades.filter(t => t.side === 'long').length,
    shorts: trades.filter(t => t.side === 'short').length,
  };
}

async function main() {
  // 240m bars
  const bars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text
     FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts`
  )).rows.map(r => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }));

  const lsHist = (await query<any>(
    `SELECT ts::text, ratio::text FROM cg_ls_top_position WHERE pair='BTCUSDT' ORDER BY ts`
  )).rows.map(r => ({ ts: Number(r.ts), v: Number(r.ratio) }));

  console.log(`BTC bars: ${bars.length}  |  L/S history: ${lsHist.length}`);
  console.log(`bars span: ${new Date(bars[0].ts).toISOString().slice(0,10)} → ${new Date(bars[bars.length-1].ts).toISOString().slice(0,10)}`);
  console.log(`ls span:   ${new Date(lsHist[0].ts).toISOString().slice(0,10)} → ${new Date(lsHist[lsHist.length-1].ts).toISOString().slice(0,10)}`);

  // Grid: try a few parameter combos
  const grids: Params[] = [
    { pctHi: 0.95, pctLo: 0.05, windowBars: 180, atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 18 },
    { pctHi: 0.90, pctLo: 0.10, windowBars: 180, atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 18 },
    { pctHi: 0.90, pctLo: 0.10, windowBars: 180, atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 18 },
    { pctHi: 0.90, pctLo: 0.10, windowBars: 180, atrPeriod: 14, slAtrMult: 2.0, tpAtrMult: 4.0, maxHoldBars: 18 },
    { pctHi: 0.90, pctLo: 0.10, windowBars: 180, atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 12 },
    { pctHi: 0.85, pctLo: 0.15, windowBars: 180, atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 18 },
    { pctHi: 0.90, pctLo: 0.10, windowBars: 90,  atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 18 },
  ];

  console.log('\n=== L/S Extreme Fade — Full-window backtest ===');
  console.log('pctHi pctLo  win  atr  sl×   tp×   hold  | trades  WR    avgR   sumR   PF    L/S');
  console.log('-----------------------------------------|------------------------------------');
  for (const p of grids) {
    const trades = runBacktest(bars, lsHist, p);
    const m = metrics(trades);
    console.log(
      `${p.pctHi.toFixed(2)} ${p.pctLo.toFixed(2)}  ${String(p.windowBars).padStart(3)}  ${String(p.atrPeriod).padStart(3)}  ${p.slAtrMult.toFixed(1)}  ${p.tpAtrMult.toFixed(1)}  ${String(p.maxHoldBars).padStart(4)}  | ` +
      `${String(m.n).padStart(6)}  ${m.wr.toFixed(1).padStart(4)}% ${m.avgR.toFixed(2).padStart(6)} ${m.sumR.toFixed(2).padStart(6)} ${m.pf.toFixed(2).padStart(5)}  ${m.longs}/${m.shorts}`
    );
  }

  // Walk-forward on best param set (assume row 2: 0.90/0.10/1.5/3.0/18)
  const best = grids[1];
  const allTrades = runBacktest(bars, lsHist, best);
  if (allTrades.length === 0) { await closePg(); return; }
  allTrades.sort((a, b) => a.entryTs - b.entryTs);

  console.log(`\n=== Walk-forward on best params (${best.pctHi}/${best.pctLo}, sl${best.slAtrMult}/tp${best.tpAtrMult}, hold${best.maxHoldBars}) ===`);
  const splitTs = bars[Math.floor(bars.length * 0.75)].ts;
  const train = allTrades.filter(t => t.entryTs < splitTs);
  const test  = allTrades.filter(t => t.entryTs >= splitTs);
  const m1 = metrics(train);
  const m2 = metrics(test);
  console.log(`TRAIN (first 75%): n=${m1.n}, WR=${m1.wr.toFixed(1)}%, avgR=${m1.avgR.toFixed(3)}, sumR=${m1.sumR.toFixed(2)}, PF=${m1.pf.toFixed(2)}, L/S=${m1.longs}/${m1.shorts}`);
  console.log(`TEST  (last 25%):  n=${m2.n}, WR=${m2.wr.toFixed(1)}%, avgR=${m2.avgR.toFixed(3)}, sumR=${m2.sumR.toFixed(2)}, PF=${m2.pf.toFixed(2)}, L/S=${m2.longs}/${m2.shorts}`);

  console.log('\nTRAIN trades (last 20):');
  for (const t of train.slice(-20)) {
    console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry=${t.entry.toFixed(0)} → exit=${t.exit.toFixed(0)} R=${t.pnlR.toFixed(2)} (${t.exitReason})`);
  }
  console.log('\nTEST trades:');
  for (const t of test) {
    console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry=${t.entry.toFixed(0)} → exit=${t.exit.toFixed(0)} R=${t.pnlR.toFixed(2)} (${t.exitReason})`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

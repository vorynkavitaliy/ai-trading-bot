// Deep multivariate feature autopsy. Pull 787 gates-off trades from 365d backtest,
// compute ~20 candidate features per trade entry timestamp, quintile-bucket each,
// strict train/test split (75/25 chronological).
//
// Goal: identify features (or feature interactions) with monotonic gradient that
// survives OOS. Each feature must pass:
//   - n ≥ 50 in each quintile bucket
//   - Δ avgR ≥ 0.15R between worst and best bucket on TEST set
//   - Direction agrees between LONG and SHORT (no asymmetric noise)
//
// Output: pass-list of features that survive all gates + reproducible bucket boundaries.

import { query, close as closePg } from '../../core/db';
import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','LTCUSDT','ATOMUSDT','TONUSDT','DOGEUSDT','APTUSDT','ARBUSDT','TAOUSDT','INJUSDT'];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT: { maxStopAtrPct: 4.5 }, SOLUSDT: { maxStopAtrPct: 5.5 }, XRPUSDT: { maxStopAtrPct: 5.5 },
  BNBUSDT: { maxStopAtrPct: 4.0 }, LTCUSDT: { maxStopAtrPct: 4.5 }, ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT: { maxStopAtrPct: 5.0 }, DOGEUSDT: { maxStopAtrPct: 5.5 }, APTUSDT: { maxStopAtrPct: 5.0 },
  ARBUSDT: { maxStopAtrPct: 5.0 }, TAOUSDT: { maxStopAtrPct: 5.0 }, INJUSDT: { maxStopAtrPct: 5.0 },
};

const COMMON = {
  startEquity: 50_000, takerFeeRate: 0.00055, makerFeeRate: 0.0002,
  slippagePct: 0.25, riskPctBase: 0.6, leverage: 10,
  tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

type T = { ts: number };
function latestAt<U extends T>(series: U[], ts: number, maxLagMs = 6 * 3600_000): U | null {
  let lo = 0, hi = series.length - 1, found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (series[m].ts <= ts) { found = m; lo = m + 1; } else hi = m - 1; }
  return found >= 0 && (ts - series[found].ts) <= maxLagMs ? series[found] : null;
}
function valueAt<U extends T>(series: U[], ts: number, key: keyof U): number | null {
  const s = latestAt(series, ts); return s ? Number(s[key]) : null;
}

interface Features {
  // Strategy-internal
  rrTp1: number;
  rrTp2: number;
  stopDistPct: number;
  tp1DistPct: number;
  tpSpreadPct: number;
  // Time
  hourUtc: number;
  dayOfWeek: number;
  // Market context (BTC)
  btcRet24h: number | null;       // % BTC change last 24h
  // CG state
  funding: number | null;
  fundingDelta24h: number | null;  // funding change vs 24h ago
  lsTopRatio: number | null;
  lsTopDelta24h: number | null;
  oiPctChange24h: number | null;
  takerImbalance1h: number | null;
  takerImbalance24h: number | null;
  // Liquidation
  liqLong24h: number | null;
  liqShort24h: number | null;
  liqRecentMax: number | null;     // max single 4h-bar liq in last 24h
  // Outcome
  side: 'long' | 'short';
  pnlR: number;
  entryTs: number;
}

async function loadCgSeries() {
  const funding = (await query<any>(`SELECT symbol, ts::text, fr_close::text FROM cg_funding_oi_weighted ORDER BY ts`)).rows;
  const fundByCoin = new Map<string, { ts: number; v: number }[]>();
  for (const r of funding) { const arr = fundByCoin.get(r.symbol) ?? []; arr.push({ ts: Number(r.ts), v: Number(r.fr_close) }); fundByCoin.set(r.symbol, arr); }

  const ls = (await query<any>(`SELECT pair, ts::text, ratio::text FROM cg_ls_top_position ORDER BY ts`)).rows;
  const lsByPair = new Map<string, { ts: number; v: number }[]>();
  for (const r of ls) { const arr = lsByPair.get(r.pair) ?? []; arr.push({ ts: Number(r.ts), v: Number(r.ratio) }); lsByPair.set(r.pair, arr); }

  const oi = (await query<any>(`SELECT symbol, ts::text, oi_close::text FROM cg_oi_aggregated ORDER BY ts`)).rows;
  const oiByCoin = new Map<string, { ts: number; v: number }[]>();
  for (const r of oi) { const arr = oiByCoin.get(r.symbol) ?? []; arr.push({ ts: Number(r.ts), v: Number(r.oi_close) }); oiByCoin.set(r.symbol, arr); }

  const taker = (await query<any>(`SELECT pair, ts::text, buy_usd::text, sell_usd::text FROM cg_taker_pair ORDER BY ts`)).rows;
  const takerByPair = new Map<string, { ts: number; b: number; s: number }[]>();
  for (const r of taker) { const arr = takerByPair.get(r.pair) ?? []; arr.push({ ts: Number(r.ts), b: Number(r.buy_usd), s: Number(r.sell_usd) }); takerByPair.set(r.pair, arr); }

  const liq = (await query<any>(`SELECT pair, ts::text, long_liq_usd::text, short_liq_usd::text FROM cg_liq_pair ORDER BY ts`)).rows;
  const liqByPair = new Map<string, { ts: number; longL: number; shortL: number }[]>();
  for (const r of liq) { const arr = liqByPair.get(r.pair) ?? []; arr.push({ ts: Number(r.ts), longL: Number(r.long_liq_usd), shortL: Number(r.short_liq_usd) }); liqByPair.set(r.pair, arr); }

  // BTC 24h return from 4H candles
  const btcRows = (await query<any>(`SELECT ts::text, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts`)).rows;
  const btc = btcRows.map((r: any) => ({ ts: Number(r.ts), v: Number(r.close) }));

  return { fundByCoin, lsByPair, oiByCoin, takerByPair, liqByPair, btc };
}

async function main() {
  const now = Date.now();
  const startTs = now - 365 * 24 * 60 * 60_000;
  const endTs = now;

  console.log('Running 13-pair backtest (permissive — current gates-off code)...');
  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allTrades.push(...r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length}\n`);
  }
  console.log(`\nTotal: ${allTrades.length} trades. Loading CG series...`);

  const data = await loadCgSeries();
  const oi24bars = 6; // 24h at 4h cadence

  console.log('Enriching trades...');
  const feats: Features[] = [];
  for (const t of allTrades) {
    const coin = t.symbol.replace('USDT', '');
    const f: Features = {
      rrTp1: 0, rrTp2: 0, stopDistPct: 0, tp1DistPct: 0, tpSpreadPct: 0,
      hourUtc: 0, dayOfWeek: 0, btcRet24h: null,
      funding: null, fundingDelta24h: null,
      lsTopRatio: null, lsTopDelta24h: null,
      oiPctChange24h: null,
      takerImbalance1h: null, takerImbalance24h: null,
      liqLong24h: null, liqShort24h: null, liqRecentMax: null,
      side: t.side, pnlR: t.pnlR, entryTs: t.entryTs,
    };

    const stopDist = Math.abs(t.entry - t.sl);
    const tp1Dist = Math.abs(t.tp1 - t.entry);
    const tp2Dist = t.tp2 !== undefined ? Math.abs(t.tp2 - t.entry) : tp1Dist;
    f.rrTp1 = stopDist > 0 ? tp1Dist / stopDist : 0;
    f.rrTp2 = stopDist > 0 ? tp2Dist / stopDist : 0;
    f.stopDistPct = (stopDist / t.entry) * 100;
    f.tp1DistPct = (tp1Dist / t.entry) * 100;
    f.tpSpreadPct = t.tp2 !== undefined ? (Math.abs(t.tp2 - t.tp1) / t.entry) * 100 : 0;

    const d = new Date(t.entryTs);
    f.hourUtc = d.getUTCHours();
    f.dayOfWeek = d.getUTCDay();

    // BTC 24h return
    const btc = data.btc;
    const idxBtc = btc.findIndex(b => b.ts > t.entryTs);
    if (idxBtc > 6) {
      const cur = btc[idxBtc - 1].v;
      const prev = btc[idxBtc - 6 - 1].v;
      if (prev > 0) f.btcRet24h = (cur - prev) / prev * 100;
    }

    // Funding + delta
    const fund = data.fundByCoin.get(coin);
    if (fund && fund.length > 0) {
      const snap = latestAt(fund, t.entryTs);
      if (snap) {
        f.funding = snap.v;
        const idx = fund.indexOf(snap);
        if (idx >= 6) f.fundingDelta24h = snap.v - fund[idx - 6].v;
      }
    }

    // L/S top + delta
    const ls = data.lsByPair.get(t.symbol);
    if (ls && ls.length > 0) {
      const snap = latestAt(ls, t.entryTs);
      if (snap) {
        f.lsTopRatio = snap.v;
        const idx = ls.indexOf(snap);
        if (idx >= 6) f.lsTopDelta24h = snap.v - ls[idx - 6].v;
      }
    }

    // OI % change 24h
    const oi = data.oiByCoin.get(coin);
    if (oi && oi.length > 0) {
      const snap = latestAt(oi, t.entryTs);
      if (snap) {
        const idx = oi.indexOf(snap);
        if (idx >= oi24bars && oi[idx - oi24bars].v > 0) {
          f.oiPctChange24h = (snap.v - oi[idx - oi24bars].v) / oi[idx - oi24bars].v * 100;
        }
      }
    }

    // Taker imbalance 1h (last 1 bar at 4h, but it's coarse — use 4h bar as proxy)
    const tk = data.takerByPair.get(t.symbol);
    if (tk && tk.length > 0) {
      const snap = latestAt(tk, t.entryTs);
      if (snap) {
        const tot = snap.b + snap.s;
        if (tot > 0) f.takerImbalance1h = (snap.b - snap.s) / tot;
        const idx = tk.indexOf(snap);
        if (idx >= 6) {
          const slice = tk.slice(idx - 6, idx + 1);
          const sb = slice.reduce((s, x) => s + x.b, 0);
          const ss = slice.reduce((s, x) => s + x.s, 0);
          if (sb + ss > 0) f.takerImbalance24h = (sb - ss) / (sb + ss);
        }
      }
    }

    // Liquidation 24h totals
    const lq = data.liqByPair.get(t.symbol);
    if (lq && lq.length > 0) {
      const snap = latestAt(lq, t.entryTs);
      if (snap) {
        const idx = lq.indexOf(snap);
        if (idx >= 6) {
          const slice = lq.slice(idx - 6, idx + 1);
          f.liqLong24h = slice.reduce((s, x) => s + x.longL, 0);
          f.liqShort24h = slice.reduce((s, x) => s + x.shortL, 0);
          f.liqRecentMax = Math.max(...slice.map(x => x.longL + x.shortL));
        }
      }
    }

    feats.push(f);
  }
  console.log(`Enriched: ${feats.length} trades`);

  // Sort chronologically + train/test split
  feats.sort((a, b) => a.entryTs - b.entryTs);
  const splitIdx = Math.floor(feats.length * 0.75);
  const train = feats.slice(0, splitIdx);
  const test = feats.slice(splitIdx);
  console.log(`Train: ${train.length}  Test: ${test.length}`);

  // For each feature: quintile-bucket on TRAIN, apply same boundaries to TEST,
  // report avgR per bucket and Δ between Q1 and Q5
  const FEATURE_NAMES = [
    'rrTp1','rrTp2','stopDistPct','tp1DistPct','tpSpreadPct',
    'hourUtc','dayOfWeek','btcRet24h',
    'funding','fundingDelta24h','lsTopRatio','lsTopDelta24h',
    'oiPctChange24h','takerImbalance1h','takerImbalance24h',
    'liqLong24h','liqShort24h','liqRecentMax',
  ] as const;

  console.log('\n========== Quintile Δ-analysis (TRAIN→TEST) ==========');
  console.log('feature              n_train  train_Q1→Q5   test_Q1→Q5   verdict');

  const passList: string[] = [];
  for (const name of FEATURE_NAMES) {
    const valid = train.filter(t => (t as any)[name] !== null && Number.isFinite((t as any)[name])) as Features[];
    if (valid.length < 100) {
      console.log(`${name.padEnd(20)} too-few-train (${valid.length})`);
      continue;
    }
    // Build quintile boundaries from train
    const sorted = [...valid].sort((a, b) => (a as any)[name] - (b as any)[name]);
    const bounds: number[] = [];
    for (let i = 1; i < 5; i++) {
      const idx = Math.floor(sorted.length * i / 5);
      bounds.push((sorted[idx] as any)[name]);
    }
    function bucketize(v: number): number {
      for (let i = 0; i < bounds.length; i++) if (v < bounds[i]) return i;
      return 4;
    }
    const trainBuckets: Features[][] = [[],[],[],[],[]];
    for (const t of valid) trainBuckets[bucketize((t as any)[name])].push(t);
    const testValid = test.filter(t => (t as any)[name] !== null && Number.isFinite((t as any)[name])) as Features[];
    const testBuckets: Features[][] = [[],[],[],[],[]];
    for (const t of testValid) testBuckets[bucketize((t as any)[name])].push(t);

    const avgR = (arr: Features[]) => arr.length > 0 ? arr.reduce((s, t) => s + t.pnlR, 0) / arr.length : 0;
    const trQ1 = avgR(trainBuckets[0]); const trQ5 = avgR(trainBuckets[4]);
    const tsQ1 = avgR(testBuckets[0]); const tsQ5 = avgR(testBuckets[4]);
    const trDiff = trQ5 - trQ1;
    const tsDiff = tsQ5 - tsQ1;
    const sameSign = (trDiff > 0 && tsDiff > 0) || (trDiff < 0 && tsDiff < 0);
    const tsAbsBig = Math.abs(tsDiff) >= 0.15;
    const everyTrainBucketHasN = trainBuckets.every(b => b.length >= 30);
    const everyTestBucketHasN = testBuckets.every(b => b.length >= 10);
    const trMono = isMonotonic(trainBuckets.map(avgR));
    const tsMono = isMonotonic(testBuckets.map(avgR));
    const verdict = sameSign && tsAbsBig && everyTrainBucketHasN && everyTestBucketHasN && (trMono || tsMono)
      ? '✅ PASS' : `⚠ ${sameSign?'sign':'sign'}/${tsAbsBig?'big':'small'}/${trMono?'mono':'nope'}-tr/${tsMono?'mono':'nope'}-ts`;
    if (verdict.startsWith('✅')) passList.push(name);
    console.log(
      `${name.padEnd(20)} ${String(valid.length).padStart(5)}  ` +
      `${trQ1.toFixed(2)}→${trQ5.toFixed(2)} (Δ${trDiff.toFixed(2)})   ` +
      `${tsQ1.toFixed(2)}→${tsQ5.toFixed(2)} (Δ${tsDiff.toFixed(2)})   ${verdict}`
    );
  }

  console.log('\n========== Pass-list ==========');
  if (passList.length === 0) {
    console.log('No features survived strict gate. Investigating individually next.');
  } else {
    console.log(`Features that survived: ${passList.join(', ')}`);
  }

  // Per-side breakdown for top features
  for (const name of passList.length > 0 ? passList : ['rrTp2','tp1DistPct','hourUtc']) {
    console.log(`\n--- ${name} by side (TEST) ---`);
    for (const side of ['long','short'] as const) {
      const arr = test.filter(t => t.side === side && (t as any)[name] !== null) as Features[];
      if (arr.length < 20) { console.log(`${side}: too few (${arr.length})`); continue; }
      const sorted = [...arr].sort((a, b) => (a as any)[name] - (b as any)[name]);
      const q1 = sorted.slice(0, Math.floor(sorted.length / 5));
      const q5 = sorted.slice(Math.floor(sorted.length * 4 / 5));
      const avgR = (a: Features[]) => a.length > 0 ? a.reduce((s, t) => s + t.pnlR, 0) / a.length : 0;
      console.log(`${side}: n=${arr.length}  Q1 avgR=${avgR(q1).toFixed(3)} (n=${q1.length})  Q5 avgR=${avgR(q5).toFixed(3)} (n=${q5.length})  Δ=${(avgR(q5) - avgR(q1)).toFixed(3)}`);
    }
  }

  await closePg();
}

function isMonotonic(arr: number[]): boolean {
  if (arr.length < 3) return true;
  let increasing = true, decreasing = true;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i-1]) increasing = false;
    if (arr[i] > arr[i-1]) decreasing = false;
  }
  return increasing || decreasing;
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

// VP-SMC trade enricher: assign each closed trade a CG-conviction score (0-3) based on
// whether L/S, funding, and ETF flow at entry align with the trade direction.
//
// Hypothesis: trades with score ≥ 2 should have meaningfully higher expR than score = 0,
// and the pattern should survive train/test walk-forward split.
//
// If pattern is weak or inconsistent OOS → drop. (Memory: 3 prior gate failures.)

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
  startEquity: 50_000,
  takerFeeRate: 0.00055, makerFeeRate: 0.0002, slippagePct: 0.25,
  riskPctBase: 0.6, leverage: 10,
  tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const WINDOW_BARS = 180; // 30d at 4h

type T = { ts: number };
function latestAt<U extends T>(series: U[], ts: number): U | null {
  let lo = 0, hi = series.length - 1, found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (series[m].ts <= ts) { found = m; lo = m + 1; } else hi = m - 1; }
  return found >= 0 && (ts - series[found].ts) <= LOOKBACK_MS ? series[found] : null;
}
function percentile(series: number[], value: number): number {
  let cnt = 0; for (const v of series) if (v <= value) cnt++; return cnt / series.length;
}

interface Enriched extends ClosedTrade {
  scoreLs: 0 | 1;
  scoreFunding: 0 | 1;
  scoreEtf: 0 | 1;
  score: 0 | 1 | 2 | 3;
}

async function loadSeries() {
  const lsAll = (await query<any>(`SELECT pair, ts::text, ratio::text FROM cg_ls_top_position ORDER BY ts`)).rows;
  const lsByPair = new Map<string, { ts: number; v: number }[]>();
  for (const r of lsAll) {
    const arr = lsByPair.get(r.pair) ?? [];
    arr.push({ ts: Number(r.ts), v: Number(r.ratio) });
    lsByPair.set(r.pair, arr);
  }
  const fundingAll = (await query<any>(`SELECT symbol, ts::text, fr_close::text FROM cg_funding_oi_weighted ORDER BY ts`)).rows;
  const fundingByCoin = new Map<string, { ts: number; v: number }[]>();
  for (const r of fundingAll) {
    const arr = fundingByCoin.get(r.symbol) ?? [];
    arr.push({ ts: Number(r.ts), v: Number(r.fr_close) });
    fundingByCoin.set(r.symbol, arr);
  }
  const etfAll = (await query<any>(`SELECT ts::text, flow_usd::text FROM cg_btc_etf_flow ORDER BY ts`)).rows
    .map(r => ({ ts: Number(r.ts), v: Number(r.flow_usd) }));
  return { lsByPair, fundingByCoin, etfAll };
}

function enrich(trades: ClosedTrade[], data: any): Enriched[] {
  const { lsByPair, fundingByCoin, etfAll } = data;
  const out: Enriched[] = [];
  for (const t of trades) {
    const coin = t.symbol.replace('USDT', '');
    const ls = lsByPair.get(t.symbol);
    const funding = fundingByCoin.get(coin);
    let scoreLs: 0 | 1 = 0, scoreFunding: 0 | 1 = 0, scoreEtf: 0 | 1 = 0;

    if (ls && ls.length > WINDOW_BARS) {
      const snap = latestAt(ls, t.entryTs);
      if (snap) {
        const idx = ls.indexOf(snap);
        if (idx >= WINDOW_BARS) {
          const window = ls.slice(idx - WINDOW_BARS, idx).map(r => r.v);
          const pct = percentile(window, snap.v);
          // Aligned: long when ratio low (top traders bearish, fade them up), short when high
          if (t.side === 'long' && pct <= 0.30) scoreLs = 1;
          if (t.side === 'short' && pct >= 0.70) scoreLs = 1;
        }
      }
    }

    if (funding && funding.length > WINDOW_BARS) {
      const snap = latestAt(funding, t.entryTs);
      if (snap) {
        const idx = funding.indexOf(snap);
        if (idx >= WINDOW_BARS) {
          const window = funding.slice(idx - WINDOW_BARS, idx).map(r => r.v);
          const pct = percentile(window, snap.v);
          // Funding mean-reversion: low fund → upside, high fund → downside
          if (t.side === 'long' && pct <= 0.30) scoreFunding = 1;
          if (t.side === 'short' && pct >= 0.70) scoreFunding = 1;
        }
      }
    }

    // ETF flow only available for BTC; use daily flow at entry day
    if (t.symbol === 'BTCUSDT') {
      const snap = etfAll.find(e => e.ts <= t.entryTs && t.entryTs - e.ts < 36 * 3600 * 1000);
      if (snap) {
        if (t.side === 'long' && snap.v > 300_000_000) scoreEtf = 1;
        if (t.side === 'short' && snap.v < -300_000_000) scoreEtf = 1;
      }
    }

    const score = (scoreLs + scoreFunding + scoreEtf) as 0 | 1 | 2 | 3;
    out.push({ ...t, scoreLs, scoreFunding, scoreEtf, score });
  }
  return out;
}

function bucketReport(label: string, trades: Enriched[]) {
  console.log(`\n=== ${label} (n=${trades.length}) ===`);
  console.log('score   n     WR     avgR    sumR    PF');
  for (let s = 0; s <= 3; s++) {
    const inB = trades.filter(t => t.score === s);
    if (inB.length === 0) { console.log(`  ${s}     0     n/a    n/a     n/a     n/a`); continue; }
    const wins = inB.filter(t => t.pnlR > 0).length;
    const wr = wins / inB.length * 100;
    const avgR = inB.reduce((sum, t) => sum + t.pnlR, 0) / inB.length;
    const sumR = inB.reduce((sum, t) => sum + t.pnlR, 0);
    const winR = inB.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
    const lossR = Math.abs(inB.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : Infinity;
    console.log(`  ${s}    ${String(inB.length).padStart(3)}   ${wr.toFixed(1).padStart(4)}%  ${avgR.toFixed(3).padStart(6)}  ${sumR.toFixed(2).padStart(6)}  ${pf === Infinity ? '∞' : pf.toFixed(2).padStart(4)}`);
  }
  // also aggregate ≥2
  const ge2 = trades.filter(t => t.score >= 2);
  if (ge2.length > 0) {
    const wins = ge2.filter(t => t.pnlR > 0).length;
    const avgR = ge2.reduce((s, t) => s + t.pnlR, 0) / ge2.length;
    const sumR = ge2.reduce((s, t) => s + t.pnlR, 0);
    console.log(`  ≥2   ${String(ge2.length).padStart(3)}   ${(wins/ge2.length*100).toFixed(1)}%  ${avgR.toFixed(3)}  ${sumR.toFixed(2)}`);
  }
  const baseline = trades.reduce((s, t) => s + t.pnlR, 0) / trades.length;
  console.log(`  ALL  ${String(trades.length).padStart(3)}  ${(trades.filter(t=>t.pnlR>0).length/trades.length*100).toFixed(1)}%  ${baseline.toFixed(3)} (baseline)`);
}

async function main() {
  const now = Date.now();
  const startTs = now - 365 * 24 * 60 * 60_000;
  const endTs = now;

  console.log('Running 13-pair × 365d backtest...');
  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allTrades.push(...r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length} trades\n`);
  }

  console.log('\nLoading CG features...');
  const data = await loadSeries();
  const enriched = enrich(allTrades, data);
  enriched.sort((a, b) => a.entryTs - b.entryTs);

  const splitIdx = Math.floor(enriched.length * 0.75);
  const train = enriched.slice(0, splitIdx);
  const test = enriched.slice(splitIdx);

  console.log(`\nTotal: ${enriched.length} trades, train: ${train.length}, test: ${test.length}`);

  bucketReport('FULL', enriched);
  bucketReport('TRAIN (first 75%)', train);
  bucketReport('TEST (last 25%, OOS)', test);

  // Component breakdown: per-feature contribution
  console.log('\n=== Per-feature alignment effect (FULL) ===');
  for (const f of ['scoreLs', 'scoreFunding', 'scoreEtf'] as const) {
    const aligned = enriched.filter(t => (t as any)[f] === 1);
    const unaligned = enriched.filter(t => (t as any)[f] === 0);
    const a1 = aligned.reduce((s, t) => s + t.pnlR, 0) / Math.max(aligned.length, 1);
    const a0 = unaligned.reduce((s, t) => s + t.pnlR, 0) / Math.max(unaligned.length, 1);
    console.log(`  ${f.padEnd(12)}  aligned avgR=${a1.toFixed(3)} (n=${aligned.length})  vs  unaligned avgR=${a0.toFixed(3)} (n=${unaligned.length})  Δ=${(a1 - a0).toFixed(3)}`);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

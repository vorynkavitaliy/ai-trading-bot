// 5m-aware conviction analyzer. Compares CG state at EXACT entry minute (≤5min lag)
// vs 4h-bucket lag. Question: does finer timing surface a usable pattern that 4h analyzer missed?
//
// Window: ~15 days (constrained by 5m × 4500 limit on Standard).
// Sample size will be small (30-80 trades total) — directional read only, not OOS-validate.

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

const LAG_5M_MS = 5 * 60 * 1000;  // exact 5-min alignment
const WINDOW_BARS_5M = 288 * 3;   // 3 days rolling window for z/percentile

type T = { ts: number };
function latestAt<U extends T>(series: U[], ts: number, maxLag: number): U | null {
  let lo = 0, hi = series.length - 1, found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (series[m].ts <= ts) { found = m; lo = m + 1; } else hi = m - 1; }
  return found >= 0 && (ts - series[found].ts) <= maxLag ? series[found] : null;
}
function percentile(series: number[], value: number): number {
  let cnt = 0; for (const v of series) if (v <= value) cnt++; return cnt / series.length;
}

async function main() {
  const now = Date.now();
  // Window covers 5m data range
  const startTs = Date.parse('2026-05-03T04:00:00Z');
  const endTs = now;
  const days = Math.round((endTs - startTs) / 86_400_000);

  console.log(`Window: ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} (${days}d)`);
  console.log('Running 13-pair backtest...');

  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allTrades.push(...r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length}\n`);
  }

  console.log(`\nTotal: ${allTrades.length} trades`);
  if (allTrades.length === 0) { await closePg(); return; }

  // Load 5m series
  console.log('Loading 5m CG features...');
  const lsAll = (await query<any>(`SELECT pair, ts::text, ratio::text FROM cg_ls_top_position_5m ORDER BY ts`)).rows;
  const lsByPair = new Map<string, { ts: number; v: number }[]>();
  for (const r of lsAll) {
    const arr = lsByPair.get(r.pair) ?? []; arr.push({ ts: Number(r.ts), v: Number(r.ratio) }); lsByPair.set(r.pair, arr);
  }
  const fundAll = (await query<any>(`SELECT symbol, ts::text, fr_close::text FROM cg_funding_oi_5m ORDER BY ts`)).rows;
  const fundByCoin = new Map<string, { ts: number; v: number }[]>();
  for (const r of fundAll) {
    const arr = fundByCoin.get(r.symbol) ?? []; arr.push({ ts: Number(r.ts), v: Number(r.fr_close) }); fundByCoin.set(r.symbol, arr);
  }
  const takerAll = (await query<any>(`SELECT pair, ts::text, buy_usd::text, sell_usd::text FROM cg_taker_pair_5m ORDER BY ts`)).rows;
  const takerByPair = new Map<string, { ts: number; b: number; s: number }[]>();
  for (const r of takerAll) {
    const arr = takerByPair.get(r.pair) ?? []; arr.push({ ts: Number(r.ts), b: Number(r.buy_usd), s: Number(r.sell_usd) }); takerByPair.set(r.pair, arr);
  }

  // Enrich each trade with 5m-aligned scores
  type Enriched = { t: ClosedTrade; sLs: 0|1; sFund: 0|1; sTaker: 0|1; score: 0|1|2|3 };
  const enriched: Enriched[] = [];
  for (const t of allTrades) {
    const coin = t.symbol.replace('USDT', '');
    let sLs: 0|1 = 0, sFund: 0|1 = 0, sTaker: 0|1 = 0;

    const ls = lsByPair.get(t.symbol);
    if (ls && ls.length > WINDOW_BARS_5M) {
      const snap = latestAt(ls, t.entryTs, LAG_5M_MS);
      if (snap) {
        const idx = ls.indexOf(snap);
        if (idx >= WINDOW_BARS_5M) {
          const w = ls.slice(idx - WINDOW_BARS_5M, idx).map(x => x.v);
          const pct = percentile(w, snap.v);
          if (t.side === 'long' && pct <= 0.30) sLs = 1;
          if (t.side === 'short' && pct >= 0.70) sLs = 1;
        }
      }
    }

    const fund = fundByCoin.get(coin);
    if (fund && fund.length > WINDOW_BARS_5M) {
      const snap = latestAt(fund, t.entryTs, LAG_5M_MS);
      if (snap) {
        const idx = fund.indexOf(snap);
        if (idx >= WINDOW_BARS_5M) {
          const w = fund.slice(idx - WINDOW_BARS_5M, idx).map(x => x.v);
          const pct = percentile(w, snap.v);
          if (t.side === 'long' && pct <= 0.30) sFund = 1;
          if (t.side === 'short' && pct >= 0.70) sFund = 1;
        }
      }
    }

    // Taker imbalance over last 12 bars (1h) at entry
    const tk = takerByPair.get(t.symbol);
    if (tk) {
      const snap = latestAt(tk, t.entryTs, LAG_5M_MS);
      if (snap) {
        const idx = tk.indexOf(snap);
        if (idx >= 12) {
          const slice = tk.slice(idx - 12, idx + 1);
          const sumB = slice.reduce((s, x) => s + x.b, 0);
          const sumS = slice.reduce((s, x) => s + x.s, 0);
          const imbal = (sumB - sumS) / (sumB + sumS);
          // Aligned: long with buy-dominance (imbal > 0.10), short with sell-dominance
          if (t.side === 'long' && imbal > 0.10) sTaker = 1;
          if (t.side === 'short' && imbal < -0.10) sTaker = 1;
        }
      }
    }

    const score = (sLs + sFund + sTaker) as 0|1|2|3;
    enriched.push({ t, sLs, sFund, sTaker, score });
  }

  // Report
  console.log('\n=== 5m-aligned conviction buckets (FULL window) ===');
  console.log('score   n     WR     avgR    sumR');
  for (let s = 0; s <= 3; s++) {
    const inB = enriched.filter(e => e.score === s);
    if (inB.length === 0) { console.log(`  ${s}     0     n/a    n/a     n/a`); continue; }
    const wins = inB.filter(e => e.t.pnlR > 0).length;
    const wr = wins / inB.length * 100;
    const avgR = inB.reduce((sum, e) => sum + e.t.pnlR, 0) / inB.length;
    const sumR = inB.reduce((sum, e) => sum + e.t.pnlR, 0);
    console.log(`  ${s}    ${String(inB.length).padStart(3)}   ${wr.toFixed(1).padStart(4)}%  ${avgR.toFixed(3).padStart(6)}  ${sumR.toFixed(2).padStart(6)}`);
  }
  const baseline = enriched.reduce((s, e) => s + e.t.pnlR, 0) / enriched.length;
  const blWr = enriched.filter(e => e.t.pnlR > 0).length / enriched.length * 100;
  console.log(`  ALL  ${String(enriched.length).padStart(3)}   ${blWr.toFixed(1)}%  ${baseline.toFixed(3)}  (baseline)`);

  console.log('\n=== Per-feature Δ (5m-aligned) ===');
  for (const [name, key] of [['L/S pos', 'sLs'], ['Funding', 'sFund'], ['Taker', 'sTaker']] as const) {
    const aligned = enriched.filter(e => (e as any)[key] === 1);
    const unaligned = enriched.filter(e => (e as any)[key] === 0);
    const a1 = aligned.reduce((s, e) => s + e.t.pnlR, 0) / Math.max(aligned.length, 1);
    const a0 = unaligned.reduce((s, e) => s + e.t.pnlR, 0) / Math.max(unaligned.length, 1);
    console.log(`  ${name.padEnd(8)}  aligned avgR=${a1.toFixed(3)} (n=${aligned.length})  vs unaligned ${a0.toFixed(3)} (n=${unaligned.length})  Δ=${(a1 - a0).toFixed(3)}`);
  }

  console.log('\n=== Per-side breakdown ===');
  for (const side of ['long', 'short'] as const) {
    const sideTrades = enriched.filter(e => e.t.side === side);
    if (sideTrades.length === 0) continue;
    const baseAvg = sideTrades.reduce((s, e) => s + e.t.pnlR, 0) / sideTrades.length;
    const score2plus = sideTrades.filter(e => e.score >= 2);
    const sc2Avg = score2plus.length > 0 ? score2plus.reduce((s, e) => s + e.t.pnlR, 0) / score2plus.length : 0;
    console.log(`  ${side.padEnd(5)}: n=${sideTrades.length} baseline=${baseAvg.toFixed(3)}, score≥2 n=${score2plus.length} avgR=${sc2Avg.toFixed(3)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

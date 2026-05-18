// Analyzes whether the strategy's CG gates (funding_extreme, lsTopMax/MinLong/Short)
// actually filter LOSING trades or just block volume.
//
// Method:
//   1) Run permissive backtest (bypass CG gates via custom strategy wrapper)
//   2) For each closed trade, fetch CG data at entry timestamp
//   3) Compute what the production gate WOULD have decided (pass/block + reason)
//   4) Bucket results: WR, avgR, sumR per gate-decision
//
// Output answers: are gated trades systematically worse than passed trades?

import { query, close as closePg } from '../../core/db';
import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade, Strategy, StrategyContext } from '../../backtest/types';

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

// Production thresholds (mirror strategy)
const FUNDING_EXTREME_ABS = 0.005;
const LS_TOP_MAX_LONG = 1.7;
const LS_TOP_MIN_SHORT = 0.7;

// Wrapper strategy that calls the underlying VP-SMC but FORCES CG gates to pass.
// We modify DEFAULT_BTC_VP_SMC.fundingExtremeAbs to a huge number to disable.
function permissiveStrategy(params: BtcVpSmcParams): Strategy {
  const permissiveParams: BtcVpSmcParams = {
    ...params,
    fundingExtremeAbs: 1.0,      // disables funding gate
    lsTopMaxLong: 999,           // disables ls-long gate
    lsTopMinShort: -999,         // disables ls-short gate
  };
  return btcVpSmc(permissiveParams);
}

interface GateDecision {
  action: 'pass' | 'block';
  reason: string;
}

function evaluateGate(
  side: 'long' | 'short',
  funding: number | null,
  lsTopPos: number | null,
): GateDecision {
  if (funding != null && Math.abs(funding) > FUNDING_EXTREME_ABS) {
    return { action: 'block', reason: `funding-extreme:${funding.toFixed(5)}` };
  }
  if (side === 'long' && lsTopPos != null && lsTopPos > LS_TOP_MAX_LONG) {
    return { action: 'block', reason: `ls-top-too-long:${lsTopPos.toFixed(2)}` };
  }
  if (side === 'short' && lsTopPos != null && lsTopPos < LS_TOP_MIN_SHORT) {
    return { action: 'block', reason: `ls-top-too-short:${lsTopPos.toFixed(2)}` };
  }
  return { action: 'pass', reason: 'pass' };
}

async function main() {
  const now = Date.now();
  const startTs = now - 365 * 24 * 60 * 60_000;
  const endTs = now;

  console.log('Running 13-pair × 365d backtest with PERMISSIVE CG gates...');
  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = permissiveStrategy(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allTrades.push(...r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length} trades\n`);
  }
  console.log(`\nTotal permissive trades: ${allTrades.length}`);

  // For each trade, find CG at entry and evaluate gate
  console.log('\nFetching CG data per entry and evaluating gates...');
  const fundingAll = (await query<any>(`SELECT symbol, ts::text, fr_close::text FROM cg_funding_oi_weighted ORDER BY ts`)).rows;
  const fundingByCoin = new Map<string, { ts: number; v: number }[]>();
  for (const r of fundingAll) {
    const arr = fundingByCoin.get(r.symbol) ?? []; arr.push({ ts: Number(r.ts), v: Number(r.fr_close) }); fundingByCoin.set(r.symbol, arr);
  }
  const lsAll = (await query<any>(`SELECT pair, ts::text, ratio::text FROM cg_ls_top_position ORDER BY ts`)).rows;
  const lsByPair = new Map<string, { ts: number; v: number }[]>();
  for (const r of lsAll) {
    const arr = lsByPair.get(r.pair) ?? []; arr.push({ ts: Number(r.ts), v: Number(r.ratio) }); lsByPair.set(r.pair, arr);
  }

  function latestAt<T extends { ts: number }>(series: T[], ts: number): T | null {
    let lo = 0, hi = series.length - 1, found = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (series[m].ts <= ts) { found = m; lo = m + 1; } else hi = m - 1; }
    return found >= 0 ? series[found] : null;
  }

  interface Enriched {
    t: ClosedTrade;
    funding: number | null;
    lsTopPos: number | null;
    gate: GateDecision;
  }

  const enriched: Enriched[] = [];
  for (const t of allTrades) {
    const coin = t.symbol.replace('USDT', '');
    const fund = fundingByCoin.get(coin);
    const ls = lsByPair.get(t.symbol);
    const fundSnap = fund ? latestAt(fund, t.entryTs) : null;
    const lsSnap = ls ? latestAt(ls, t.entryTs) : null;
    const funding = fundSnap && (t.entryTs - fundSnap.ts) < 6 * 3600_000 ? fundSnap.v : null;
    const lsTopPos = lsSnap && (t.entryTs - lsSnap.ts) < 6 * 3600_000 ? lsSnap.v : null;
    const gate = evaluateGate(t.side, funding, lsTopPos);
    enriched.push({ t, funding, lsTopPos, gate });
  }

  // Stats
  const blocked = enriched.filter(e => e.gate.action === 'block');
  const passed = enriched.filter(e => e.gate.action === 'pass');
  console.log(`\nTotal: ${enriched.length}  blocked: ${blocked.length} (${(blocked.length/enriched.length*100).toFixed(1)}%)  passed: ${passed.length}`);

  function summary(label: string, arr: Enriched[]) {
    if (arr.length === 0) { console.log(`${label}: empty`); return; }
    const wins = arr.filter(e => e.t.pnlR > 0).length;
    const sumR = arr.reduce((s, e) => s + e.t.pnlR, 0);
    const avgR = sumR / arr.length;
    const wr = wins / arr.length * 100;
    const sumWin = arr.filter(e => e.t.pnlR > 0).reduce((s, e) => s + e.t.pnlR, 0);
    const sumLoss = Math.abs(arr.filter(e => e.t.pnlR < 0).reduce((s, e) => s + e.t.pnlR, 0));
    const pf = sumLoss > 0 ? sumWin / sumLoss : Infinity;
    console.log(`${label.padEnd(20)} n=${String(arr.length).padStart(4)}  WR=${wr.toFixed(1).padStart(4)}%  avgR=${avgR.toFixed(3).padStart(6)}  sumR=${sumR.toFixed(2).padStart(7)}  PF=${pf === Infinity ? '∞' : pf.toFixed(2)}`);
  }

  console.log('\n=== Overall buckets ===');
  summary('BLOCKED (would skip)', blocked);
  summary('PASSED (would take)', passed);
  summary('TOTAL (permissive)', enriched);

  // By side
  console.log('\n=== By side ===');
  for (const side of ['long', 'short'] as const) {
    const sideArr = enriched.filter(e => e.t.side === side);
    const sBlocked = sideArr.filter(e => e.gate.action === 'block');
    const sPassed = sideArr.filter(e => e.gate.action === 'pass');
    summary(`${side.toUpperCase()} blocked`, sBlocked);
    summary(`${side.toUpperCase()} passed`, sPassed);
  }

  // Breakdown by reason
  console.log('\n=== By block reason ===');
  const reasons = new Map<string, Enriched[]>();
  for (const e of blocked) {
    const r = e.gate.reason.split(':')[0];
    if (!reasons.has(r)) reasons.set(r, []);
    reasons.get(r)!.push(e);
  }
  for (const [r, arr] of reasons) summary(r, arr);

  // CG availability
  const noCg = enriched.filter(e => e.funding === null && e.lsTopPos === null);
  const someCg = enriched.filter(e => e.funding !== null || e.lsTopPos !== null);
  console.log(`\n=== CG data availability ===`);
  console.log(`Trades with NO CG data (would be permissive): ${noCg.length}`);
  console.log(`Trades WITH CG data: ${someCg.length}`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

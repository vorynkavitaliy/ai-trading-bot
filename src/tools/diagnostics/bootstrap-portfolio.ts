// Bootstrap CI on portfolio trades.
//
// Procedure:
//   1) Run portfolio backtest (same cap-N + per-pair-unique logic as portfolio.ts),
//      collect post-cap realized trades with their R-multiples.
//   2) Resample with replacement N times (default 5000), each sample size = annualTrades.
//   3) For each resample, compound the equity curve using riskPct% per trade.
//   4) Report 5 / 25 / 50 / 75 / 95 percentiles of annual return, P(loss), worst case.
//
// IID assumption — sample trades independently. Real trades have mild serial
// dependence (cap-N skips, regime clusters), so bootstrap underestimates variance.
// Good enough as a sanity-check lower bound.

import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'BNBUSDT', 'LTCUSDT', 'LINKUSDT', 'ATOMUSDT',
  'SUIUSDT', 'TONUSDT', 'DOGEUSDT', 'APTUSDT', 'ARBUSDT',
];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  LINKUSDT: { maxStopAtrPct: 5.0 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
  SUIUSDT:  { maxStopAtrPct: 5.0 },
  TONUSDT:  { maxStopAtrPct: 5.0 },
  DOGEUSDT: { maxStopAtrPct: 5.5 },
  APTUSDT:  { maxStopAtrPct: 5.0 },
  ARBUSDT:  { maxStopAtrPct: 5.0 },
};

const SLIPPAGE_PCT = parseFloat(process.env.BS_SLIP ?? '0.25');
const RISK_PCT = parseFloat(process.env.BS_RISK_PCT ?? '0.375');
const MAX_PARALLEL = parseInt(process.env.BS_CAP ?? '4', 10);
const N_RESAMPLES = parseInt(process.env.BS_N ?? '5000', 10);
const SEED = parseInt(process.env.BS_SEED ?? '42', 10);

const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: SLIPPAGE_PCT,
  riskPctBase: 0.6,
  leverage: 10,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

// Simple linear congruential PRNG for reproducibility (Park-Miller).
let prngState = SEED;
function rand(): number {
  prngState = (prngState * 16807) % 2147483647;
  return prngState / 2147483647;
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

async function gatherPortfolioTrades(): Promise<ClosedTrade[]> {
  const now = Date.now();
  const envStart = process.env.BT_START_ISO ? Date.parse(process.env.BT_START_ISO) : NaN;
  const envEnd   = process.env.BT_END_ISO   ? Date.parse(process.env.BT_END_ISO)   : NaN;
  const days = parseInt(process.env.BT_DAYS ?? '365', 10);
  const startTs = Number.isFinite(envStart) ? envStart : now - days * 86_400_000;
  const endTs   = Number.isFinite(envEnd)   ? envEnd   : now;

  log.info('gathering trades', { from: new Date(startTs).toISOString().slice(0,10), to: new Date(endTs).toISOString().slice(0,10) });

  const allRaw: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allRaw.push(...r.trades);
  }
  allRaw.sort((a, b) => a.entryTs - b.entryTs);

  // Apply cap-N + pair-unique gating, identical to portfolio.ts
  const open: { symbol: string; exitTs: number }[] = [];
  const taken: ClosedTrade[] = [];
  for (const t of allRaw) {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].exitTs <= t.entryTs) open.splice(i, 1);
    if (open.some((p) => p.symbol === t.symbol)) continue;
    if (open.length >= MAX_PARALLEL) continue;
    taken.push(t);
    open.push({ symbol: t.symbol, exitTs: t.exitTs });
  }
  return taken;
}

function compoundReturn(trades: ClosedTrade[]): number {
  let equity = COMMON.startEquity;
  for (const t of trades) {
    const riskUsd = equity * (RISK_PCT / 100);
    equity += t.pnlR * riskUsd;
  }
  return (equity - COMMON.startEquity) / COMMON.startEquity * 100;
}

async function main() {
  console.log('==================================================================================');
  console.log(`BOOTSTRAP CI — portfolio trades resampled with replacement`);
  console.log(`cap-${MAX_PARALLEL}, risk ${RISK_PCT}%, slip ${SLIPPAGE_PCT}%, N=${N_RESAMPLES}, seed=${SEED}`);
  console.log('==================================================================================\n');

  const trades = await gatherPortfolioTrades();
  const observedReturn = compoundReturn(trades);

  console.log(`gathered ${trades.length} post-cap portfolio trades`);
  console.log(`observed compounded return (this sample): ${observedReturn.toFixed(2)}%\n`);

  // Stats on the underlying R distribution
  const rValues = trades.map((t) => t.pnlR);
  const meanR = rValues.reduce((a, b) => a + b, 0) / rValues.length;
  const wr = trades.filter((t) => t.pnlR > 0).length / trades.length;
  const winR = trades.filter((t) => t.pnlR > 0).map((t) => t.pnlR);
  const lossR = trades.filter((t) => t.pnlR <= 0).map((t) => t.pnlR);
  const avgWin = winR.length ? winR.reduce((a, b) => a + b, 0) / winR.length : 0;
  const avgLoss = lossR.length ? lossR.reduce((a, b) => a + b, 0) / lossR.length : 0;
  console.log(`R-distribution: WR=${(wr * 100).toFixed(1)}%, avgR=${meanR.toFixed(3)}, avgWin=${avgWin.toFixed(3)}R, avgLoss=${avgLoss.toFixed(3)}R`);

  // Bootstrap. Sample N trades per resample. Use trades.length as annual estimate.
  const annualTrades = trades.length;
  console.log(`bootstrapping ${N_RESAMPLES} resamples, ${annualTrades} trades each (compound)...\n`);

  const returns: number[] = new Array(N_RESAMPLES);
  for (let s = 0; s < N_RESAMPLES; s++) {
    let equity = COMMON.startEquity;
    for (let i = 0; i < annualTrades; i++) {
      const t = trades[Math.floor(rand() * trades.length)];
      const riskUsd = equity * (RISK_PCT / 100);
      equity += t.pnlR * riskUsd;
    }
    returns[s] = (equity - COMMON.startEquity) / COMMON.startEquity * 100;
  }

  returns.sort((a, b) => a - b);
  const p5 = percentile(returns, 5);
  const p25 = percentile(returns, 25);
  const p50 = percentile(returns, 50);
  const p75 = percentile(returns, 75);
  const p95 = percentile(returns, 95);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const pLoss = returns.filter((x) => x < 0).length / returns.length * 100;
  const worst = returns[0];
  const best = returns[returns.length - 1];

  console.log('annual return distribution:');
  console.log(`  P5  (5%-percentile):  ${p5.toFixed(2)}%  ← bad-luck lower bound (95% above this)`);
  console.log(`  P25:                  ${p25.toFixed(2)}%`);
  console.log(`  P50  (median):        ${p50.toFixed(2)}%`);
  console.log(`  P75:                  ${p75.toFixed(2)}%`);
  console.log(`  P95:                  ${p95.toFixed(2)}%  ← good-luck upper bound`);
  console.log(`  mean:                 ${mean.toFixed(2)}%`);
  console.log(`  worst (full range):   ${worst.toFixed(2)}%`);
  console.log(`  best  (full range):   ${best.toFixed(2)}%`);
  console.log(`  P(loss):              ${pLoss.toFixed(2)}%  ← chance of negative year`);

  // Monthly equivalents
  const months = (parseInt(process.env.BT_DAYS ?? '365', 10)) / 30.4;
  console.log('');
  console.log(`per-month equivalents (assuming ${months.toFixed(1)} months of trades):`);
  console.log(`  P5  monthly:  ${(p5 / months).toFixed(2)}%/мес`);
  console.log(`  P50 monthly:  ${(p50 / months).toFixed(2)}%/мес`);
  console.log(`  P95 monthly:  ${(p95 / months).toFixed(2)}%/мес`);

  await closePg();
}

main().catch(async (e) => {
  log.error('bootstrap failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});

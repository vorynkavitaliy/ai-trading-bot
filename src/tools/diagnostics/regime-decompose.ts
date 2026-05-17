// Regime decomposition: classify each trade by BTC regime at entry time,
// then aggregate metrics per regime. Tests whether the strategy edge is
// concentrated in one regime (= regime-specific overfit) or distributed.
//
// Regimes (BTC 1H, ADX + EMA stack):
//   range       — ADX < 20
//   transition  — ADX 20-25
//   trend_bull  — ADX > 25, EMA stack bull (8>21>55>200)
//   trend_bear  — ADX > 25, EMA stack bear (8<21<55<200)
//   trend_other — ADX > 25, EMA stack mixed
//
// Output:
//   1) total time BTC spent in each regime (% of bars)
//   2) per-regime: trades, WR, totalR, avgR, contribution to total P&L
//   3) verdict: if one regime carries >70% of P&L, edge is regime-concentrated

import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { ADX, EMA } from 'technicalindicators';

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

const SLIPPAGE_PCT = parseFloat(process.env.RG_SLIP ?? '0.25');
const RISK_PCT = parseFloat(process.env.RG_RISK_PCT ?? '0.375');
const MAX_PARALLEL = parseInt(process.env.RG_CAP ?? '4', 10);

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

type Regime = 'range' | 'transition' | 'trend_bull' | 'trend_bear' | 'trend_other';

interface RegimeBar {
  ts: number;
  adx: number;
  stack: 'bull' | 'bear' | 'mixed';
  regime: Regime;
}

function classify(adx: number, stack: 'bull' | 'bear' | 'mixed'): Regime {
  if (adx < 20) return 'range';
  if (adx < 25) return 'transition';
  if (stack === 'bull') return 'trend_bull';
  if (stack === 'bear') return 'trend_bear';
  return 'trend_other';
}

async function buildBtcRegimeSeries(fromTs: number, toTs: number): Promise<RegimeBar[]> {
  // Pull BTC 1H bars with warmup (300 bars)
  const warmupMs = 300 * 60 * 60_000;
  const r = await query<any>(
    `SELECT ts::text, open, high, low, close
     FROM candles WHERE symbol = 'BTCUSDT' AND tf = '60m'
       AND ts >= $1 AND ts <= $2 ORDER BY ts ASC`,
    [fromTs - warmupMs, toTs]
  );
  const bars = r.rows.map((row: any) => ({
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open), high: parseFloat(row.high),
    low: parseFloat(row.low), close: parseFloat(row.close),
  }));
  const highs = bars.map((b: any) => b.high);
  const lows = bars.map((b: any) => b.low);
  const closes = bars.map((b: any) => b.close);
  const adxSeries = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
  const ema8s = EMA.calculate({ period: 8, values: closes });
  const ema21s = EMA.calculate({ period: 21, values: closes });
  const ema55s = EMA.calculate({ period: 55, values: closes });
  const ema200s = EMA.calculate({ period: 200, values: closes });

  // technicalindicators offsets: each indicator omits first (period-1) values
  // ADX requires 2×period ≈ 28 lead-in. We just align by tail.
  const out: RegimeBar[] = [];
  const N = bars.length;
  for (let i = 0; i < N; i++) {
    // Compute index into each indicator's tail-aligned series
    const adxIdx = i - (N - adxSeries.length);
    const ema8Idx = i - (N - ema8s.length);
    const ema21Idx = i - (N - ema21s.length);
    const ema55Idx = i - (N - ema55s.length);
    const ema200Idx = i - (N - ema200s.length);
    if (adxIdx < 0 || ema200Idx < 0) continue;
    const adxVal = (adxSeries[adxIdx] as any).adx;
    const e8 = ema8s[ema8Idx], e21 = ema21s[ema21Idx], e55 = ema55s[ema55Idx], e200 = ema200s[ema200Idx];
    let stack: 'bull' | 'bear' | 'mixed' = 'mixed';
    if (e8 > e21 && e21 > e55 && e55 > e200) stack = 'bull';
    else if (e8 < e21 && e21 < e55 && e55 < e200) stack = 'bear';
    if (bars[i].ts < fromTs) continue;
    out.push({ ts: bars[i].ts, adx: adxVal, stack, regime: classify(adxVal, stack) });
  }
  return out;
}

async function gatherPortfolioTrades(startTs: number, endTs: number): Promise<ClosedTrade[]> {
  const allRaw: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allRaw.push(...r.trades);
  }
  allRaw.sort((a, b) => a.entryTs - b.entryTs);
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

async function main() {
  const envStart = process.env.BT_START_ISO ? Date.parse(process.env.BT_START_ISO) : NaN;
  const envEnd   = process.env.BT_END_ISO   ? Date.parse(process.env.BT_END_ISO)   : NaN;
  const days = parseInt(process.env.BT_DAYS ?? '365', 10);
  const now = Date.now();
  const startTs = Number.isFinite(envStart) ? envStart : now - days * 86_400_000;
  const endTs   = Number.isFinite(envEnd)   ? envEnd   : now;

  console.log('==================================================================================');
  console.log(`REGIME DECOMPOSITION — slip ${SLIPPAGE_PCT}%, cap-${MAX_PARALLEL}, risk ${RISK_PCT}%`);
  console.log(`window: ${new Date(startTs).toISOString().slice(0, 10)} → ${new Date(endTs).toISOString().slice(0, 10)}`);
  console.log('==================================================================================\n');

  const [regimeBars, trades] = await Promise.all([
    buildBtcRegimeSeries(startTs, endTs),
    gatherPortfolioTrades(startTs, endTs),
  ]);

  console.log(`BTC 1H regime bars: ${regimeBars.length}`);
  console.log(`portfolio trades:   ${trades.length}\n`);

  // 1) Regime distribution over BTC time
  const timeByRegime: Record<Regime, number> = { range: 0, transition: 0, trend_bull: 0, trend_bear: 0, trend_other: 0 };
  for (const b of regimeBars) timeByRegime[b.regime]++;
  console.log('BTC time spent by regime:');
  for (const r of Object.keys(timeByRegime) as Regime[]) {
    const pct = (timeByRegime[r] / regimeBars.length) * 100;
    console.log(`  ${r.padEnd(13)} ${String(timeByRegime[r]).padStart(4)} bars  (${pct.toFixed(1)}%)`);
  }
  console.log('');

  // 2) Classify each trade by BTC regime at entry
  const regimeByTs = new Map<number, Regime>();
  for (const b of regimeBars) regimeByTs.set(b.ts, b.regime);
  // For trades whose entryTs falls between bar timestamps, snap to floor 1H boundary
  function findRegime(ts: number): Regime | null {
    const floor = Math.floor(ts / 3_600_000) * 3_600_000;
    return regimeByTs.get(floor) ?? null;
  }
  const tradesByRegime: Record<Regime, ClosedTrade[]> = { range: [], transition: [], trend_bull: [], trend_bear: [], trend_other: [] };
  let unmatched = 0;
  for (const t of trades) {
    const r = findRegime(t.entryTs);
    if (!r) { unmatched++; continue; }
    tradesByRegime[r].push(t);
  }
  if (unmatched > 0) log.warn('unmatched trades', { count: unmatched });

  // 3) Per-regime metrics
  console.log('per-regime trade stats:');
  console.log('  regime         trades  WR     totalR    avgR     P&L estimate   contrib%');
  console.log('  ---------------------------------------------------------------------------');
  const totalR = trades.reduce((a, t) => a + t.pnlR, 0);
  for (const r of Object.keys(tradesByRegime) as Regime[]) {
    const ts = tradesByRegime[r];
    const wins = ts.filter((t) => t.pnlR > 0).length;
    const trR = ts.reduce((a, t) => a + t.pnlR, 0);
    const avgR = ts.length ? trR / ts.length : 0;
    const wr = ts.length ? (wins / ts.length) * 100 : 0;
    // Linear P&L estimate (riskPct × startEquity per R, no compound)
    const pnlEst = trR * (RISK_PCT / 100) * COMMON.startEquity;
    const contrib = totalR !== 0 ? (trR / totalR) * 100 : 0;
    const expectedShare = (timeByRegime[r] / regimeBars.length) * 100;
    console.log(
      `  ${r.padEnd(13)} ${String(ts.length).padStart(5)}  ${wr.toFixed(1).padStart(5)}%  ${trR.toFixed(2).padStart(7)}R  ${avgR.toFixed(3).padStart(6)}  $${pnlEst.toFixed(0).padStart(7)}  ${contrib.toFixed(1).padStart(5)}%  (expected: ${expectedShare.toFixed(1)}%)`
    );
  }

  // 4) Verdict
  console.log('');
  const regimeContribs = (Object.keys(tradesByRegime) as Regime[]).map((r) => {
    const trR = tradesByRegime[r].reduce((a, t) => a + t.pnlR, 0);
    return { regime: r, trR, contrib: totalR !== 0 ? (trR / totalR) * 100 : 0 };
  }).sort((a, b) => b.contrib - a.contrib);
  const top = regimeContribs[0];
  const top2 = regimeContribs[0].contrib + regimeContribs[1].contrib;
  console.log('verdict:');
  console.log(`  top regime:      ${top.regime} = ${top.contrib.toFixed(1)}% of total R`);
  console.log(`  top 2 regimes:   ${top2.toFixed(1)}% of total R`);
  if (top.contrib > 70) {
    console.log(`  ⚠ EDGE CONCENTRATED: ${top.regime} alone carries ${top.contrib.toFixed(0)}% — strategy is regime-specific.`);
  } else if (top2 > 85) {
    console.log(`  ⚠ EDGE CONCENTRATED IN 2: top 2 regimes carry ${top2.toFixed(0)}% — if both flip, strategy dies.`);
  } else {
    console.log(`  ✓ edge distributed across regimes (no single regime carries >70%)`);
  }

  // 4.5) Per-pair × per-regime contribution
  console.log('');
  console.log('per-pair × per-regime totalR:');
  const REGIMES: Regime[] = ['range', 'transition', 'trend_bull', 'trend_bear', 'trend_other'];
  console.log('  symbol     range  transition  trend_bull  trend_bear  trend_other    total    pref-regime');
  console.log('  --------------------------------------------------------------------------------------');
  for (const sym of SYMBOLS) {
    const symTrades = trades.filter((t) => t.symbol === sym);
    const byRegime: Record<Regime, number> = { range: 0, transition: 0, trend_bull: 0, trend_bear: 0, trend_other: 0 };
    const countByRegime: Record<Regime, number> = { range: 0, transition: 0, trend_bull: 0, trend_bear: 0, trend_other: 0 };
    for (const t of symTrades) {
      const r = findRegime(t.entryTs);
      if (!r) continue;
      byRegime[r] += t.pnlR;
      countByRegime[r]++;
    }
    const totalR = REGIMES.reduce((a, r) => a + byRegime[r], 0);
    // Find preferred regime by avgR (where edge is strongest)
    let pref = '—';
    let bestAvg = -Infinity;
    for (const r of REGIMES) {
      if (countByRegime[r] < 5) continue;  // need ≥5 trades for stable avg
      const avg = byRegime[r] / countByRegime[r];
      if (avg > bestAvg) { bestAvg = avg; pref = `${r}(${avg.toFixed(2)}R)`; }
    }
    const row = [
      sym.padEnd(10),
      byRegime.range.toFixed(2).padStart(6),
      byRegime.transition.toFixed(2).padStart(10),
      byRegime.trend_bull.toFixed(2).padStart(10),
      byRegime.trend_bear.toFixed(2).padStart(10),
      byRegime.trend_other.toFixed(2).padStart(11),
      totalR.toFixed(2).padStart(7),
      '  ' + pref,
    ].join('  ');
    console.log(`  ${row}`);
  }

  // 5) BTC bull-bias check — what % of time was bull-stack?
  const bullBars = regimeBars.filter((b) => b.stack === 'bull').length;
  const bearBars = regimeBars.filter((b) => b.stack === 'bear').length;
  const mixedBars = regimeBars.filter((b) => b.stack === 'mixed').length;
  console.log('');
  console.log('BTC EMA-stack distribution over window:');
  console.log(`  bull:   ${((bullBars / regimeBars.length) * 100).toFixed(1)}%`);
  console.log(`  bear:   ${((bearBars / regimeBars.length) * 100).toFixed(1)}%`);
  console.log(`  mixed:  ${((mixedBars / regimeBars.length) * 100).toFixed(1)}%`);

  await closePg();
}

main().catch(async (e) => {
  log.error('regime-decompose failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});

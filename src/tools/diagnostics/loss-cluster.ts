// Loss-cluster diagnostic — find common features in losing trades.
//
// For every post-cap portfolio trade with pnlR < 0 (SL hits + tail-stops),
// extract environmental features at entry time and bucket them:
//   - BTC regime (ADX + EMA stack)
//   - Hour of UTC day
//   - Day of week
//   - Pair's own ATR percentile (current ATR_pct vs last 100 bars)
//   - Recent N-bar move magnitude: |close_now - close_n_ago| / ATR
//   - Pair's preferred regime (from regime-decompose) vs current regime
//
// Then compare distribution of losses vs distribution of all trades:
// over-represented features in losses indicate filterable patterns.

import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { ADX, EMA, ATR } from 'technicalindicators';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'BNBUSDT', 'LTCUSDT', 'ATOMUSDT',
  'TONUSDT', 'DOGEUSDT', 'APTUSDT', 'ARBUSDT',
  'TAOUSDT', 'INJUSDT',
];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT:  { maxStopAtrPct: 5.0 },
  DOGEUSDT: { maxStopAtrPct: 5.5 },
  APTUSDT:  { maxStopAtrPct: 5.0 },
  ARBUSDT:  { maxStopAtrPct: 5.0 },
  TAOUSDT:  { maxStopAtrPct: 5.0 },
  INJUSDT:  { maxStopAtrPct: 5.0 },
};

const SLIPPAGE_PCT = parseFloat(process.env.LC_SLIP ?? '0.25');
const RISK_PCT = parseFloat(process.env.LC_RISK_PCT ?? '0.375');
const MAX_PARALLEL = parseInt(process.env.LC_CAP ?? '6', 10);

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
type Bar = { ts: number; open: number; high: number; low: number; close: number };

async function loadBars1h(symbol: string, fromTs: number, toTs: number): Promise<Bar[]> {
  const r = await query<any>(
    `SELECT ts::text, open, high, low, close FROM candles
     WHERE symbol = $1 AND tf = '60m' AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
    [symbol, fromTs, toTs]
  );
  return r.rows.map((row: any) => ({
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open), high: parseFloat(row.high),
    low: parseFloat(row.low), close: parseFloat(row.close),
  }));
}

async function buildBtcRegimeMap(fromTs: number, toTs: number): Promise<Map<number, Regime>> {
  const warmupMs = 300 * 3_600_000;
  const bars = await loadBars1h('BTCUSDT', fromTs - warmupMs, toTs);
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low), closes = bars.map(b => b.close);
  const adxSeries = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
  const ema8s = EMA.calculate({ period: 8, values: closes });
  const ema21s = EMA.calculate({ period: 21, values: closes });
  const ema55s = EMA.calculate({ period: 55, values: closes });
  const ema200s = EMA.calculate({ period: 200, values: closes });
  const N = bars.length;
  const out = new Map<number, Regime>();
  for (let i = 0; i < N; i++) {
    const adxIdx = i - (N - adxSeries.length);
    const ema200Idx = i - (N - ema200s.length);
    if (adxIdx < 0 || ema200Idx < 0) continue;
    const adx = (adxSeries[adxIdx] as any).adx;
    const e8 = ema8s[i - (N - ema8s.length)], e21 = ema21s[i - (N - ema21s.length)];
    const e55 = ema55s[i - (N - ema55s.length)], e200 = ema200s[i - (N - ema200s.length)];
    let stack: 'bull' | 'bear' | 'mixed' = 'mixed';
    if (e8 > e21 && e21 > e55 && e55 > e200) stack = 'bull';
    else if (e8 < e21 && e21 < e55 && e55 < e200) stack = 'bear';
    let regime: Regime;
    if (adx < 20) regime = 'range';
    else if (adx < 25) regime = 'transition';
    else if (stack === 'bull') regime = 'trend_bull';
    else if (stack === 'bear') regime = 'trend_bear';
    else regime = 'trend_other';
    out.set(bars[i].ts, regime);
  }
  return out;
}

// For each symbol, build a lookup of features by ts:
//   - ATR pct (atr/close)
//   - 3-bar move magnitude: |close - close_3_ago| / atr
//   - 1-bar move magnitude (last closed bar): |close - open| / atr
async function buildPairFeatures(symbol: string, fromTs: number, toTs: number) {
  const warmupMs = 100 * 3_600_000;
  const bars = await loadBars1h(symbol, fromTs - warmupMs, toTs);
  const N = bars.length;
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low), closes = bars.map(b => b.close);
  const atrSeries = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  // tail-aligned: atrSeries.length = N - 14
  const feats = new Map<number, { atrPct: number; move3bar: number; move1bar: number; atrPctile: number }>();
  // Compute atrPct array, then percentile rank against last 100 bars
  const atrPctArr: number[] = [];
  for (let i = 0; i < atrSeries.length; i++) {
    const barIdx = i + (N - atrSeries.length);
    atrPctArr.push((atrSeries[i] / bars[barIdx].close) * 100);
  }
  for (let i = 14; i < N; i++) {
    const atrIdx = i - 14;
    const atr = atrSeries[atrIdx];
    if (!atr || atr <= 0) continue;
    const move1 = Math.abs(bars[i].close - bars[i].open) / atr;
    const move3 = i >= 17 ? Math.abs(bars[i].close - bars[i - 3].close) / atr : 0;
    // ATR percentile vs last 100 bars
    const lookbackStart = Math.max(0, atrIdx - 100);
    const lookback = atrPctArr.slice(lookbackStart, atrIdx);
    const curPct = atrPctArr[atrIdx];
    const rank = lookback.filter(x => x <= curPct).length / Math.max(1, lookback.length);
    feats.set(bars[i].ts, { atrPct: curPct, move3bar: move3, move1bar: move1, atrPctile: rank * 100 });
  }
  return feats;
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
    if (open.some(p => p.symbol === t.symbol)) continue;
    if (open.length >= MAX_PARALLEL) continue;
    taken.push(t);
    open.push({ symbol: t.symbol, exitTs: t.exitTs });
  }
  return taken;
}

function floorToHour(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

async function main() {
  const envStart = process.env.BT_START_ISO ? Date.parse(process.env.BT_START_ISO) : NaN;
  const envEnd   = process.env.BT_END_ISO   ? Date.parse(process.env.BT_END_ISO)   : NaN;
  const days = parseInt(process.env.BT_DAYS ?? '365', 10);
  const now = Date.now();
  const startTs = Number.isFinite(envStart) ? envStart : now - days * 86_400_000;
  const endTs   = Number.isFinite(envEnd)   ? envEnd   : now;

  console.log('==================================================================================');
  console.log(`LOSS-CLUSTER DIAGNOSTIC — slip ${SLIPPAGE_PCT}%, cap-${MAX_PARALLEL}, risk ${RISK_PCT}%`);
  console.log(`window: ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)}`);
  console.log('==================================================================================\n');

  const [regimeMap, trades] = await Promise.all([
    buildBtcRegimeMap(startTs, endTs),
    gatherPortfolioTrades(startTs, endTs),
  ]);

  console.log(`total post-cap trades:    ${trades.length}`);
  const losses = trades.filter(t => t.pnlR < 0);
  const wins = trades.filter(t => t.pnlR > 0);
  const flat = trades.filter(t => t.pnlR === 0);
  console.log(`wins: ${wins.length}  losses: ${losses.length}  flat (BE): ${flat.length}`);
  console.log(`baseline WR: ${(wins.length / trades.length * 100).toFixed(1)}%\n`);

  // Build pair features per symbol (cache)
  const pairFeats = new Map<string, Map<number, any>>();
  for (const sym of SYMBOLS) {
    pairFeats.set(sym, await buildPairFeatures(sym, startTs, endTs));
  }

  // For each trade, attach: hour, dayOfWeek, btcRegime, atrPctile, move3bar, move1bar
  interface Enriched extends ClosedTrade {
    hour: number;
    dayOfWeek: number;
    btcRegime: Regime | 'unknown';
    atrPctile: number;
    move3bar: number;
    move1bar: number;
  }
  const enrich = (t: ClosedTrade): Enriched => {
    const d = new Date(t.entryTs);
    const tsFloor = floorToHour(t.entryTs - 3_600_000);  // last CLOSED 1H bar (entry occurred at open of new bar)
    const pf = pairFeats.get(t.symbol)?.get(tsFloor);
    return {
      ...t,
      hour: d.getUTCHours(),
      dayOfWeek: d.getUTCDay(),  // 0=Sun
      btcRegime: regimeMap.get(tsFloor) ?? 'unknown',
      atrPctile: pf?.atrPctile ?? -1,
      move3bar: pf?.move3bar ?? -1,
      move1bar: pf?.move1bar ?? -1,
    };
  };
  const allEnriched = trades.map(enrich);
  const lossEnriched = losses.map(enrich);

  // -- distribution comparisons --

  // 1) BTC regime
  console.log('=== BTC regime at entry: losses vs all ===');
  const regimes: Regime[] = ['range', 'transition', 'trend_bull', 'trend_bear', 'trend_other'];
  console.log('  regime         losses  loss%   all  all%    loss-rate-in-regime');
  for (const r of regimes) {
    const lc = lossEnriched.filter(e => e.btcRegime === r).length;
    const ac = allEnriched.filter(e => e.btcRegime === r).length;
    const lossPct = losses.length ? (lc / losses.length) * 100 : 0;
    const allPct = trades.length ? (ac / trades.length) * 100 : 0;
    const lossRate = ac ? (lc / ac) * 100 : 0;
    console.log(`  ${r.padEnd(13)} ${String(lc).padStart(5)}  ${lossPct.toFixed(1).padStart(5)}%  ${String(ac).padStart(4)}  ${allPct.toFixed(1).padStart(5)}%  ${lossRate.toFixed(1).padStart(6)}%`);
  }

  // 2) Hour of UTC day (group by 4h buckets)
  console.log('\n=== Hour of UTC day (4h buckets) ===');
  console.log('  bucket   losses  loss%   all  all%   loss-rate');
  for (let h = 0; h < 24; h += 4) {
    const inBucket = (e: Enriched) => e.hour >= h && e.hour < h + 4;
    const lc = lossEnriched.filter(inBucket).length;
    const ac = allEnriched.filter(inBucket).length;
    const lossPct = losses.length ? (lc / losses.length) * 100 : 0;
    const allPct = trades.length ? (ac / trades.length) * 100 : 0;
    const lossRate = ac ? (lc / ac) * 100 : 0;
    const label = `${String(h).padStart(2,'0')}-${String(h+4).padStart(2,'0')}`;
    console.log(`  ${label}    ${String(lc).padStart(5)}  ${lossPct.toFixed(1).padStart(5)}%  ${String(ac).padStart(4)}  ${allPct.toFixed(1).padStart(5)}%  ${lossRate.toFixed(1).padStart(6)}%`);
  }

  // 3) Day of week
  console.log('\n=== Day of week (UTC) ===');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  console.log('  day   losses  loss%   all  all%   loss-rate');
  for (let d = 0; d < 7; d++) {
    const lc = lossEnriched.filter(e => e.dayOfWeek === d).length;
    const ac = allEnriched.filter(e => e.dayOfWeek === d).length;
    const lossPct = losses.length ? (lc / losses.length) * 100 : 0;
    const allPct = trades.length ? (ac / trades.length) * 100 : 0;
    const lossRate = ac ? (lc / ac) * 100 : 0;
    console.log(`  ${dayNames[d]}   ${String(lc).padStart(5)}  ${lossPct.toFixed(1).padStart(5)}%  ${String(ac).padStart(4)}  ${allPct.toFixed(1).padStart(5)}%  ${lossRate.toFixed(1).padStart(6)}%`);
  }

  // 4) ATR percentile buckets (current ATR%pct vs last 100 bars)
  console.log('\n=== ATR percentile (current vs last 100 bars) ===');
  const atrBuckets = [[0, 25], [25, 50], [50, 75], [75, 90], [90, 100]];
  console.log('  pctile bucket  losses  loss%   all  all%   loss-rate');
  for (const [lo, hi] of atrBuckets) {
    const inBucket = (e: Enriched) => e.atrPctile >= lo && e.atrPctile < hi;
    const lc = lossEnriched.filter(inBucket).length;
    const ac = allEnriched.filter(inBucket).length;
    const lossPct = losses.length ? (lc / losses.length) * 100 : 0;
    const allPct = trades.length ? (ac / trades.length) * 100 : 0;
    const lossRate = ac ? (lc / ac) * 100 : 0;
    console.log(`  ${String(lo).padStart(3)}-${String(hi).padStart(3)}        ${String(lc).padStart(5)}  ${lossPct.toFixed(1).padStart(5)}%  ${String(ac).padStart(4)}  ${allPct.toFixed(1).padStart(5)}%  ${lossRate.toFixed(1).padStart(6)}%`);
  }

  // 5) 1-bar move magnitude (|close-open|/ATR for last closed bar before entry)
  console.log('\n=== Last bar |close-open|/ATR (volatility of decision bar) ===');
  const move1Buckets = [[0, 0.3], [0.3, 0.6], [0.6, 1.0], [1.0, 1.5], [1.5, 10]];
  console.log('  bucket         losses  loss%   all  all%   loss-rate');
  for (const [lo, hi] of move1Buckets) {
    const inBucket = (e: Enriched) => e.move1bar >= lo && e.move1bar < hi;
    const lc = lossEnriched.filter(inBucket).length;
    const ac = allEnriched.filter(inBucket).length;
    const lossPct = losses.length ? (lc / losses.length) * 100 : 0;
    const allPct = trades.length ? (ac / trades.length) * 100 : 0;
    const lossRate = ac ? (lc / ac) * 100 : 0;
    const lab = `${lo.toFixed(2)}-${hi.toFixed(2)}`;
    console.log(`  ${lab.padEnd(13)}  ${String(lc).padStart(5)}  ${lossPct.toFixed(1).padStart(5)}%  ${String(ac).padStart(4)}  ${allPct.toFixed(1).padStart(5)}%  ${lossRate.toFixed(1).padStart(6)}%`);
  }

  // 6) 3-bar move magnitude (|close - close_3bars_ago| / ATR — momentum into entry)
  console.log('\n=== 3-bar momentum |close - close[-3]|/ATR (run-up before entry) ===');
  const move3Buckets = [[0, 0.5], [0.5, 1.0], [1.0, 1.5], [1.5, 2.5], [2.5, 100]];
  console.log('  bucket         losses  loss%   all  all%   loss-rate');
  for (const [lo, hi] of move3Buckets) {
    const inBucket = (e: Enriched) => e.move3bar >= lo && e.move3bar < hi;
    const lc = lossEnriched.filter(inBucket).length;
    const ac = allEnriched.filter(inBucket).length;
    const lossPct = losses.length ? (lc / losses.length) * 100 : 0;
    const allPct = trades.length ? (ac / trades.length) * 100 : 0;
    const lossRate = ac ? (lc / ac) * 100 : 0;
    const lab = `${lo.toFixed(2)}-${hi.toFixed(2)}`;
    console.log(`  ${lab.padEnd(13)}  ${String(lc).padStart(5)}  ${lossPct.toFixed(1).padStart(5)}%  ${String(ac).padStart(4)}  ${allPct.toFixed(1).padStart(5)}%  ${lossRate.toFixed(1).padStart(6)}%`);
  }

  // 7) Per-symbol loss-rate (sanity check vs portfolio average)
  console.log('\n=== Per-symbol loss rate ===');
  console.log('  symbol     trades  losses  loss-rate');
  for (const sym of SYMBOLS) {
    const symAll = allEnriched.filter(e => e.symbol === sym);
    const symLoss = symAll.filter(e => e.pnlR < 0);
    const rate = symAll.length ? (symLoss.length / symAll.length) * 100 : 0;
    console.log(`  ${sym.padEnd(10)} ${String(symAll.length).padStart(4)}  ${String(symLoss.length).padStart(4)}    ${rate.toFixed(1).padStart(5)}%`);
  }

  // 8) Side breakdown
  console.log('\n=== Side breakdown ===');
  const longAll = allEnriched.filter(e => e.side === 'long');
  const longLoss = longAll.filter(e => e.pnlR < 0);
  const shortAll = allEnriched.filter(e => e.side === 'short');
  const shortLoss = shortAll.filter(e => e.pnlR < 0);
  console.log(`  LONG:   ${longAll.length} trades, ${longLoss.length} losses (${(longLoss.length/longAll.length*100).toFixed(1)}%)`);
  console.log(`  SHORT:  ${shortAll.length} trades, ${shortLoss.length} losses (${(shortLoss.length/shortAll.length*100).toFixed(1)}%)`);

  await closePg();
}

main().catch(async (e) => {
  log.error('loss-cluster failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});

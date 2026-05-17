// Walk-back over the last 7 days: collect every candidate signal the algorithm
// would have produced, attach full enrichment (multi-TF / Coinglass / BTC ctx /
// structural levels) AT THE MOMENT OF SIGNAL, plus the actual outcome (R from
// historical fill). Output: JSON for the trader to review.

import fs from 'node:fs';
import { runBacktest } from '../engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams, resetCooldownState } from '../../strategies/btc-vp-smc';
import { Bar, ClosedTrade, StrategyContext } from '../types';
import { computeFeatures, CandleRow } from '../../data/features';
import { loadCoinglassAt, CoinglassFeatures } from '../../data/coinglass-features';
import { buildEnrichment, buildBtcContextFrom, BtcContext, DecisionEnrichment } from '../enrichment';
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'AVAXUSDT',
  'BNBUSDT', 'LTCUSDT', 'LINKUSDT', 'NEARUSDT', 'ATOMUSDT',
];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  AVAXUSDT: { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  LINKUSDT: { maxStopAtrPct: 5.0 },
  NEARUSDT: { maxStopAtrPct: 5.5 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
};

const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: 0.05,
  riskPctBase: 0.375,
  leverage: 10,
};

async function loadBarsUpTo(symbol: string, tf: string, atTs: number, lookback: number): Promise<Bar[]> {
  const r = await query<any>(
    `SELECT ts::text, open, high, low, close, volume FROM candles
     WHERE symbol = $1 AND tf = $2 AND ts < $3 ORDER BY ts DESC LIMIT $4`,
    [symbol, tf, atTs, lookback]
  );
  return r.rows.reverse().map((row: any): Bar => ({
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
  }));
}

async function buildHistoricalCtx(symbol: string, atTs: number): Promise<{
  ctx: StrategyContext;
  features5m: any; features15m: any; features4h: any;
} | null> {
  const [bars1h, bars1d, bars1w, bars5m, bars15m, bars4h] = await Promise.all([
    loadBarsUpTo(symbol, '60m', atTs, 300),
    loadBarsUpTo(symbol, '1D', atTs, 250),
    loadBarsUpTo(symbol, '1W', atTs, 60),
    loadBarsUpTo(symbol, '5m', atTs, 300),
    loadBarsUpTo(symbol, '15m', atTs, 300),
    loadBarsUpTo(symbol, '240m', atTs, 300),
  ]);
  if (bars1h.length < 100 || bars1w.length < 1) return null;

  const decisionBar = bars1h[bars1h.length - 1];
  const slice1h = bars1h.slice(-300).map<CandleRow>((b) => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  const features1h = computeFeatures(symbol, '60m', slice1h);

  function safeFt(tf: string, bars: Bar[]): any {
    if (bars.length < 50) return undefined;
    const slice = bars.slice(-300).map<CandleRow>((b) => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    return computeFeatures(symbol, tf, slice);
  }
  const features5m = safeFt('5m', bars5m);
  const features15m = safeFt('15m', bars15m);
  const features4h = safeFt('240m', bars4h);
  const featuresD = bars1d.length >= 50 ? safeFt('1D', bars1d) : undefined;
  const featuresW = bars1w.length >= 20 ? safeFt('1W', bars1w) : undefined;

  let coinglass: CoinglassFeatures | undefined;
  try {
    const coin = symbol.replace(/USDT$/, '');
    coinglass = await loadCoinglassAt(coin, symbol, decisionBar.ts);
  } catch { coinglass = undefined; }

  const ctx: StrategyContext = {
    symbol,
    ts: atTs,
    price: decisionBar.close,           // historical: use closed-bar close (no live ticker available)
    features1h,
    features4h,
    featuresD,
    featuresW,
    position: null,
    coinglass,
    recentBars: bars1h.slice(-30),
    bars1hRecent: bars1h.slice(-200),
    bars1dRecent: bars1d.slice(-60),
    bars1wRecent: bars1w.slice(-12),
  };
  return { ctx, features5m, features15m, features4h };
}

interface CandidateOut {
  id: string;                   // SYMBOL_DATETIME for the trader to reference
  symbol: string;
  side: 'long' | 'short';
  entryTs: number;
  entryIso: string;
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  algoRationale: string;
  enrichment: DecisionEnrichment;
  // Actual historical outcome — known from full backtest
  outcome: {
    pnlR: number;
    exitReason: ClosedTrade['exitReason'];
    exitPrice: number;
    exitTs: number;
    durationMin: number;
  };
}

async function main() {
  const days = parseInt(process.argv[2] ?? '7', 10);
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;

  log.info('=== walk-7d start ===', { days, symbols: SYMBOLS.length });

  // Step 1: BTC backtest first — we need BTC trades for context AND BTC bars at any moment.
  const btcStrategy = btcVpSmc(DEFAULT_BTC_VP_SMC);

  // Step 2: per-pair backtests, collect trades chronologically.
  const allTrades: Array<ClosedTrade & { pairParams: BtcVpSmcParams }> = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    log.info('pair done', { symbol, trades: r.trades.length });
    for (const t of r.trades) allTrades.push({ ...t, pairParams: params });
  }
  allTrades.sort((a, b) => a.entryTs - b.entryTs);

  // Step 3: for each trade, rebuild enrichment AT entryTs.
  // BTC context computed on-the-fly per moment (BTC ctx changes hour-to-hour).
  const btcCtxCache = new Map<number, BtcContext | null>();
  async function getBtcCtxAt(ts: number): Promise<BtcContext | null> {
    // Round to hour to share between alts entering same hour
    const hourKey = Math.floor(ts / (60 * 60_000));
    if (btcCtxCache.has(hourKey)) return btcCtxCache.get(hourKey)!;
    const r = await buildHistoricalCtx('BTCUSDT', ts);
    const out = r ? buildBtcContextFrom(r.ctx.price, r.ctx.features1h, r.features4h, r.ctx.bars1wRecent, r.ctx.coinglass as any) : null;
    btcCtxCache.set(hourKey, out);
    return out;
  }

  // Clear module-level cooldown so re-deciding at historical entry points isn't blocked.
  resetCooldownState();

  const candidates: CandidateOut[] = [];
  for (const t of allTrades) {
    resetCooldownState();
    const r = await buildHistoricalCtx(t.symbol, t.entryTs);
    if (!r) continue;
    const strategy = btcVpSmc(t.pairParams);
    const action = strategy.decide(r.ctx);
    if (action.kind !== 'enter') continue;          // shouldn't happen — but guard

    const btcCtx = await getBtcCtxAt(t.entryTs);
    const enrichment = buildEnrichment(
      r.ctx, r.features5m, r.features15m, r.features4h,
      action.side, action.entryPrice, action.sl, action.tp1, action.tp2 ?? undefined, btcCtx,
    );
    const id = `${t.symbol}_${new Date(t.entryTs).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    const durationMin = Math.round((t.exitTs - t.entryTs) / 60_000);
    candidates.push({
      id, symbol: t.symbol, side: action.side,
      entryTs: t.entryTs,
      entryIso: new Date(t.entryTs).toISOString(),
      entryPrice: action.entryPrice,
      sl: action.sl,
      tp1: action.tp1,
      tp2: action.tp2 ?? null,
      algoRationale: action.rationale,
      enrichment,
      outcome: {
        pnlR: t.pnlR,
        exitReason: t.exitReason,
        exitPrice: t.exit,
        exitTs: t.exitTs,
        durationMin,
      },
    });
  }

  const outPath = `/tmp/walk-${days}d-candidates.json`;
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    window: { startTs, endTs, days },
    totalCandidates: candidates.length,
    perPairCount: candidates.reduce<Record<string, number>>((acc, c) => {
      acc[c.symbol] = (acc[c.symbol] ?? 0) + 1;
      return acc;
    }, {}),
    candidates,
  }, null, 2));

  console.log(`\n=== walk-${days}d candidates collected ===`);
  console.log(`window: ${new Date(startTs).toISOString().slice(0, 10)} → ${new Date(endTs).toISOString().slice(0, 10)}`);
  console.log(`total candidates: ${candidates.length}`);
  console.log(`written to: ${outPath}`);
  console.log('\nper-pair breakdown:');
  for (const sym of SYMBOLS) {
    const count = candidates.filter((c) => c.symbol === sym).length;
    if (count > 0) console.log(`  ${sym.padEnd(10)}  ${count}`);
  }

  // Quick algo-only baseline metrics
  const totalR = candidates.reduce((s, c) => s + c.outcome.pnlR, 0);
  const wins = candidates.filter((c) => c.outcome.pnlR > 0).length;
  const wr = candidates.length > 0 ? (wins / candidates.length) * 100 : 0;
  const avgR = candidates.length > 0 ? totalR / candidates.length : 0;
  console.log(`\nalgo-only baseline (no cap-4, all signals taken):`);
  console.log(`  totalR: ${totalR.toFixed(2)}  WR: ${wr.toFixed(1)}%  avgR: ${avgR.toFixed(3)}`);

  await closePg();
}

main().catch(async (e) => {
  log.error('walk-7d failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});

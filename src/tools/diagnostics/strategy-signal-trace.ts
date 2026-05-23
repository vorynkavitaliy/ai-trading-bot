/**
 * Strategy signal trace — for a given symbol/window, replay strategy.decide()
 * at every 1H bar close and print the result (enter/hold). Mirrors the exact
 * data path used by runBacktest, so any difference vs live means data drift
 * (Coinglass / features) or strategy gate.
 *
 * Usage:
 *   npx tsx src/tools/diagnostics/strategy-signal-trace.ts BNBUSDT 2026-05-16 2026-05-23
 *
 * Optionally filter for entry-only:
 *   --only-enter
 */
import { query, close as closePg } from '../../core/db';
import { computeFeatures, CandleRow } from '../../data/features';
import { loadCoinglassAt } from '../../data/coinglass-features';
import { btcVpSmc, DEFAULT_BTC_VP_SMC } from '../../strategies/btc-vp-smc';
import { Bar, StrategyContext } from '../../backtest/types';

async function loadBars(symbol: string, tf: string, fromTs: number, toTs: number): Promise<Bar[]> {
  const r = await query<any>(
    `SELECT ts::text, open, high, low, close, volume FROM candles
     WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4 ORDER BY ts ASC`,
    [symbol, tf, fromTs, toTs]
  );
  return r.rows.map((row: any): Bar => ({
    ts: parseInt(row.ts, 10), open: parseFloat(row.open), high: parseFloat(row.high),
    low: parseFloat(row.low), close: parseFloat(row.close), volume: parseFloat(row.volume),
  }));
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !isFinite(n)) return 'n/a';
  return n.toFixed(d);
}

async function main() {
  const symbol = process.argv[2];
  const fromIso = process.argv[3];
  const toIso = process.argv[4];
  const onlyEnter = process.argv.includes('--only-enter');
  if (!symbol || !fromIso || !toIso) {
    console.error('usage: strategy-signal-trace.ts SYMBOL FROM_ISO TO_ISO [--only-enter]');
    process.exit(1);
  }
  const startTs = Date.parse(fromIso);
  const endTs = Date.parse(toIso);
  if (!isFinite(startTs) || !isFinite(endTs)) {
    console.error('bad iso dates'); process.exit(1);
  }

  // Warmup: same as engine.ts
  const warmupHourlyMs = 300 * 60 * 60_000;
  const warmupDailyMs = 250 * 24 * 60 * 60_000;
  const warmupWeeklyMs = 60 * 7 * 24 * 60 * 60_000;

  const [bars1h, bars1d, bars1w, rf] = await Promise.all([
    loadBars(symbol, '60m', startTs - warmupHourlyMs, endTs),
    loadBars(symbol, '1D', startTs - warmupDailyMs, endTs),
    loadBars(symbol, '1W', startTs - warmupWeeklyMs, endTs),
    query<any>(
      `SELECT ts::text, rate::text FROM funding_history
       WHERE symbol = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
      [symbol, startTs - warmupHourlyMs, endTs]
    ),
  ]);
  const fundingByTs = new Map<number, number>();
  for (const row of rf.rows) fundingByTs.set(parseInt(row.ts, 10), parseFloat(row.rate));

  console.log(`Strategy signal trace — ${symbol}  ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)}`);
  console.log(`bars1h: ${bars1h.length}, bars1d: ${bars1d.length}, bars1w: ${bars1w.length}`);
  console.log();

  const strategy = btcVpSmc(DEFAULT_BTC_VP_SMC);
  const idxStartActive = bars1h.findIndex((b) => b.ts >= startTs);
  if (idxStartActive < 0) { console.error('no decision bars'); await closePg(); return; }

  let enterCount = 0;
  let holdCount = 0;

  console.log('  ts                  price       action  side  entry      sl         tp1        tp2');
  for (let i = idxStartActive; i < bars1h.length; i++) {
    const nowBar = bars1h[i];
    const nowTs = nowBar.ts;
    if (nowTs > endTs) break;
    if (i < 1) continue;

    const decisionBar = bars1h[i - 1];
    const cutoff = nowTs;

    // Build features same as engine.ts
    const sliceStart = Math.max(0, i - 300);
    const sliceDecision = bars1h.slice(sliceStart, i).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    if (sliceDecision.length < 200) continue;
    const feat1h = computeFeatures(symbol, '60m', sliceDecision);

    const closedD = bars1d.filter((b) => b.ts < cutoff);
    const sliceD = closedD.slice(-250).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    const featD = sliceD.length >= 50 ? computeFeatures(symbol, '1D', sliceD) : undefined;

    const closedW = bars1w.filter((b) => b.ts < cutoff);
    const sliceW = closedW.slice(-60).map<CandleRow>((b) => ({
      ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));
    const featW = sliceW.length >= 20 ? computeFeatures(symbol, '1W', sliceW) : undefined;

    const fundingTs = [...fundingByTs.keys()].filter((t) => t <= decisionBar.ts);
    const lastFundingTs = fundingTs.length > 0 ? Math.max(...fundingTs) : null;
    const fundingRate = lastFundingTs ? fundingByTs.get(lastFundingTs) : undefined;

    const coin = symbol.replace(/USDT$/, '');
    const coinglass = await loadCoinglassAt(coin, symbol, decisionBar.ts);

    const recentBars = bars1h.slice(Math.max(0, i - 30), i);
    const bars1hRecent = bars1h.filter((b) => b.ts < cutoff).slice(-200);
    const bars1dRecent = bars1d.filter((b) => b.ts < cutoff).slice(-60);
    const bars1wRecent = bars1w.filter((b) => b.ts < cutoff).slice(-12);

    const ctx: StrategyContext = {
      symbol, ts: nowTs, price: decisionBar.close,
      features1h: feat1h, featuresD: featD, featuresW: featW,
      fundingRate, position: null, coinglass,
      recentBars, bars1hRecent, bars1dRecent, bars1wRecent,
    };
    const action = strategy.decide(ctx);

    if (action.kind === 'enter') {
      enterCount++;
      console.log(`  ${new Date(nowTs).toISOString().slice(0,16)}  ${fmt(decisionBar.close,4).padStart(10)}  ENTER   ${action.side.padEnd(5)} ${fmt(action.entryPrice,4).padStart(8)}  ${fmt(action.sl,4).padStart(8)}  ${fmt(action.tp1,4).padStart(8)}  ${fmt(action.tp2,4).padStart(8)}`);
    } else if (!onlyEnter) {
      holdCount++;
      console.log(`  ${new Date(nowTs).toISOString().slice(0,16)}  ${fmt(decisionBar.close,4).padStart(10)}  hold`);
    } else {
      holdCount++;
    }
  }

  console.log();
  console.log(`Total: ${enterCount} ENTER signals, ${holdCount} hold`);
  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

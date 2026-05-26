/**
 * Post-mortem of grid backtest "catastrophic" cycles on BTC 365d.
 *
 * Operator hypothesis: the major drawdown was caused by a single flash-crash
 * candle in October 2025, which is an exception not the rule. If true, then
 * a small safety mechanism (kill switch on > X% intra-bar drop) might solve
 * it without dropping the strategy.
 *
 * This tool examines the worst cycles from grid-btc.ts results and shows:
 *   - When did the cycle start? (timestamp)
 *   - When was the deepest drawdown? (timestamp + price)
 *   - What was BTC's high→low movement during the cycle?
 *   - Was the drawdown delivered in 1 candle, 1 day, or weeks?
 *   - Did the cycle eventually exit at TP, or stuck?
 */
import { close as closePg } from '../../core/db';
import { loadBars } from '../../data/candles';
import { runGridBacktest, GridConfig, GridCycle } from '../grid-engine';

const TOTAL_DEPOSIT = 200_000;
const ALLOC_PCT = 0.25;
const ALLOCATED = TOTAL_DEPOSIT * ALLOC_PCT;

const CONFIG_AGGRESSIVE: GridConfig = {
  rangePct: 15, nOrders: 10, martingalePct: 5, indentPct: 0.2,
  firstOrderEntry: 'market', distribution: 'logarithmic',
  tpPct: 1.15, leverage: 5,
  allocatedCapitalUsd: ALLOCATED, marginUsagePct: 0.5,
  takerFeeRate: 0.00055, makerFeeRate: 0.0002,
};

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const startTs = Date.now() - days * 24 * 3600_000;
  const endTs = Date.now();

  console.log(`Loading BTC 1m bars ${days}d…`);
  const bars1m = await loadBars('BTCUSDT', '1m', { fromTs: startTs, toTs: endTs });
  console.log(`Loaded ${bars1m.length} 1m bars`);

  console.log('\nRunning Aggressive grid…');
  const r = await runGridBacktest(bars1m, CONFIG_AGGRESSIVE);
  console.log(`${r.cycles.length} cycles, return ${r.metrics.totalReturnPct.toFixed(2)}%`);

  // Sort by worst unrealized loss
  const worst = [...r.cycles].sort((a, b) => a.maxUnrealizedLossPct - b.maxUnrealizedLossPct).slice(0, 5);

  console.log('\n=== TOP 5 WORST CYCLES ===');
  for (const c of worst) {
    console.log(`\n--- Cycle #${c.cycleId} ---`);
    console.log(`  Start:  ${new Date(c.startTs).toISOString()}  @ $${c.firstFillPrice.toFixed(0)}`);
    console.log(`  End:    ${new Date(c.endTs).toISOString()}  @ $${c.exitPrice.toFixed(0)}  reason=${c.exitReason}`);
    console.log(`  Duration:    ${c.durationHours.toFixed(1)}h (${(c.durationHours / 24).toFixed(1)} days)`);
    console.log(`  Max depth:   ${c.maxDepthLevel}/${CONFIG_AGGRESSIVE.nOrders}`);
    console.log(`  Avg entry:   $${c.avgEntry.toFixed(0)}`);
    console.log(`  Worst unrl:  ${c.maxUnrealizedLossPct.toFixed(2)}% of allocated ($${c.maxUnrealizedLossUsd.toFixed(0)})`);
    console.log(`  Cycle PnL:   $${c.pnlUsd.toFixed(0)}`);
    console.log(`  Fills (${c.fills.length}):`);
    for (const f of c.fills) {
      console.log(`    lvl ${f.level}: ${new Date(f.ts).toISOString()}  @ $${f.price.toFixed(0)}  size $${f.orderUsd.toFixed(0)}`);
    }

    // What happened to BTC during this cycle?
    // Find slices of bars1m within [startTs, endTs] and analyze price action.
    const cycleBars = bars1m.filter(b => b.ts >= c.startTs && b.ts <= c.endTs);
    if (cycleBars.length === 0) continue;

    // Find the bar with the lowest LOW (this is where worst unrealized occurred)
    let minBar = cycleBars[0];
    for (const b of cycleBars) if (b.low < minBar.low) minBar = b;

    // What was BTC drop within ONE candle? Find max 1m drop (high → low same bar)
    let maxIntraBarDropPct = 0;
    let maxIntraBarDropTs = 0;
    for (const b of cycleBars) {
      const d = (b.high - b.low) / b.high * 100;
      if (d > maxIntraBarDropPct) { maxIntraBarDropPct = d; maxIntraBarDropTs = b.ts; }
    }

    // 24h aggregated drop within cycle (use 60m bars hourly aggregation)
    // Approx: look at every 60-bar window of 1m bars
    let max24hDropPct = 0;
    let max24hDropEndTs = 0;
    const win24h = 24 * 60;
    for (let i = 0; i + win24h < cycleBars.length; i += 60) {
      const start = cycleBars[i];
      const end = cycleBars[i + win24h - 1];
      const d = (start.high - end.low) / start.high * 100;
      if (d > max24hDropPct) { max24hDropPct = d; max24hDropEndTs = end.ts; }
    }

    let cycleHigh = cycleBars[0].high;
    let cycleLow = cycleBars[0].low;
    for (const b of cycleBars) { if (b.high > cycleHigh) cycleHigh = b.high; if (b.low < cycleLow) cycleLow = b.low; }
    const totalDrop = (cycleHigh - cycleLow) / cycleHigh * 100;

    console.log(`  BTC during cycle: high $${cycleHigh.toFixed(0)} → low $${cycleLow.toFixed(0)}  (total drop ${totalDrop.toFixed(2)}%)`);
    console.log(`  Worst single 1m candle drop: ${maxIntraBarDropPct.toFixed(2)}% at ${new Date(maxIntraBarDropTs).toISOString()}`);
    console.log(`  Worst 24h drop: ${max24hDropPct.toFixed(2)}% ending ${new Date(max24hDropEndTs).toISOString()}`);
    console.log(`  Low @ ${new Date(minBar.ts).toISOString()}  $${minBar.low.toFixed(0)}`);

    // Classification
    const cls = maxIntraBarDropPct > 5 ? '🔴 FLASH CRASH (>5% in 1m)' :
                max24hDropPct > 10 ? '🟡 SHARP CORRECTION (>10% in 24h)' :
                totalDrop > 15 ? '🟠 SUSTAINED DOWNTREND (>15% over cycle)' :
                '🟢 GRADUAL';
    console.log(`  Classification: ${cls}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

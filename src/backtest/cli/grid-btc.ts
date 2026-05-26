/**
 * Run Veles-style grid bot on BTC 1m bars over a configurable lookback.
 *
 * Usage:
 *   npx tsx src/backtest/cli/grid-btc.ts [days=365] [preset=moderate]
 *
 * Compares three Veles presets (conservative/moderate/aggressive) with
 * capital allocation 25% of $200k prop = $50k per grid. Logs cycle-level
 * details and aggregate metrics. Also runs a CG-trigger hybrid (only enter
 * grid when LsTopPositionFade S1 says LONG — see Veles indicator filters).
 */
import { close as closePg } from '../../core/db';
import { loadBars } from '../../data/candles';
import { runGridBacktest, GridConfig } from '../grid-engine';
import { loadCoinglassAt } from '../../data/coinglass-features';
import { percentile } from '../../core/indicators';

const TOTAL_DEPOSIT = 200_000;
const ALLOC_PCT = 0.25;   // 25% of deposit to grid
const ALLOCATED = TOTAL_DEPOSIT * ALLOC_PCT;  // $50k

const PRESETS: Record<string, Partial<GridConfig>> = {
  aggressive: { rangePct: 15, nOrders: 10, tpPct: 1.15 },
  moderate: { rangePct: 25, nOrders: 15, tpPct: 1.15 },
  conservative: { rangePct: 40, nOrders: 20, tpPct: 1.15 },
};

const BASE_CONFIG: GridConfig = {
  rangePct: 25,
  nOrders: 15,
  martingalePct: 5,
  indentPct: 0.2,
  firstOrderEntry: 'market',
  distribution: 'logarithmic',
  tpPct: 1.15,
  leverage: 5,
  allocatedCapitalUsd: ALLOCATED,
  marginUsagePct: 0.5,        // use 50% of allocated as margin
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  // No safety SL — pure Veles native (will see how bad it gets)
};

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const presetName = process.argv[3] ?? 'all';

  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const endTs = now;

  console.log(`Loading BTC 1m bars from ${new Date(startTs).toISOString()} to ${new Date(endTs).toISOString()}…`);
  const bars1m = await loadBars('BTCUSDT', '1m', { fromTs: startTs, toTs: endTs });
  console.log(`Loaded ${bars1m.length} 1m bars.\n`);

  const presetsToRun = presetName === 'all'
    ? ['aggressive', 'moderate', 'conservative']
    : [presetName];

  for (const p of presetsToRun) {
    const cfg: GridConfig = { ...BASE_CONFIG, ...PRESETS[p] };
    console.log(`\n========== PRESET = ${p.toUpperCase()} (range=${cfg.rangePct}% n=${cfg.nOrders} TP=${cfg.tpPct}%) ==========`);
    console.log(`Allocated capital: $${ALLOCATED}  (${ALLOC_PCT * 100}% of $${TOTAL_DEPOSIT})  Margin usage: ${cfg.marginUsagePct * 100}%  Leverage: ${cfg.leverage}x`);

    const r = await runGridBacktest(bars1m, cfg);
    const m = r.metrics;
    console.log(`Cycles: ${m.cycles}   TP: ${m.tpCycles} (WR ${m.winRate.toFixed(1)}%)   Full-deploy: ${m.fullDeployCycles}   Safety stops: ${m.safetyStops}`);
    console.log(`Avg cycle: ${m.avgCycleHours.toFixed(1)}h   Max depth reached: lvl ${m.maxDepthLevelReached}/${cfg.nOrders}`);
    console.log(`Final capital: $${r.finalCapitalUsd.toFixed(0)}   Return: $${m.totalReturnUsd.toFixed(0)} (${m.totalReturnPct.toFixed(2)}%)`);
    console.log(`Max drawdown: $${r.maxDrawdownUsd.toFixed(0)} (${r.maxDrawdownPctOfCapital.toFixed(2)}% of $${ALLOCATED} allocated)`);
    console.log(`Worst single-cycle unrealized: ${m.worstUnrealizedPctOfCapital.toFixed(2)}% of allocated capital`);
    console.log(`Avg single-cycle unrealized:   ${m.avgUnrealizedPctOfCapital.toFixed(2)}% of allocated capital`);

    // HyroTrader compliance check
    const ddUsd = -m.worstUnrealizedPctOfCapital / 100 * ALLOCATED;
    const propDailyDD = TOTAL_DEPOSIT * 0.05;
    const propTotalDD = TOTAL_DEPOSIT * 0.10;
    console.log(`HyroTrader compliance ($${TOTAL_DEPOSIT} prop):`);
    console.log(`  Worst unrealized: $${ddUsd.toFixed(0)} vs daily DD $${propDailyDD} ${Math.abs(ddUsd) <= propDailyDD ? '✓' : '✗ BREACHED'}`);
    console.log(`  Worst unrealized: $${ddUsd.toFixed(0)} vs total DD $${propTotalDD} ${Math.abs(ddUsd) <= propTotalDD ? '✓' : '✗ BREACHED'}`);

    // Cycle distribution
    const depthBuckets = new Array(cfg.nOrders + 1).fill(0);
    for (const c of r.cycles) depthBuckets[c.maxDepthLevel]++;
    console.log(`Cycle depth distribution (level reached → count):`);
    for (let i = 1; i <= cfg.nOrders; i++) {
      if (depthBuckets[i] > 0) console.log(`  ${i}: ${depthBuckets[i]}`);
    }
    // Sample longest cycles
    const longest = [...r.cycles].sort((a, b) => b.durationHours - a.durationHours).slice(0, 3);
    console.log(`Longest cycles:`);
    for (const c of longest) {
      console.log(`  cycle #${c.cycleId}: ${c.durationHours.toFixed(1)}h  depth ${c.maxDepthLevel}/${cfg.nOrders}  unreal ${c.maxUnrealizedLossPct.toFixed(2)}%  exit ${c.exitReason}`);
    }
  }

  // Hybrid: only enter when CG L/S Top Position percentile signal says LONG (≤ 0.15)
  console.log(`\n\n========== HYBRID: CG-trigger + grid (Moderate) ==========`);
  const cfgH: GridConfig = { ...BASE_CONFIG, ...PRESETS['moderate'] };
  console.log(`Same Moderate grid mechanics, but only enter when CG L/S Top Position percentile ≤ 0.15 (S1 BTC long signal) at 4H close.`);

  // Pre-compute "should enter" markers: at each 4H boundary, check CG signal.
  // The grid will then enter on the next 1m bar whose ts >= that boundary.
  const fourHMs = 4 * 3600_000;
  const allowedEntryAfterTs = new Set<number>();
  let lastSignalCheck = startTs;
  while (lastSignalCheck < endTs) {
    const ts4h = Math.floor(lastSignalCheck / fourHMs) * fourHMs;
    const cg = await loadCoinglassAt('BTC', 'BTCUSDT', ts4h);
    if (cg.ls_top_position_history.length >= 180 && cg.ls_top_position != null) {
      const pct = percentile(cg.ls_top_position_history.slice(-180), cg.ls_top_position);
      if (pct <= 0.15) {
        // Signal triggered → allow entry within next 4h window
        for (let t = ts4h; t < ts4h + fourHMs; t += 60_000) allowedEntryAfterTs.add(t);
      }
    }
    lastSignalCheck += fourHMs;
  }
  console.log(`Pre-computed ${allowedEntryAfterTs.size} 1m slots eligible for entry (out of ${bars1m.length}).`);

  const rH = await runGridBacktest(bars1m, cfgH, {
    shouldEnter: (ts) => allowedEntryAfterTs.has(ts),
  });
  const mH = rH.metrics;
  console.log(`Cycles: ${mH.cycles}   TP: ${mH.tpCycles} (WR ${mH.winRate.toFixed(1)}%)   Full-deploy: ${mH.fullDeployCycles}`);
  console.log(`Avg cycle: ${mH.avgCycleHours.toFixed(1)}h   Max depth: lvl ${mH.maxDepthLevelReached}/${cfgH.nOrders}`);
  console.log(`Final capital: $${rH.finalCapitalUsd.toFixed(0)}   Return: ${mH.totalReturnPct.toFixed(2)}%`);
  console.log(`Max DD: ${rH.maxDrawdownPctOfCapital.toFixed(2)}% of allocated   Worst unrealized: ${mH.worstUnrealizedPctOfCapital.toFixed(2)}%`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

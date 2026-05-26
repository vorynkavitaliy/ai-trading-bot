/**
 * Grid/DCA/Martingale bot mathematics — Veles-style configuration analyzer.
 *
 * Models a long-only grid with N orders, range %, martingale step, and computes:
 *   - Position size & avg entry at each fill level (cumulative)
 *   - Unrealized loss at each level vs entry price
 *   - TP price level (after partial cycle ends)
 *   - Risk if all N orders fill and price keeps dropping further
 *
 * Used for prop-compliance analysis: can this bot survive within HyroTrader
 * limits (−5% daily DD trailing, −10% total static)?
 *
 * Default config = Veles "Умеренный" preset shown in operator's screenshot:
 *   range=25%, n=15, martingale=5%, indent=0.2%, log distribution, TP=1.15%
 */

interface GridConfig {
  entryPrice: number;
  rangePct: number;            // grid covers entryPrice × (1 - rangePct/100) downward
  nOrders: number;             // total orders incl. first
  martingalePct: number;       // each next order = previous × (1 + martingalePct/100)
  indentPct: number;           // first order placed at entry × (1 - indentPct/100), or market entry
  firstOrderUsd: number;       // notional USD of first order
  tpPct: number;               // TP from average entry
  leverage: number;
  distribution: 'linear' | 'logarithmic';
}

interface FillSnapshot {
  level: number;
  fillPrice: number;
  orderUsd: number;
  orderQty: number;
  cumQty: number;
  cumUsd: number;
  avgEntry: number;
  unrealizedLossUsd: number;       // if held at this fill price (not deeper)
  unrealizedLossPctOfCum: number;
  tpPrice: number;                 // TP @ +tpPct from avg entry
  recoveryNeededPct: number;       // distance from fillPrice → tpPrice (% up)
}

function computeGrid(c: GridConfig): FillSnapshot[] {
  const snapshots: FillSnapshot[] = [];
  // Price levels for orders 1..N
  const priceLevels: number[] = [];
  const first = c.entryPrice * (1 - c.indentPct / 100);
  const last = c.entryPrice * (1 - c.rangePct / 100);

  if (c.distribution === 'linear') {
    for (let i = 0; i < c.nOrders; i++) {
      priceLevels.push(first + (last - first) * (i / (c.nOrders - 1)));
    }
  } else {
    // Logarithmic: orders denser closer to entry (small price diff between first orders,
    // larger between last orders — fewer DCA buys far from entry → smaller martingale exposure)
    // Implementation: take log-spaced positions on a normalized [0,1] interval,
    // map to [first, last].
    for (let i = 0; i < c.nOrders; i++) {
      const t = Math.log(1 + i) / Math.log(c.nOrders);   // t ∈ [0,1]
      priceLevels.push(first + (last - first) * t);
    }
  }

  // Order USD amounts: order_i = first × (1 + martingale/100)^i
  let cumQty = 0;
  let cumUsd = 0;
  for (let i = 0; i < c.nOrders; i++) {
    const orderUsd = c.firstOrderUsd * Math.pow(1 + c.martingalePct / 100, i);
    const fillPrice = priceLevels[i];
    const orderQty = orderUsd / fillPrice;
    cumQty += orderQty;
    cumUsd += orderUsd;
    const avgEntry = cumUsd / cumQty;
    const unrealizedLossUsd = (fillPrice - avgEntry) * cumQty;  // negative = loss
    const tpPrice = avgEntry * (1 + c.tpPct / 100);
    const recoveryNeededPct = (tpPrice - fillPrice) / fillPrice * 100;
    snapshots.push({
      level: i + 1,
      fillPrice,
      orderUsd,
      orderQty,
      cumQty,
      cumUsd,
      avgEntry,
      unrealizedLossUsd,
      unrealizedLossPctOfCum: cumUsd > 0 ? unrealizedLossUsd / cumUsd * 100 : 0,
      tpPrice,
      recoveryNeededPct,
    });
  }

  return snapshots;
}

function printGrid(label: string, c: GridConfig, depositUsd: number) {
  const g = computeGrid(c);
  const last = g[g.length - 1];

  console.log(`\n=== ${label} ===`);
  console.log(`Config: range=${c.rangePct}%  n=${c.nOrders}  martingale=${c.martingalePct}%  indent=${c.indentPct}%  TP=${c.tpPct}%  lev=${c.leverage}x  dist=${c.distribution}`);
  console.log(`Entry: $${c.entryPrice}  First order: $${c.firstOrderUsd} notional   Deposit: $${depositUsd}`);

  console.log('\nlvl  fillPrice  orderUsd   cumUsd     cumQty   avgEntry   unrealL$   unrealL%   tpPrice    recovery%');
  for (const s of g) {
    console.log(
      String(s.level).padStart(3) + '  ' +
      s.fillPrice.toFixed(2).padStart(8) + '  ' +
      s.orderUsd.toFixed(0).padStart(8) + '   ' +
      s.cumUsd.toFixed(0).padStart(8) + '   ' +
      s.cumQty.toFixed(3).padStart(7) + '  ' +
      s.avgEntry.toFixed(2).padStart(8) + '   ' +
      s.unrealizedLossUsd.toFixed(0).padStart(8) + '  ' +
      s.unrealizedLossPctOfCum.toFixed(2).padStart(6) + '%  ' +
      s.tpPrice.toFixed(2).padStart(8) + '  ' +
      s.recoveryNeededPct.toFixed(2).padStart(6) + '%'
    );
  }

  // Margin required for cumUsd at full deploy
  const fullMargin = last.cumUsd / c.leverage;
  console.log(`\nAt full deploy (level ${c.nOrders}):`);
  console.log(`  Notional USD:        $${last.cumUsd.toFixed(0)} (${(last.cumUsd / depositUsd * 100).toFixed(0)}% of deposit, ${(last.cumUsd / fullMargin).toFixed(1)}× margin used)`);
  console.log(`  Margin required:     $${fullMargin.toFixed(0)} (${(fullMargin / depositUsd * 100).toFixed(0)}% of deposit at ${c.leverage}× leverage)`);
  console.log(`  Unrealized loss:     $${last.unrealizedLossUsd.toFixed(0)} (${last.unrealizedLossPctOfCum.toFixed(2)}% of position)`);
  console.log(`  Loss/deposit ratio:  ${(last.unrealizedLossUsd / depositUsd * 100).toFixed(2)}% of deposit`);
  console.log(`  Avg entry:           $${last.avgEntry.toFixed(2)} (${((last.avgEntry / c.entryPrice - 1) * 100).toFixed(2)}% below initial)`);
  console.log(`  TP price:            $${last.tpPrice.toFixed(2)}`);
  console.log(`  Recovery needed:     ${last.recoveryNeededPct.toFixed(2)}% from last fill`);

  // What if price drops 5% below last grid order — common in trendy moves
  for (const beyondPct of [5, 10, 20]) {
    const px = last.fillPrice * (1 - beyondPct / 100);
    const unreal = (px - last.avgEntry) * last.cumQty;
    console.log(`  If price drops ${beyondPct}% below last grid: avg entry $${last.avgEntry.toFixed(2)}, price $${px.toFixed(2)}, unrealized = $${unreal.toFixed(0)} (${(unreal / depositUsd * 100).toFixed(2)}% of deposit)`);
  }

  // What HyroTrader rules would say
  console.log(`\n  HyroTrader compliance @ deposit $${depositUsd}:`);
  console.log(`    Daily DD limit (−5% trailing): $${(depositUsd * 0.05).toFixed(0)}`);
  console.log(`    Total DD limit (−10% static):  $${(depositUsd * 0.10).toFixed(0)}`);
  const lvlBreakingDailyDD = g.findIndex(s => s.unrealizedLossUsd <= -depositUsd * 0.05);
  if (lvlBreakingDailyDD >= 0) {
    console.log(`    >> Daily DD ($${(depositUsd * 0.05).toFixed(0)}) BREACHED at level ${lvlBreakingDailyDD + 1} of ${c.nOrders} (fill $${g[lvlBreakingDailyDD].fillPrice.toFixed(2)}, ${((1 - g[lvlBreakingDailyDD].fillPrice / c.entryPrice) * 100).toFixed(2)}% down)`);
  } else {
    console.log(`    Daily DD NOT breached even at full deploy.`);
  }
  const lvlBreakingTotalDD = g.findIndex(s => s.unrealizedLossUsd <= -depositUsd * 0.10);
  if (lvlBreakingTotalDD >= 0) {
    console.log(`    >> Total DD ($${(depositUsd * 0.10).toFixed(0)}) BREACHED at level ${lvlBreakingTotalDD + 1} of ${c.nOrders} (fill $${g[lvlBreakingTotalDD].fillPrice.toFixed(2)})`);
  } else {
    console.log(`    Total DD NOT breached even at full deploy.`);
  }
}

async function main() {
  // Veles config from operator's screenshot (SOL long preset "Умеренный"):
  //   range=25%, n=15, martingale=5%, indent=0.2%, log dist, TP=1.15%, lev=5x
  const entryPrice = 150;  // assume SOL ≈ $150 — used only to render absolute USD figures
  const deposit200k = 200_000;

  // First order: assume 1% of deposit notional (typical Veles config).
  // Total cumulative grows by martingale formula. Let's adjust so SUM of all orders
  // uses ~50% of deposit notional (operator's recommendation: "use ≤half").
  const martingalePct = 5;
  const n = 15;
  // sum of geometric series: 1 + r + r² + ... + r^(n-1) = (r^n - 1) / (r - 1) where r = 1.05
  const r = 1 + martingalePct / 100;
  const sumMultiplier = (Math.pow(r, n) - 1) / (r - 1);
  // We want fullDeploy notional ≈ 50% × deposit × leverage = 50% × deposit × 5x = 2.5× deposit
  const targetCumUsd = deposit200k * 0.5 * 5;  // = $500k
  const firstOrderUsd = targetCumUsd / sumMultiplier;

  console.log(`First order sized so SUM of 15 orders × martingale 5% = $${targetCumUsd.toFixed(0)} (50% of deposit × 5x leverage)`);
  console.log(`→ First order = $${firstOrderUsd.toFixed(0)}`);

  printGrid('VELES MODERATE (range 25%, n=15, mart 5%, log, TP 1.15%) — $200k deposit',
    { entryPrice, rangePct: 25, nOrders: 15, martingalePct: 5, indentPct: 0.2, firstOrderUsd, tpPct: 1.15, leverage: 5, distribution: 'logarithmic' },
    deposit200k
  );

  printGrid('VELES CONSERVATIVE (range 40%, n=20, mart 5%, log) — $200k deposit',
    { entryPrice, rangePct: 40, nOrders: 20, martingalePct: 5, indentPct: 0.2, firstOrderUsd: firstOrderUsd * 0.5, tpPct: 1.15, leverage: 5, distribution: 'logarithmic' },
    deposit200k
  );

  printGrid('VELES AGGRESSIVE (range 15%, n=10, mart 5%, log) — $200k deposit',
    { entryPrice, rangePct: 15, nOrders: 10, martingalePct: 5, indentPct: 0.2, firstOrderUsd: firstOrderUsd * 1.5, tpPct: 1.15, leverage: 5, distribution: 'logarithmic' },
    deposit200k
  );

  // Sized for personal account $810 (operator's actual balance shown in screenshot)
  printGrid('VELES MODERATE on $810 personal account',
    { entryPrice, rangePct: 25, nOrders: 15, martingalePct: 5, indentPct: 0.2,
      firstOrderUsd: 810 * 0.5 * 5 / sumMultiplier, tpPct: 1.15, leverage: 5, distribution: 'logarithmic' },
    810
  );
}

main().catch(e => { console.error(e); process.exit(1); });

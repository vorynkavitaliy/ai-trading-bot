/**
 * Step 4 of BTC WR-uplift research (2026-05-24).
 *
 * Reads /tmp/btc-trades-enriched.json. Calibrates filter thresholds with
 * walk-forward discipline:
 *   1. Split trades 50/50 by entryTs (TRAIN = first half, TEST = second).
 *   2. On TRAIN: grid-search threshold values for chosen feature(s), find the
 *      configuration that yields WR >= target AND n >= min_n.
 *   3. Apply the SAME threshold to TEST, report WR/n/sumR.
 *   4. If TEST holds → filter generalises. If TEST degrades a lot → overfit.
 *
 * Filters explored (per side):
 *   LONG side: agg_liq_squeeze_24h gate, etf_flow_5d_usd gate, funding_oi_pct gate,
 *              agg_taker_delta_pct gate, and pair-confluence combos.
 *   SHORT side: agg_taker_delta_pct gate, funding_oi_pct gate, oi_pct_chg_24h gate.
 *
 * Output: /tmp/btc-filter-calibration.json + human-readable to stdout.
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Trade {
  entryTs: number;
  side: 'long' | 'short';
  pnlR: number;
  win: boolean;
  features: Record<string, number | null>;
}

type Op = '>=' | '<=';
interface Gate { feature: string; op: Op; threshold: number; }

function applyGates(trades: Trade[], gates: Gate[]): Trade[] {
  return trades.filter(t => {
    for (const g of gates) {
      const v = t.features[g.feature];
      if (v == null) return false;
      if (g.op === '>=' && !(v >= g.threshold)) return false;
      if (g.op === '<=' && !(v <= g.threshold)) return false;
    }
    return true;
  });
}

function stats(trades: Trade[]) {
  const n = trades.length;
  const wins = trades.filter(t => t.win).length;
  const wr = n ? wins / n * 100 : 0;
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const pf = lossR > 0 ? winR / lossR : Infinity;
  return { n, wins, wr, sumR, pf };
}

interface CalibResult {
  side: 'long' | 'short' | 'all';
  gates: Gate[];
  train: ReturnType<typeof stats>;
  test: ReturnType<typeof stats>;
}

function pctile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
}

function gridSearchSingle(
  trainTrades: Trade[],
  feature: string,
  op: Op,
  minN: number,
  targetWR: number,
): { threshold: number; result: ReturnType<typeof stats> } | null {
  const values = trainTrades.map(t => t.features[feature]).filter(v => v != null) as number[];
  if (values.length === 0) return null;

  // Grid: percentile cutoffs 10%..95% step 5%
  const candidates: number[] = [];
  for (let p = 5; p <= 95; p += 5) candidates.push(pctile(values, p / 100));

  let best: { threshold: number; result: ReturnType<typeof stats> } | null = null;
  for (const t of candidates) {
    const subset = applyGates(trainTrades, [{ feature, op, threshold: t }]);
    if (subset.length < minN) continue;
    const s = stats(subset);
    if (s.wr < targetWR) continue;
    if (!best || s.sumR > best.result.sumR) best = { threshold: t, result: s };
  }
  return best;
}

function gridSearchPair(
  trainTrades: Trade[],
  f1: string, op1: Op,
  f2: string, op2: Op,
  minN: number,
  targetWR: number,
): { gates: Gate[]; result: ReturnType<typeof stats> } | null {
  const v1 = trainTrades.map(t => t.features[f1]).filter(v => v != null) as number[];
  const v2 = trainTrades.map(t => t.features[f2]).filter(v => v != null) as number[];
  if (!v1.length || !v2.length) return null;

  const c1: number[] = [];
  const c2: number[] = [];
  for (let p = 10; p <= 90; p += 10) { c1.push(pctile(v1, p / 100)); c2.push(pctile(v2, p / 100)); }

  let best: { gates: Gate[]; result: ReturnType<typeof stats> } | null = null;
  for (const t1 of c1) {
    for (const t2 of c2) {
      const gates: Gate[] = [
        { feature: f1, op: op1, threshold: t1 },
        { feature: f2, op: op2, threshold: t2 },
      ];
      const subset = applyGates(trainTrades, gates);
      if (subset.length < minN) continue;
      const s = stats(subset);
      if (s.wr < targetWR) continue;
      if (!best || s.sumR > best.result.sumR) best = { gates, result: s };
    }
  }
  return best;
}

async function main() {
  const raw = JSON.parse(readFileSync('/tmp/btc-trades-enriched.json', 'utf8'));
  const trades: Trade[] = raw.trades;

  // Walk-forward split: 50/50 by entryTs
  const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  const mid = Math.floor(sorted.length / 2);
  const train = sorted.slice(0, mid);
  const test = sorted.slice(mid);
  const splitTs = sorted[mid].entryTs;
  console.log(`Split @ ${new Date(splitTs).toISOString()} — TRAIN=${train.length}  TEST=${test.length}`);
  console.log(`TRAIN base WR: ${stats(train).wr.toFixed(1)}%   TEST base WR: ${stats(test).wr.toFixed(1)}%`);

  const longsTrain = train.filter(t => t.side === 'long');
  const longsTest = test.filter(t => t.side === 'long');
  const shortsTrain = train.filter(t => t.side === 'short');
  const shortsTest = test.filter(t => t.side === 'short');

  const TARGET_WR = 70;        // hard target. We aim 75% but try 70+ first.
  const MIN_N_TRAIN = 6;       // per side, per half-year — ≥12/yr post-filter
  const results: CalibResult[] = [];

  console.log('\n========== LONG-SIDE FILTERS ==========');
  console.log(`Long train n=${longsTrain.length}  test n=${longsTest.length}`);

  const longSingleCands: Array<[string, Op]> = [
    ['agg_liq_squeeze_24h', '>='],
    ['etf_flow_5d_usd', '<='],
    ['funding_oi_pct', '>='],
    ['agg_taker_delta_pct', '>='],
    ['funding_oi', '>='],
    ['cb_premium_rate', '<='],
  ];

  for (const [f, op] of longSingleCands) {
    const cal = gridSearchSingle(longsTrain, f, op, MIN_N_TRAIN, TARGET_WR);
    if (!cal) { console.log(`  [single] ${f} ${op} — no threshold reaches WR ${TARGET_WR}%`); continue; }
    const gate: Gate = { feature: f, op, threshold: cal.threshold };
    const testStats = stats(applyGates(longsTest, [gate]));
    results.push({ side: 'long', gates: [gate], train: cal.result, test: testStats });
    console.log(`  [single] ${f} ${op} ${cal.threshold.toFixed(4)}   TRAIN: n=${cal.result.n} WR=${cal.result.wr.toFixed(1)}% sumR=${cal.result.sumR.toFixed(2)} PF=${cal.result.pf.toFixed(2)}   TEST: n=${testStats.n} WR=${testStats.wr.toFixed(1)}% sumR=${testStats.sumR.toFixed(2)} PF=${testStats.pf.toFixed(2)}`);
  }

  console.log('\nLong pair-combos:');
  const longPairs: Array<[string, Op, string, Op]> = [
    ['agg_liq_squeeze_24h', '>=', 'etf_flow_5d_usd', '<='],
    ['agg_liq_squeeze_24h', '>=', 'funding_oi_pct', '>='],
    ['etf_flow_5d_usd', '<=', 'funding_oi_pct', '>='],
    ['agg_liq_squeeze_24h', '>=', 'agg_taker_delta_pct', '>='],
    ['funding_oi_pct', '>=', 'agg_taker_delta_pct', '>='],
  ];
  for (const [f1, op1, f2, op2] of longPairs) {
    const cal = gridSearchPair(longsTrain, f1, op1, f2, op2, MIN_N_TRAIN, TARGET_WR);
    if (!cal) { console.log(`  [pair] ${f1}/${f2} — no combo reaches WR ${TARGET_WR}%`); continue; }
    const testStats = stats(applyGates(longsTest, cal.gates));
    results.push({ side: 'long', gates: cal.gates, train: cal.result, test: testStats });
    const desc = cal.gates.map(g => `${g.feature}${g.op}${g.threshold.toFixed(3)}`).join(' AND ');
    console.log(`  [pair] ${desc}   TRAIN: n=${cal.result.n} WR=${cal.result.wr.toFixed(1)}% sumR=${cal.result.sumR.toFixed(2)} PF=${cal.result.pf.toFixed(2)}   TEST: n=${testStats.n} WR=${testStats.wr.toFixed(1)}% sumR=${testStats.sumR.toFixed(2)} PF=${testStats.pf.toFixed(2)}`);
  }

  console.log('\n========== SHORT-SIDE FILTERS ==========');
  console.log(`Short train n=${shortsTrain.length}  test n=${shortsTest.length}`);

  const shortSingleCands: Array<[string, Op]> = [
    ['agg_taker_delta_pct', '>='],
    ['funding_oi_pct', '>='],
    ['funding_oi', '>='],
    ['oi_pct_chg_24h', '>='],
    ['etf_flow_5d_usd', '<='],
    ['cb_premium_rate', '<='],
  ];
  for (const [f, op] of shortSingleCands) {
    const cal = gridSearchSingle(shortsTrain, f, op, MIN_N_TRAIN, TARGET_WR);
    if (!cal) { console.log(`  [single] ${f} ${op} — no threshold reaches WR ${TARGET_WR}%`); continue; }
    const gate: Gate = { feature: f, op, threshold: cal.threshold };
    const testStats = stats(applyGates(shortsTest, [gate]));
    results.push({ side: 'short', gates: [gate], train: cal.result, test: testStats });
    console.log(`  [single] ${f} ${op} ${cal.threshold.toFixed(4)}   TRAIN: n=${cal.result.n} WR=${cal.result.wr.toFixed(1)}% sumR=${cal.result.sumR.toFixed(2)} PF=${cal.result.pf.toFixed(2)}   TEST: n=${testStats.n} WR=${testStats.wr.toFixed(1)}% sumR=${testStats.sumR.toFixed(2)} PF=${testStats.pf.toFixed(2)}`);
  }

  console.log('\nShort pair-combos:');
  const shortPairs: Array<[string, Op, string, Op]> = [
    ['agg_taker_delta_pct', '>=', 'funding_oi_pct', '>='],
    ['funding_oi', '>=', 'oi_pct_chg_24h', '>='],
    ['agg_taker_delta_pct', '>=', 'oi_pct_chg_24h', '>='],
  ];
  for (const [f1, op1, f2, op2] of shortPairs) {
    const cal = gridSearchPair(shortsTrain, f1, op1, f2, op2, MIN_N_TRAIN, TARGET_WR);
    if (!cal) { console.log(`  [pair] ${f1}/${f2} — no combo reaches WR ${TARGET_WR}%`); continue; }
    const testStats = stats(applyGates(shortsTest, cal.gates));
    results.push({ side: 'short', gates: cal.gates, train: cal.result, test: testStats });
    const desc = cal.gates.map(g => `${g.feature}${g.op}${g.threshold.toFixed(3)}`).join(' AND ');
    console.log(`  [pair] ${desc}   TRAIN: n=${cal.result.n} WR=${cal.result.wr.toFixed(1)}% sumR=${cal.result.sumR.toFixed(2)} PF=${cal.result.pf.toFixed(2)}   TEST: n=${testStats.n} WR=${testStats.wr.toFixed(1)}% sumR=${testStats.sumR.toFixed(2)} PF=${testStats.pf.toFixed(2)}`);
  }

  writeFileSync('/tmp/btc-filter-calibration.json', JSON.stringify({ splitTs, results }, null, 2));
  console.log(`\nwrote /tmp/btc-filter-calibration.json (${results.length} configs)`);
}

main().catch(e => { console.error(e); process.exit(1); });

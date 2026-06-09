/**
 * ANGLE 2 — ETH packaged honest grid (single-entry only).
 *
 * Sweeps the winning CG-fade archetype over a parameter grid, running BOTH
 * halves (recent: days183 SKIP0; older: days183 SKIP183) at realistic ETH slip
 * (0.05%, cron-realistic). Keeps only configs positive in BOTH halves, ranks by
 * min(PF_old, PF_recent). Re-runs each finalist at stress slip 0.10 and 0.25.
 *
 * Usage:
 *   npx tsx src/backtest/cli/eth-packaged-grid.ts            # default archetype S3 fundingFade
 *   ARCH=S3 npx tsx src/backtest/cli/eth-packaged-grid.ts
 *
 * Single-entry only (no scaledIn) — scaled-in DCA is a known killer on low-vol majors.
 */
import { runBacktest } from '../engine';
import { fundingFade, fundingTaConfluence, lsTopPositionFade, CgFadeParams } from '../../strategies/cg-fade';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const PAIR = 'ETHUSDT';
const ARCH = (process.env.ARCH ?? 'S3').toUpperCase();

// Cron-realistic mirror of live entry timing + funding-window block + prop equity,
// but realistic ETH slip (0.05%) for the headline. Stress slips applied to finalists.
function common(slip: number) {
  return {
    ...BACKTEST_COMMON,
    startEquity: 668_000,
    slippagePct: slip,
    riskPctBase: 0.5,
    leverage: 10,
    decisionTf: '240m' as const,
    tp1SlMode: 'no_move' as const,
    bePlusBufferPct: 0.10,
    cronRealistic: true,
  };
}

function makeStrategy(p: Partial<CgFadeParams>): Strategy {
  if (ARCH === 'S3') return fundingFade(p);
  if (ARCH === 'S4') return fundingTaConfluence(p);
  if (ARCH === 'S1') return lsTopPositionFade(p);
  throw new Error(`unknown ARCH ${ARCH}`);
}

interface Half { trades: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number; longTrades: number; shortTrades: number; longR: number; shortR: number; }

async function runHalf(p: Partial<CgFadeParams>, skipDays: number, slip: number): Promise<Half> {
  resetCgFadeCooldownState();
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const r = await runBacktest(makeStrategy(p), { symbol: PAIR, startTs, endTs, ...common(slip) });
  const m = r.metrics;
  let longTrades = 0, shortTrades = 0, longR = 0, shortR = 0;
  for (const t of r.trades) {
    const rr = t.pnlR ?? 0;
    if (t.side === 'long') { longTrades++; longR += rr; }
    else { shortTrades++; shortR += rr; }
  }
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, longTrades, shortTrades, longR, shortR };
}

interface Cfg { label: string; p: Partial<CgFadeParams>; }

function buildGrid(): Cfg[] {
  const cfgs: Cfg[] = [];
  const pcts = [[0.70, 0.30], [0.75, 0.25], [0.80, 0.20]];
  const sls = [1.5, 2.0, 2.5];
  const tps = [2.0, 2.5, 3.0];
  // hold made negligible difference in the first 27 configs (recent identical for
  // 12/18/24) — trim to {12,24} to keep the grid tractable. Two-sided/half robustness
  // is the discriminator, not hold.
  const holds = (process.env.HOLDS ?? '12,24').split(',').map(Number);
  const trends: Array<{ pair: boolean; btc: boolean; tag: string }> = [
    { pair: false, btc: false, tag: 'none' },
    { pair: true, btc: false, tag: 'pair' },
    { pair: false, btc: true, tag: 'btc ' },
    { pair: true, btc: true, tag: 'both' },
  ];
  for (const [hi, lo] of pcts)
    for (const sl of sls)
      for (const tp of tps)
        for (const hold of holds)
          for (const tr of trends) {
            cfgs.push({
              label: `${hi}/${lo} sl${sl} tp${tp} h${hold} ${tr.tag}`,
              p: {
                pctHi: hi, pctLo: lo, slAtrMult: sl, tpAtrMult: tp, maxHoldBars: hold,
                usePairTrend: tr.pair, useBtcTrend: tr.btc, riskPct: 0.5,
                // single-entry: NO scaledIn
              },
            });
          }
  return cfgs;
}

function fmt(h: Half): string {
  return `tr${String(h.trades).padStart(3)} WR${h.wr.toFixed(0).padStart(3)} PF${h.pf.toFixed(2).padStart(5)} R${h.sumR.toFixed(1).padStart(6)} DD${h.maxDD.toFixed(1).padStart(4)} ret${h.ret.toFixed(1).padStart(6)}% [L${h.longTrades}/${h.longR.toFixed(1)}R S${h.shortTrades}/${h.shortR.toFixed(1)}R]`;
}

// One shard runs ONE half across the whole grid so recent/older run in parallel.
// HALF=recent → skip 0; HALF=older → skip 183. Emits one machine-parseable line
// per config: "ROW|<label>|<half>|trades|wr|pf|sumR|maxDD|ret|longTr|longR|shortTr|shortR"
async function main() {
  const half = (process.env.HALF ?? 'recent');
  const skip = half === 'older' ? 183 : 0;
  const slip = parseFloat(process.env.SLIP ?? '0.05');
  const grid = buildGrid();
  console.error(`ETH grid — ARCH ${ARCH}, single-entry, slip ${slip}, cron-realistic, HALF=${half} (skip ${skip}). ${grid.length} configs.`);

  let n = 0;
  for (const c of grid) {
    n++;
    const h = await runHalf(c.p, skip, slip);
    console.log(`ROW|${c.label}|${half}|${h.trades}|${h.wr.toFixed(1)}|${h.pf.toFixed(3)}|${h.sumR.toFixed(2)}|${h.maxDD.toFixed(2)}|${h.ret.toFixed(2)}|${h.longTrades}|${h.longR.toFixed(2)}|${h.shortTrades}|${h.shortR.toFixed(2)}`);
    if (n % 20 === 0) console.error(`  ...${n}/${grid.length}`);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

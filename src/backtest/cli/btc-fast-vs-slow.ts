/**
 * btc-fast-vs-slow — Track A: measure the legacy +1h cron-deferral cost on BTC.
 *
 * Engine toggle (engine.ts:856-874, inside the cronRealistic block):
 *   slow    = default, no env       → legacy +1h deferral (models OLD buggy live).
 *   fast    = CRON_FAST_ENTRY=1      → faithful POST-cycle.sh-fix live: NON-funding
 *             4H closes (04/12/20 UTC) entered SAME-hour; funding closes (00/08/16)
 *             still defer via the funding-window skip.
 *   instant = cronRealistic:false    → upper bound, fill at the 4H close next-1m bar.
 *
 * LIVE BTC config (pair-strategies.ts): lsTopPositionFade .85/.15, useBtcTrend,
 * sl2.0 tp2.0 hold12, riskPct 1.25. Also test fundingFade .70/.30 same packaging.
 *
 * Single pair → cap never binds. Mirrors btc-attribution.ts COMMON.
 * Windows: recent(OOS) = last 183d; older(IS) = prior 183d.
 * Run: npx tsx src/backtest/cli/btc-fast-vs-slow.ts
 */
import { runBacktest } from '../engine';
import { fundingFade, lsTopPositionFade } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const PAIR = 'BTCUSDT';
const RISK = 1.25; // LIVE_RISK_PCT_BTC

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 668_000,
  slippagePct: 0.25,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  cronRealistic: true,
};

function lsStrat(): Strategy {
  return lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK });
}
function fundingStrat(): Strategy {
  return fundingFade({ pctHi: 0.70, pctLo: 0.30, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK });
}

type Timing = 'slow' | 'fast' | 'instant';

async function runCell(make: () => Strategy, timing: Timing, skipDays: number) {
  // env / cronRealistic per timing
  if (timing === 'fast') process.env.CRON_FAST_ENTRY = '1';
  else delete process.env.CRON_FAST_ENTRY;
  const cronRealistic = timing !== 'instant';

  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const r = await runBacktest(make(), { symbol: PAIR, startTs, endTs, ...COMMON, cronRealistic });

  delete process.env.CRON_FAST_ENTRY;
  const m = r.metrics;
  return { n: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, ret: m.netPnlPct, maxDD: m.maxDDPct };
}

const fmt = (m: any) =>
  `${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${(isFinite(m.pf) ? m.pf.toFixed(2) : 'inf').padStart(6)} ${m.sumR.toFixed(2).padStart(7)} ${m.ret.toFixed(2).padStart(7)} ${m.maxDD.toFixed(2).padStart(6)}`;

async function runStrategy(name: string, make: () => Strategy) {
  console.log(`\n#### ${name} — BTCUSDT single pair, honest, risk ${RISK}% ####`);
  console.log('timing  | window      | n  WR    PF    sumR   ret%   DD%');
  console.log('-'.repeat(64));
  const timings: Timing[] = ['slow', 'fast', 'instant'];
  const windows: { label: string; skip: number }[] = [
    { label: 'recent(OOS)', skip: 0 },
    { label: 'older(IS) ', skip: 183 },
  ];
  for (const t of timings) {
    for (const w of windows) {
      const m = await runCell(make, t, w.skip);
      console.log(`${t.padEnd(7)} | ${w.label} | ${fmt(m)}`);
      console.log(`ROW ${name} ${t} ${w.label.replace(/[()]/g, '').trim()} ${m.n} ${m.wr.toFixed(1)} ${m.pf.toFixed(3)} ${m.sumR.toFixed(3)} ${m.ret.toFixed(3)} ${m.maxDD.toFixed(3)}`);
    }
    console.log('-'.repeat(64));
  }
}

async function main() {
  console.log(`\n== BTC FAST-vs-SLOW — ls_pos(.85/.15) & funding(.70/.30), useBtcTrend, sl2/tp2 hold12 ==`);
  await runStrategy('LS_POS', lsStrat);
  await runStrategy('FUNDING', fundingStrat);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

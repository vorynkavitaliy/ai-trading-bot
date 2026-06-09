/**
 * Interrogate the lone S3 finalist that cleared min(PF)>=1.4 both halves:
 *   fundingFade 0.70/0.30 sl2.5 tp3 hold12 NO-trend.
 * (1) Stress at slip 0.05/0.10/0.25.
 * (2) Plateau check: neighbours sl{2.0,2.5,3.0} x tp{2.5,3.0,3.5}, no-trend, slip 0.05.
 * Single-entry throughout. Reports per-side R to expose regime sign-flip.
 */
import { runBacktest } from '../engine';
import { fundingFade, CgFadeParams, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

function common(slip: number) {
  return { ...BACKTEST_COMMON, startEquity: 668_000, slippagePct: slip, riskPctBase: 0.5,
    leverage: 10, decisionTf: '240m' as const, tp1SlMode: 'no_move' as const,
    bePlusBufferPct: 0.10, cronRealistic: true };
}
async function run(p: Partial<CgFadeParams>, skip: number, slip: number) {
  resetCgFadeCooldownState();
  const endTs = Date.now() - skip * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const r = await runBacktest(fundingFade(p), { symbol: 'ETHUSDT', startTs, endTs, ...common(slip) });
  let lr = 0, sr = 0, lt = 0, st = 0;
  for (const t of r.trades) { if (t.side === 'long') { lt++; lr += t.pnlR; } else { st++; sr += t.pnlR; } }
  const m = r.metrics;
  return `tr${m.trades} WR${(m.winRate*100).toFixed(0)} PF${m.profitFactor.toFixed(2)} R${m.totalR.toFixed(1)} DD${m.maxDDPct.toFixed(1)} ret${m.netPnlPct.toFixed(1)}% [L${lt}/${lr.toFixed(1)} S${st}/${sr.toFixed(1)}]`;
}
const BASE: Partial<CgFadeParams> = { pctHi: 0.70, pctLo: 0.30, usePairTrend: false, useBtcTrend: false, maxHoldBars: 12, riskPct: 0.5 };

async function main() {
  console.log('=== (1) STRESS the finalist S3 0.70/0.30 sl2.5 tp3 no-trend ===');
  for (const slip of [0.05, 0.10, 0.25]) {
    const p = { ...BASE, slAtrMult: 2.5, tpAtrMult: 3.0 };
    console.log(`slip ${slip.toFixed(2)} recent: ${await run(p, 0, slip)}`);
    console.log(`slip ${slip.toFixed(2)} older : ${await run(p, 183, slip)}`);
  }
  console.log('\n=== (2) PLATEAU check (slip 0.05, no-trend) ===');
  for (const sl of [2.0, 2.5, 3.0]) for (const tp of [2.5, 3.0, 3.5]) {
    const p = { ...BASE, slAtrMult: sl, tpAtrMult: tp };
    console.log(`sl${sl} tp${tp} recent: ${await run(p, 0, 0.05)}`);
    console.log(`sl${sl} tp${tp} older : ${await run(p, 183, 0.05)}`);
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * Stress-test ETH finalist configs at slip 0.05 / 0.10 / 0.25, both halves.
 * The finalists from the packaged grid (S4 fundingTaConfluence 0.70/0.30 tp3,
 * the only two-sided both-halves-positive band). Single-entry.
 */
import { runBacktest } from '../engine';
import { fundingTaConfluence, CgFadeParams, resetCgFadeCooldownState } from '../../strategies/cg-fade';
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
  const r = await runBacktest(fundingTaConfluence(p), { symbol: 'ETHUSDT', startTs, endTs, ...common(slip) });
  let lr = 0, sr = 0, lt = 0, st = 0;
  for (const t of r.trades) { if (t.side === 'long') { lt++; lr += t.pnlR; } else { st++; sr += t.pnlR; } }
  const m = r.metrics;
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, lt, lr, st, sr };
}

const FINALISTS: Array<{ name: string; p: Partial<CgFadeParams> }> = [
  { name: 'S4 0.70/0.30 sl1.5 tp3 both', p: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 12, usePairTrend: true, useBtcTrend: true, riskPct: 0.5 } },
  { name: 'S4 0.70/0.30 sl2.0 tp3 both', p: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.0, tpAtrMult: 3.0, maxHoldBars: 12, usePairTrend: true, useBtcTrend: true, riskPct: 0.5 } },
  { name: 'S4 0.70/0.30 sl1.5 tp3 btc ', p: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 12, usePairTrend: false, useBtcTrend: true, riskPct: 0.5 } },
];

async function main() {
  for (const f of FINALISTS) {
    console.log(`\n=== ${f.name} ===`);
    for (const slip of [0.05, 0.10, 0.25]) {
      const rec = await run(f.p, 0, slip);
      const old = await run(f.p, 183, slip);
      console.log(`slip ${slip.toFixed(2)} recent: tr${rec.trades} WR${rec.wr.toFixed(0)} PF${rec.pf.toFixed(2)} R${rec.sumR.toFixed(1)} DD${rec.maxDD.toFixed(1)} ret${rec.ret.toFixed(1)}% [L${rec.lt}/${rec.lr.toFixed(1)} S${rec.st}/${rec.sr.toFixed(1)}]`);
      console.log(`slip ${slip.toFixed(2)} older : tr${old.trades} WR${old.wr.toFixed(0)} PF${old.pf.toFixed(2)} R${old.sumR.toFixed(1)} DD${old.maxDD.toFixed(1)} ret${old.ret.toFixed(1)}% [L${old.lt}/${old.lr.toFixed(1)} S${old.st}/${old.sr.toFixed(1)}]`);
    }
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

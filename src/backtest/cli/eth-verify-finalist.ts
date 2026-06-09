/**
 * eth-verify-finalist — clean, unambiguous reproduction + robustness check of the
 * ETH packaged-grid finalist (fundingFade/fundingTaConfluence 0.70/0.30, wide stop
 * sl2.5 / tp3.0, no trend filter). The workflow's grid agent hung before returning a
 * verdict; its /tmp output showed PF 1.85/2.01 two-sided both halves but with a
 * mislabeled archetype. This reproduces both S3 and S4 from scratch with long/short
 * split, two static halves AND a 4-window rolling walk-forward over the ~378d CG span.
 *
 * Run: npx tsx src/backtest/cli/eth-verify-finalist.ts
 */
import { runBacktest } from '../engine';
import { fundingFade, fundingTaConfluence, CgFadeParams, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

function common(slip: number) {
  return { ...BACKTEST_COMMON, startEquity: 668_000, slippagePct: slip, riskPctBase: 0.5,
    leverage: 10, decisionTf: '240m' as const, tp1SlMode: 'no_move' as const,
    bePlusBufferPct: 0.10, cronRealistic: true };
}

type Mk = (p: Partial<CgFadeParams>) => any;

async function run(mk: Mk, p: Partial<CgFadeParams>, startTs: number, endTs: number, slip: number) {
  resetCgFadeCooldownState();
  const r = await runBacktest(mk(p), { symbol: 'ETHUSDT', startTs, endTs, ...common(slip) });
  let lr = 0, sr = 0, lt = 0, st = 0;
  for (const t of r.trades) { if (t.side === 'long') { lt++; lr += t.pnlR; } else { st++; sr += t.pnlR; } }
  const m = r.metrics;
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, lt, lr, st, sr };
}

function fmt(tag: string, x: any) {
  const twoSided = x.lr > 0 && x.sr > 0 ? 'TWO-SIDED' : (x.lr > 0 || x.sr > 0 ? 'one-sided' : 'NEG');
  return `${tag.padEnd(16)} tr${String(x.trades).padStart(3)} WR${x.wr.toFixed(0).padStart(3)} PF${x.pf.toFixed(2)} R${x.sumR.toFixed(1).padStart(6)} DD${x.maxDD.toFixed(1)}% ret${x.ret.toFixed(1)}% [L${x.lt}/${x.lr.toFixed(1)} S${x.st}/${x.sr.toFixed(1)}] ${twoSided}`;
}

const P: Partial<CgFadeParams> = {
  pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 12,
  usePairTrend: false, useBtcTrend: false, riskPct: 0.5,
};

const DAY = 24 * 3600_000;

async function main() {
  const now = Date.now();
  const archetypes: Array<{ name: string; mk: Mk }> = [
    { name: 'S3 fundingFade', mk: fundingFade },
    { name: 'S4 fundingTaConfluence', mk: fundingTaConfluence },
  ];

  for (const a of archetypes) {
    console.log(`\n══════ ${a.name}  pctHi0.70/pctLo0.30 sl2.5 tp3.0 hold12 NO-TREND single-entry ══════`);

    // (1) Two static halves at slip 0.05 and 0.10
    for (const slip of [0.05, 0.10]) {
      const recent = await run(a.mk, P, now - 183 * DAY, now, slip);
      const older = await run(a.mk, P, now - 366 * DAY, now - 183 * DAY, slip);
      console.log(`  -- slip ${slip.toFixed(2)} --`);
      console.log('  ' + fmt('recent half', recent));
      console.log('  ' + fmt('older half', older));
    }

    // (2) 4-window rolling walk-forward over the CG span (~378d → 4 × ~92d windows), slip 0.05
    console.log(`  -- 4-window rolling WF (slip 0.05, ~92d each) --`);
    const W = 92;
    for (let i = 4; i >= 1; i--) {
      const endTs = now - (i - 1) * W * DAY;
      const startTs = endTs - W * DAY;
      const r = await run(a.mk, P, startTs, endTs, 0.05);
      const lbl = `win${5 - i} (${new Date(startTs).toISOString().slice(0, 10)})`;
      console.log('  ' + fmt(lbl, r));
    }
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

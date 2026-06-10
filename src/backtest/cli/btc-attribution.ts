/**
 * btc-attribution — P&L-gap attribution for BTC funding-fade / ls_pos-fade.
 *
 * The puzzle: BTC funding-fade has raw IC ~-0.17 OOS (mean-reverting → should be
 * profitable) yet backtests to ~-7R / PF 0.39 OOS. WHERE is the edge lost —
 * packaging (SL/TP/threshold/horizon) or engine realism (cron delay, funding
 * window block, intrabar SL-first)?
 *
 * Two strategies, RECENT 183d half (OOS), under variants:
 *   V0  live as-is (cronRealistic, funding-window ON, sl2/tp2 hold12)
 *   V1  NO_FUNDING_WINDOW=1 (set via env before the call)
 *   V2  cronRealistic:false (instant entry at the 4H close, no next-hour cron delay)
 *   V3  NO STOP: slAtrMult=10 → SL never hit → rides to maxHold time-stop
 *   V4  wider target + longer hold: tpAtrMult=3.0, maxHoldBars=18
 * V0 + V3 also on the OLDER 183d half (IS) for contrast.
 *
 * Single pair → cap never binds. Mirrors btc-regime-pnl.ts COMMON exactly.
 * Run: npx tsx src/backtest/cli/btc-attribution.ts
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

// Strategy factories per variant. base = funding .70/.30; ls = ls_pos .85/.15.
function fundingStrat(over: { slAtrMult?: number; tpAtrMult?: number; maxHoldBars?: number } = {}): Strategy {
  return fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK, ...over });
}
function lsStrat(over: { slAtrMult?: number; tpAtrMult?: number; maxHoldBars?: number } = {}): Strategy {
  return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK, ...over });
}

interface V {
  key: string;
  label: string;
  make: (over?: any) => Strategy;
  over?: { slAtrMult?: number; tpAtrMult?: number; maxHoldBars?: number };
  cronRealistic: boolean;
  noFundingWindow: boolean;
}

function buildVariants(make: (over?: any) => Strategy): V[] {
  return [
    { key: 'V0', label: 'V0 live as-is                   ', make, cronRealistic: true,  noFundingWindow: false },
    { key: 'V1', label: 'V1 NO_FUNDING_WINDOW            ', make, cronRealistic: true,  noFundingWindow: true  },
    { key: 'V2', label: 'V2 cronRealistic:false (instant)', make, cronRealistic: false, noFundingWindow: false },
    // V3: SL effectively never hit. slAtr=10 alone fails the MIN_RR_TP2 gate
    // (tp2Dist/slDist = 2/10 = 0.2 < 0.3 → every entry skipped). Scale TP up too
    // (tpAtr=10) so R:R=1.0 passes the gate; with both SL & TP ~10 ATR away the
    // position almost always exits on the maxHold time-stop instead — isolating
    // whether the tight SL is knocking us out before the 24-48h reversion.
    { key: 'V3', label: 'V3 NO STOP slAtr/tpAtr=10 (rideTS)', make, over: { slAtrMult: 10, tpAtrMult: 10 }, cronRealistic: true, noFundingWindow: false },
    { key: 'V4', label: 'V4 tpAtr=3.0 maxHold=18         ', make, over: { tpAtrMult: 3.0, maxHoldBars: 18 }, cronRealistic: true, noFundingWindow: false },
  ];
}

async function runHalf(v: V, skipDays: number) {
  // Funding-window toggle is read inside engine.isInFundingWindow via env.
  if (v.noFundingWindow) process.env.NO_FUNDING_WINDOW = '1';
  else delete process.env.NO_FUNDING_WINDOW;

  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const strat = v.make(v.over);
  const r = await runBacktest(strat, {
    symbol: PAIR, startTs, endTs, ...COMMON, cronRealistic: v.cronRealistic,
  });
  // Reset env so it doesn't leak across variants.
  delete process.env.NO_FUNDING_WINDOW;
  const m = r.metrics;
  return { n: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct };
}

const fmt = (m: any) =>
  `${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${(isFinite(m.pf) ? m.pf.toFixed(2) : 'inf').padStart(6)} ${m.sumR.toFixed(2).padStart(7)} ${m.ret.toFixed(2).padStart(7)} ${m.maxDD.toFixed(2).padStart(6)}`;

async function runStrategy(name: string, make: (over?: any) => Strategy) {
  console.log(`\n#### ${name} — BTCUSDT single pair, honest, RECENT(OOS) 183d, risk ${RISK}% ####`);
  console.log('variant                          | half | n  WR    PF    sumR   ret%   DD%');
  console.log('-'.repeat(82));
  const variants = buildVariants(make);
  for (const v of variants) {
    const oos = await runHalf(v, 0);
    console.log(`${v.label} | OOS  | ${fmt(oos)}`);
    console.log(`ROW ${name} ${v.key} OOS ${oos.n} ${oos.wr.toFixed(1)} ${oos.pf.toFixed(3)} ${oos.sumR.toFixed(3)} ${oos.ret.toFixed(3)} ${oos.maxDD.toFixed(3)}`);
    // V0 and V3 also on the OLDER (IS) half.
    if (v.key === 'V0' || v.key === 'V3') {
      const is = await runHalf(v, 183);
      console.log(`${' '.repeat(v.label.length)} | IS   | ${fmt(is)}`);
      console.log(`ROW ${name} ${v.key} IS  ${is.n} ${is.wr.toFixed(1)} ${is.pf.toFixed(3)} ${is.sumR.toFixed(3)} ${is.ret.toFixed(3)} ${is.maxDD.toFixed(3)}`);
    }
    console.log('-'.repeat(82));
  }
}

async function main() {
  console.log(`\n== BTC ATTRIBUTION — funding-fade(.70/.30) & ls_pos-fade(.85/.15), useBtcTrend, honest cron ==`);
  await runStrategy('FUNDING', fundingStrat);
  await runStrategy('LS_POS', lsStrat);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * eth-btc-filter-test — isolate how much the BTC-trend filter contributes to the ETH
 * funding fade, and whether it rescues the losing LONG side. Runs ETH funding .70/.30
 * over 365d with 4 trend-filter configs (both / BTC-only / pair-only / none), splitting
 * P&L by long vs short. Answers: "did BTC movement get used, and does more of it help?"
 *
 * Run: npx tsx src/backtest/cli/eth-btc-filter-test.ts
 */
import { runBacktest } from '../engine';
import { fundingFade } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 668_000, slippagePct: 0.25, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
  cronRealistic: true,
};

const CONFIGS: { label: string; strat: Strategy }[] = [
  { label: 'both trends (pair+BTC) [current]', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: true, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'BTC-trend only                  ', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'pair-trend only                 ', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
  { label: 'NO trend filter                 ', strat: fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: .5 }) },
];

async function main() {
  const endTs = Date.now(), startTs = endTs - 365 * 24 * 3600_000;
  console.log(`\n══ ETH funding .70/.30 — BTC-trend filter isolation (365d, long/short split) ══\n`);
  console.log('filter config                    │ total: n  sumR   │ LONG: n  WR  sumR  │ SHORT: n  WR  sumR │ MaxDD');
  console.log('─'.repeat(115));
  for (const c of CONFIGS) {
    const r = await runBacktest(c.strat, { symbol: 'ETHUSDT', startTs, endTs, ...COMMON });
    const tr = r.trades as any[];
    const bySide = (side: string) => {
      const t = tr.filter(x => String(x.side) === side);
      const wins = t.filter(x => x.pnlR > 0.05).length, losses = t.filter(x => x.pnlR < -0.05).length;
      const sumR = t.reduce((s, x) => s + x.pnlR, 0);
      return { n: t.length, wr: (wins + losses) ? wins / (wins + losses) * 100 : 0, sumR };
    };
    const L = bySide('long'), S = bySide('short');
    const tot = tr.reduce((s, x) => s + x.pnlR, 0);
    console.log(
      `${c.label} │ ${String(tr.length).padStart(3)} ${tot.toFixed(1).padStart(6)}  │ ${String(L.n).padStart(3)} ${L.wr.toFixed(0).padStart(3)}% ${L.sumR.toFixed(1).padStart(6)} │ ${String(S.n).padStart(3)} ${S.wr.toFixed(0).padStart(3)}% ${S.sumR.toFixed(1).padStart(6)} │ ${r.metrics.maxDDPct.toFixed(1)}%`,
    );
  }
  console.log(`\n(LONG sumR is the key column — does any BTC filter make ETH longs stop losing?)`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

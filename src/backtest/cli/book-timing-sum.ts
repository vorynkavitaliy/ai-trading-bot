/**
 * book-timing-sum — TRACK B: BOOK timing delta (as per-pair sum).
 *
 * The live book is 4 pairs SINGLE-ENTRY (BTC + SOL + ADA + LINK), cap-4. Cap-4
 * never binds below 4 simultaneous positions → summing each pair's standalone
 * runBacktest is a faithful book proxy AND uses engine.ts where the
 * CRON_FAST_ENTRY toggle works.
 *
 * Goal: quantify what the legacy +1h cron-entry deferral was costing the book.
 * engine.ts now has env CRON_FAST_ENTRY=1 (inside the cronRealistic block):
 *   - slow (default, unset): legacy +1h deferral on EVERY 4H close.
 *   - fast (CRON_FAST_ENTRY=1): a NON-funding 4H close (04/12/20 UTC) is entered
 *     the SAME hour; funding-boundary closes (00/08/16) still defer via the
 *     funding-window skip.
 *
 * For each of the 4 live pairs (EXACT enabled config from pair-strategies.ts),
 * run standalone runBacktest (cronRealistic:true, slippage 0.25%, the pair's true
 * riskPct, decisionTf 240m) on:
 *   - RECENT 183d (skip 0)   and   OLDER 183d (skip 183)
 *   - slow (default)         and   fast (CRON_FAST_ENTRY=1)
 * Prints per-pair n/PF/sumR/ret%, plus a SUMMED book sumR and summed ret% per
 * (timing, window). ret% is summed across pairs (each run uses the SAME
 * startEquity, so summing % is the additive book-PnL proxy under cap-non-binding).
 *
 * Run: npx tsx src/backtest/cli/book-timing-sum.ts
 */
import { runBacktest } from '../engine';
import { fundingFade, lsTopPositionFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';
import { LIVE_RISK_PCT, LIVE_RISK_PCT_BTC, LIVE_RISK_PCT_LINK } from '../../runtime/pair-strategies';

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

// EXACT enabled live configs, copied 1:1 from src/runtime/pair-strategies.ts
// TIER1_PORTFOLIO (the enabled:true entries).
interface PairDef { pair: string; risk: number; make: () => Strategy; }
const PAIRS: PairDef[] = [
  { pair: 'BTCUSDT', risk: LIVE_RISK_PCT_BTC, make: () => lsTopPositionFade({
      pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,
      slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: LIVE_RISK_PCT_BTC }) },
  { pair: 'SOLUSDT', risk: LIVE_RISK_PCT, make: () => fundingFade({
      pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT }) },
  { pair: 'ADAUSDT', risk: LIVE_RISK_PCT, make: () => fundingFade({
      pctHi: 0.75, pctLo: 0.25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT }) },
  { pair: 'LINKUSDT', risk: LIVE_RISK_PCT_LINK, make: () => fundingTaConfluence({
      pctHi: 0.70, pctLo: 0.30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
      riskPct: LIVE_RISK_PCT_LINK }) },
];

type Timing = 'slow' | 'fast';
type Window = 'recent' | 'older';

interface Row { n: number; wr: number; pf: number; sumR: number; ret: number; maxDD: number; }

async function runOne(p: PairDef, window: Window, timing: Timing): Promise<Row> {
  if (timing === 'fast') process.env.CRON_FAST_ENTRY = '1';
  else delete process.env.CRON_FAST_ENTRY;

  const skipDays = window === 'recent' ? 0 : 183;
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;

  const r = await runBacktest(p.make(), { symbol: p.pair, startTs, endTs, ...COMMON });

  delete process.env.CRON_FAST_ENTRY;
  const m = r.metrics;
  return { n: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, ret: m.netPnlPct, maxDD: m.maxDDPct };
}

const fmtPf = (pf: number) => (isFinite(pf) ? pf.toFixed(2) : 'inf').padStart(6);
const fmtRow = (label: string, m: Row) =>
  `${label.padEnd(28)} ${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${fmtPf(m.pf)} ${m.sumR.toFixed(2).padStart(8)} ${m.ret.toFixed(3).padStart(9)} ${m.maxDD.toFixed(2).padStart(6)}`;

async function main() {
  console.log('\n== TRACK B — BOOK timing delta (per-pair sum) ==');
  console.log('Live book: BTC+SOL+ADA+LINK single-entry, cap-4 (never binds <4 pos).');
  console.log('cronRealistic:true, slip 0.25%, decisionTf 240m, startEquity 668k, per-pair live riskPct.');
  console.log('slow = legacy +1h deferral (default). fast = CRON_FAST_ENTRY=1 (same-hour non-funding 4H close).\n');

  // results[window][timing] = { pair -> Row }
  const results: Record<Window, Record<Timing, Record<string, Row>>> = {
    recent: { slow: {}, fast: {} },
    older: { slow: {}, fast: {} },
  };

  for (const window of ['recent', 'older'] as Window[]) {
    for (const timing of ['slow', 'fast'] as Timing[]) {
      for (const p of PAIRS) {
        results[window][timing][p.pair] = await runOne(p, window, timing);
      }
    }
  }

  for (const window of ['recent', 'older'] as Window[]) {
    for (const timing of ['slow', 'fast'] as Timing[]) {
      console.log(`\n#### ${window.toUpperCase()} 183d | ${timing.toUpperCase()} timing ####`);
      console.log('pair/config                  n  WR     PF     sumR      ret%    DD%');
      console.log('-'.repeat(74));
      let bookN = 0, bookSumR = 0, bookRet = 0;
      for (const p of PAIRS) {
        const m = results[window][timing][p.pair];
        const label = `${p.pair} r${p.risk}`;
        console.log(fmtRow(label, m));
        console.log(`ROW ${p.pair} ${window} ${timing} ${m.n} ${m.wr.toFixed(1)} ${fmtPf(m.pf).trim()} ${m.sumR.toFixed(3)} ${m.ret.toFixed(3)} ${m.maxDD.toFixed(3)}`);
        bookN += m.n; bookSumR += m.sumR; bookRet += m.ret;
      }
      console.log('-'.repeat(74));
      console.log(`${'BOOK TOTAL'.padEnd(28)} ${String(bookN).padStart(3)} ${'   '} ${'      '} ${bookSumR.toFixed(2).padStart(8)} ${bookRet.toFixed(3).padStart(9)}`);
      console.log(`ROW BOOK_TOTAL ${window} ${timing} ${bookN} ${bookSumR.toFixed(3)} ${bookRet.toFixed(3)}`);
    }
  }

  // Delta table: fast - slow, per window, book-wide.
  console.log('\n#### BOOK-WIDE DELTA (fast - slow) ####');
  console.log('window   d_sumR    d_ret%   d_ret%/yr');
  console.log('-'.repeat(44));
  for (const window of ['recent', 'older'] as Window[]) {
    let slowR = 0, slowRet = 0, fastR = 0, fastRet = 0;
    for (const p of PAIRS) {
      slowR += results[window].slow[p.pair].sumR;
      slowRet += results[window].slow[p.pair].ret;
      fastR += results[window].fast[p.pair].sumR;
      fastRet += results[window].fast[p.pair].ret;
    }
    const dR = fastR - slowR;
    const dRet = fastRet - slowRet;
    const dRetYr = dRet * (365 / 183); // annualize the 183d delta
    console.log(`${window.padEnd(8)} ${dR.toFixed(2).padStart(8)} ${dRet.toFixed(3).padStart(8)} ${dRetYr.toFixed(2).padStart(9)}`);
    console.log(`ROW DELTA ${window} dSumR=${dR.toFixed(3)} dRet=${dRet.toFixed(3)} dRetYr=${dRetYr.toFixed(3)}`);
  }

  // Per-pair delta (which pairs gain most under fast timing).
  console.log('\n#### PER-PAIR DELTA (fast - slow) ####');
  console.log('pair      window   d_sumR    d_ret%');
  console.log('-'.repeat(44));
  for (const p of PAIRS) {
    for (const window of ['recent', 'older'] as Window[]) {
      const dR = results[window].fast[p.pair].sumR - results[window].slow[p.pair].sumR;
      const dRet = results[window].fast[p.pair].ret - results[window].slow[p.pair].ret;
      console.log(`${p.pair.padEnd(9)} ${window.padEnd(8)} ${dR.toFixed(2).padStart(8)} ${dRet.toFixed(3).padStart(8)}`);
      console.log(`ROW PAIRDELTA ${p.pair} ${window} dSumR=${dR.toFixed(3)} dRet=${dRet.toFixed(3)}`);
    }
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

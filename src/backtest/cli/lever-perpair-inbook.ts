/**
 * lever-perpair-inbook — IN-BOOK A/B verifier for a LEVER-1 per-pair config change.
 * Takes a single proposed per-pair config override (via env) and runs the FULL live
 * 4-pair book (BTC+SOL+ADA+LINK, cap-4, flatten 4.3, market entries, mixed risk)
 * BOTH ways — live book vs book-with-one-pair-swapped — on:
 *   - full year + old/recent halves (slip 0.05)
 *   - 4-window rolling WF (~91d)
 * Reports return%/yr, PF, MaxDD, Hyro −5% breach counts (daysBreach5/balDaysBreach5)
 * for each, so the standalone headroom can be confirmed to survive correlation in-book.
 *
 * Env (override ONE pair):
 *   OVR_PAIR=ADAUSDT OVR_SL=2.0 OVR_TP=2.5 OVR_HI=0.80 OVR_LO=0.20 OVR_HOLD=12
 * (any omitted field falls back to that pair's live value)
 *
 * Run: OVR_PAIR=ADAUSDT OVR_SL=2.0 OVR_TP=2.5 OVR_HI=0.80 OVR_LO=0.20 \
 *      npx tsx src/backtest/cli/lever-perpair-inbook.ts [days=366] > /tmp/inbook.out 2>&1
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const START_EQ = 200_000;
const RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: 0.6 };
const riskOf = (s: string) => RISK[s] ?? 0.6;
const BOOK = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];

// Live per-pair configs (verbatim from pair-strategies.ts).
type Cfg = { sl: number; tp: number; hi: number; lo: number; hold: number };
const LIVE: Record<string, Cfg> = {
  BTCUSDT: { sl: 2.0, tp: 2.0, hi: 0.85, lo: 0.15, hold: 12 },
  SOLUSDT: { sl: 2.0, tp: 2.0, hi: 0.70, lo: 0.30, hold: 12 },
  ADAUSDT: { sl: 1.5, tp: 2.0, hi: 0.75, lo: 0.25, hold: 12 },
  LINKUSDT: { sl: 1.5, tp: 2.0, hi: 0.70, lo: 0.30, hold: 12 },
};

const OVR_PAIR = process.env.OVR_PAIR;
function cfgFor(pair: string): Cfg {
  const base = { ...LIVE[pair] };
  if (pair === OVR_PAIR) {
    if (process.env.OVR_SL) base.sl = parseFloat(process.env.OVR_SL);
    if (process.env.OVR_TP) base.tp = parseFloat(process.env.OVR_TP);
    if (process.env.OVR_HI) base.hi = parseFloat(process.env.OVR_HI);
    if (process.env.OVR_LO) base.lo = parseFloat(process.env.OVR_LO);
    if (process.env.OVR_HOLD) base.hold = parseFloat(process.env.OVR_HOLD);
  }
  return base;
}

function strat(pair: string, c: Cfg, risk: number): Strategy {
  const common = { slAtrMult: c.sl, tpAtrMult: c.tp, maxHoldBars: c.hold, riskPct: risk };
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: c.hi, pctLo: c.lo, usePairTrend: false, useBtcTrend: true, ...common });
    case 'SOLUSDT': return fundingFade({ pctHi: c.hi, pctLo: c.lo, ...common });
    case 'ADAUSDT': return fundingFade({ pctHi: c.hi, pctLo: c.lo, ...common });
    case 'LINKUSDT': return fundingTaConfluence({ pctHi: c.hi, pctLo: c.lo, ...common });
    default: throw new Error(`no cfg ${pair}`);
  }
}

function stats(t: ClosedTrade[]) {
  let eq = START_EQ, peak = eq, maxDD = 0, w = 0, l = 0, usd = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = x.pnlR * (riskOf(x.symbol) / 100 * START_EQ);
    eq += pnl; usd += pnl; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
  }
  const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, maxDD, ret: usd / START_EQ * 100 };
}

async function run(useOvr: boolean, startTs: number, endTs: number, slip: number) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = BOOK.map((p, i) => {
    const c = useOvr ? cfgFor(p) : LIVE[p];
    return { symbol: p, strategy: strat(p, c, riskOf(p)), priority: i };
  });
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: slip, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs, maxParallelCap: 4, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: 4.3,
  });
  return { S: stats(r.trades), dd: r.dailyDd };
}

const fmtRow = (label: string, S: any, dd: any, days: number) => {
  const ann = S.ret * 365 / days;
  const surv = dd.daysBreach5 === 0 && dd.balDaysBreach5 === 0;
  return `  ${label.padEnd(20)} ${((S.ret >= 0 ? '+' : '') + S.ret.toFixed(1) + '%').padStart(7)} (${(ann >= 0 ? '+' : '') + ann.toFixed(0)}%/yr) PF${S.pf.toFixed(2)} MaxDD${S.maxDD.toFixed(1)}% Hyro${dd.daysBreach5}/${dd.balDaysBreach5}${surv ? '✅' : '❌'} n=${S.n}`;
};

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete (process.env as any).ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '366');
  const now = Date.now(), D = days * 24 * 3600_000, half = Math.round(days / 2), DAY = 24 * 3600_000;
  const ovr = OVR_PAIR ? cfgFor(OVR_PAIR) : null;
  console.log(`\n████ IN-BOOK A/B — override ${OVR_PAIR ?? '(none)'} → ${ovr ? `sl${ovr.sl} tp${ovr.tp} ${ovr.hi}/${ovr.lo} h${ovr.hold}` : '—'} ████`);
  console.log(`book BTC+SOL+ADA+LINK cap-4 flatten4.3 slip0.05 mixed-risk ${days}d\n`);

  console.log('── year + halves ──');
  for (const [lbl, s, e, d] of [['YEAR', now - D, now, days], ['OLD half', now - D, now - D / 2, half], ['RECENT half', now - D / 2, now, half]] as [string, number, number, number][]) {
    const a = await run(false, s, e, 0.05), b = await run(true, s, e, 0.05);
    console.log(`  [${lbl}]`);
    console.log(fmtRow('  LIVE book', a.S, a.dd, d));
    console.log(fmtRow('  PROPOSED book', b.S, b.dd, d));
  }

  console.log('\n── 4-window rolling WF (~91d, slip 0.05) ──');
  const W = 91;
  for (let i = 4; i >= 1; i--) {
    const endTs = now - (i - 1) * W * DAY, startTs = endTs - W * DAY;
    const a = await run(false, startTs, endTs, 0.05), b = await run(true, startTs, endTs, 0.05);
    const lbl = `w${5 - i}`;
    console.log(`  ${lbl} LIVE ret${a.S.ret >= 0 ? '+' : ''}${a.S.ret.toFixed(1)}% PF${a.S.pf.toFixed(2)} DD${a.S.maxDD.toFixed(1)}% Hyro${a.dd.daysBreach5}/${a.dd.balDaysBreach5} || PROP ret${b.S.ret >= 0 ? '+' : ''}${b.S.ret.toFixed(1)}% PF${b.S.pf.toFixed(2)} DD${b.S.maxDD.toFixed(1)}% Hyro${b.dd.daysBreach5}/${b.dd.balDaysBreach5}`);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

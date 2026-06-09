/**
 * lever-perpair-config — LEVER 1: per-pair SL/TP/hold/threshold optimization for the
 * LIVE standalone book (BTC ls_pos / SOL funding / ADA funding / LINK S4 confluence).
 *
 * For EACH live pair, sweep its OWN archetype over:
 *   slAtrMult {1.5, 2.0, 2.5} × tpAtrMult {2.0, 2.5, 3.0} × maxHoldBars {12, 18, 24}
 *   × thresholds (±0.05 around the live pctHi/pctLo).
 * Single-entry, slip 0.05, cron-realistic, $668k prop equity, 10× lev.
 *
 * Robustness gauntlet (non-negotiable — selection-on-train inflates ~3-5×):
 *   1) Rank full grid by full-span (~366d) sumR (cheap screen).
 *   2) Take top-K candidates + the LIVE config through the rigorous check:
 *        - 4-window rolling WF (~91d each) — must be POSITIVE in ALL 4 windows.
 *        - two-sided over full span (long sumR > 0 AND short sumR > 0).
 *        - PF over full span ≥ live PF.
 *        - MaxDD over full span not worse than live by > 1.0pp.
 *      Only candidates passing ALL of the above beat live → real headroom.
 *   3) Report the live config's own 4-window WF + two-sided as the baseline.
 *
 * Read-only on DB. Does NOT edit runtime. Compact summary block at the end.
 *
 * Run:  npx tsx src/backtest/cli/lever-perpair-config.ts [pair=ALL] > /tmp/lever-perpair.out 2>&1
 */
import { runBacktest } from '../engine';
import {
  lsTopPositionFade, fundingFade, fundingTaConfluence, CgFadeParams, resetCgFadeCooldownState,
} from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

type Mk = (p: Partial<CgFadeParams>) => Strategy;

function common(slip: number) {
  return {
    ...BACKTEST_COMMON, startEquity: 668_000, slippagePct: slip, riskPctBase: 0.5,
    leverage: 10, decisionTf: '240m' as const, tp1SlMode: 'no_move' as const,
    bePlusBufferPct: 0.10, cronRealistic: true,
  };
}

interface Res {
  trades: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number;
  lt: number; lr: number; st: number; sr: number;
}

async function run(mk: Mk, p: Partial<CgFadeParams>, startTs: number, endTs: number, slip: number): Promise<Res> {
  resetCgFadeCooldownState();
  const r = await runBacktest(mk(p), { symbol: p.__symbol as any, startTs, endTs, ...common(slip) } as any);
  let lr = 0, sr = 0, lt = 0, st = 0;
  for (const t of r.trades) { if (t.side === 'long') { lt++; lr += t.pnlR; } else { st++; sr += t.pnlR; } }
  const m = r.metrics;
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, lt, lr, st, sr };
}

const DAY = 24 * 3600_000;

interface PairDef {
  symbol: string;
  archetype: string;
  mk: Mk;
  live: Partial<CgFadeParams>;          // exact live config (sl/tp/hold/thresholds + trend flags)
  thresholdGrid: Array<{ pctHi: number; pctLo: number }>;  // ±0.05 around live
  trend: Partial<CgFadeParams>;         // trend flags that must be held fixed per archetype
}

// Live configs verbatim from src/runtime/pair-strategies.ts (single source of truth).
const PAIRS: PairDef[] = [
  {
    symbol: 'BTCUSDT', archetype: 'S1 lsTopPositionFade',
    mk: lsTopPositionFade,
    trend: { usePairTrend: false, useBtcTrend: true },
    live: { pctHi: 0.85, pctLo: 0.15, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12 },
    thresholdGrid: [
      { pctHi: 0.80, pctLo: 0.20 }, { pctHi: 0.85, pctLo: 0.15 }, { pctHi: 0.90, pctLo: 0.10 },
    ],
  },
  {
    symbol: 'SOLUSDT', archetype: 'S3 fundingFade',
    mk: fundingFade,
    trend: { usePairTrend: true, useBtcTrend: true },   // FundingFade defaults; live passes no override → keeps defaults
    live: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12 },
    thresholdGrid: [
      { pctHi: 0.65, pctLo: 0.35 }, { pctHi: 0.70, pctLo: 0.30 }, { pctHi: 0.75, pctLo: 0.25 },
    ],
  },
  {
    symbol: 'ADAUSDT', archetype: 'S3 fundingFade',
    mk: fundingFade,
    trend: { usePairTrend: true, useBtcTrend: true },
    live: { pctHi: 0.75, pctLo: 0.25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12 },
    thresholdGrid: [
      { pctHi: 0.70, pctLo: 0.30 }, { pctHi: 0.75, pctLo: 0.25 }, { pctHi: 0.80, pctLo: 0.20 },
    ],
  },
  {
    symbol: 'LINKUSDT', archetype: 'S4 fundingTaConfluence',
    mk: fundingTaConfluence,
    trend: { usePairTrend: true, useBtcTrend: true },
    live: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12 },
    thresholdGrid: [
      { pctHi: 0.65, pctLo: 0.35 }, { pctHi: 0.70, pctLo: 0.30 }, { pctHi: 0.75, pctLo: 0.25 },
    ],
  },
];

const SL_GRID = [1.5, 2.0, 2.5];
const TP_GRID = [2.0, 2.5, 3.0];
// maxHoldBars probed at {12,24}: a BTC pre-run showed 12/18/24 produce IDENTICAL
// trades (the 48h time-stop rarely binds before the ATR stop/TP) — the hold lever is
// near-inert for these wide ATR stops. Keep the live 12 + the 96h extreme 24 to confirm.
const HOLD_GRID = [12, 24];

function cfgKey(p: Partial<CgFadeParams>): string {
  return `sl${p.slAtrMult} tp${p.tpAtrMult} h${p.maxHoldBars} ${p.pctHi}/${p.pctLo}`;
}

function twoSided(r: Res): boolean { return r.lr > 0 && r.sr > 0; }
function tag(r: Res): string {
  return r.lr > 0 && r.sr > 0 ? 'TWO-SIDED' : (r.lr > 0 || r.sr > 0 ? 'one-sided' : 'NEG');
}

// Build full param object for a grid point (merge trend flags + threshold + sl/tp/hold).
function buildParams(pd: PairDef, sl: number, tp: number, hold: number, th: { pctHi: number; pctLo: number }): Partial<CgFadeParams> {
  return {
    ...pd.trend, pctHi: th.pctHi, pctLo: th.pctLo,
    slAtrMult: sl, tpAtrMult: tp, maxHoldBars: hold, riskPct: 0.5,
    __symbol: pd.symbol,
  } as any;
}

async function evalPair(pd: PairDef, now: number) {
  console.log(`\n\n████████ ${pd.symbol} — ${pd.archetype} ████████`);
  const spanStart = now - 366 * DAY;

  // LIVE config full-span + 4-window WF baseline.
  const liveP = buildParams(pd, pd.live.slAtrMult!, pd.live.tpAtrMult!, pd.live.maxHoldBars!, { pctHi: pd.live.pctHi!, pctLo: pd.live.pctLo! });
  const liveFull = await run(pd.mk, liveP, spanStart, now, 0.05);

  // 4 rolling windows (~91d).
  const W = 91;
  async function wf(p: Partial<CgFadeParams>): Promise<Res[]> {
    const out: Res[] = [];
    for (let i = 4; i >= 1; i--) {
      const endTs = now - (i - 1) * W * DAY;
      const startTs = endTs - W * DAY;
      out.push(await run(pd.mk, p, startTs, endTs, 0.05));
    }
    return out;
  }
  const liveWf = await wf(liveP);
  const liveAllPos = liveWf.every(w => w.sumR > 0);

  console.log(`  LIVE  ${cfgKey(liveP).padEnd(34)} full: tr${liveFull.trades} PF${liveFull.pf.toFixed(2)} R${liveFull.sumR.toFixed(1)} DD${liveFull.maxDD.toFixed(1)}% ret${liveFull.ret.toFixed(1)}% [L${liveFull.lt}/${liveFull.lr.toFixed(1)} S${liveFull.st}/${liveFull.sr.toFixed(1)}] ${tag(liveFull)}`);
  console.log(`        WF windows: ` + liveWf.map((w, i) => `w${i + 1} R${w.sumR.toFixed(1)}`).join(' ') + `  allPos=${liveAllPos}`);

  // Full grid screen (rank by full-span sumR).
  type GP = { p: Partial<CgFadeParams>; full: Res };
  const grid: GP[] = [];
  for (const sl of SL_GRID) for (const tp of TP_GRID) for (const hold of HOLD_GRID) for (const th of pd.thresholdGrid) {
    const p = buildParams(pd, sl, tp, hold, th);
    const full = await run(pd.mk, p, spanStart, now, 0.05);
    grid.push({ p, full });
  }
  grid.sort((a, b) => b.full.sumR - a.full.sumR);

  console.log(`\n  -- top 8 grid points by full-span sumR (of ${grid.length}) --`);
  for (const g of grid.slice(0, 8)) {
    console.log(`    ${cfgKey(g.p).padEnd(34)} tr${String(g.full.trades).padStart(3)} PF${g.full.pf.toFixed(2)} R${g.full.sumR.toFixed(1).padStart(6)} DD${g.full.maxDD.toFixed(1)}% ret${g.full.ret.toFixed(1)}% ${tag(g.full)}`);
  }

  // Rigorous gauntlet on top-K candidates (skip the exact live point, already done).
  const K = 6;
  const liveKey = cfgKey(liveP);
  const candidates = grid.filter(g => cfgKey(g.p) !== liveKey).slice(0, K);

  console.log(`\n  -- gauntlet on top ${candidates.length} candidates (4-window WF + two-sided + PF≥live + DD≤live+1pp) --`);
  const robust: Array<{ key: string; full: Res; wf: Res[]; liftR: number; liftRet: number; ddDelta: number }> = [];
  for (const c of candidates) {
    const cwf = await wf(c.p);
    const allPos = cwf.every(w => w.sumR > 0);
    const ts = twoSided(c.full);
    const pfOk = c.full.pf >= liveFull.pf - 1e-9;
    const ddDelta = c.full.maxDD - liveFull.maxDD;             // positive = worse
    const ddOk = ddDelta <= 1.0;
    const beatsLiveWf = cwf.reduce((s, w) => s + w.sumR, 0) > liveWf.reduce((s, w) => s + w.sumR, 0);
    const pass = allPos && ts && pfOk && ddOk && beatsLiveWf;
    const flag = pass ? 'ROBUST ✅' : `reject(${[!allPos && 'WFneg', !ts && '1side', !pfOk && 'PF<live', !ddOk && 'DD+', !beatsLiveWf && 'WF≤live'].filter(Boolean).join(',')})`;
    console.log(`    ${cfgKey(c.p).padEnd(34)} WF[${cwf.map(w => w.sumR.toFixed(1)).join(',')}] full PF${c.full.pf.toFixed(2)} R${c.full.sumR.toFixed(1)} DD${c.full.maxDD.toFixed(1)}%(Δ${ddDelta >= 0 ? '+' : ''}${ddDelta.toFixed(1)}) ${tag(c.full)} → ${flag}`);
    if (pass) robust.push({ key: cfgKey(c.p), full: c.full, wf: cwf, liftR: c.full.sumR - liveFull.sumR, liftRet: c.full.ret - liveFull.ret, ddDelta });
  }

  // Best robust alternative = highest full-span sumR among robust passers.
  robust.sort((a, b) => b.full.sumR - a.full.sumR);
  const best = robust[0];

  return {
    symbol: pd.symbol, archetype: pd.archetype,
    liveKey, liveFull, liveWf, liveAllPos,
    best,
    robustCount: robust.length,
  };
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete (process.env as any).ANCHOR_4H;
  const arg = (process.argv[2] ?? 'ALL').toUpperCase();
  const now = Date.now();
  const targets = arg === 'ALL' ? PAIRS : PAIRS.filter(p => p.symbol === arg);
  if (targets.length === 0) { console.error(`no pair ${arg}`); process.exit(1); }

  const summaries: any[] = [];
  for (const pd of targets) {
    summaries.push(await evalPair(pd, now));
  }

  // COMPACT FINAL SUMMARY ───────────────────────────────────────────────
  console.log(`\n\n══════════════ LEVER 1 COMPACT SUMMARY (slip 0.05, single-entry, $668k) ══════════════`);
  let totalLiftRet = 0;
  for (const s of summaries) {
    const lf = s.liveFull;
    console.log(`\n${s.symbol} (${s.archetype})`);
    console.log(`  live    ${s.liveKey.padEnd(34)} PF${lf.pf.toFixed(2)} R${lf.sumR.toFixed(1)} ret${lf.ret.toFixed(1)}% DD${lf.maxDD.toFixed(1)}% [L${lf.lr.toFixed(1)}/S${lf.sr.toFixed(1)}] WFallPos=${s.liveAllPos} twoSided=${twoSided(lf)}`);
    if (s.best) {
      const b = s.best;
      console.log(`  BEST-ROB ${b.key.padEnd(34)} PF${b.full.pf.toFixed(2)} R${b.full.sumR.toFixed(1)} ret${b.full.ret.toFixed(1)}% DD${b.full.maxDD.toFixed(1)}% liftRet=${b.liftRet >= 0 ? '+' : ''}${b.liftRet.toFixed(1)}pp/span ΔDD=${b.ddDelta >= 0 ? '+' : ''}${b.ddDelta.toFixed(1)}pp`);
      console.log(`           WF[${b.wf.map((w: Res) => w.sumR.toFixed(1)).join(',')}]  (robustPassers=${s.robustCount})`);
      // pp/yr lift: span≈366d → liftRet over span ≈ liftRet per year.
      totalLiftRet += b.liftRet;
    } else {
      console.log(`  BEST-ROB none — live config is the robust optimum (no candidate beat it on the gauntlet)`);
    }
  }
  console.log(`\n  TOTAL standalone robust lift (sum of per-pair liftRet over ~366d span) ≈ ${totalLiftRet >= 0 ? '+' : ''}${totalLiftRet.toFixed(1)}pp/yr`);
  console.log(`  NOTE: standalone sum — portfolio verifier (validate-book.ts) must confirm survival in-book (correlation, cap-4, flatten).`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

/**
 * lever-perpair-sweep — LEVER 1: per-pair config optimization for the LIVE book.
 *
 * For ONE live pair, sweep its OWN archetype over slAtrMult × tpAtrMult × maxHoldBars
 * × thresholds(±0.05 around live), single-entry, slip 0.05, cron-realistic. Each config
 * is scored STANDALONE (single-pair runBacktest) on:
 *   (a) two static 183d halves (recent / older)
 *   (b) a 4-window rolling walk-forward (~89d each, fits ADA/LINK's ~362d CG span)
 * with long/short split on every window.
 *
 * A config counts as ROBUST headroom only if, vs the LIVE config, it:
 *   - is positive sumR in ALL 4 rolling windows
 *   - is two-sided in the FULL window (long>0 AND short>0)
 *   - PF(full) >= live PF(full) (>= so ties allowed if other metrics improve)
 *   - MaxDD(full) <= live MaxDD(full) + 0.5pp (not materially worse)
 *   - sumR(full) > live sumR(full)
 *
 * The live config is ALWAYS printed first as the baseline. Then we print the live
 * config's per-window detail, then the top robust candidates ranked by min-window sumR
 * (robustness, not max aggregate — selection-on-aggregate is the artifact).
 *
 * Run: npx tsx src/backtest/cli/lever-perpair-sweep.ts BTCUSDT
 *   PAIR in {BTCUSDT, SOLUSDT, ADAUSDT, LINKUSDT}. Slip via SLIP env (default 0.05).
 *   GRID=full (default, 81 cfgs) or GRID=coarse (sl/tp/hold only at live threshold).
 */
import { runBacktest } from '../engine';
import {
  lsTopPositionFade, fundingFade, fundingTaConfluence,
  CgFadeParams, resetCgFadeCooldownState,
} from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SLIP = parseFloat(process.env.SLIP ?? '0.05');
const GRID = process.env.GRID ?? 'full';
const DAY = 24 * 3600_000;

function common(slip: number) {
  return {
    ...BACKTEST_COMMON, startEquity: 668_000, slippagePct: slip, riskPctBase: 0.5,
    leverage: 10, decisionTf: '240m' as const, tp1SlMode: 'no_move' as const,
    bePlusBufferPct: 0.10, cronRealistic: true,
  };
}

type Mk = (p: Partial<CgFadeParams>) => any;

// Per-pair archetype + LIVE config (single source of truth = pair-strategies.ts).
interface PairDef { symbol: string; mk: Mk; live: Partial<CgFadeParams>; }
const PAIRS: Record<string, PairDef> = {
  BTCUSDT: {
    symbol: 'BTCUSDT', mk: lsTopPositionFade,
    live: { pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12 },
  },
  SOLUSDT: {
    symbol: 'SOLUSDT', mk: fundingFade,
    live: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12 },
  },
  ADAUSDT: {
    symbol: 'ADAUSDT', mk: fundingFade,
    live: { pctHi: 0.75, pctLo: 0.25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12 },
  },
  LINKUSDT: {
    symbol: 'LINKUSDT', mk: fundingTaConfluence,
    live: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12 },
  },
};

interface WinRes { trades: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number; lt: number; lr: number; st: number; sr: number; }

async function run(def: PairDef, p: Partial<CgFadeParams>, startTs: number, endTs: number, slip: number): Promise<WinRes> {
  resetCgFadeCooldownState();
  const params: Partial<CgFadeParams> = { ...def.live, ...p, riskPct: 0.5 };
  const r = await runBacktest(def.mk(params), { symbol: def.symbol, startTs, endTs, ...common(slip) });
  let lr = 0, sr = 0, lt = 0, st = 0;
  for (const t of r.trades) { if (t.side === 'long') { lt++; lr += t.pnlR; } else { st++; sr += t.pnlR; } }
  const m = r.metrics;
  return { trades: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, lt, lr, st, sr };
}

function twoSided(x: WinRes): boolean { return x.lr > 0 && x.sr > 0; }
function fmt(tag: string, x: WinRes): string {
  const ts = twoSided(x) ? 'TWO' : (x.lr > 0 || x.sr > 0 ? '1sd' : 'NEG');
  return `${tag.padEnd(20)} tr${String(x.trades).padStart(3)} WR${x.wr.toFixed(0).padStart(3)} PF${x.pf.toFixed(2)} R${x.sumR.toFixed(1).padStart(6)} DD${x.maxDD.toFixed(1).padStart(4)}% ret${x.ret.toFixed(1).padStart(6)}% [L${x.lt}/${x.lr.toFixed(1)} S${x.st}/${x.sr.toFixed(1)}] ${ts}`;
}

function gridConfigs(def: PairDef): Partial<CgFadeParams>[] {
  const sls = [1.5, 2.0, 2.5];
  const tps = [2.0, 2.5, 3.0];
  // maxHoldBars is a DEAD dimension for these CG-fade strategies: positions exit via
  // TP/SL/reversal well before the 48h (12-bar) cap, so 12/18/24 give byte-identical
  // results (verified on BTC: every (sl,tp,12/18/24) triplet identical). We fix hold=12
  // (live) in the main grid and sweep hold separately (HOLD_SWEEP=1) to confirm.
  const holds = process.env.HOLD_SWEEP === '1' ? [12, 18, 24] : [12];
  // thresholds ±0.05 around live (symmetric pctHi/pctLo)
  const hiLive = def.live.pctHi!, loLive = def.live.pctLo!;
  const thr = GRID === 'full'
    ? [{ pctHi: hiLive, pctLo: loLive }, { pctHi: +(hiLive + 0.05).toFixed(2), pctLo: +(loLive - 0.05).toFixed(2) }, { pctHi: +(hiLive - 0.05).toFixed(2), pctLo: +(loLive + 0.05).toFixed(2) }]
    : [{ pctHi: hiLive, pctLo: loLive }];
  const out: Partial<CgFadeParams>[] = [];
  for (const t of thr) for (const sl of sls) for (const tp of tps) for (const h of holds) {
    out.push({ pctHi: t.pctHi, pctLo: t.pctLo, slAtrMult: sl, tpAtrMult: tp, maxHoldBars: h });
  }
  return out;
}

function key(p: Partial<CgFadeParams>): string {
  return `hi${p.pctHi}/lo${p.pctLo} sl${p.slAtrMult} tp${p.tpAtrMult} h${p.maxHoldBars}`;
}

async function main() {
  const sym = (process.argv[2] ?? '').toUpperCase();
  const def = PAIRS[sym];
  if (!def) { console.error('usage: lever-perpair-sweep.ts <BTCUSDT|SOLUSDT|ADAUSDT|LINKUSDT>'); process.exit(1); }

  const now = Date.now();
  // Window sizing: ADA/LINK have ~362d CG; use 4 × 89d = 356d rolling so all windows
  // have CG. BTC/SOL have full 378d but we keep the same windowing for comparability.
  const W = 89;
  const half = 181; // ~half of 362d span
  const rollStarts: Array<{ s: number; e: number; lbl: string }> = [];
  for (let i = 4; i >= 1; i--) {
    const endTs = now - (i - 1) * W * DAY;
    const startTs = endTs - W * DAY;
    rollStarts.push({ s: startTs, e: endTs, lbl: `win${5 - i}(${new Date(startTs).toISOString().slice(0, 10)})` });
  }

  console.log(`\n═══════ LEVER-1 per-pair sweep: ${sym}  (archetype=${def.mk.name}, slip ${SLIP}%, GRID=${GRID}) ═══════`);
  console.log(`LIVE config: ${key(def.live)}\n`);

  // 1) LIVE config baseline: halves + rolling WF
  console.log('── LIVE config baseline ──');
  const liveRecent = await run(def, def.live, now - half * DAY, now, SLIP);
  const liveOlder = await run(def, def.live, now - 2 * half * DAY, now - half * DAY, SLIP);
  console.log('  ' + fmt('recent half', liveRecent));
  console.log('  ' + fmt('older half', liveOlder));
  const liveFull = await run(def, def.live, now - 2 * half * DAY, now, SLIP);
  console.log('  ' + fmt('FULL 362d', liveFull));
  const liveWins: WinRes[] = [];
  for (const w of rollStarts) { const r = await run(def, def.live, w.s, w.e, SLIP); liveWins.push(r); console.log('  ' + fmt(w.lbl, r)); }
  const liveMinWin = Math.min(...liveWins.map(x => x.sumR));
  const liveAllPos = liveWins.every(x => x.sumR > 0);
  console.log(`  LIVE rolling: minWinR=${liveMinWin.toFixed(2)} allPos=${liveAllPos} twoSidedFull=${twoSided(liveFull)} PF=${liveFull.pf.toFixed(2)} DD=${liveFull.maxDD.toFixed(1)}% sumR=${liveFull.sumR.toFixed(1)}\n`);

  // 2) Grid sweep — evaluate FULL window first (cheap filter), then rolling WF on survivors.
  const cfgs = gridConfigs(def);
  console.log(`── Grid sweep (${cfgs.length} configs) — phase 1: FULL 362d filter ──`);
  interface Cand { p: Partial<CgFadeParams>; full: WinRes; }
  const survivors: Cand[] = [];
  for (const p of cfgs) {
    const full = await run(def, p, now - 2 * half * DAY, now, SLIP);
    // Cheap filter: must beat live sumR, two-sided, PF >= live, DD <= live+0.5pp
    const pass = full.sumR > liveFull.sumR && twoSided(full) && full.pf >= liveFull.pf && full.maxDD <= liveFull.maxDD + 0.5;
    if (pass) survivors.push({ p, full });
  }
  console.log(`  ${survivors.length}/${cfgs.length} configs beat live on FULL (sumR↑, two-sided, PF≥live, DD≤live+0.5pp)\n`);

  // 3) Rolling WF on survivors — the real robustness gate.
  console.log('── Phase 2: rolling WF on FULL-survivors (must be positive ALL 4 windows) ──');
  interface Robust { p: Partial<CgFadeParams>; full: WinRes; wins: WinRes[]; minWin: number; }
  const robust: Robust[] = [];
  for (const c of survivors) {
    const wins: WinRes[] = [];
    for (const w of rollStarts) wins.push(await run(def, c.p, w.s, w.e, SLIP));
    const minWin = Math.min(...wins.map(x => x.sumR));
    const allPos = wins.every(x => x.sumR > 0);
    if (allPos) robust.push({ p: c.p, full: c.full, wins, minWin });
  }
  // Rank by minWin (robustness), then full sumR.
  robust.sort((a, b) => (b.minWin - a.minWin) || (b.full.sumR - a.full.sumR));
  console.log(`  ${robust.length} configs ROBUST (positive all 4 windows + FULL filter)\n`);

  const topN = Math.min(robust.length, 5);
  for (let i = 0; i < topN; i++) {
    const r = robust[i];
    console.log(`  #${i + 1} ${key(r.p)}`);
    console.log('     ' + fmt('FULL 362d', r.full));
    for (let k = 0; k < r.wins.length; k++) console.log('     ' + fmt(rollStarts[k].lbl, r.wins[k]));
    console.log(`     minWinR=${r.minWin.toFixed(2)} ΔsumR=${(r.full.sumR - liveFull.sumR).toFixed(1)} ΔPF=${(r.full.pf - liveFull.pf).toFixed(2)} ΔDD=${(r.full.maxDD - liveFull.maxDD).toFixed(1)}pp ΔminWin=${(r.minWin - liveMinWin).toFixed(2)}`);
  }

  // 4) Compact verdict line for the parent agent.
  console.log('\n── VERDICT ──');
  if (robust.length === 0) {
    console.log(`  ${sym}: NO ROBUST HEADROOM. Live config is on/above the robust frontier. Keep live.`);
  } else {
    const best = robust[0];
    const dRetFull = best.full.ret - liveFull.ret;
    // FULL is 362d ≈ 1yr; ret is on $668k. Standalone pp/yr ≈ dRetFull * (365/362).
    const ppYr = dRetFull * 365 / 362;
    console.log(`  ${sym}: ${robust.length} robust alt(s). BEST=${key(best.p)}`);
    console.log(`  vs LIVE: ΔsumR=${(best.full.sumR - liveFull.sumR).toFixed(1)}R ΔPF=${(best.full.pf - liveFull.pf).toFixed(2)} ΔDD=${(best.full.maxDD - liveFull.maxDD).toFixed(1)}pp ΔminWinR=${(best.minWin - liveMinWin).toFixed(2)} | standalone Δret≈${dRetFull.toFixed(1)}pp (~${ppYr.toFixed(1)}pp/yr @r0.5%)`);
    console.log(`  NOTE: standalone lift must be re-confirmed IN-BOOK (correlation/cap/flatten) via portfolio verifier before it is real.`);
  }

  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

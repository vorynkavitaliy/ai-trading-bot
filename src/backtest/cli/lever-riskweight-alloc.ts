/**
 * lever-riskweight-alloc — LEVER 2: risk-weight / heat allocation across the live
 * 4-pair book (BTC ls_pos / SOL funding / ADA funding / LINK S4 confluence).
 *
 * Question: are the hand-set weights (BTC1.25 / SOL0.875 / ADA0.875 / LINK0.6,
 * heat 3.6% of the 3.75% cap) leaving robust return/MaxDD on the table? We:
 *   A) Standalone per-pair edge (single-pair engine, cap1, flatten OFF, slip 0.05):
 *      expectancy R/trade, annualized return @1% risk, return/MaxDD, both halves.
 *   B) Pairwise correlation of daily R-PnL (standalone streams → true asset corr).
 *   C) Portfolio engine (engine-portfolio.ts, flatten 4.3, slip 0.05, cap4) for
 *      several weight sets: (a) live, (b) edge-proportional, (c) inverse-corr tilt,
 *      (d/e) hand variants, (f) equalize. Full + old/recent halves. Δret/yr,
 *      ΔMaxDD, Hyro breaches. Robust only if it holds on BOTH halves.
 *
 * Heat (sum of weights) must stay <= 3.75; per-pair <= 1.5. NO scaledIn (live).
 *
 * Run: npx tsx src/backtest/cli/lever-riskweight-alloc.ts [days=340]
 */
import { runBacktest } from '../engine';
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const START_EQ = 200_000;
const SLIP = 0.05;
const FLAT = 4.3;
const PAIRS = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];
const LIVE_W: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: 0.6 };
const CAP_PER_PAIR = 1.5;
const HEAT_CAP = 3.75;

// Strategy factory at a given risk weight (EXACT live config per pair, single-entry).
function cfg(pair: string, risk: number): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'LINKUSDT': return fundingTaConfluence({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    default: throw new Error(`no cfg ${pair}`);
  }
}

const PORT_COMMON = {
  startEquity: START_EQ, slippagePct: SLIP, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10, cronRealistic: true,
  maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000, cooldownOnCommit: true,
  intradayDdGuardPct: undefined as number | undefined,
};

// ── Portfolio run with a given weight map ──
async function runPort(weights: Record<string, number>, startTs: number, endTs: number, flat: number | undefined) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = PAIRS.map((p, i) => ({ symbol: p, strategy: cfg(p, weights[p]), priority: i }));
  const r = await runPortfolioBacktest(strats, {
    ...PORT_COMMON, startTs, endTs, maxParallelCap: PAIRS.length, dailyDdFlattenPct: flat,
  });
  // Stats: R→$ via that pair's weight (matches engine sizing basis, single-entry).
  const riskOf = (s: string) => weights[s] ?? 0;
  return { S: stats(r.trades, riskOf), dd: r.dailyDd, trades: r.trades };
}

// ── Standalone single-pair run (clean asset edge, flatten OFF) ──
async function runSolo(pair: string, weight: number, startTs: number, endTs: number) {
  resetCgFadeCooldownState();
  const r = await runBacktest(cfg(pair, weight), {
    ...BACKTEST_COMMON, symbol: pair, startTs, endTs,
    startEquity: START_EQ, slippagePct: SLIP, riskPctBase: weight, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    maxParallelCap: 1, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
  } as any);
  return r;
}

function stats(t: ClosedTrade[], riskOf: (s: string) => number) {
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

// Edge in pure R-space (weight-invariant): sumR, expectancy R/trade, R-MaxDD, R/MaxDD.
function edgeR(t: ClosedTrade[]) {
  const sumR = t.reduce((s, x) => s + x.pnlR, 0);
  let cum = 0, peak = 0, ddR = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    cum += x.pnlR; if (cum > peak) peak = cum; const d = peak - cum; if (d > ddR) ddR = d;
  }
  return { n: t.length, sumR, expR: t.length ? sumR / t.length : 0, ddR, rOverDd: ddR > 0 ? sumR / ddR : (sumR > 0 ? 99 : 0) };
}

// Daily R-PnL series → Pearson correlation between two pairs.
function dailyR(t: ClosedTrade[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of t) {
    const day = new Date(x.exitTs).toISOString().slice(0, 10);
    m.set(day, (m.get(day) ?? 0) + x.pnlR);
  }
  return m;
}
function pearson(a: Map<string, number>, b: Map<string, number>): { r: number; nDays: number } {
  const days = new Set([...a.keys(), ...b.keys()]);
  const xs: number[] = [], ys: number[] = [];
  for (const d of days) { xs.push(a.get(d) ?? 0); ys.push(b.get(d) ?? 0); }
  const n = xs.length; if (n < 3) return { r: 0, nDays: n };
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  const den = Math.sqrt(vx * vy);
  return { r: den > 0 ? cov / den : 0, nDays: n };
}

const sgn = (x: number) => (x >= 0 ? '+' : '');
const annOf = (ret: number, days: number) => ret * 365 / days;

function portRow(label: string, res: { S: any; dd: any }, days: number, base?: { S: any }) {
  const ann = annOf(res.S.ret, days);
  const surv = res.dd.daysBreach5 === 0 && res.dd.balDaysBreach5 === 0;
  const dRet = base ? annOf(res.S.ret - base.S.ret, days) : 0;
  const dDD = base ? res.S.maxDD - base.S.maxDD : 0;
  return `  ${label.padEnd(26)} ${(sgn(res.S.ret) + res.S.ret.toFixed(1) + '%').padStart(7)} (${sgn(ann) + ann.toFixed(0)}%/г) · PF ${res.S.pf.toFixed(2)} · MaxDD ${res.S.maxDD.toFixed(1).padStart(4)}% · Hyro ${res.dd.daysBreach5}/${res.dd.balDaysBreach5} ${surv ? '✅' : '❌'} · n=${res.S.n}` +
    (base ? `  | Δ ${sgn(dRet) + dRet.toFixed(0)}pp/г ΔDD ${sgn(dDD) + dDD.toFixed(1)}pp` : '');
}

const heatOf = (w: Record<string, number>) => PAIRS.reduce((s, p) => s + w[p], 0);
const validW = (w: Record<string, number>) => heatOf(w) <= HEAT_CAP + 1e-9 && PAIRS.every(p => w[p] <= CAP_PER_PAIR + 1e-9);

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  // PHASE=AB → only standalone+corr+weight-sets (fast). PHASE=PORT_<win> → only the
  // portfolio compare for one window (full|old|new). default = everything.
  const PHASE = process.env.PHASE ?? 'ALL';
  const now = Date.now(), D = days * 24 * 3600_000, half = Math.round(days / 2);
  const winFull: [string, number, number, number] = ['ГОД', now - D, now, days];
  const winOld: [string, number, number, number] = ['СТАРАЯ', now - D, now - D / 2, half];
  const winNew: [string, number, number, number] = ['СВЕЖАЯ', now - D / 2, now, half];

  console.log(`\n████ LEVER 2 — РИСК-ВЕС / HEAT-АЛЛОКАЦИЯ (BTC/SOL/ADA/LINK, single-entry) ████`);
  console.log(`live веса ${JSON.stringify(LIVE_W)} heat=${heatOf(LIVE_W).toFixed(2)}% (cap ${HEAT_CAP}%) · slip ${SLIP}% · flatten ${FLAT}%  [PHASE=${PHASE}]`);

  // ── A) STANDALONE PER-PAIR EDGE (R-space, weight-invariant) on full + halves ──
  console.log(`\n── A) STANDALONE EDGE (single-pair cap1, flatten OFF, slip ${SLIP}) — R-space ──`);
  console.log(`  pair       | FULL n / expR / sumR / R÷DD | OLD expR/sumR | NEW expR/sumR`);
  const soloFull: Record<string, ClosedTrade[]> = {};
  const edgeFull: Record<string, ReturnType<typeof edgeR>> = {};
  for (const p of PAIRS) {
    const [f, o, n2] = [winFull, winOld, winNew];
    const rf = await runSolo(p, 1.0, f[1], f[2]);   // weight 1.0 → R unaffected anyway
    const ro = await runSolo(p, 1.0, o[1], o[2]);
    const rn = await runSolo(p, 1.0, n2[1], n2[2]);
    soloFull[p] = rf.trades;
    const ef = edgeR(rf.trades), eo = edgeR(ro.trades), en = edgeR(rn.trades);
    edgeFull[p] = ef;
    const annAt1 = (sumR: number, dd: number, dys: number) => annOf(sumR * 1.0, dys); // ret% @1% = sumR*1; ann
    console.log(`  ${p.padEnd(9)} | n=${String(ef.n).padStart(3)} expR ${sgn(ef.expR) + ef.expR.toFixed(3)} sumR ${sgn(ef.sumR) + ef.sumR.toFixed(1).padStart(5)} R÷DD ${ef.rOverDd.toFixed(2).padStart(5)} | ${sgn(eo.expR) + eo.expR.toFixed(3)} / ${sgn(eo.sumR) + eo.sumR.toFixed(1)} | ${sgn(en.expR) + en.expR.toFixed(3)} / ${sgn(en.sumR) + en.sumR.toFixed(1)}`);
  }
  // Annualized return @1% risk (full): ret% = sumR (since 1% × R = % of equity per R unit ≈ sumR for small).
  console.log(`  (@1% risk, FULL: годовой доход ≈ sumR×365/${days} %/г, Sharpe-прокси = sumR÷R-MaxDD)`);
  for (const p of PAIRS) {
    const e = edgeFull[p];
    console.log(`    ${p.padEnd(9)} ≈ ${sgn(annOf(e.sumR, days)) + annOf(e.sumR, days).toFixed(1)}%/г @1% · R÷DD ${e.rOverDd.toFixed(2)}`);
  }

  // ── B) PAIRWISE CORRELATION of daily R-PnL (standalone streams) ──
  console.log(`\n── B) КОРРЕЛЯЦИЯ дневного R-PnL (standalone, FULL ${days}d) ──`);
  const dr: Record<string, Map<string, number>> = {};
  for (const p of PAIRS) dr[p] = dailyR(soloFull[p]);
  process.stdout.write('             ' + PAIRS.map(p => p.replace('USDT', '').padStart(6)).join(' ') + '\n');
  const corrToBtc: Record<string, number> = {};
  for (const a of PAIRS) {
    const cells: string[] = [];
    for (const b of PAIRS) {
      const { r } = pearson(dr[a], dr[b]);
      if (b === 'BTCUSDT') corrToBtc[a] = r;
      cells.push((a === b ? '1.00' : (sgn(r) + r.toFixed(2))).padStart(6));
    }
    process.stdout.write('  ' + a.replace('USDT', '').padEnd(9) + cells.join(' ') + '\n');
  }

  // ── C) Build candidate weight sets ──
  // (a) live
  // (b) edge-proportional: weight ∝ max(0, sumR_full), normalized so heat fills toward cap, clamped 1.5
  // (c) inverse-corr tilt: down-weight most-BTC-correlated; tilt off live by (1 - corrToBtc)
  // (d) hand1: BTC1.25/SOL1.0/ADA0.6/LINK0.6
  // (e) hand2: BTC1.5/SOL1.0/ADA0.625/LINK0.625 (heat 3.75 exactly, BTC-heavy)
  // (f) equalize: all 0.9 (heat 3.6, same heat as live)
  const clampW = (w: Record<string, number>) => {
    const o: Record<string, number> = {};
    for (const p of PAIRS) o[p] = Math.min(CAP_PER_PAIR, Math.max(0, w[p]));
    return o;
  };
  const liveHeat = heatOf(LIVE_W);

  // (b) edge-proportional — scale sumR (floored at 0.1 to avoid zeroing a pair) to fill liveHeat budget.
  const rawEdge: Record<string, number> = {};
  for (const p of PAIRS) rawEdge[p] = Math.max(0.1, edgeFull[p].sumR);
  const edgeSum = PAIRS.reduce((s, p) => s + rawEdge[p], 0);
  const edgeProp = clampW(Object.fromEntries(PAIRS.map(p => [p, rawEdge[p] / edgeSum * liveHeat])));
  // renormalize after clamp to keep heat == liveHeat where possible
  const epHeat = heatOf(edgeProp);
  if (epHeat < liveHeat - 1e-6) { const k = liveHeat / epHeat; for (const p of PAIRS) edgeProp[p] = Math.min(CAP_PER_PAIR, edgeProp[p] * k); }

  // (c) inverse-corr tilt off live: factor (1 - corrToBtc[p]) (BTC keeps its own), renorm to liveHeat.
  const invRaw: Record<string, number> = {};
  for (const p of PAIRS) invRaw[p] = LIVE_W[p] * (p === 'BTCUSDT' ? 1 : (1 - Math.max(0, corrToBtc[p])));
  const invSum = heatOf(invRaw);
  const invCorr = clampW(Object.fromEntries(PAIRS.map(p => [p, invRaw[p] / invSum * liveHeat])));

  const sets: Array<{ key: string; label: string; w: Record<string, number> }> = [
    { key: 'a', label: '(a) live', w: { ...LIVE_W } },
    { key: 'b', label: '(b) edge-proportional', w: edgeProp },
    { key: 'c', label: '(c) inverse-corr tilt', w: invCorr },
    { key: 'd', label: '(d) hand BTC1.25/SOL1.0/ADA0.6/LINK0.6', w: clampW({ BTCUSDT: 1.25, SOLUSDT: 1.0, ADAUSDT: 0.6, LINKUSDT: 0.6 }) },
    { key: 'e', label: '(e) hand BTC1.5/SOL1.0/ADA0.625/LINK0.625', w: clampW({ BTCUSDT: 1.5, SOLUSDT: 1.0, ADAUSDT: 0.625, LINKUSDT: 0.625 }) },
    { key: 'f', label: '(f) equalize 0.9 each', w: clampW({ BTCUSDT: 0.9, SOLUSDT: 0.9, ADAUSDT: 0.9, LINKUSDT: 0.9 }) },
  ];

  console.log(`\n── C) ВЕСОВЫЕ НАБОРЫ (heat / по-парно) ──`);
  for (const s of sets) {
    console.log(`  ${s.key}) ${PAIRS.map(p => p.replace('USDT', '') + ' ' + s.w[p].toFixed(3)).join(' / ')}  heat=${heatOf(s.w).toFixed(2)}% ${validW(s.w) ? '✅' : '❌НАРУШ.ОГРАН'}`);
  }

  // ── D) PORTFOLIO comparison (flatten ON, slip 0.05) — gated by PHASE/window ──
  if (PHASE === 'AB') { await closePg(); return; }
  const wins: [string, number, number, number][] = [];
  if (PHASE === 'ALL' || PHASE === 'PORT_FULL') wins.push(winFull);
  if (PHASE === 'ALL' || PHASE === 'PORT_OLD') wins.push(winOld);
  if (PHASE === 'ALL' || PHASE === 'PORT_NEW') wins.push(winNew);
  // ONLY env: comma-list of candidate keys to run vs the always-run live base (a).
  // e.g. ONLY=c,d → runs base + c + d. Lets me batch the slow flatten-grid runs.
  const only = (process.env.ONLY ?? '').split(',').map(s => s.trim()).filter(Boolean);
  console.log(`\n── D) ПОРТФЕЛЬ (flatten ${FLAT}% · slip ${SLIP}% · cap4)${only.length ? ` ONLY=${only.join(',')}` : ''} ──`);
  for (const [lbl, s, e, d] of wins) {
    console.log(`  [${lbl} ${d}d]`);
    const base = await runPort(LIVE_W, s, e, FLAT);
    console.log(portRow('a) live (база)', base, d));
    for (const set of sets.slice(1)) {
      if (only.length && !only.includes(set.key)) continue;
      if (!validW(set.w)) { console.log(`  ${set.label.padEnd(26)} ПРОПУСК (нарушает ограничения)`); continue; }
      const res = await runPort(set.w, s, e, FLAT);
      console.log(portRow(set.label, res, d, base));
    }
  }

  console.log(`\n── ИТОГ: робастность = улучшение И на СТАРОЙ И на СВЕЖОЙ половине, 0 Hyro, ΔDD ≤ +1pp ──`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

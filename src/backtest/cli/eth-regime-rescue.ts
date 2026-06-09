/**
 * eth-regime-rescue — ANGLE 4: does giving ETH's fade reversion more room
 * (WIDER stop 2.0-3.0 ATR + LONGER hold 18-36 bars) and/or conditioning on the
 * BTC 4H regime (RANGING vs TRENDING) turn ETH's flip-y CG fade into a stable
 * BOTH-HALVES, TWO-SIDED edge — the way the wider-stop/longer-hold rescue worked
 * on BTC?
 *
 * Tests fundingFade (S3) and lsTopPositionFade (S1/S2) archetypes on ETHUSDT,
 * single-entry (NO DCA — known killer on low-vol majors), slip 0.05 (ETH is a
 * liquid major; 0.25 stress only on the headline winner), cron-realistic, $668k.
 *
 * Halves: IS = older 183d (SKIP 183), OOS = recent 183d (SKIP 0). CG binds the
 * window to ~378d → ~6mo halves. We report BOTH halves AND per-side (long/short)
 * sumR so we can apply the robustness discriminator: a real edge is two-sided AND
 * both-halves positive with the SAME config.
 *
 * Run (background, ~30-45min): npx tsx src/backtest/cli/eth-regime-rescue.ts
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade } from '../../strategies/cg-fade';
import { Strategy, StrategyContext, Action, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';
import { ema } from '../../core/indicators';

const PAIR = 'ETHUSDT';
const SLIP = parseFloat(process.env.SLIP ?? '0.05'); // ETH liquid major; 0.25 = stress test
const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 668_000,
  slippagePct: SLIP,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  cronRealistic: true,
};

// ─── Regime-conditional wrapper ───────────────────────────────────────────────
// Wraps a base CG-fade strategy. Classifies the BTC 4H regime via |EMA20-EMA50|/
// EMA50 separation: < band → RANGING, ≥ band → TRENDING. Only delegates to the
// inner strategy when the current regime matches `want`. Forces needsBtcContext so
// the engine loads BTC bars and populates ctx.btcBars4hRecent.
type Regime = 'ranging' | 'trending';
class BtcRegimeGate implements Strategy {
  readonly name: string;
  readonly needsCoinglass = true;
  readonly needsBtcContext = true;
  constructor(
    private readonly inner: Strategy,
    private readonly want: Regime,
    private readonly band: number, // e.g. 0.01 = 1% EMA separation boundary
  ) {
    this.name = `btc-${want}-gate(band${band})[${inner.name}]`;
  }
  private btcRegime(ctx: StrategyContext): Regime | null {
    const bars = ctx.btcBars4hRecent ?? [];
    if (bars.length < 55) return null;
    const closes = bars.map((b) => b.close);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    if (e20 == null || e50 == null || e50 === 0) return null;
    const sep = Math.abs(e20 - e50) / e50;
    return sep < this.band ? 'ranging' : 'trending';
  }
  decide(ctx: StrategyContext): Action {
    if (ctx.position) return this.inner.decide(ctx); // let inner manage exits/holds
    const reg = this.btcRegime(ctx);
    if (reg == null) return { kind: 'hold' };
    if (reg !== this.want) return { kind: 'hold' };
    return this.inner.decide(ctx);
  }
}

interface V { label: string; strat: Strategy }

// Base archetypes. lsTopPositionFade thresholds .85/.15; fundingFade keeps its
// .75/.25 defaults but we override trend filters explicitly per variant.
function lsPos(o: any): Strategy {
  return lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, riskPct: 0.5, ...o });
}
function fund(o: any): Strategy {
  return fundingFade({ riskPct: 0.5, ...o });
}

const VARIANTS: V[] = [
  // ── Reference: live-ish tight stop / short hold (the "flip-y" baseline) ──
  { label: 'B1 lsPos sl1.5 tp2.0 h12 btcTr', strat: lsPos({ usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12 }) },
  { label: 'B2 fund  sl1.5 tp2.0 h12 both ', strat: fund({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12 }) },

  // ── WIDER STOP + LONGER HOLD grid on lsPos (BTC trend filter) ──
  { label: 'W1 lsPos sl2.0 tp2.5 h18 btcTr', strat: lsPos({ usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.5, maxHoldBars: 18 }) },
  { label: 'W2 lsPos sl2.5 tp2.5 h24 btcTr', strat: lsPos({ usePairTrend: false, useBtcTrend: true, slAtrMult: 2.5, tpAtrMult: 2.5, maxHoldBars: 24 }) },
  { label: 'W3 lsPos sl2.5 tp3.0 h24 btcTr', strat: lsPos({ usePairTrend: false, useBtcTrend: true, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }) },
  { label: 'W4 lsPos sl3.0 tp3.0 h36 btcTr', strat: lsPos({ usePairTrend: false, useBtcTrend: true, slAtrMult: 3.0, tpAtrMult: 3.0, maxHoldBars: 36 }) },
  // WIDER/LONGER with NO trend filter (more trades, raw signal room)
  { label: 'W5 lsPos sl2.5 tp3.0 h24 noTr ', strat: lsPos({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }) },
  // WIDER/LONGER pairTrend
  { label: 'W6 lsPos sl2.5 tp3.0 h24 pairTr', strat: lsPos({ usePairTrend: true, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }) },

  // ── WIDER STOP + LONGER HOLD on fundingFade ──
  { label: 'F1 fund  sl2.0 tp2.5 h18 both ', strat: fund({ slAtrMult: 2.0, tpAtrMult: 2.5, maxHoldBars: 18 }) },
  { label: 'F2 fund  sl2.5 tp2.5 h24 both ', strat: fund({ slAtrMult: 2.5, tpAtrMult: 2.5, maxHoldBars: 24 }) },
  { label: 'F3 fund  sl2.5 tp3.0 h24 both ', strat: fund({ slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }) },
  { label: 'F4 fund  sl3.0 tp3.0 h36 both ', strat: fund({ slAtrMult: 3.0, tpAtrMult: 3.0, maxHoldBars: 36 }) },
  { label: 'F5 fund  sl2.5 tp3.0 h24 noTr ', strat: fund({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }) },

  // ── REGIME-CONDITIONAL: best wider/longer fade only in BTC RANGING ──
  { label: 'R-rng lsPos W3 BTC=RANGING b.01', strat: new BtcRegimeGate(lsPos({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'ranging', 0.01) },
  { label: 'R-rng lsPos W3 BTC=RANGING b.02', strat: new BtcRegimeGate(lsPos({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'ranging', 0.02) },
  { label: 'R-trd lsPos W3 BTC=TRENDING b.01', strat: new BtcRegimeGate(lsPos({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'trending', 0.01) },
  { label: 'R-trd lsPos W3 BTC=TRENDING b.02', strat: new BtcRegimeGate(lsPos({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'trending', 0.02) },
  { label: 'R-rng fund  F3 BTC=RANGING b.01', strat: new BtcRegimeGate(fund({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'ranging', 0.01) },
  { label: 'R-rng fund  F3 BTC=RANGING b.02', strat: new BtcRegimeGate(fund({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'ranging', 0.02) },
  { label: 'R-trd fund  F3 BTC=TRENDING b.01', strat: new BtcRegimeGate(fund({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'trending', 0.01) },
  { label: 'R-trd fund  F3 BTC=TRENDING b.02', strat: new BtcRegimeGate(fund({ usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 24 }), 'trending', 0.02) },
];

function sideSplit(trades: ClosedTrade[]) {
  const longs = trades.filter((t) => t.side === 'long');
  const shorts = trades.filter((t) => t.side === 'short');
  const sumR = (ts: ClosedTrade[]) => ts.reduce((a, t) => a + t.pnlR, 0);
  return { longN: longs.length, longR: sumR(longs), shortN: shorts.length, shortR: sumR(shorts) };
}

async function runHalf(strat: Strategy, skipDays: number) {
  const endTs = Date.now() - skipDays * 24 * 3600_000;
  const startTs = endTs - 183 * 24 * 3600_000;
  const r = await runBacktest(strat, { symbol: PAIR, startTs, endTs, ...COMMON });
  const m = r.metrics;
  const ss = sideSplit(r.trades);
  return { n: m.trades, wr: m.winRate * 100, pf: m.profitFactor, sumR: m.totalR, maxDD: m.maxDDPct, ret: m.netPnlPct, ...ss };
}

async function main() {
  console.log(`\n══ ETH ANGLE-4: WIDER STOP + LONGER HOLD + BTC-REGIME — single entry, HONEST, slip ${SLIP}%, IS(older)/OOS(recent) 183d ══\n`);
  console.log('variant                          │ OOS:  n  WR    PF   sumR  ret%  DD%  (L/S R) │ IS:   n  WR    PF   sumR  ret%  DD%  (L/S R) │ verdict');
  console.log('─'.repeat(168));

  const rows: Array<{ label: string; oos: any; is: any; combined: number; bothPos: boolean; twoSided: boolean }> = [];
  for (const v of VARIANTS) {
    const oos = await runHalf(v.strat, 0);
    const is = await runHalf(v.strat, 183);
    const bothPos = oos.sumR > 0 && is.sumR > 0;
    // two-sided where measurable: both halves have both long AND short non-negative
    // (require >=2 trades on a side to count it; ignore an absent side).
    const sideOk = (h: any) =>
      (h.longN < 2 || h.longR > 0) && (h.shortN < 2 || h.shortR > 0);
    const twoSided = sideOk(oos) && sideOk(is) &&
      (oos.longN >= 2 || is.longN >= 2) && (oos.shortN >= 2 || is.shortN >= 2);
    const combined = oos.sumR + is.sumR;
    rows.push({ label: v.label, oos, is, combined, bothPos, twoSided });
    const fmt = (m: any) =>
      `${String(m.n).padStart(3)} ${m.wr.toFixed(0).padStart(3)}% ${m.pf.toFixed(2).padStart(5)} ${m.sumR.toFixed(1).padStart(6)} ${m.ret.toFixed(1).padStart(5)} ${m.maxDD.toFixed(1).padStart(4)}  (${m.longR.toFixed(1)}/${m.shortR.toFixed(1)})`;
    const verdict = !bothPos
      ? (oos.sumR > 0 ? 'OOS+ only' : is.sumR > 0 ? 'IS+ only' : '✗ both−')
      : (oos.pf >= 1.4 && is.pf >= 1.4 ? (twoSided ? '✓✓ both PF≥1.4 2sided' : '✓✓ PF≥1.4 1sided') : (twoSided ? '✓ both+ 2sided' : '✓ both+ 1sided'));
    console.log(`${v.label.padEnd(32)} │ ${fmt(oos)} │ ${fmt(is)} │ ${verdict}`);
  }

  console.log('\n=== RANKED (both-halves-positive only, by combined sumR) ===');
  const ranked = rows.filter((r) => r.bothPos).sort((a, b) => b.combined - a.combined);
  if (ranked.length === 0) console.log('  (NONE — no variant is positive in both halves)');
  for (const r of ranked) {
    console.log(`  ${r.label.trim().padEnd(34)} combined ${r.combined.toFixed(1).padStart(6)}R | OOS ${r.oos.sumR.toFixed(1)}/PF${r.oos.pf.toFixed(2)} IS ${r.is.sumR.toFixed(1)}/PF${r.is.pf.toFixed(2)} | maxDD ${Math.max(r.oos.maxDD, r.is.maxDD).toFixed(1)}% | 2sided=${r.twoSided}`);
  }
  const failed = rows.filter((r) => !r.bothPos).map((r) => r.label.trim().split(' ')[0]);
  if (failed.length) console.log(`\n  (failed both-halves: ${failed.join(', ')})`);

  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

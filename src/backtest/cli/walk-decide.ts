// Apply discretionary classifier (my rules from 7-day walk analysis) to a
// candidate list, then simulate portfolio with cap-4 + per-pair uniqueness +
// compounding equity. Outputs comparison: algo-only vs my-curated.

import fs from 'node:fs';
import { log } from '../../core/logger';

const RISK_FULL_PCT = 0.375;        // matches strategy / CLAUDE.md
const RISK_DOWNSIZED_PCT = 0.25;
const MAX_PARALLEL = 4;
const START_EQUITY = 50_000;

interface CandidateOut {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryTs: number;
  entryIso: string;
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  enrichment: {
    mtf: Array<{ tf: string; rsi: number | null; adx: number | null; ema_stack: 'bull' | 'bear' | null; bb_pos: number | null; vol_spike: number | null; atr_pct: number | null }>;
    structural: { poc: number | null; val: number | null; vah: number | null; pwl: number | null; pwh: number | null };
    coinglass: { funding_oi_weighted: number | null; ls_top_position: number | null; taker_delta_24h_usd: number | null; liq_long_24h_usd: number | null; liq_short_24h_usd: number | null } | null;
    setupQuality: { rrTp1: number; rrTp2: number; stopPct: number };
    btcContext: { ema_stack_4h: 'bull' | 'bear' | null; rsi1h: number | null; distancePctToPWL: number | null; distancePctToPWH: number | null } | null;
    notes: string[];
  };
  outcome: { pnlR: number; exitReason: string; exitPrice: number; exitTs: number; durationMin: number };
}

type Decision = 'TAKE' | 'DOWNSIZE' | 'SKIP';

interface ClassResult {
  decision: Decision;
  reasons: string[];
}

// Refined classifier — based on 180-day walk analysis of 23 losers vs 262 winners.
// Strict patterns ONLY: m15m RSI extension (Pattern A), counter-BTC short (Pattern B),
// catastrophic rrTp2 < 0.20 (Pattern C). Old loose rules removed because they killed
// winning counter-trend reversion trades (the strategy's bread and butter).
function classify(c: CandidateOut): ClassResult {
  const e = c.enrichment;
  const isLong = c.side === 'long';
  const m5m = e.mtf[0];
  const m15m = e.mtf[1];
  const btc = e.btcContext;
  const skipReasons: string[] = [];
  const cautionReasons: string[] = [];

  // -------- Pattern C: catastrophic R:R --------
  // Below 0.20 → small wins barely cover SL when fail. Not below 0.30 — many algo
  // winners are 0.30–0.50 partial-close trades (TP1 banks, BE-stop saves tail).
  if (e.setupQuality.rrTp2 < 0.20) {
    skipReasons.push(`rrTp2 ${e.setupQuality.rrTp2.toFixed(2)} catastrophic`);
  }

  // -------- Pattern A-revised: ONLY long extension (short extension proved profitable on 365d) --------
  // For long entry, m15m > 68 + 5m > 60 = entering at end of run. This was the
  // only Pattern A variant with consistent negative-edge correlation (caught 4 of 14
  // big losers, including XRP −1.05/−1.06/−1.03 hat-trick). Short extension
  // (m15m<32) turned out PROFITABLE on aggregate (+5.01R / 84% WR / 19 trades),
  // so we leave shorts alone.
  if (isLong && m15m?.rsi != null && m15m.rsi > 68 && m5m?.rsi != null && m5m.rsi > 60) {
    skipReasons.push(`15m RSI ${m15m.rsi.toFixed(0)} + 5m ${m5m.rsi.toFixed(0)} — long entry on exhausted up-move`);
  }

  // -------- Pattern B REMOVED: counter-BTC short turned out HIGHLY PROFITABLE --------
  // 365-day analysis: 100 such trades, +27.58R total, 87% WR, +0.28R avg.
  // This is the strategy's CORE edge — alt shorts during BTC rallies catch overheating
  // alts that revert to value area. Filtering this killed +$5,500 of returns.
  // Lesson: don't filter mean-reversion strategy by trend-following BTC heuristics.

  if (skipReasons.length > 0) return { decision: 'SKIP', reasons: skipReasons };

  // -------- DOWNSIZE: only thin R:R 0.20-0.30 --------
  // Counter-BTC long DOWNSIZE also removed — same reasoning, mean-reversion edge.
  if (e.setupQuality.rrTp2 < 0.30) cautionReasons.push(`thin rrTp2 ${e.setupQuality.rrTp2.toFixed(2)}`);

  if (cautionReasons.length >= 1) return { decision: 'DOWNSIZE', reasons: cautionReasons };

  return { decision: 'TAKE', reasons: ['confluence clean'] };
}

// Simulate a portfolio: chronological order, cap-4 + per-pair uniqueness, compound equity.
interface PortResult {
  trades: Array<{ c: CandidateOut; takenRiskPct: number; pnlUsd: number; equityAfter: number; decisionLabel: string }>;
  skipped: Array<{ c: CandidateOut; reason: string }>;
  metrics: {
    countTaken: number;
    countWin: number;
    wr: number;
    totalRWeighted: number;        // R-multiples × risk-pct (USD/equity-pct contribution)
    netPnlUsd: number;
    netPnlPct: number;
    finalEquity: number;
    maxDDPct: number;
  };
}

function simulate(cands: CandidateOut[], pickRisk: (c: CandidateOut) => number | null, label: string): PortResult {
  // pickRisk returns risk pct (e.g. 0.375) if take, null if skip
  const taken: PortResult['trades'] = [];
  const skipped: PortResult['skipped'] = [];
  type Open = { c: CandidateOut; risk: number; entryEquity: number };
  const openByExit: Open[] = [];

  // We simulate by event stream of (entry, exit) pairs. For chronological correctness:
  // walk candidates ordered by entryTs; at each entry, drop closed (exitTs ≤ entryTs); cap-4 + per-pair check.
  let equity = START_EQUITY;
  let peak = equity;
  let maxDDPct = 0;
  // Realized exits chronologically — apply pnl when each exit time arrives.
  // Simpler: process taken trades in entry order; at each new entry, "settle" any
  // already-taken position whose exitTs < this entry's entryTs to update equity.
  function settleClosedBefore(ts: number) {
    for (let i = openByExit.length - 1; i >= 0; i--) {
      const o = openByExit[i];
      if (o.c.outcome.exitTs <= ts) {
        const pnl = o.c.outcome.pnlR * (o.risk / 100) * o.entryEquity;
        equity += pnl;
        if (equity > peak) peak = equity;
        const dd = (peak - equity) / peak * 100;
        if (dd > maxDDPct) maxDDPct = dd;
        // Find this trade in `taken` and update equity-after
        const t = taken.find((x) => x.c.id === o.c.id);
        if (t) { t.pnlUsd = pnl; t.equityAfter = equity; }
        openByExit.splice(i, 1);
      }
    }
  }

  for (const c of cands.slice().sort((a, b) => a.entryTs - b.entryTs)) {
    settleClosedBefore(c.entryTs);

    const risk = pickRisk(c);
    if (risk == null) {
      skipped.push({ c, reason: 'classifier-skip' });
      continue;
    }
    if (openByExit.some((o) => o.c.symbol === c.symbol)) {
      skipped.push({ c, reason: 'pair already open' });
      continue;
    }
    if (openByExit.length >= MAX_PARALLEL) {
      skipped.push({ c, reason: 'cap-4 reached' });
      continue;
    }

    openByExit.push({ c, risk, entryEquity: equity });
    taken.push({ c, takenRiskPct: risk, pnlUsd: 0, equityAfter: equity, decisionLabel: label });
  }
  // Settle remaining
  const lastTs = cands.reduce((m, c) => Math.max(m, c.outcome.exitTs), 0);
  settleClosedBefore(lastTs + 1);

  const wins = taken.filter((t) => t.c.outcome.pnlR > 0).length;
  const totalRWeighted = taken.reduce((s, t) => s + t.c.outcome.pnlR * t.takenRiskPct / RISK_FULL_PCT, 0);
  return {
    trades: taken,
    skipped,
    metrics: {
      countTaken: taken.length,
      countWin: wins,
      wr: taken.length > 0 ? (wins / taken.length) * 100 : 0,
      totalRWeighted,
      netPnlUsd: equity - START_EQUITY,
      netPnlPct: ((equity - START_EQUITY) / START_EQUITY) * 100,
      finalEquity: equity,
      maxDDPct,
    },
  };
}

async function main() {
  const inputPath = process.argv[2] ?? '/tmp/walk-30d-candidates.json';
  const file = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const candidates: CandidateOut[] = file.candidates;
  const days = file.window?.days ?? 30;

  console.log(`\n${'='.repeat(64)}`);
  console.log(`WALK-${days}D PORTFOLIO COMPARISON  •  $${START_EQUITY} start  •  cap-${MAX_PARALLEL}`);
  console.log(`window: ${new Date(file.window.startTs).toISOString().slice(0,10)} → ${new Date(file.window.endTs).toISOString().slice(0,10)}`);
  console.log('='.repeat(64));

  // Apply classifier
  const classified = candidates.map((c) => ({ c, cls: classify(c) }));
  const counts = { TAKE: 0, DOWNSIZE: 0, SKIP: 0 };
  for (const x of classified) counts[x.cls.decision]++;
  console.log(`\nClassifier: TAKE ${counts.TAKE}  DOWNSIZE ${counts.DOWNSIZE}  SKIP ${counts.SKIP}  (of ${classified.length})`);

  // Simulate algo-only (full risk, all candidates)
  const algoOnly = simulate(candidates, () => RISK_FULL_PCT, 'ALGO');

  // Simulate my-curated
  const classMap = new Map(classified.map((x) => [x.c.id, x.cls]));
  const myCurated = simulate(candidates, (c) => {
    const cls = classMap.get(c.id)!;
    if (cls.decision === 'SKIP') return null;
    return cls.decision === 'DOWNSIZE' ? RISK_DOWNSIZED_PCT : RISK_FULL_PCT;
  }, 'CURATED');

  // ---- Output ----
  function printMetrics(label: string, m: PortResult['metrics']) {
    console.log(`\n${label}:`);
    console.log(`  trades:      ${m.countTaken} (${m.countWin}W / ${m.countTaken - m.countWin}L)`);
    console.log(`  WR:          ${m.wr.toFixed(1)}%`);
    console.log(`  Net P&L:     $${m.netPnlUsd.toFixed(2)} (${m.netPnlPct.toFixed(2)}%)`);
    console.log(`  Final eq:    $${m.finalEquity.toFixed(2)}`);
    console.log(`  Max DD:      ${m.maxDDPct.toFixed(2)}%`);
  }
  printMetrics('ALGO-ONLY (all signals, full risk)', algoOnly.metrics);
  printMetrics('MY CURATED (classifier + cap-4)', myCurated.metrics);

  console.log('\n' + '─'.repeat(64));
  console.log('PER-TRADE LEDGER (curated):');
  console.log('─'.repeat(64));
  console.log('  date         pair        side   class    risk%  R-mult  $P&L      $equity');
  for (const t of myCurated.trades.sort((a, b) => a.c.entryTs - b.c.entryTs)) {
    const dt = new Date(t.c.entryTs).toISOString().slice(5, 16).replace('T', ' ');
    const p = t.c.symbol.padEnd(10);
    const s = t.c.side.toUpperCase().padEnd(5);
    const cls = (classMap.get(t.c.id)?.decision ?? 'TAKE').padEnd(8);
    const r = t.takenRiskPct.toFixed(3);
    const rm = t.c.outcome.pnlR.toFixed(2).padStart(6);
    const pnl = t.pnlUsd >= 0 ? `+$${t.pnlUsd.toFixed(0).padStart(6)}` : `-$${Math.abs(t.pnlUsd).toFixed(0).padStart(6)}`;
    const eq = `$${t.equityAfter.toFixed(0)}`;
    console.log(`  ${dt}  ${p}  ${s}  ${cls} ${r}  ${rm}  ${pnl.padEnd(9)}  ${eq}`);
  }

  // Show what I skipped to highlight value
  console.log('\n' + '─'.repeat(64));
  console.log('SKIPPED BY MY CLASSIFIER (with what would have happened):');
  console.log('─'.repeat(64));
  const skipsByClassifier = classified.filter((x) => x.cls.decision === 'SKIP');
  let avoidedR = 0;
  for (const x of skipsByClassifier) {
    const c = x.c;
    avoidedR += c.outcome.pnlR;
    const dt = new Date(c.entryTs).toISOString().slice(5, 16).replace('T', ' ');
    const r = c.outcome.pnlR.toFixed(2).padStart(6);
    console.log(`  ${dt}  ${c.symbol.padEnd(10)} ${c.side.toUpperCase().padEnd(5)} ${r}R  ← ${x.cls.reasons[0]}`);
  }
  console.log(`\n  Avoided cumulative: ${avoidedR.toFixed(2)}R (${avoidedR >= 0 ? 'lost' : 'saved'} by skipping)`);
}

main().catch((e) => {
  log.error('walk-decide failed', { err: e?.message ?? String(e), stack: e?.stack });
  process.exit(1);
});

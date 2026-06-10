import { query } from '../core/db';
import { loadAccounts } from '../core/accounts';
import { getRest, ping } from '../core/bybit';
import { getDayPnl } from '../core/pnl';
import { log } from '../core/logger';
import { tradeRepo } from '../data/trade-repo';
import { Position } from '../core/position';
import { tier1Pairs } from './pair-strategies';

/**
 * Risk constants — must match CLAUDE.md § Risk budget v5.
 *
 * Object.freeze prevents accidental mutation. Was a plain `const RISK = {...}`
 * whose fields were technically writable; anything in the process could have
 * silently changed `RISK.minRrTp2`. Freezing locks the contract.
 */
export const RISK = Object.freeze({
  riskPctBase: 0.375,                       // 3.75% heat cap / 10 parallel = 0.375%
  riskPctCap: 1.5,                          // 2026-06-03: raised 0.6→1.5 for the 3-pair standalone portfolio (BTC 1.25%/trade, SOL/ADA 0.875%). Backstop vs runaway sizing. Full-deploy heat = 1.25+0.875+0.875 = 3.0% < 3.75% cap.
  maxParallelPositions: 4,                  // 2026-06-04: 4-pair book (BTC+SOL+ADA+LINK, single entry) → cap-4 = one position per pair. Heat 1.25+0.875+0.875+0.6=3.6% < 3.75% cap. Was cap-3 (3-pair BTC+SOL+ADA), cap-6 (8-pair v5, archived).
  maxSameSideConcentration: 0,              // L5 macro-corr overlay — DISABLED 2026-06-06 after direct verification REFUTED its justification. The claim "removes the 2026-05-21 Hyro gap-day breach" is FALSE on the honest recent-170d (fresh-$200k) window: base AND blk3 both breach 1/1 (raw DD −8.13% vs −7.74% — a price gap flatten can't catch either way). blk3 also UNDERPERFORMS base on BOTH halves (OLD −6.2pp, recent −9.6pp ret, +2.2pp MaxDD) — the lone FULL-340d +3.7pp gain is a compounding-path artifact, not a robust edge (flatten path-chaos: gap-day delta sign is noise). Plumbing (openLongCount/openShortCount, telemetry, scan-decide gate) is left in place but inert via this 0. Set to 3 to re-enable IF re-justified on decomposed windows. See memory/project_l5_macrocorr_overlay_2026_06_06.md. Block logic mirrors lever-macrocorr blk3: wouldBe = openSame + sameCycleApproved + 1; block if wouldBe ≥ this.
  maxEntriesPerWindow: 6,                     // 2026-06-03: raised 3→6 for the 3-pair book — the validated WF used no entry-throttle; 6/12h lets all 3 pairs enter + re-enter without strangling the edge, while still a runaway backstop.
  entryCapWindowHours: 12,                    // rolling window for maxEntriesPerWindow (operator: 12h, not calendar day)
  entryCapEpochMs: 1780424189205,             // operator-reset 2026-06-02 18:16 UTC: counter cleared after ETH SL cluster. Entries BEFORE this don't count toward the cap.
  totalHeatCapPct: 3.75,                    // worst-case bt MaxDD 3.96% @ slip 0.40%
  dailyDrawdownSoftKillPct: -2.5,
  dailyDrawdownHardKillPct: -4.0,
  // 2026-06-03: entry-block kills DISABLED. The DD-flatten daemon (−4.3% from daily
  // peak, position-monitor) is now the ACTIVE daily-DD protection. Entry-block kills
  // are useless for Hyro survival (they stop new entries but don't CLOSE the existing
  // floating-loss positions that actually breach −5%) and deadlock with flatten (a
  // flatten-realized loss trips the soft kill → blocks re-entry rest of day → strategy
  // strangled; backtest profile C = −4.4%/n20). Mirrors the backtest's
  // disableKillSwitches (engine-portfolio.ts) which is on whenever flatten is armed.
  // Metric dailyDdFromPeakPct is still computed (telemetry). Flip true to re-enable.
  dailyKillSwitchesEnabled: false,
  totalKillPct: -8.0,
  maxSlPerPairPerDay: 2,
  cooldownAfterSlHours: 12,                 // post-SL cooldown survives UTC-day boundary
  cooldownAfterAnyCloseHours: 4,            // post-any-close cooldown (TP/manual)
  minRrTp2: 0.3,                            // skip setups with rrTp2 < this (bt-validated)
  fundingWindows: [0, 8, 16] as const,
  fundingWindowMinutes: 10,
  hyrotraderDailyDdPct: -5.0,
  hyrotraderTotalDdPct: -10.0,
  minLeverage: 10,
  slMaxAgeMs: 5 * 60_000,                   // 5 min
});

export type RiskConfig = typeof RISK;

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  sizeMultiplier?: number;                 // 1.0 default; news-medium → 0.5
}

export interface RiskState {
  ts: number;
  iso: string;
  totalEquityUsd: number;
  dailyOpenEquityUsd: number;              // equity at session start (UTC midnight)
  dailyPnlUsd: number;
  dailyPnlPct: number;                     // P&L from session open (informational)
  // HyroTrader-faithful DDD: peak equity since UTC midnight AND the lowest
  // equity observed AFTER that peak (including unrealized P&L). DDD =
  // (trough - peak) / peak * 100. Kill switches use this, NOT dailyPnlPct
  // (from open), because Hyro terminates at -5% from PEAK and the breach
  // latches on the worst point seen — even if equity recovers before the
  // next risk-guard tick, the account is dead.
  dailyPeakEquityUsd: number;
  dailyTroughEquityUsd: number;            // lowest equity since the current peak was set
  dailyDdFromPeakPct: number;              // (trough - peak) / peak * 100
  openPositionsCount: number;
  openLongCount: number;                    // distinct pairs currently open LONG (macro-corr same-side overlay)
  openShortCount: number;                   // distinct pairs currently open SHORT (macro-corr same-side overlay)
  entriesInWindow: number;                  // distinct entries opened in the trailing entryCapWindowHours (any status) — rolling entry cap
  totalHeatPct: number;
  pairBlocked: Record<string, string>;     // 'BTCUSDT' → reason
  inFundingWindow: boolean;
  softKillTriggered: boolean;
  hardKillTriggered: boolean;
  totalKillTriggered: boolean;
}

function isFundingWindow(d: Date): boolean {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  for (const fundingHour of RISK.fundingWindows) {
    if (h === fundingHour && m < RISK.fundingWindowMinutes) return true;
    // Cover the 10 minutes BEFORE funding too — cross hour boundary
    if (h === (fundingHour + 23) % 24 && m >= 60 - RISK.fundingWindowMinutes) return true;
  }
  return false;
}

async function fetchTotalEquity(): Promise<number> {
  const accs = loadAccounts();
  const results = await Promise.all(accs.map(async (a) => {
    const r = await ping(a);
    return r.ok ? (r.equity ?? 0) : 0;
  }));
  return results.reduce((s, e) => s + e, 0);
}

async function fetchSessionStartEquity(now: Date): Promise<number> {
  // Use the latest positions_snapshot at or before the most recent UTC midnight.
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const r = await query<{ eq: string }>(
    `SELECT SUM(equity)::text AS eq FROM positions_snapshot
     WHERE ts = (SELECT MAX(ts) FROM positions_snapshot WHERE ts <= $1)`,
    [sessionStart]
  );
  const v = r.rows[0]?.eq;
  return v ? parseFloat(v) : 0;
}

// HyroTrader-faithful DDD tracking. UPSERT current equity into risk_daily_peak
// and maintain both:
//   - peak_equity   = highest equity seen today (UTC)
//   - trough_equity = lowest equity observed AFTER that peak was set
//
// When current > stored peak: a fresh leg starts → peak := current, trough := current.
// Otherwise: peak stays, trough := LEAST(stored trough, current).
//
// DDD = (trough - peak) / peak * 100  (always ≤ 0). Kill switches latch on the
// trough so a brief dip to -5% terminates the account even if equity recovers
// before the next risk-guard cycle — matching HyroTrader semantics.
//
// Pre-deploy day will under-estimate the early peak (tracking starts at first
// read, not actual midnight). From day 2 onward, tracking is accurate.
async function fetchAndUpsertDailyPeak(
  now: Date,
  currentEquity: number,
): Promise<{ peak: number; trough: number }> {
  const utcDay = now.toISOString().slice(0, 10);  // YYYY-MM-DD in UTC
  const r = await query<{ peak: string; trough: string }>(
    `INSERT INTO risk_daily_peak (utc_day, peak_equity, trough_equity)
     VALUES ($1::date, $2, $2)
     ON CONFLICT (utc_day) DO UPDATE
       SET peak_equity = GREATEST(risk_daily_peak.peak_equity, EXCLUDED.peak_equity),
           trough_equity = CASE
             WHEN EXCLUDED.peak_equity > risk_daily_peak.peak_equity
               THEN EXCLUDED.peak_equity
             ELSE LEAST(risk_daily_peak.trough_equity, EXCLUDED.peak_equity)
           END,
           updated_at = NOW()
     RETURNING peak_equity::text AS peak, trough_equity::text AS trough`,
    [utcDay, currentEquity]
  );
  const row = r.rows[0];
  return {
    peak: row?.peak ? parseFloat(row.peak) : currentEquity,
    trough: row?.trough ? parseFloat(row.trough) : currentEquity,
  };
}

// Returns a cooldown-block reason string if the pair is in cooldown; null otherwise.
// Combines two cooldown windows: (a) long post-SL (default 12h, losing closes only),
// (b) short post-any-close (default 4h, any TP/manual close). The 12h survives the
// UTC-day boundary so back-to-back SL clusters can't re-enter.
async function lastSlCooldown(now: Date, symbol: string): Promise<string | null> {
  const slCutoff = now.getTime() - RISK.cooldownAfterSlHours * 3_600_000;
  const slTs = await tradeRepo.lastSlCloseTs(symbol);
  if (slTs !== null && slTs >= slCutoff) {
    const minsSince = Math.floor((now.getTime() - slTs) / 60_000);
    return `SL cooldown: ${minsSince}min since SL, need ${RISK.cooldownAfterSlHours * 60}min`;
  }

  const anyCutoff = now.getTime() - RISK.cooldownAfterAnyCloseHours * 3_600_000;
  const lastTs = await tradeRepo.lastCloseTs(symbol);
  if (lastTs === null || lastTs < anyCutoff) return null;
  const minsSince = Math.floor((now.getTime() - lastTs) / 60_000);
  const minsRemaining = Math.max(0, RISK.cooldownAfterAnyCloseHours * 60 - minsSince);
  return `closed ${minsSince}min ago; any-close cooldown ${minsRemaining}min remaining`;
}

async function countSlToday(now: Date, symbol: string): Promise<number> {
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return tradeRepo.countSlInSession(symbol, sessionStart);
}

async function fetchOpenPositions(): Promise<Array<{ symbol: string; riskedUsd: number; side: 'long' | 'short' }>> {
  const trades = await tradeRepo.openTrades();
  return trades.map((t) => {
    const p = Position.fromOpenTrade(t);
    // trades.side is stored Bybit-style ('Buy'/'Sell'); normalize to long/short space
    // so it compares against the strategy's action.side ('long'|'short').
    const side: 'long' | 'short' = /^(buy|long)$/i.test(p.side) ? 'long' : 'short';
    return { symbol: p.symbol, riskedUsd: p.riskedUsd(), side };
  });
}

export async function getRiskState(now: Date = new Date()): Promise<RiskState> {
  const ts = now.getTime();
  // Use DB-derived day P&L (realized closed today + unrealized from Bybit) instead
  // of legacy positions_snapshot diff which was never populated.
  const dayPnl = await getDayPnl(now);
  const equity = dayPnl.totalEquityUsd;
  const sessionEquity = equity - dayPnl.netUsd;
  const dailyPnl = dayPnl.netUsd;
  const dailyPnlPct = dayPnl.netPct;

  // HyroTrader DDD: upsert current equity, get back today's peak AND the lowest
  // equity since that peak. DDD = (trough - peak) / peak * 100 — Hyro-faithful
  // because it latches on the worst point seen, not just the current value.
  const { peak: dailyPeakEquityUsd, trough: dailyTroughEquityUsd } =
    await fetchAndUpsertDailyPeak(now, equity);
  const dailyDdFromPeakPct = dailyPeakEquityUsd > 0
    ? (dailyTroughEquityUsd - dailyPeakEquityUsd) / dailyPeakEquityUsd * 100
    : 0;

  const openPositions = await fetchOpenPositions();
  // Cap-4 should count UNIQUE pairs, not raw trade rows. One signal placed on N
  // accounts creates N rows in the DB but it's still ONE pair-position. Strategy
  // is symmetric across accounts (Promise.all broadcast), so they live and die together.
  const uniquePairs = new Set(openPositions.map((p) => p.symbol));
  const uniquePositionsCount = uniquePairs.size;
  // Per-side UNIQUE-pair counts for the macro-corr overlay. Dedup by symbol (one
  // signal broadcast to N accounts = N rows but ONE pair-position), same as uniquePairs.
  const longOpenPairs = new Set(openPositions.filter((p) => p.side === 'long').map((p) => p.symbol));
  const shortOpenPairs = new Set(openPositions.filter((p) => p.side === 'short').map((p) => p.symbol));
  const totalRisked = openPositions.reduce((s, p) => s + p.riskedUsd, 0);
  const totalHeatPct = equity > 0 ? (totalRisked / equity) * 100 : 0;

  // Floor the rolling window at the cap-logic start epoch so entries opened before
  // the operator activated this cap don't count (clean start). Once 12h pass, the
  // rolling window naturally moves past the epoch and the floor is a no-op.
  const entryWindowStartMs = Math.max(now.getTime() - RISK.entryCapWindowHours * 3_600_000, RISK.entryCapEpochMs);
  const entriesInWindow = await tradeRepo.countEntriesSince(entryWindowStartMs);

  const pairBlocked: Record<string, string> = {};
  for (const symbol of tier1Pairs()) {
    const slCount = await countSlToday(now, symbol);
    if (slCount >= RISK.maxSlPerPairPerDay) {
      pairBlocked[symbol] = `${slCount} SL today (cap ${RISK.maxSlPerPairPerDay})`;
    }
    // Cooldown after a recent SL — finer-grained than the UTC-day cap.
    // Only set if not already blocked by the daily cap above (avoid stomping the reason).
    if (!pairBlocked[symbol]) {
      const cool = await lastSlCooldown(now, symbol);
      if (cool) pairBlocked[symbol] = cool;
    }
  }

  return {
    ts,
    iso: now.toISOString(),
    totalEquityUsd: equity,
    dailyOpenEquityUsd: sessionEquity,
    dailyPnlUsd: dailyPnl,
    dailyPnlPct,                                   // informational (from-open P&L)
    dailyPeakEquityUsd,
    dailyTroughEquityUsd,
    dailyDdFromPeakPct,
    openPositionsCount: uniquePositionsCount,
    openLongCount: longOpenPairs.size,
    openShortCount: shortOpenPairs.size,
    entriesInWindow,
    totalHeatPct,
    pairBlocked,
    inFundingWindow: isFundingWindow(now),
    // Kill switches measure from PEAK (Hyro semantics). Account can be in profit
    // for the day net-net but still trigger kill if it gave back enough from peak.
    // Gated by dailyKillSwitchesEnabled (now false — flatten daemon supersedes these).
    softKillTriggered: RISK.dailyKillSwitchesEnabled && dailyDdFromPeakPct <= RISK.dailyDrawdownSoftKillPct,
    hardKillTriggered: RISK.dailyKillSwitchesEnabled && dailyDdFromPeakPct <= RISK.dailyDrawdownHardKillPct,
    totalKillTriggered: false,                     // requires baseline equity tracking — TODO
  };
}

/**
 * RiskManager — caches a single RiskState snapshot per "scan tick" so
 * precheckEntry() doesn't re-query the DB 13× per cycle (once per candidate
 * pair). Each scan-decide cycle creates a fresh manager via createForTick().
 *
 * The legacy free `precheckEntry(symbol, risk, now)` still works (back-compat);
 * internally it constructs a one-shot RiskManager.
 */
export class RiskManager {
  private snapshot: RiskState | null = null;

  constructor(private readonly now: Date) {}

  static async createForTick(now: Date = new Date()): Promise<RiskManager> {
    const m = new RiskManager(now);
    m.snapshot = await getRiskState(now);
    return m;
  }

  state(): RiskState {
    if (!this.snapshot) throw new Error('RiskManager: state() before createForTick()');
    return this.snapshot;
  }

  async precheck(symbol: string, riskPct: number): Promise<RiskCheckResult> {
    if (!this.snapshot) this.snapshot = await getRiskState(this.now);
    return runPrecheck(symbol, riskPct, this.snapshot);
  }
}

async function runPrecheck(symbol: string, riskPct: number, state: RiskState): Promise<RiskCheckResult> {
  if (state.inFundingWindow) {
    return { allowed: false, reason: `funding window (UTC ${state.iso})` };
  }
  if (state.hardKillTriggered) {
    return { allowed: false, reason: `trailing-peak DDD ${state.dailyDdFromPeakPct.toFixed(2)}% breached hard kill ${RISK.dailyDrawdownHardKillPct}% (peak $${state.dailyPeakEquityUsd.toFixed(0)})` };
  }
  if (state.softKillTriggered) {
    return { allowed: false, reason: `trailing-peak DDD ${state.dailyDdFromPeakPct.toFixed(2)}% breached soft kill ${RISK.dailyDrawdownSoftKillPct}% (peak $${state.dailyPeakEquityUsd.toFixed(0)})` };
  }
  if (state.openPositionsCount >= RISK.maxParallelPositions) {
    return { allowed: false, reason: `${state.openPositionsCount} open positions (cap ${RISK.maxParallelPositions})` };
  }
  if (state.entriesInWindow >= RISK.maxEntriesPerWindow) {
    return { allowed: false, reason: `${state.entriesInWindow} entries in last ${RISK.entryCapWindowHours}h (cap ${RISK.maxEntriesPerWindow}) — wait for window to clear` };
  }
  if (state.pairBlocked[symbol]) {
    return { allowed: false, reason: `pair disabled: ${state.pairBlocked[symbol]}` };
  }
  // Per-pair uniqueness: only ONE position per symbol across all accounts.
  // Without this, cron firing on the same actionable signal across 5-min cycles
  // would re-execute the same trade. The strategy's cooldown is in-process and
  // doesn't survive across `npx tsx` invocations.
  const pairOpenR = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM trades WHERE status = 'open' AND symbol = $1`,
    [symbol]
  );
  const pairOpenCount = parseInt(pairOpenR.rows[0]?.c ?? '0', 10);
  if (pairOpenCount > 0) {
    return { allowed: false, reason: `${symbol} already has ${pairOpenCount} open position(s) — duplicate signal` };
  }
  // Strengthened pair-uniqueness — catches the ARB-248 dupe-fire bug on 2026-05-27:
  // first ladder placed at 17:00 UTC didn't fill (slot-1 LIMIT), reconcile marked
  // it `orphaned` at 17:19, then at 18:00 the next scan-decide fired and the
  // legacy filter (`status IN ('pending','placed') AND trade_id IS NULL`) failed
  // because `orphaned` was excluded and the row had resolved_at set. Bybit-side
  // the cancelled-orphan promise was best-effort, so a second ladder stacked on
  // the pair and inflated effective sizing 2.4×.
  //
  // New rule: any pending_orders row placed in the last 90 minutes on this pair
  // counts as "pair occupied" UNLESS explicitly cancelled/failed AND its trade
  // (if any) has closed. The 90-min window covers the next 4H decision boundary
  // plus reconcile latency. Matches the spirit of cg-fade's in-process 6h cooldown
  // (which is a no-op across cron forks).
  const pairPendingR = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM pending_orders po
      LEFT JOIN trades t ON po.trade_id = t.id
      WHERE po.symbol = $1
        AND po.requested_at > NOW() - INTERVAL '90 minutes'
        AND po.status NOT IN ('cancelled', 'failed')
        AND (po.trade_id IS NULL OR t.status = 'open')`,
    [symbol]
  );
  const pairPendingCount = parseInt(pairPendingR.rows[0]?.c ?? '0', 10);
  if (pairPendingCount > 0) {
    return { allowed: false, reason: `${symbol} has ${pairPendingCount} unresolved pending order(s) in last 90min — duplicate signal` };
  }
  if (riskPct > RISK.riskPctCap) {
    return { allowed: false, reason: `risk ${riskPct}% exceeds cap ${RISK.riskPctCap}%` };
  }
  // Heat check: would adding this trade exceed total heat cap?
  const projectedHeatPct = state.totalHeatPct + riskPct;
  if (projectedHeatPct > RISK.totalHeatCapPct) {
    return { allowed: false, reason: `heat would be ${projectedHeatPct.toFixed(2)}% (cap ${RISK.totalHeatCapPct}%)` };
  }

  return { allowed: true, sizeMultiplier: 1.0 };
}

/** Back-compat wrapper — constructs a one-shot RiskManager per call. */
export async function precheckEntry(
  symbol: string,
  riskPct: number,
  now: Date = new Date()
): Promise<RiskCheckResult> {
  const m = await RiskManager.createForTick(now);
  return m.precheck(symbol, riskPct);
}

export function formatRiskState(s: RiskState): string {
  return [
    `risk state @ ${s.iso}`,
    `  equity:        $${s.totalEquityUsd.toFixed(0)}`,
    `  session start: $${s.dailyOpenEquityUsd.toFixed(0)}`,
    `  daily P&L:     $${s.dailyPnlUsd.toFixed(0)} (${s.dailyPnlPct.toFixed(2)}%)  ← from open (informational)`,
    `  day peak:      $${s.dailyPeakEquityUsd.toFixed(0)}`,
    `  trough (post-peak): $${s.dailyTroughEquityUsd.toFixed(0)}`,
    `  DDD = peak − trough: ${s.dailyDdFromPeakPct.toFixed(2)}%  ← kill metric (Hyro -5% limit)`,
    `  open positions: ${s.openPositionsCount} / ${RISK.maxParallelPositions}`,
    `  same-side open: ${s.openLongCount}L / ${s.openShortCount}S  ${RISK.maxSameSideConcentration > 0 ? `(max ${RISK.maxSameSideConcentration - 1}/side, macro-corr overlay)` : '(overlay off)'}`,
    `  total heat:    ${s.totalHeatPct.toFixed(2)}% / ${RISK.totalHeatCapPct}%`,
    `  funding window: ${s.inFundingWindow}`,
    `  soft kill:      ${s.softKillTriggered}  (threshold ${RISK.dailyDrawdownSoftKillPct}% from peak)`,
    `  hard kill:      ${s.hardKillTriggered}  (threshold ${RISK.dailyDrawdownHardKillPct}% from peak)`,
    `  pair blocks:    ${Object.keys(s.pairBlocked).length === 0 ? 'none' : JSON.stringify(s.pairBlocked)}`,
  ].join('\n');
}

/**
 * TRUE multi-symbol portfolio backtest engine.
 *
 * Difference from `runBacktest` (single-symbol) + portfolio-live.ts (post-hoc
 * aggregation): here ALL risk-guard checks are shared across symbols DURING
 * simulation. Specifically:
 *
 *   - Heat cap (3.75%) blocks an entry when summed across all symbols' open
 *     positions it would breach the cap.
 *   - Soft / hard / total kill switches are evaluated against PORTFOLIO equity
 *     (sum of realized P&L across all symbols), with HyroTrader-faithful
 *     peak−trough trailing DDD reset at UTC midnight.
 *   - Max parallel positions caps the GLOBAL count (operator-set, default 6).
 *   - Per-pair SL cooldown (12h), any-close cooldown (4h), max 2 SL/pair/day
 *     are scoped to each symbol but live in a single shared state.
 *   - Funding window block (±10 min around 00/08/16 UTC) — same as engine.ts.
 *
 * Iteration model: union of all symbols' 4H bar timestamps drives the loop.
 * Between decision boundaries we resolve open positions on every symbol using
 * its own 1m bars (the engine helper `resolvePosition`). Decisions on the same
 * 4H boundary are processed in symbol-priority order (matches operator's
 * preference list: TIER1_PORTFOLIO array order, with unknown symbols going
 * last alphabetically).
 *
 * Reuses engine.ts helpers (`loadData`, `resolvePosition`, `applySlippage`,
 * `calcQty`, `aggregateHourlyTo`, `isInFundingWindow`, `checkBacktestRisk`,
 * `updateBacktestRiskOnClose`) — no behavioural duplication.
 */

import {
  loadData,
  resolvePosition,
  applySlippage,
  calcQty,
  capSlotQty,
  aggregateHourlyTo,
  dayStartUtc,
  weekStartUtc,
  isInFundingWindow,
  checkBacktestRisk,
  updateBacktestRiskOnClose,
  makeBacktestRiskState,
  recordBacktestEntry,
  BacktestRiskState,
  MIN_RR_TP2,
  DataBundle,
} from './engine';
import {
  Action,
  Bar,
  ClosedTrade,
  OpenPosition,
  Strategy,
  StrategyContext,
} from './types';
import { computeFeatures, CandleRow } from '../data/features';
import { loadCoinglassAt, CoinglassFeatures } from '../data/coinglass-features';
import { peekCgFadeCooldown, restoreCgFadeCooldown } from '../strategies/cg-fade';
import { log } from '../core/logger';

export interface PortfolioSymbolStrategy {
  symbol: string;
  strategy: Strategy;
  /** Priority for tie-breaking when multiple symbols pass risk-guard on the
   *  same 4H boundary but cap is full. Lower = earlier. Defaults to insertion
   *  order if not provided. */
  priority?: number;
}

export interface PortfolioBacktestSettings {
  startTs: number;
  endTs: number;
  startEquity: number;
  takerFeeRate: number;
  makerFeeRate: number;
  slippagePct: number;
  leverage: number;
  decisionTf?: '60m' | '240m';
  tp1SlMode?: 'be' | 'be_plus' | 'no_move' | 'halfway';
  bePlusBufferPct?: number;
  maxNotionalPctOfEquity?: number;
  /** Override max parallel positions cap. Defaults to the engine's
   *  MAX_PARALLEL_POSITIONS = 6 if undefined. */
  maxParallelCap?: number;
  /** Rolling per-window entry cap, mirroring live risk-guard maxEntriesPerWindow.
   *  0/undefined = disabled (legacy). Live = 2 over entryCapWindowHours=12. */
  maxEntriesPerWindow?: number;
  entryCapWindowMs?: number;
  /** Live-cron-realistic mode (2026-05-29): entry откладывается до следующего
   *  HH:00 после funding window. CG данные читаются на nowTs (а не decisionBar.ts).
   *  Эмулирует реальную задержку live execution. По умолчанию false. */
  cronRealistic?: boolean;
  /** Experimental: roll back the cg-fade in-process cooldown when an entry SIGNAL
   *  is blocked by cap/heat/funding so only COMMITTED entries burn the cooldown.
   *  Current live (and default backtest) burn it on signal — see TASK on cap↔cooldown
   *  chaos. A/B flag; default false = legacy signal-burn behaviour. */
  cooldownOnCommit?: boolean;
  /** Portfolio intraday MTM drawdown guard (negative %, e.g. -3.5). When the
   *  mark-to-market equity (realized + open-position unrealized, marked at nowTs
   *  with the CURRENT resolved-to-nowTs qty, so no DCA back-projection) drops this
   *  far below the day's running MTM peak, BLOCK all new entries for the step. Open
   *  positions are NOT closed (closing in DD kills the mean-reversion edge). Purpose:
   *  stop piling correlated positions into a developing crash so the daily DD stays
   *  under Hyro's −5%. undefined = off. */
  intradayDdGuardPct?: number;
  /** Emergency daily-DD FLATTEN (negative %, e.g. -4.3). When intraday EQUITY MTM
   *  (balance + floating PnL of open positions) drops this far below the day's
   *  running equity peak, INSTANTLY CLOSE ALL open positions (exitReason
   *  'dd_flatten') and halt new entries for the rest of the UTC day. Checked on a
   *  fine (15-min) grid so it fires before Hyro's −5% trailing kill. This is the
   *  account-survival hard stop the operator mandated. undefined = off. */
  dailyDdFlattenPct?: number;
}

export interface PortfolioBacktestResult {
  trades: ClosedTrade[];
  /** Daily-sampled equity curve (UTC midnight closes + final ts). */
  equityCurve: { ts: number; equity: number }[];
  startEquity: number;
  endEquity: number;
  /** Per-symbol diagnostic: how many entry candidates passed strategy.decide() vs were
   *  actually opened (i.e. how many were blocked by shared risk-guard). */
  decisionStats: Record<string, { candidates: number; opened: number; blocked: number }>;
  /** Honest intraday Daily-DD. MTM (equity = balance + floating) AND balance-only
   *  (realized closes) variants — prop firms differ on which the daily limit uses. */
  dailyDd: { worstDailyDdPct: number; worstDay: string; daysBreach5: number; daysBreach4: number; daysBreach25: number; samples: number; balWorstDailyDdPct: number; balWorstDay: string; balDaysBreach5: number; balDaysBreach4: number };
  /** Intraday MTM DD guard activity (when intradayDdGuardPct set) + emergency
   *  flatten count (when dailyDdFlattenPct set). */
  guard: { blockedDays: number; blockedEvents: number; flattenDays: number };
}

interface SymbolRuntime {
  symbol: string;
  strategy: Strategy;
  priority: number;
  data: DataBundle;
  tsTo1mIdx: Map<number, number>;
  position: OpenPosition | null;
  lastClosedTrade: StrategyContext['lastClosedTrade'];
  // Index into barsDecision indicating the next bar whose CLOSE will trigger a decision
  // (decision uses bar[i-1] info, executes at bar[i].ts).
  nextDecisionIdx: number;
}

const ONE_DAY_MS = 86_400_000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

/**
 * Run a TRUE multi-symbol portfolio backtest.
 *
 * @param symbolStrategies — ordered list (priority = array index unless overridden).
 * @param settings        — shared backtest settings (fees, slip, equity, decisionTf).
 */
export async function runPortfolioBacktest(
  symbolStrategies: PortfolioSymbolStrategy[],
  settings: PortfolioBacktestSettings,
): Promise<PortfolioBacktestResult> {
  const decisionTf = settings.decisionTf ?? '240m';
  const fees = { taker: settings.takerFeeRate, maker: settings.makerFeeRate };
  const maxParallelCap = settings.maxParallelCap;  // undefined → fall back to engine default

  // DECISION_CADENCE=60m → research mode that mirrors LIVE literally: decide EVERY
  // 1H bar close (not just the 4H boundary), price = last closed 1H close, indicators
  // still 4H (closed 4H bars + the forming 4H bar rebuilt from 1H). Entry fires the
  // SAME hour (no +1h cronRealistic defer); a funding-blocked hour is simply skipped
  // and the next hourly step re-decides — exactly how live's hourly cron behaves.
  // Default (unset) = 4H decisions = unchanged production/live-aligned behaviour.
  const HOURLY = process.env.DECISION_CADENCE === '60m';
  // ANCHOR_4H=1 (hourly mode only): lock ctx.price (→ entry/SL/TP levels + CG read ts)
  // to the last CLOSED 4H bar instead of the last closed 1H bar, while still re-deciding
  // every hour. Isolates whether the degradation from hourly cadence is the PRICE ANCHOR
  // (1H vs 4H close) or the decision timing itself.
  const ANCHOR_4H = HOURLY && process.env.ANCHOR_4H === '1';
  const FOUR_H_MS = 4 * 3_600_000;

  log.info('portfolio backtest start', {
    symbols: symbolStrategies.map(s => s.symbol),
    from: new Date(settings.startTs).toISOString(),
    to: new Date(settings.endTs).toISOString(),
    startEquity: settings.startEquity,
    decisionTf,
    decisionCadence: HOURLY ? '60m (live-mirror)' : decisionTf,
  });

  // ─── 1) Load data for every symbol ────────────────────────────────────────
  // Sequential loading: each `loadData` call fires 6 parallel queries. With pool
  // max=10, even 2 symbols in parallel can saturate the pool and trigger connect
  // timeouts at 10+ symbols. Sequential keeps the pool happy at the cost of a
  // few extra seconds.
  const runtimes: SymbolRuntime[] = [];
  for (let i = 0; i < symbolStrategies.length; i++) {
    const cfg = symbolStrategies[i];
    const data = await loadData(
      cfg.symbol, settings.startTs, settings.endTs, decisionTf, cfg.strategy.needsBtcContext,
    );
    const tsTo1mIdx = new Map<number, number>();
    data.bars1m.forEach((b, idx) => tsTo1mIdx.set(b.ts, idx));
    runtimes.push({
      symbol: cfg.symbol,
      strategy: cfg.strategy,
      priority: cfg.priority ?? i,
      data,
      tsTo1mIdx,
      position: null,
      lastClosedTrade: undefined,
      nextDecisionIdx: Math.max(0, data.barsDecision.findIndex(b => b.ts >= settings.startTs)),
    });
  }

  // ─── 2) Build the unified 4H decision-boundary timeline ───────────────────
  // All Bybit 4H bars share the 00/04/08/12/16/20 UTC grid, so we can just take
  // the union of every symbol's barsDecision timestamps in the active window.
  const decisionTsSet = new Set<number>();
  for (const r of runtimes) {
    // HOURLY: decide on every 1H bar close; default: only 4H boundaries.
    const cadenceBars = HOURLY ? r.data.bars1h : r.data.barsDecision;
    for (const b of cadenceBars) {
      if (b.ts >= settings.startTs && b.ts <= settings.endTs) decisionTsSet.add(b.ts);
    }
  }
  const decisionTimeline = [...decisionTsSet].sort((a, b) => a - b);
  if (decisionTimeline.length === 0) {
    log.warn('no decision bars in active window');
    return {
      trades: [],
      equityCurve: [{ ts: settings.startTs, equity: settings.startEquity }],
      startEquity: settings.startEquity,
      endEquity: settings.startEquity,
      decisionStats: {},
      dailyDd: { worstDailyDdPct: 0, worstDay: '', daysBreach5: 0, daysBreach4: 0, daysBreach25: 0, samples: 0, balWorstDailyDdPct: 0, balWorstDay: '', balDaysBreach5: 0, balDaysBreach4: 0 },
      guard: { blockedDays: 0, blockedEvents: 0, flattenDays: 0 },
    };
  }

  // ─── 3) Shared risk state + equity + outputs ──────────────────────────────
  const riskState: BacktestRiskState = makeBacktestRiskState(settings.startEquity, settings.startTs, {
    maxParallelPositions: settings.maxParallelCap,
    maxEntriesPerWindow: settings.maxEntriesPerWindow,
    entryCapWindowMs: settings.entryCapWindowMs,
    // KEEP_KILLS=1 keeps soft/hard/total kill switches ACTIVE even when a daily-DD
    // flatten is armed — for the COMBINED experiment (kills −2.5/−4.0 entry-block +
    // flatten −4.3 close-all together, mirroring a live config that runs both).
    // Default unchanged: arming flatten alone disables the kills (else they double-
    // count the same drawdown). Reversible env knob, backtest-only.
    disableKillSwitches: process.env.KEEP_KILLS === '1' ? false : (settings.dailyDdFlattenPct != null),
  });
  const equityRef = { value: settings.startEquity };
  const trades: ClosedTrade[] = [];
  const decisionStats: Record<string, { candidates: number; opened: number; blocked: number }> = {};
  for (const r of runtimes) decisionStats[r.symbol] = { candidates: 0, opened: 0, blocked: 0 };

  // Daily-sampled equity curve. We sample at every decision boundary that
  // crosses a new UTC day. Final ts pushed at the end.
  const equityCurve: { ts: number; equity: number }[] = [
    { ts: settings.startTs, equity: settings.startEquity },
  ];
  let lastSampledDay = new Date(settings.startTs).toISOString().slice(0, 10);

  // Intraday MTM drawdown guard state (portfolio-wide, reset per UTC day).
  let mtmDayKey = '';
  let dailyMtmPeak = settings.startEquity;
  const guardBlockedDays = new Set<string>();
  let guardBlockedEvents = 0;

  // Emergency daily-DD flatten state. When enabled we step the loop on a fine
  // (default 1-min, like a per-minute cron) grid so the flatten fires before
  // Hyro's −5%; decisions still only run on 4H boundaries (decisionTsSet). When
  // off, step on the 4H grid (legacy). FLATTEN_STEP_MIN env overrides cadence.
  const FLATTEN_STEP_MS = (parseInt(process.env.FLATTEN_STEP_MIN ?? '1', 10) || 1) * 60_000;
  let stepTimeline: number[];
  if (settings.dailyDdFlattenPct != null) {
    stepTimeline = [];
    for (let t = decisionTimeline[0]; t <= settings.endTs; t += FLATTEN_STEP_MS) stepTimeline.push(t);
  } else {
    stepTimeline = decisionTimeline;
  }
  let flattenDayKey = '';
  let flattenDayPeak = settings.startEquity;
  const flattenedDays = new Set<string>();
  let flattenCount = 0;
  // Authoritative 1-min raw-mark daily DD (peak-relative, %), measured on the SAME
  // grid + marks the flatten acts on — avoids the post-hoc 15-min maeR-clamp
  // overstatement. This is what Hyro actually sees.
  const liveDayWorstDd = new Map<string, number>();
  let liveWorstDd = 0, liveWorstDay = '';

  // ─── 4) Main loop (15-min fine grid when flatten on, else 4H boundaries) ───
  for (const nowTs of stepTimeline) {

    // 4a) Resolve open positions on every symbol up to (but not including) nowTs.
    //     Each symbol uses its own 1m bars. We may close several positions in
    //     this step; risk-state cooldowns advance accordingly.
    for (const r of runtimes) {
      if (!r.position) continue;
      const pos = r.position;
      const bars1m = r.data.bars1m;
      const entry1mIdx = r.tsTo1mIdx.get(pos.entryTs) ?? bars1m.findIndex(b => b.ts >= pos.entryTs);
      const nowIdxLookup = r.tsTo1mIdx.get(nowTs);
      const endIdx = (nowIdxLookup !== undefined ? nowIdxLookup : bars1m.findIndex(b => b.ts >= nowTs)) - 1;
      const startIdx = (pos.lastScanned1mIdx ?? entry1mIdx) + 1;
      if (endIdx < startIdx) continue;
      const closed = resolvePosition(
        pos,
        bars1m,
        startIdx,
        endIdx,
        r.data.fundingByTs,
        fees,
        settings.slippagePct,
        r.symbol,
        pos.rationale,
        pos.riskedUsd,
        equityRef,
        settings.tp1SlMode ?? 'be',
        settings.bePlusBufferPct ?? 0.10,
        settings.leverage,
        settings.maxNotionalPctOfEquity,
      );
      if (closed) {
        trades.push(closed);
        equityRef.value += closed.pnlUsd - closed.feesUsd - closed.fundingUsd;
        r.lastClosedTrade = { exitTs: closed.exitTs, exitReason: closed.exitReason, side: closed.side };
        updateBacktestRiskOnClose(riskState, closed);
        r.position = null;
      } else {
        pos.lastScanned1mIdx = endIdx;
      }
    }

    // 4b) Sample equity curve at the boundary if we crossed a UTC midnight since
    //     last sample. This gives close-only granularity ≥1 sample/day.
    const todayKey = new Date(nowTs).toISOString().slice(0, 10);
    if (todayKey !== lastSampledDay) {
      equityCurve.push({ ts: nowTs, equity: equityRef.value });
      lastSampledDay = todayKey;
    }

    // 4b.5) EMERGENCY DAILY-DD FLATTEN. Mark all open positions at nowTs (EQUITY =
    //       balance + floating), track the day's running equity peak, and if the DD
    //       from that peak ≤ dailyDdFlattenPct → INSTANTLY close ALL positions and
    //       halt entries for the rest of the UTC day. Runs on the 15-min fine grid.
    if (settings.dailyDdFlattenPct != null) {
      let mtmUnreal = 0;
      for (const r of runtimes) {
        const pos = r.position; if (!pos) continue;
        const idx = r.tsTo1mIdx.get(nowTs);
        const px = idx !== undefined ? r.data.bars1m[idx].close : pos.entry;
        mtmUnreal += (px - pos.entry) * pos.qty * (pos.side === 'long' ? 1 : -1);
      }
      const mtmEq = equityRef.value + mtmUnreal;
      // max_peak_per_day (operator spec): running max EQUITY this UTC day.
      if (todayKey !== flattenDayKey) { flattenDayKey = todayKey; flattenDayPeak = mtmEq; }
      else if (mtmEq > flattenDayPeak) flattenDayPeak = mtmEq;
      // Authoritative live DD (peak-relative %) on the 1-min raw grid.
      const liveDd = flattenDayPeak > 0 ? (mtmEq - flattenDayPeak) / flattenDayPeak * 100 : 0;
      if (liveDd < (liveDayWorstDd.get(todayKey) ?? 0)) liveDayWorstDd.set(todayKey, liveDd);
      if (liveDd < liveWorstDd) { liveWorstDd = liveDd; liveWorstDay = todayKey; }
      // daily_drawdown = max_peak_per_day − current_equity; flatten when it exceeds
      // |dailyDdFlattenPct|% of BASE balance (startEquity), per operator spec.
      const ddFromPeakUsd = flattenDayPeak - mtmEq;
      const triggerUsd = Math.abs(settings.dailyDdFlattenPct) / 100 * settings.startEquity;
      const ddPct = -(ddFromPeakUsd / settings.startEquity * 100);
      if (ddFromPeakUsd >= triggerUsd && !flattenedDays.has(todayKey)) {
        for (const r of runtimes) {
          const pos = r.position; if (!pos) continue;
          const idx = r.tsTo1mIdx.get(nowTs);
          const rawPx = idx !== undefined ? r.data.bars1m[idx].close : pos.entry;
          const fillPrice = applySlippage(rawPx, pos.side, 'exit', settings.slippagePct);
          const exitFee = pos.qty * fillPrice * fees.taker;
          const tailPnl = pos.side === 'long' ? (fillPrice - pos.entry) * pos.qty : (pos.entry - fillPrice) * pos.qty;
          const totalFees = pos.openFeesUsd + exitFee;
          const grossPnl = ((pos as any).bankedPnl ?? 0) + tailPnl;
          const pnlR = pos.riskedUsd > 0 ? (grossPnl - exitFee - pos.fundingPaidUsd) / pos.riskedUsd : 0;
          trades.push({
            side: pos.side, symbol: r.symbol, entry: pos.entry, exit: fillPrice,
            entryTs: pos.entryTs, exitTs: nowTs, qty: pos.qty * (pos.tp1Hit ? 2 : 1),
            sl: pos.sl, initialSl: pos.initialSl, tp1: pos.tp1, tp2: pos.tp2,
            pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: pos.fundingPaidUsd,
            pnlR, exitReason: 'dd_flatten', rationale: `daily DD flatten ${ddPct.toFixed(2)}%`,
            mfeR: (pos as any).mfeR ?? Math.max(0, pnlR), maeR: (pos as any).maeR ?? Math.min(0, pnlR),
            mfeTs: (pos as any).mfeTs ?? nowTs, maeTs: (pos as any).maeTs ?? nowTs,
          });
          equityRef.value += grossPnl - totalFees - pos.fundingPaidUsd;
          r.lastClosedTrade = { exitTs: nowTs, exitReason: 'dd_flatten', side: pos.side };
          updateBacktestRiskOnClose(riskState, trades[trades.length - 1]);
          r.position = null;
        }
        flattenedDays.add(todayKey);
        flattenCount++;
        if (process.env.FLATTEN_DEBUG) console.log(`[FLATTEN] ${new Date(nowTs).toISOString()} dd=${ddPct.toFixed(2)}% eqAfter=$${equityRef.value.toFixed(0)} peak=$${flattenDayPeak.toFixed(0)}`);
      }
    }

    // Decisions run ONLY on 4H boundaries, and never on a day already flattened.
    if (!decisionTsSet.has(nowTs) || flattenedDays.has(todayKey)) continue;

    // 4c) Gather entry candidates from every symbol whose 4H bar just closed.
    //     A 4H bar closing at nowTs means barsDecision[i].ts === nowTs and the
    //     decision uses barsDecision[i-1] which is the closed prior bar. We do
    //     NOT mutate riskState here — that happens in the prioritised pass below.
    interface Candidate {
      runtime: SymbolRuntime;
      action: Extract<Action, { kind: 'enter' }>;
      next1mIdx: number;
      decisionBarTs: number;
      cdSnap: { side: 'long' | 'short'; ts: number } | undefined;
    }
    const candidates: Candidate[] = [];

    for (const r of runtimes) {
      const allDecision = r.data.barsDecision;
      // decisionBar = price source (its close = ctx.price). decisionBars4h = the ≤300
      // 4H bars feeding features + recentBars (ATR/trend). Differs by cadence mode.
      let decisionBar: Bar;
      let decisionBars4h: Bar[];

      if (HOURLY) {
        // Mirror live scan-decide.buildContext at every 1H step: price = last closed
        // 1H bar; 4H window = closed 4H bars + the forming 4H bar rebuilt from 1H
        // (no look-ahead — same as live's recentBars4h which includes the open DB bar).
        const closed1h = r.data.bars1h.filter(b => b.ts < nowTs);
        if (closed1h.length < 100) continue;
        const closed4h = allDecision.filter(b => b.ts + FOUR_H_MS <= nowTs);
        const synth4h = aggregateHourlyTo(r.data.bars1h, Math.floor(nowTs / FOUR_H_MS) * FOUR_H_MS, nowTs);
        decisionBars4h = (synth4h ? [...closed4h, synth4h] : closed4h).slice(-300);
        // Price/CG anchor: ANCHOR_4H → last CLOSED 4H bar (4H-close levels); else last
        // closed 1H bar (true live behaviour). Falls back to 1H if no closed 4H bar yet.
        decisionBar = (ANCHOR_4H && closed4h.length > 0)
          ? closed4h[closed4h.length - 1]
          : closed1h[closed1h.length - 1];
      } else {
        // 4H cadence (default): trigger only when this symbol has a 4H bar at nowTs.
        while (r.nextDecisionIdx < allDecision.length && allDecision[r.nextDecisionIdx].ts < nowTs) {
          r.nextDecisionIdx++;
        }
        const idx = r.nextDecisionIdx;
        if (idx >= allDecision.length) continue;
        if (allDecision[idx].ts !== nowTs) continue;  // symbol has no bar at this boundary
        if (idx < 1) { r.nextDecisionIdx = idx + 1; continue; }
        decisionBar = allDecision[idx - 1];
        decisionBars4h = allDecision.slice(Math.max(0, idx - 300), idx);
        r.nextDecisionIdx = idx + 1;
      }
      if (decisionBars4h.length < 200) continue;

      // Build StrategyContext exactly like engine.ts does.
      const sliceDecision = decisionBars4h.map<CandleRow>(b => ({
        ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));

      const featDecision = computeFeatures(r.symbol, decisionTf, sliceDecision);
      let feat1h = featDecision;
      let feat4h: any = undefined;
      let featD: any = undefined;
      let featW: any = undefined;
      const cutoff1h = nowTs;
      if (decisionTf === '240m') {
        feat4h = featDecision;
        const closed1h = r.data.bars1h.filter(b => b.ts < cutoff1h);
        const slice1h = closed1h.slice(-300).map<CandleRow>(b => ({
          ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        }));
        if (slice1h.length >= 100) feat1h = computeFeatures(r.symbol, '60m', slice1h);
      }
      if (r.data.bars1d) {
        const closedD = r.data.bars1d.filter(b => b.ts + ONE_DAY_MS <= cutoff1h);
        const synthD = aggregateHourlyTo(r.data.bars1h, dayStartUtc(cutoff1h), cutoff1h);
        const allD = synthD ? [...closedD, synthD] : closedD;
        const sliceD = allD.slice(-250).map<CandleRow>(b => ({
          ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        }));
        if (sliceD.length >= 50) featD = computeFeatures(r.symbol, '1D', sliceD);
      }
      if (r.data.bars1w) {
        const closedW = r.data.bars1w.filter(b => b.ts + ONE_WEEK_MS <= cutoff1h);
        const synthW = aggregateHourlyTo(r.data.bars1h, weekStartUtc(cutoff1h), cutoff1h);
        const allW = synthW ? [...closedW, synthW] : closedW;
        const sliceW = allW.slice(-60).map<CandleRow>(b => ({
          ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        }));
        if (sliceW.length >= 20) featW = computeFeatures(r.symbol, '1W', sliceW);
      }

      const fundingTs = [...r.data.fundingByTs.keys()].filter(t => t <= decisionBar.ts);
      const lastFundingTs = fundingTs.length > 0 ? Math.max(...fundingTs) : null;
      const fundingRate = lastFundingTs ? r.data.fundingByTs.get(lastFundingTs) : undefined;

      let coinglass: CoinglassFeatures | undefined;
      if (r.strategy.needsCoinglass) {
        const coin = r.symbol.replace(/USDT$/, '');
        // Соответствует scan-decide.ts:146 (live также читает на decisionBar.ts).
        // CG-availability lag (fidelity research, default 0 = unchanged): live can't read a
        // just-closed 4H CG bar until ~next cron (Coinglass publish + hourly cg-incremental
        // ingest). CG_AVAIL_LAG_MS>0 delays when the backtest "sees" a CG bar to match live.
        const cgLagMs = parseInt(process.env.CG_AVAIL_LAG_MS ?? '0', 10);
        coinglass = await loadCoinglassAt(coin, r.symbol, decisionBar.ts - cgLagMs);
      }

      const recentBars = decisionBars4h.slice(-200);
      const bars1hRecent = r.data.bars1h.filter(b => b.ts < cutoff1h).slice(-400);
      const closedDRecent = r.data.bars1d ? r.data.bars1d.filter(b => b.ts + ONE_DAY_MS <= cutoff1h) : [];
      const synthDRecent = r.data.bars1d ? aggregateHourlyTo(r.data.bars1h, dayStartUtc(cutoff1h), cutoff1h) : null;
      const bars1dRecent = (synthDRecent ? [...closedDRecent, synthDRecent] : closedDRecent).slice(-60);
      const closedWRecent = r.data.bars1w ? r.data.bars1w.filter(b => b.ts + ONE_WEEK_MS <= cutoff1h) : [];
      const synthWRecent = r.data.bars1w ? aggregateHourlyTo(r.data.bars1h, weekStartUtc(cutoff1h), cutoff1h) : null;
      const bars1wRecent = (synthWRecent ? [...closedWRecent, synthWRecent] : closedWRecent).slice(-12);
      const btcBars4hRecent = r.data.btcBars4h
        ? r.data.btcBars4h.filter(b => b.ts < cutoff1h).slice(-200)
        : undefined;

      const ctx: StrategyContext = {
        symbol: r.symbol,
        ts: nowTs,
        price: decisionBar.close,
        features1h: feat1h,
        features4h: feat4h,
        featuresD: featD,
        featuresW: featW,
        fundingRate,
        position: r.position,
        coinglass,
        recentBars,
        bars1hRecent,
        bars1dRecent,
        bars1wRecent,
        btcBars4hRecent,
        lastClosedTrade: r.lastClosedTrade,
      };

      // Snapshot the pair's cooldown BEFORE decide() mutates it (buildEnter→markEntry
      // burns it on an enter SIGNAL). If cooldownOnCommit, we roll back when the entry
      // is not actually committed (blocked/deferred) so only real entries burn it.
      const cdSnap = settings.cooldownOnCommit ? peekCgFadeCooldown(r.symbol) : undefined;
      const rollback = () => { if (settings.cooldownOnCommit) restoreCgFadeCooldown(r.symbol, cdSnap); };

      const action = r.strategy.decide(ctx);

      // Reverse-signal exit (strategy closes a held position) is processed
      // in-line and does not compete with new entries for the cap. Matches
      // engine.ts semantics.
      if (action.kind === 'exit' && r.position) {
        const next1mIdx = r.tsTo1mIdx.get(nowTs) ?? r.data.bars1m.findIndex(b => b.ts >= nowTs);
        if (next1mIdx >= 0) {
          const exitBar = r.data.bars1m[next1mIdx];
          const fillPrice = applySlippage(exitBar.open, r.position.side, 'exit', settings.slippagePct);
          const exitFee = r.position.qty * fillPrice * fees.taker;
          const grossPnl = r.position.side === 'long'
            ? (fillPrice - r.position.entry) * r.position.qty
            : (r.position.entry - fillPrice) * r.position.qty;
          const totalFees = r.position.openFeesUsd + exitFee;
          const netPnl = grossPnl - totalFees - r.position.fundingPaidUsd;
          const pnlR = r.position.riskedUsd > 0 ? netPnl / r.position.riskedUsd : 0;
          const closedTrade: ClosedTrade = {
            side: r.position.side, symbol: r.symbol,
            entry: r.position.entry, exit: fillPrice,
            entryTs: r.position.entryTs, exitTs: exitBar.ts,
            qty: r.position.initialQty,
            sl: r.position.initialSl, initialSl: r.position.initialSl, tp1: r.position.tp1, tp2: r.position.tp2,
            pnlUsd: netPnl, feesUsd: totalFees, fundingUsd: r.position.fundingPaidUsd,
            pnlR, exitReason: 'strategy_exit', rationale: action.reason,
            mfeR: (r.position as any).mfeR ?? Math.max(0, pnlR),
            maeR: (r.position as any).maeR ?? Math.min(0, pnlR),
            mfeTs: (r.position as any).mfeTs ?? exitBar.ts,
            maeTs: (r.position as any).maeTs ?? exitBar.ts,
          };
          trades.push(closedTrade);
          equityRef.value += netPnl;
          r.lastClosedTrade = { exitTs: exitBar.ts, exitReason: 'strategy_exit', side: r.position.side };
          updateBacktestRiskOnClose(riskState, closedTrade);
          r.position = null;
        }
        continue;
      }

      if (action.kind !== 'enter') continue;
      if (r.position) { rollback(); continue; }  // don't pyramid

      const next1mIdx = r.tsTo1mIdx.get(nowTs) ?? r.data.bars1m.findIndex(b => b.ts >= nowTs);
      if (next1mIdx < 0) { rollback(); continue; }

      // cronRealistic: entry откладывается до следующего HH:00 после funding
      // window (как live cron). 4H close на 16:00 → entry на 17:00 (16:00-16:10 blocked).
      let entryNext1mIdx = next1mIdx;
      // 4H cadence: entry deferred to the next HH:00 past any funding window (a 4H
      // close at 16:00 → entry 17:00). HOURLY cadence enters the SAME hour as the
      // decision (next1m.ts === nowTs); a funding-blocked hour is skipped below and
      // the next hourly step re-decides — mirroring live's hourly cron exactly.
      if (settings.cronRealistic && !HOURLY) {
        const MS_HOUR = 3_600_000;
        let entryTs = Math.ceil(nowTs / MS_HOUR) * MS_HOUR;
        if (entryTs <= nowTs) entryTs += MS_HOUR;
        let attempts = 0;
        while (isInFundingWindow(entryTs) && attempts < 12) {
          entryTs += MS_HOUR; attempts++;
        }
        if (attempts >= 12) { rollback(); continue; }
        const altIdx = r.tsTo1mIdx.get(entryTs) ?? r.data.bars1m.findIndex(b => b.ts >= entryTs);
        if (altIdx < 0) { rollback(); continue; }
        entryNext1mIdx = altIdx;
      }

      decisionStats[r.symbol].candidates += 1;
      candidates.push({ runtime: r, action, next1mIdx: entryNext1mIdx, decisionBarTs: decisionBar.ts, cdSnap });
    }

    // 4c.5) Portfolio intraday MTM drawdown guard. Mark every open position at
    //       nowTs using its CURRENT (resolved-to-nowTs) qty/entry — no DCA
    //       back-projection — track the day's running MTM peak, and trip the guard
    //       if MTM DD ≤ intradayDdGuardPct. Tripped → block ALL new entries this
    //       step (existing positions ride it out). Cuts correlated-crash days that
    //       breach Hyro −5% without realising mean-reversion losses early.
    let guardTripped = false;
    if (settings.intradayDdGuardPct != null) {
      let mtmUnreal = 0;
      for (const r of runtimes) {
        const pos = r.position; if (!pos) continue;
        const idx = r.tsTo1mIdx.get(nowTs);
        const px = idx !== undefined ? r.data.bars1m[idx].close : pos.entry;
        mtmUnreal += (px - pos.entry) * pos.qty * (pos.side === 'long' ? 1 : -1);
      }
      const mtmEquity = equityRef.value + mtmUnreal;
      const dayKey = new Date(nowTs).toISOString().slice(0, 10);
      if (dayKey !== mtmDayKey) { mtmDayKey = dayKey; dailyMtmPeak = mtmEquity; }
      else if (mtmEquity > dailyMtmPeak) dailyMtmPeak = mtmEquity;
      const mtmDdPct = dailyMtmPeak > 0 ? (mtmEquity - dailyMtmPeak) / dailyMtmPeak * 100 : 0;
      if (mtmDdPct <= settings.intradayDdGuardPct) {
        guardTripped = true;
        guardBlockedDays.add(dayKey);
        guardBlockedEvents += candidates.length;
      }
    }

    // 4d) Process candidates in priority order. Each must pass shared
    //     risk-guard against the CURRENT (post-prior-candidate) state. This
    //     means earlier priority symbols are checked first; if they consume
    //     heat / cap budget, later symbols may be blocked.
    candidates.sort((a, b) => a.runtime.priority - b.runtime.priority);
    for (const c of candidates) {
      const r = c.runtime;
      let action = c.action;
      const next1m = r.data.bars1m[c.next1mIdx];
      // Roll back this candidate's signal-burned cooldown if it ends up blocked
      // (cooldownOnCommit mode). No-op in legacy signal-burn mode.
      const rb = () => { if (settings.cooldownOnCommit) restoreCgFadeCooldown(r.symbol, c.cdSnap); };

      // Intraday MTM drawdown guard: block all entries this step when tripped.
      if (guardTripped) { decisionStats[r.symbol].blocked += 1; rb(); continue; }

      // Funding window block
      if (isInFundingWindow(next1m.ts)) {
        if (process.env.DUMP_DECISIONS === '1') console.log(`DEC ${r.symbol} sig=${new Date(c.decisionBarTs).toISOString().slice(0, 16)} entry=${new Date(next1m.ts).toISOString().slice(0, 16)} ${action.side} → BLOCKED:funding-window`);
        decisionStats[r.symbol].blocked += 1;
        rb(); continue;
      }

      // rrTp2 quality gate
      const rrTp2Dist = action.tp2 != null ? Math.abs(action.tp2 - action.entryPrice) : Math.abs(action.tp1 - action.entryPrice);
      const stopDist = Math.abs(action.entryPrice - action.sl);
      if (stopDist > 0 && rrTp2Dist / stopDist < MIN_RR_TP2) {
        decisionStats[r.symbol].blocked += 1;
        rb(); continue;
      }

      // Shared risk-guard. Mirrors live behaviour: projectedRiskUsd uses the
      // ACTION sizePct (the base risk slot), even though scaled-in trades can
      // grow real risk up to ~1.75× on full deploy. This matches what
      // risk-guard.ts checks at signal time.
      const projectedRiskUsd = equityRef.value * (action.sizePct / 100);
      const check = checkBacktestRisk(riskState, r.symbol, next1m.ts, equityRef.value, projectedRiskUsd);
      if (!check.allowed) {
        if (process.env.DUMP_DECISIONS === '1') console.log(`DEC ${r.symbol} sig=${new Date(c.decisionBarTs).toISOString().slice(0, 16)} entry=${new Date(next1m.ts).toISOString().slice(0, 16)} ${action.side} → BLOCKED:${check.reason}`);
        decisionStats[r.symbol].blocked += 1;
        rb(); continue;
      }
      // Operator-set max parallel override. Default 6 is enforced by
      // checkBacktestRisk; if caller supplied a different cap, recheck here.
      if (maxParallelCap !== undefined && riskState.openPositions.size >= maxParallelCap) {
        decisionStats[r.symbol].blocked += 1;
        rb(); continue;
      }

      // ─── Open position ────────────────────────────────────────────────
      if (action.scaledIn) {
        const cfg = action.scaledIn;
        const dir = action.side === 'long' ? -1 : +1;
        const firstFillPrice = action.orderType === 'market'
          ? applySlippage(next1m.open, action.side, 'entry', settings.slippagePct)
          : action.entryPrice;
        // cronRealistic: НЕ сдвигаем action.sl/entryPrice. Live placeScaledIn вешает
        // SL/TP от strategy decision price, не от actual fill. Отменено 2026-05-29.
        const sizingMode = cfg.sizingMode ?? 'dca_boost';   // match live execute.ts default
        const decay = cfg.dcaBoostDecay ?? 0.5;
        const slotRiskPcts: number[] = [];
        if (sizingMode === 'custom_weights') {
          const weights = cfg.customWeights ?? [];
          for (let i = 0; i < cfg.nEntries; i++) {
            const w = weights[i] ?? 0;
            slotRiskPcts.push(action.sizePct * w);
          }
        } else if (sizingMode === 'equal_r') {
          for (let i = 0; i < cfg.nEntries; i++) slotRiskPcts.push(action.sizePct / cfg.nEntries);
        } else {
          for (let i = 0; i < cfg.nEntries; i++) slotRiskPcts.push(action.sizePct * Math.pow(decay, i));
        }
        const riskPerSlotPct = slotRiskPcts[0];
        const slotRiskUsd = equityRef.value * (riskPerSlotPct / 100);
        const slotDist = Math.abs(firstFillPrice - action.sl);
        if (slotDist <= 0) { decisionStats[r.symbol].blocked += 1; continue; }
        const firstQty = capSlotQty(slotRiskUsd / slotDist, equityRef.value, firstFillPrice, settings.leverage, settings.maxNotionalPctOfEquity);
        const firstFee = firstQty * firstFillPrice * (action.orderType === 'market' ? fees.taker : fees.maker);

        const pendingEntries: { price: number; level: number; riskPct: number }[] = [];
        for (let lvl = 1; lvl < cfg.nEntries; lvl++) {
          const ep = firstFillPrice + dir * lvl * cfg.spacingAtr * cfg.atr;
          const onCorrectSide = action.side === 'long' ? ep > action.sl : ep < action.sl;
          if (!onCorrectSide) continue;
          pendingEntries.push({ price: ep, level: lvl + 1, riskPct: slotRiskPcts[lvl] });
        }

        // TP anchored to firstFillPrice (legacy). Anchoring to action.tp1
        // in cronRealistic caused -8R artifacts on tight-SL DCA — reverted 2026-05-29.
        const tpInit = action.side === 'long'
          ? firstFillPrice + cfg.tpAtrMult * cfg.atr
          : firstFillPrice - cfg.tpAtrMult * cfg.atr;

        const pos: OpenPosition = {
          side: action.side,
          qty: firstQty,
          initialQty: firstQty,
          entry: firstFillPrice,
          entryTs: next1m.ts,
          sl: action.sl,
          initialSl: action.sl,
          tp1: tpInit,
          tp2: tpInit,
          tp1Hit: false,
          rationale: action.rationale,
          openFeesUsd: firstFee,
          fundingPaidUsd: 0,
          riskedUsd: firstQty * slotDist,
          lastScanned1mIdx: c.next1mIdx,
          scaledIn: {
            pendingEntries,
            cfg,
            riskPerSlotPct,
            filledLevels: [1],
          },
        };
        r.position = pos;
        riskState.openPositions.set(r.symbol, { riskedUsd: pos.riskedUsd, pair: r.symbol });
        recordBacktestEntry(riskState, next1m.ts);
        if (process.env.DUMP_DECISIONS === '1') console.log(`DEC ${r.symbol} sig=${new Date(c.decisionBarTs).toISOString().slice(0, 16)} entry=${new Date(next1m.ts).toISOString().slice(0, 16)} ${action.side} → OPENED`);
        decisionStats[r.symbol].opened += 1;
      } else {
        // Legacy single-entry path
        let fillPrice = action.orderType === 'market'
          ? applySlippage(next1m.open, action.side, 'entry', settings.slippagePct)
          : action.entryPrice;
        // LTF entry refinement (research, env-gated — no env = baseline). ENTRY_LIMIT_R>0
        // places a limit that much R better than the market/signal ref; fills if a 1m bar
        // reaches it within ENTRY_WINDOW_MIN. On no-fill: ENTRY_NOFILL=market → fallback
        // market at window end (never miss the trade); =skip → abandon the signal. SL/TP stay
        // signal-anchored, so a better fill = smaller risk + bigger reward at the same sizePct.
        let entryIdx = c.next1mIdx;
        const limR = parseFloat(process.env.ENTRY_LIMIT_R ?? '0');
        if (limR > 0 && action.orderType === 'market') {
          const ref = next1m.open;
          const sd0 = Math.abs(ref - action.sl);
          const limit = action.side === 'short' ? ref + limR * sd0 : ref - limR * sd0;
          const winMin = parseInt(process.env.ENTRY_WINDOW_MIN ?? '60', 10);
          const hiIdx = Math.min(c.next1mIdx + winMin, r.data.bars1m.length - 1);
          let fillIdx = -1;
          for (let i = c.next1mIdx; i <= hiIdx; i++) {
            const b = r.data.bars1m[i];
            if (action.side === 'short' ? b.high >= limit : b.low <= limit) { fillIdx = i; break; }
          }
          if (fillIdx >= 0) { fillPrice = limit; entryIdx = fillIdx; }
          else if ((process.env.ENTRY_NOFILL ?? 'market') === 'skip') {
            decisionStats[r.symbol].blocked += 1; rb(); continue;
          } else {
            fillPrice = applySlippage(r.data.bars1m[hiIdx].open, action.side, 'entry', settings.slippagePct);
            entryIdx = hiIdx;
          }
        }
        const entryBar = r.data.bars1m[entryIdx];
        const qty = calcQty(
          equityRef.value, action.sizePct, fillPrice, action.sl,
          settings.leverage, settings.maxNotionalPctOfEquity,
        );
        if (qty <= 0) { decisionStats[r.symbol].blocked += 1; continue; }
        const entryFee = qty * fillPrice * (action.orderType === 'market' ? fees.taker : fees.maker);
        const pos: OpenPosition = {
          side: action.side,
          qty,
          initialQty: qty,
          entry: fillPrice,
          entryTs: entryBar.ts,
          sl: action.sl,
          initialSl: action.sl,
          tp1: action.tp1,
          tp2: action.tp2,
          tp1Hit: false,
          rationale: action.rationale,
          openFeesUsd: entryFee,
          fundingPaidUsd: 0,
          riskedUsd: Math.abs(fillPrice - action.sl) * qty,
          lastScanned1mIdx: entryIdx,
        };
        r.position = pos;
        riskState.openPositions.set(r.symbol, { riskedUsd: pos.riskedUsd, pair: r.symbol });
        recordBacktestEntry(riskState, entryBar.ts);
        if (process.env.DUMP_DECISIONS === '1') console.log(`DEC ${r.symbol} sig=${new Date(c.decisionBarTs).toISOString().slice(0, 16)} entry=${new Date(next1m.ts).toISOString().slice(0, 16)} ${action.side} → OPENED`);
        decisionStats[r.symbol].opened += 1;
      }
    }
  }

  // ─── 5) Close any leftover positions at the last 1m bar (time stop) ───────
  for (const r of runtimes) {
    if (!r.position) continue;
    const pos = r.position;
    const bars1m = r.data.bars1m;
    if (bars1m.length === 0) continue;
    const last1m = bars1m[bars1m.length - 1];
    const fillPrice = applySlippage(last1m.close, pos.side, 'exit', settings.slippagePct);
    const exitFee = pos.qty * fillPrice * fees.taker;
    const tailPnl = pos.side === 'long'
      ? (fillPrice - pos.entry) * pos.qty
      : (pos.entry - fillPrice) * pos.qty;
    const totalFees = pos.openFeesUsd + exitFee;
    const grossPnl = ((pos as any).bankedPnl ?? 0) + tailPnl;
    const pnlR = pos.riskedUsd > 0 ? (grossPnl - exitFee - pos.fundingPaidUsd) / pos.riskedUsd : 0;
    const closed: ClosedTrade = {
      side: pos.side, symbol: r.symbol,
      entry: pos.entry, exit: fillPrice,
      entryTs: pos.entryTs, exitTs: last1m.ts,
      qty: pos.qty * (pos.tp1Hit ? 2 : 1),
      sl: pos.sl, initialSl: pos.initialSl, tp1: pos.tp1, tp2: pos.tp2,
      pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: pos.fundingPaidUsd,
      pnlR, exitReason: 'time_stop', rationale: pos.rationale,
      mfeR: (pos as any).mfeR ?? Math.max(0, pnlR),
      maeR: (pos as any).maeR ?? Math.min(0, pnlR),
      mfeTs: (pos as any).mfeTs ?? last1m.ts,
      maeTs: (pos as any).maeTs ?? last1m.ts,
    };
    trades.push(closed);
    equityRef.value += grossPnl - totalFees - pos.fundingPaidUsd;
    updateBacktestRiskOnClose(riskState, closed);
    r.position = null;
  }

  // Final equity sample
  equityCurve.push({ ts: settings.endTs, equity: equityRef.value });

  // ─── Honest intraday Daily-DD measurement (read-only post-pass) ──────────────
  // HyroTrader's killer is the DAILY trailing DD (−5% from the day's running peak).
  // The realized equityCurve above samples only at trade closes → understates it.
  // Here we walk a fine time grid and mark every open position to market each step,
  // tracking the worst intraday peak→trough drawdown PER UTC DAY. This is the figure
  // to compare against Hyro −5%. NOTE: positions are sized on the engine's
  // COMPOUNDING equity, whereas live sizes off a FIXED starting balance — so this
  // DDD is in the engine's sizing basis; a fixed-base run is needed for a 1:1 live
  // DDD. Decoupled from all risk-state (cannot affect trade selection).
  const dailyDd = computeIntradayDailyDd(trades, runtimes, settings.startEquity);
  log.info('intraday daily-DD (MTM)', dailyDd);
  if (settings.dailyDdFlattenPct != null) {
    let lb5 = 0, lb4 = 0;
    for (const v of liveDayWorstDd.values()) { if (v <= -5) lb5++; if (v <= -4) lb4++; }
    console.log(`  [AUTHORITATIVE 1m raw DD] worst ${liveWorstDd.toFixed(2)}% @ ${liveWorstDay}  −5%=${lb5}  −4%=${lb4}  (flatten fired ${flattenCount}× — measured on the exact grid+marks the flatten acts on)`);
  }

  log.info('portfolio backtest complete', {
    trades: trades.length,
    startEquity: settings.startEquity,
    endEquity: equityRef.value,
    return: ((equityRef.value - settings.startEquity) / settings.startEquity * 100).toFixed(2) + '%',
  });

  return {
    trades,
    equityCurve,
    startEquity: settings.startEquity,
    endEquity: equityRef.value,
    decisionStats,
    dailyDd,
    guard: { blockedDays: guardBlockedDays.size, blockedEvents: guardBlockedEvents, flattenDays: flattenCount },
  };
}

// Mark a single open trade's unrealized $ contribution at a given price, BOUNDED to
// the trade's TRUE intraday excursion envelope [maeR, mfeR] × riskedUsd. The naive
// (price − finalAvgEntry) × fullQty back-projects the post-DCA average and full size
// onto the position's early life — for a DCA-down entry the early price sits ABOVE
// the final avg (later slots fill lower), inventing a phantom unrealized profit
// (observed: an LTC trade that closed at SL was marked +$48k mid-flight, inflating
// the day's peak and the Daily-DD from ~−2% to −8.8%). mfeR/maeR are computed during
// resolution with the EVOLVING qty/entry, so they are the phantom-free bound.
// Fallback to the [initialSl, tp1] price corridor when excursions are absent.
function markContribution(tr: ClosedTrade, rawMark: number): number {
  const dir = tr.side === 'long' ? 1 : -1;
  let c = (rawMark - tr.entry) * tr.qty * dir;
  if (tr.mfeR !== undefined || tr.maeR !== undefined) {
    const riskedUsd = Math.abs(tr.entry - tr.initialSl) * tr.qty;
    const favCap = (tr.mfeR ?? 0) * riskedUsd;
    const advCap = (tr.maeR ?? 0) * riskedUsd;
    if (c > favCap) c = favCap;
    if (c < advCap) c = advCap;
  } else {
    const lo = Math.min(tr.initialSl, tr.tp1), hi = Math.max(tr.initialSl, tr.tp1);
    const m = rawMark < lo ? lo : rawMark > hi ? hi : rawMark;
    c = (m - tr.entry) * tr.qty * dir;
  }
  return c;
}

/**
 * Read-only intraday Daily-DD: walk a fine grid, mark every open position via
 * markContribution() (bounded to its true [maeR, mfeR] excursion — kills the DCA
 * back-projection phantom), track per-UTC-day worst (trough−peak)/peak from the
 * day's RUNNING peak (HyroTrader trailing-daily semantics). Returns worst day + how
 * many days would breach −5% (Hyro), −4% / −2.5% (our internal kills). stepMs 15min.
 */
function computeIntradayDailyDd(
  trades: ClosedTrade[],
  runtimes: SymbolRuntime[],
  startEquity: number,
  stepMs = 15 * 60_000,
): { worstDailyDdPct: number; worstDay: string; daysBreach5: number; daysBreach4: number; daysBreach25: number; samples: number; balWorstDailyDdPct: number; balWorstDay: string; balDaysBreach5: number; balDaysBreach4: number } {
  if (trades.length === 0) return { worstDailyDdPct: 0, worstDay: '', daysBreach5: 0, daysBreach4: 0, daysBreach25: 0, samples: 0, balWorstDailyDdPct: 0, balWorstDay: '', balDaysBreach5: 0, balDaysBreach4: 0 };
  const bySym = new Map(runtimes.map(r => [r.symbol, r]));
  const opens = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  const closes = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  let oi = 0, ci = 0, realized = 0;
  const active = new Set<ClosedTrade>();
  const tStart = opens[0].entryTs;
  const tEnd = closes[closes.length - 1].exitTs;
  let curDay = '', dayPeak = 0, dayTrough = 0, worst = 0, worstDay = '', samples = 0;
  const dayWorst = new Map<string, number>();
  // Balance-based (realized-only) daily DD, parallel to the MTM one. Some prop
  // firms measure the daily trailing limit on BALANCE (closed P&L) not EQUITY
  // (balance + floating). On balance, intraday unrealized swings that recover
  // before close do NOT count → far smaller DD. Tracked from the running daily
  // peak of realized equity, reset each UTC day (same trailing semantics).
  let balDayPeak = 0, balDayTrough = 0, balWorst = 0, balWorstDay = '';
  const balDayWorst = new Map<string, number>();
  const debug = !!process.env.DDD_DEBUG;
  let worstSnap = '';
  for (let t = tStart; t <= tEnd; t += stepMs) {
    while (ci < closes.length && closes[ci].exitTs <= t) { realized += closes[ci].pnlUsd; active.delete(closes[ci]); ci++; }
    while (oi < opens.length && opens[oi].entryTs <= t) { if (opens[oi].exitTs > t) active.add(opens[oi]); oi++; }
    let unreal = 0;
    const contribs: string[] = [];
    for (const tr of active) {
      const rt = bySym.get(tr.symbol); if (!rt) continue;
      const tMin = t - (t % 60_000);
      const idx = rt.tsTo1mIdx.get(tMin);
      const rawMark = idx !== undefined ? rt.data.bars1m[idx].close : tr.entry;
      const c = markContribution(tr, rawMark);
      unreal += c;
      if (debug) contribs.push(`${tr.symbol}:${tr.side} qty=${tr.qty.toFixed(1)} raw=${rawMark.toFixed(4)} entry=${tr.entry.toFixed(4)} contrib=$${c.toFixed(0)} [mfeR=${(tr.mfeR??0).toFixed(2)} maeR=${(tr.maeR??0).toFixed(2)}]`);
    }
    const eq = startEquity + realized + unreal;
    const bal = startEquity + realized;
    const day = new Date(t).toISOString().slice(0, 10);
    if (day !== curDay) {
      curDay = day;
      dayPeak = eq; dayTrough = eq;
      balDayPeak = bal; balDayTrough = bal;
    } else {
      if (eq > dayPeak) { dayPeak = eq; dayTrough = eq; } else if (eq < dayTrough) dayTrough = eq;
      if (bal > balDayPeak) { balDayPeak = bal; balDayTrough = bal; } else if (bal < balDayTrough) balDayTrough = bal;
    }
    const dd = dayPeak > 0 ? (dayTrough - dayPeak) / dayPeak * 100 : 0;
    const balDd = balDayPeak > 0 ? (balDayTrough - balDayPeak) / balDayPeak * 100 : 0;
    if (dd < (dayWorst.get(day) ?? 0)) dayWorst.set(day, dd);
    if (balDd < (balDayWorst.get(day) ?? 0)) balDayWorst.set(day, balDd);
    if (balDd < balWorst) { balWorst = balDd; balWorstDay = day; }
    if (dd < worst) {
      worst = dd; worstDay = day;
      if (debug) worstSnap = `[DDD_DEBUG] worst @ ${new Date(t).toISOString()} dd=${dd.toFixed(2)}% eq=$${eq.toFixed(0)} dayPeak=$${dayPeak.toFixed(0)} dayTrough=$${dayTrough.toFixed(0)} realized=$${realized.toFixed(0)} unreal=$${unreal.toFixed(0)} active=${active.size}\n    ${contribs.join('\n    ')}`;
    }
    samples++;
  }
  let d5 = 0, d4 = 0, d25 = 0;
  for (const v of dayWorst.values()) { if (v <= -5) d5++; if (v <= -4) d4++; if (v <= -2.5) d25++; }
  let bd5 = 0, bd4 = 0;
  for (const v of balDayWorst.values()) { if (v <= -5) bd5++; if (v <= -4) bd4++; }
  if (debug && worstSnap) {
    console.log(worstSnap);
    const wdStart = Date.parse(worstDay + 'T00:00:00.000Z');
    const wdEnd = wdStart + 24 * 3600_000;
    // Fresh second pass over JUST the worst day: print eq/realized/unreal per step.
    let r2 = 0; const act2 = new Set<ClosedTrade>(); let oi2 = 0, ci2 = 0;
    while (ci2 < closes.length && closes[ci2].exitTs <= wdStart) { r2 += closes[ci2].pnlUsd; ci2++; }
    while (oi2 < opens.length && opens[oi2].entryTs <= wdStart) { if (opens[oi2].exitTs > wdStart) act2.add(opens[oi2]); oi2++; }
    console.log(`[DDD_DEBUG] === worst-day walk ${worstDay} (realizedAtDayStart=$${r2.toFixed(0)}) ===`);
    for (let t = wdStart; t < wdEnd; t += stepMs) {
      while (ci2 < closes.length && closes[ci2].exitTs <= t) { r2 += closes[ci2].pnlUsd; act2.delete(closes[ci2]); ci2++; }
      while (oi2 < opens.length && opens[oi2].entryTs <= t) { if (opens[oi2].exitTs > t) act2.add(opens[oi2]); oi2++; }
      let u2 = 0; const parts: string[] = [];
      for (const tr of act2) {
        const rt = bySym.get(tr.symbol); if (!rt) continue;
        const idx = rt.tsTo1mIdx.get(t - (t % 60_000));
        const raw = idx !== undefined ? rt.data.bars1m[idx].close : tr.entry;
        const c = markContribution(tr, raw);
        u2 += c; parts.push(`${tr.symbol}=$${c.toFixed(0)}`);
      }
      const eq2 = startEquity + r2 + u2;
      console.log(`    ${new Date(t).toISOString().slice(11,16)} eq=$${eq2.toFixed(0)} realized=$${r2.toFixed(0)} unreal=$${u2.toFixed(0)} active=${act2.size} [${parts.join(' ')}]`);
    }
  }
  return {
    worstDailyDdPct: Number(worst.toFixed(2)), worstDay, daysBreach5: d5, daysBreach4: d4, daysBreach25: d25, samples,
    balWorstDailyDdPct: Number(balWorst.toFixed(2)), balWorstDay, balDaysBreach5: bd5, balDaysBreach4: bd4,
  };
}

export type Side = 'long' | 'short';

export interface Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Optional scaled-in entry config — when present, engine treats the trade as
// N limit orders spaced by k·ATR. TP is recomputed from running avg entry on
// each fill.
//
// sizingMode controls how per-slot qty is computed:
//   - 'equal_r' (legacy): each slot risks sizePct/N R. Single-fill → under-sized
//     by factor N (1/3 baseline R for n=3). Failed BTC backtest 2026-05-24.
//   - 'dca_boost' (recommended): slot #0 risks full sizePct R (baseline-equivalent).
//     Each subsequent slot adds dcaBoostDecay × previous slot risk. Single-fill =
//     baseline trade. Full deploy = (1 + decay + decay² + …) R total risk. With
//     decay=0.5 and N=3, full deploy = 1.75 R worst-case (0.875% deposit at
//     sizePct=0.5 — under HyroTrader daily DD limit).
export interface ScaledInConfig {
  nEntries: number;        // # of limit orders incl. first (typically 3)
  spacingAtr: number;      // each next entry at first ± k·ATR
  atr: number;             // ATR(14) at signal time — used for spacing + TP
  tpAtrMult: number;       // TP price = avgEntry ± tpAtrMult·ATR (recomputed each fill)
  sizingMode?: 'equal_r' | 'dca_boost' | 'custom_weights';   // default 'equal_r' for back-compat
  dcaBoostDecay?: number;  // used when sizingMode='dca_boost' (default 0.5)
  // Used when sizingMode='custom_weights' — explicit risk fraction per slot.
  // Each entry: fraction of sizePct used for that slot. Sum can be ≷ 1.
  // Example: [0.17, 0.17, 0.34] means slot0 risks 0.17·sizePct, etc; total 0.68·sizePct.
  customWeights?: number[];
  // If true (default), TP price recomputes to (running_avg ± tpAtrMult·ATR) on
  // each DCA fill — moves TP closer when avg drops. If false, TP locks at the
  // initial signal price ± tpAtrMult·ATR and never moves; DCA fills then deliver
  // larger qty at the same exit price → bigger R per win (but price must travel
  // further to reach TP from a deeper fill).
  tpRecomputeOnFill?: boolean;
}

// Action returned by a strategy on each decision tick (1H close).
export type Action =
  | {
      kind: 'enter';
      side: Side;
      orderType: 'market' | 'limit';
      entryPrice: number;       // for limit: target; for market: signal close
      sl: number;
      tp1: number;
      tp2?: number;
      sizePct: number;          // 0.6 means 0.6% risk
      rationale: string;
      scaledIn?: ScaledInConfig;  // optional: convert to multi-entry trade
      // Resting-limit TTL (Phase 2, v5): cancel the unfilled entry after this many
      // minutes. srcNew-validated 230 — expires 10 min before the next 4H boundary.
      ttlMinutes?: number;
    }
  | { kind: 'exit'; reason: string }
  | { kind: 'hold' };

export interface OpenPosition {
  side: Side;
  qty: number;                // current qty (decremented after TP1 partial)
  initialQty: number;         // qty at entry
  entry: number;              // avg entry price (mutates as DCA orders fill)
  entryTs: number;
  sl: number;                 // current SL (mutates to breakeven after TP1)
  initialSl: number;          // SL at entry — used for riskedUsd calc
  tp1: number;
  tp2?: number;
  tp1Hit: boolean;
  rationale: string;
  openFeesUsd: number;
  fundingPaidUsd: number;
  riskedUsd: number;          // |entry - initialSl| × initialQty (running max as DCA orders fill)
  lastScanned1mIdx?: number;  // last 1m bar index already scanned for SL/TP/funding (advances each cycle to prevent funding double-count)
  // Scaled-in state (multi-entry trade). Undefined for legacy single-entry trades.
  scaledIn?: {
    pendingEntries: { price: number; level: number; riskPct: number }[];  // remaining unfilled limits (each with its own risk %)
    cfg: ScaledInConfig;
    riskPerSlotPct: number;  // legacy: kept for back-compat; per-slot %s now in pendingEntries[].riskPct
    filledLevels: number[];   // levels of filled entries (incl. #1)
  };
}

export interface ClosedTrade {
  side: Side;
  symbol: string;
  entry: number;
  exit: number;
  entryTs: number;
  exitTs: number;
  qty: number;
  sl: number;
  initialSl: number;          // SL at open (pre-TP1-BE-move); used for honest intraday DD clamp
  tp1: number;
  tp2?: number;
  pnlUsd: number;
  feesUsd: number;
  fundingUsd: number;
  pnlR: number;               // (pnl - fees - funding) / risked_usd
  exitReason: 'sl' | 'tp1' | 'tp2' | 'tp1_then_sl_be' | 'time_stop' | 'strategy_exit' | 'dd_flatten';
  rationale: string;
  // MAE/MFE — Max Adverse / Favorable Excursion in R units, computed bar-by-bar
  // during the position's lifetime. Enables honest MTM (mark-to-market) intraday
  // DDD calculation downstream (peak-to-trough within a calendar day). Without
  // these, daily DDD is close-only granularity and systematically underestimates
  // real-world trailing-peak drawdown.
  mfeR?: number;              // best unrealized R seen during trade life (≥ 0)
  maeR?: number;              // worst unrealized R seen during trade life (≤ 0)
  mfeTs?: number;             // timestamp of MFE
  maeTs?: number;             // timestamp of MAE
}

export interface BacktestSettings {
  symbol: string;
  startTs: number;
  endTs: number;
  startEquity: number;
  takerFeeRate: number;       // 0.00055 for Bybit perp taker
  makerFeeRate: number;       // 0.0002
  slippagePct: number;        // applied to entry/exit price
  riskPctBase: number;        // 0.6 means 0.6% per trade
  leverage: number;           // 10
  maxNotionalPctOfEquity?: number; // cap notional to N% of equity (default = leverage×100, i.e. no extra cap)
  // After TP1 fills, what to do with SL on remaining 50%:
  //  'be' — move to entry (breakeven, original behavior)
  //  'be_plus' — move to entry × (1 ± bePlusBufferPct/100) — covers fees+slippage
  //  'no_move' — keep initial SL (let it ride to TP2 or original SL)
  //  'halfway' — move to halfway between entry and initial SL (still risk, but reduced)
  tp1SlMode?: 'be' | 'be_plus' | 'no_move' | 'halfway';
  bePlusBufferPct?: number;   // default 0.10 (= 0.10%)
  decisionTf?: '60m' | '240m';  // default '60m' (1H decisions); set '240m' for 4H
  // Time stop: close position if held longer than this many ms after entry
  maxHoldMs?: number;
  // Live-cron-realistic mode (2026-05-29): когда true, entry откладывается до
  // следующего HH:00 (cron-tick) после закрытия decision-бара, пропуская funding
  // window. Воспроизводит реальную задержку live-execution. По умолчанию false —
  // существующие бэктесты остаются неизменными.
  cronRealistic?: boolean;
}

export interface BacktestResult {
  symbol: string;
  trades: ClosedTrade[];
  startEquity: number;
  endEquity: number;
  metrics: BacktestMetrics;
  equityCurve: { ts: number; equity: number }[];
}

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  avgR: number;
  expectancyR: number;
  profitFactor: number;       // sum_wins / abs(sum_losses)
  maxDDPct: number;           // % of starting equity
  maxDDUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  sharpe: number;             // annualized, using daily R
  bestTradeR: number;
  worstTradeR: number;
  avgWinR: number;
  avgLossR: number;
}

// Strategy interface — pure function, called on each 1H close.
// Returns the action for that bar. Strategy may also need higher-TF context
// (60m features, 240m features), passed via the `ctx` field.
export interface StrategyContext {
  symbol: string;
  ts: number;
  price: number;
  features1h: any;            // FeatureSnapshot, kept loose to avoid circular import
  features15m?: any;
  features5m?: any;
  features4h?: any;
  featuresD?: any;
  featuresW?: any;
  fundingRate?: number;
  position: OpenPosition | null;
  coinglass?: any;
  recentBars?: Bar[];          // last 30 bars at decisionTf — enables structural SL placement
  bars1hRecent?: Bar[];        // last 200 closed 1H bars — for intraday VP construction
  bars1dRecent?: Bar[];        // last 60 closed 1D bars — for daily VP / structural levels
  bars1wRecent?: Bar[];        // last 12 closed 1W bars — for PWL/PWH
  // BTC 4H bars for cross-pair macro filters (CG fade strategies use this on altcoins).
  // Always loaded for non-BTC symbols when strategy.needsBtcContext = true.
  btcBars4hRecent?: Bar[];
  // BTC Coinglass features for cross-pair sentiment signals (v5 cgSlowFade btc-signal
  // mode trades alts off BTC positioning extremes). For BTCUSDT this equals coinglass.
  btcCoinglass?: any;
  // Live ticker price at decision time (set ONLY by scan-decide; engines leave it
  // unset → strategies fall back to ctx.price). Phase 2 limit entries anchor the
  // limit at the CURRENT price ∓ offset: srcNew used the 1m close at decisionTs
  // (boundary + 60s), and the live ticker at scan time (~boundary + 90s) is the
  // faithful equivalent. ctx.price (4H anchor close) stays the signal anchor.
  livePrice?: number;
  // Last closed trade on THIS symbol (any reason: tp/sl/strategy_exit). Set by
  // engine after each close. Strategies use this to implement cooldown-after-TP
  // (prevent re-entry into a freshly-resolved cycle).
  lastClosedTrade?: { exitTs: number; exitReason: ClosedTrade['exitReason']; side: Side };
  // Cross-process same-direction cooldown snapshot. Populated ONLY by the live
  // scan-decide loop (loaded once per cycle from `strategy_cooldowns` table).
  // Backtest engines leave this undefined — the cg-fade strategy falls back to
  // its in-process Map, which is fine for a single-process backtest run.
  // Key: symbol. Value: { side, ts } of the most recent entry on that symbol.
  cooldownState?: Map<string, { side: Side; ts: number }>;
}

export interface Strategy {
  name: string;
  // True if strategy needs Coinglass features in ctx. Engine pre-loads them only for these.
  // Strategies without this flag get ctx.coinglass = undefined (cheaper).
  needsCoinglass?: boolean;
  // True if strategy needs BTC 4H bars for cross-pair macro filter (CG-fade altcoin strategies).
  // Engine loads BTCUSDT 4H bars and populates ctx.btcBars4hRecent. For BTC backtests this is a no-op.
  needsBtcContext?: boolean;
  // True if live scan-decide must call decide() at most ONCE per closed 4H anchor bar
  // (v5 cgSlowFade contract — the validated srcNew engine consumes a decision bar even
  // when the signal is blocked, so hourly cron retries on the same anchor are forbidden).
  // Enforced by scan-decide via src/core/decided-anchors.ts; legacy strategies without
  // this flag keep their validated hourly re-evaluation semantics.
  decideOncePerAnchor?: boolean;
  // How many 4H buckets to LAG the live Coinglass read behind the anchor bar (default 0).
  // v5 cgSlowFade sets 1: the validating srcNew engine ran with cgPublishLagMs(120s) >
  // gapMs(60s), so its "current" CG point at decision D was the bucket closed at D−4h,
  // already revision-settled. Reading the just-closed bucket instead (lag 0) doubled
  // MTM maxDD (−12.25% vs −6.92%) at equal return in the 2026-06-10 policy experiments
  // (srcNew/backtest/cli/live-policy-experiments.ts) — fresher crowd data is NOT better.
  cgReadLagBars?: number;
  decide(ctx: StrategyContext): Action;
}

export type Side = 'long' | 'short';

export interface Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
    }
  | { kind: 'exit'; reason: string }
  | { kind: 'hold' };

export interface OpenPosition {
  side: Side;
  qty: number;                // current qty (decremented after TP1 partial)
  initialQty: number;         // qty at entry
  entry: number;
  entryTs: number;
  sl: number;                 // current SL (mutates to breakeven after TP1)
  initialSl: number;          // SL at entry — used for riskedUsd calc
  tp1: number;
  tp2?: number;
  tp1Hit: boolean;
  rationale: string;
  openFeesUsd: number;
  fundingPaidUsd: number;
  riskedUsd: number;          // |entry - initialSl| × initialQty
  lastScanned1mIdx?: number;  // last 1m bar index already scanned for SL/TP/funding (advances each cycle to prevent funding double-count)
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
  tp1: number;
  tp2?: number;
  pnlUsd: number;
  feesUsd: number;
  fundingUsd: number;
  pnlR: number;               // (pnl - fees - funding) / risked_usd
  exitReason: 'sl' | 'tp1' | 'tp2' | 'tp1_then_sl_be' | 'time_stop' | 'strategy_exit';
  rationale: string;
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
  decisionTf?: '60m' | '240m';  // default '60m' (1H decisions); set '240m' for 4H
  // Time stop: close position if held longer than this many ms after entry
  maxHoldMs?: number;
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
}

export interface Strategy {
  name: string;
  // True if strategy needs Coinglass features in ctx. Engine pre-loads them only for these.
  // Strategies without this flag get ctx.coinglass = undefined (cheaper).
  needsCoinglass?: boolean;
  decide(ctx: StrategyContext): Action;
}

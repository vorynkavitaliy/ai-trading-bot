// Types for the Claude-Walk backtest (Stage 3.5).
// I (the LLM) play the trader role on historical snapshots, decisions are written
// to vault/Backtest/decisions/{id}.md, then resolve.ts simulates outcomes.

export interface CandidateReason {
  kind: 'bb_touch_lower' | 'bb_touch_upper' | 'ema55_pullback' | 'rsi_extreme_low' | 'rsi_extreme_high' | 'volume_spike';
  detail: string;
}

export interface SnapshotMeta {
  id: string;                     // e.g. BTCUSDT_2025-08-12T14-00
  symbol: string;
  ts: number;                     // 1H close ts
  iso: string;                    // ISO string for human read
  reasons: CandidateReason[];     // why this is a candidate
  price: number;
}

export interface QueueEntry {
  id: string;
  symbol: string;
  ts: number;
  iso: string;
  snapshotPath: string;
  status: 'pending' | 'decided' | 'resolved';
  reasons: string[];              // shorthand for queue display
}

// Cross-exchange aggregates from Coinglass at the moment of the candidate.
// All fields use values at-or-before meta.ts (no lookahead).
export interface CoinglassFeatures {
  // Aggregated OI (USD)
  oi_close: number | null;
  oi_delta_24h: number | null;            // close − close 24h before
  oi_pct_chg_24h: number | null;
  // Funding (cross-exchange, fraction; 0.0001 = 0.01%)
  funding_oi_weighted: number | null;
  funding_vol_weighted: number | null;
  // L/S ratios on Binance
  ls_global_account: number | null;       // retail sentiment
  ls_top_account: number | null;          // top-trader by account count
  ls_top_position: number | null;         // top-trader by capital
  // Aggregated liquidation across major venues (USD, sum of last 6 4h-bars = 24h)
  liq_long_24h_usd: number | null;
  liq_short_24h_usd: number | null;
  // Aggregated taker buy/sell (USD, last 24h)
  taker_buy_24h_usd: number | null;
  taker_sell_24h_usd: number | null;
  taker_delta_24h_usd: number | null;     // buy − sell (positive = aggressive buying)
}

// Snapshot loaded by Claude when deciding. Keep it compact — every byte is context cost.
export interface Snapshot {
  meta: SnapshotMeta;
  // Bars — recent windows only. OHLCV only, no derived fields embedded.
  bars1h: { ts: number; o: number; h: number; l: number; c: number; v: number }[];     // last 50
  bars15m: { ts: number; o: number; h: number; l: number; c: number; v: number }[];    // last 100
  bars5m: { ts: number; o: number; h: number; l: number; c: number; v: number }[];     // last 100
  // Features at this moment
  features: {
    h1: any;     // FeatureSnapshot
    m15: any;
    m5: any;
  };
  fundingRate: number | null;
  // Cross-exchange aggregates (Coinglass)
  coinglass: CoinglassFeatures;
  // Reference levels for the decision template (Claude can ignore but they help)
  hint: {
    bb_upper_1h: number | null;
    bb_middle_1h: number | null;
    bb_lower_1h: number | null;
    ema55_1h: number | null;
    atr_1h: number | null;
    adx_1h: number | null;
  };
}

export type Decision =
  | {
      kind: 'enter';
      side: 'long' | 'short';
      entryPrice: number;
      sl: number;
      tp1: number;
      tp2?: number;
      sizePct: number;
      rationale: string;
    }
  | { kind: 'skip'; reason: string };

export type DecisionRecord = Decision & {
  id: string;
  symbol: string;
  ts: number;
  decidedAt: string;     // ISO
};

export interface Outcome {
  id: string;
  symbol: string;
  decision: DecisionRecord;
  // Simulated result (only meaningful for kind === 'enter')
  trade?: {
    entry: number;
    exit: number;
    exitTs: number;
    pnlR: number;
    pnlUsd: number;
    feesUsd: number;
    fundingUsd: number;
    exitReason: string;
  };
}

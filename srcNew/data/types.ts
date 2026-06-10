export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SeriesPoint {
  ts: number;
  values: Record<string, number>;
}

export type CgSeriesName =
  | 'oi_aggregated'
  | 'funding_oi_weighted'
  | 'ls_global_account'
  | 'ls_top_account'
  | 'ls_top_position'
  | 'liquidation_pair'
  | 'taker_pair';

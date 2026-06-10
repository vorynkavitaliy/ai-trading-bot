export interface CgEnvelope<T> {
  code: string | number;
  msg?: string;
  data: T;
}

export type CgInterval =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '8h'
  | '12h'
  | '1d'
  | '1w';

export interface CgOhlc {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

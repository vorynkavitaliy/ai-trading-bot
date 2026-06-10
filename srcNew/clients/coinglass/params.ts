import { QueryValue } from '../../core/http';
import { CgInterval } from './types';

export interface PairSeriesParams {
  exchange: string;
  symbol: string;
  interval: CgInterval;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface CoinSeriesParams {
  symbol: string;
  interval: CgInterval;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface AggregatedSeriesParams {
  exchangeList: string;
  symbol: string;
  interval: CgInterval;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export function pairSeriesQuery(params: PairSeriesParams): Record<string, QueryValue> {
  return {
    exchange: params.exchange,
    symbol: params.symbol,
    interval: params.interval,
    limit: params.limit,
    start_time: params.startTime,
    end_time: params.endTime,
  };
}

export function coinSeriesQuery(params: CoinSeriesParams): Record<string, QueryValue> {
  return {
    symbol: params.symbol,
    interval: params.interval,
    limit: params.limit,
    start_time: params.startTime,
    end_time: params.endTime,
  };
}

export function aggregatedSeriesQuery(params: AggregatedSeriesParams): Record<string, QueryValue> {
  return {
    exchange_list: params.exchangeList,
    symbol: params.symbol,
    interval: params.interval,
    limit: params.limit,
    start_time: params.startTime,
    end_time: params.endTime,
  };
}

import { AggregatedSeriesParams, PairSeriesParams, aggregatedSeriesQuery, pairSeriesQuery } from '../params';
import { CgLiquidationCoin, CgLiquidationExchange, CgLiquidationHistoryPoint } from '../responses';
import { CgTransport } from '../transport';
import { CgRange } from '../types';

export class LiquidationEndpoints {
  constructor(private readonly transport: CgTransport) {}

  getHistory(params: PairSeriesParams): Promise<CgLiquidationHistoryPoint[]> {
    return this.transport.request<CgLiquidationHistoryPoint[]>(
      '/futures/liquidation/history',
      pairSeriesQuery(params),
    );
  }

  getAggregatedHistory(params: AggregatedSeriesParams): Promise<CgLiquidationHistoryPoint[]> {
    return this.transport.request<CgLiquidationHistoryPoint[]>(
      '/futures/liquidation/aggregated-history',
      aggregatedSeriesQuery(params),
    );
  }

  getCoinList(exchange?: string): Promise<CgLiquidationCoin[]> {
    return this.transport.request<CgLiquidationCoin[]>('/futures/liquidation/coin-list', { exchange });
  }

  getExchangeList(range: CgRange, symbol?: string): Promise<CgLiquidationExchange[]> {
    return this.transport.request<CgLiquidationExchange[]>('/futures/liquidation/exchange-list', {
      range,
      symbol,
    });
  }
}

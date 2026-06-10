import { AggregatedSeriesParams, PairSeriesParams, aggregatedSeriesQuery, pairSeriesQuery } from '../params';
import { CgOrderbookHistoryPoint } from '../responses';
import { CgTransport } from '../transport';

export interface OrderbookPairParams extends PairSeriesParams {
  range?: number;
}

export interface OrderbookAggregatedParams extends AggregatedSeriesParams {
  range?: number;
}

export class OrderbookEndpoints {
  constructor(private readonly transport: CgTransport) {}

  getAskBidsHistory(params: OrderbookPairParams): Promise<CgOrderbookHistoryPoint[]> {
    return this.transport.request<CgOrderbookHistoryPoint[]>('/futures/orderbook/ask-bids-history', {
      ...pairSeriesQuery(params),
      range: params.range,
    });
  }

  getAggregatedAskBidsHistory(params: OrderbookAggregatedParams): Promise<CgOrderbookHistoryPoint[]> {
    return this.transport.request<CgOrderbookHistoryPoint[]>(
      '/futures/orderbook/aggregated-ask-bids-history',
      {
        ...aggregatedSeriesQuery(params),
        range: params.range,
      },
    );
  }
}

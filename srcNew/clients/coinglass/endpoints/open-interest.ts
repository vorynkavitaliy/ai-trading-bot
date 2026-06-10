import { CoinSeriesParams, PairSeriesParams, coinSeriesQuery, pairSeriesQuery } from '../params';
import { CgOhlcBar, CgOpenInterestExchange } from '../responses';
import { CgTransport } from '../transport';

export class OpenInterestEndpoints {
  constructor(private readonly transport: CgTransport) {}

  getHistory(params: PairSeriesParams): Promise<CgOhlcBar[]> {
    return this.transport.request<CgOhlcBar[]>('/futures/open-interest/history', pairSeriesQuery(params));
  }

  getAggregatedHistory(params: CoinSeriesParams): Promise<CgOhlcBar[]> {
    return this.transport.request<CgOhlcBar[]>(
      '/futures/open-interest/aggregated-history',
      coinSeriesQuery(params),
    );
  }

  getExchangeList(symbol: string): Promise<CgOpenInterestExchange[]> {
    return this.transport.request<CgOpenInterestExchange[]>('/futures/open-interest/exchange-list', {
      symbol,
    });
  }
}

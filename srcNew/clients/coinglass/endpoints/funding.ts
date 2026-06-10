import { CoinSeriesParams, PairSeriesParams, coinSeriesQuery, pairSeriesQuery } from '../params';
import { CgOhlcBar } from '../responses';
import { CgTransport } from '../transport';

export class FundingEndpoints {
  constructor(private readonly transport: CgTransport) {}

  getHistory(params: PairSeriesParams): Promise<CgOhlcBar[]> {
    return this.transport.request<CgOhlcBar[]>('/futures/funding-rate/history', pairSeriesQuery(params));
  }

  getOiWeightHistory(params: CoinSeriesParams): Promise<CgOhlcBar[]> {
    return this.transport.request<CgOhlcBar[]>(
      '/futures/funding-rate/oi-weight-history',
      coinSeriesQuery(params),
    );
  }

  getVolWeightHistory(params: CoinSeriesParams): Promise<CgOhlcBar[]> {
    return this.transport.request<CgOhlcBar[]>(
      '/futures/funding-rate/vol-weight-history',
      coinSeriesQuery(params),
    );
  }
}

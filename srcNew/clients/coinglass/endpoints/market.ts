import { PairSeriesParams, pairSeriesQuery } from '../params';
import { CgCoinMarket, CgInstrument, CgPairMarket, CgPriceOhlcBar } from '../responses';
import { CgTransport } from '../transport';

export interface CoinsMarketsParams {
  exchangeList?: string;
  perPage?: number;
  page?: number;
}

export class MarketEndpoints {
  constructor(private readonly transport: CgTransport) {}

  getSupportedCoins(): Promise<string[]> {
    return this.transport.request<string[]>('/futures/supported-coins');
  }

  getSupportedExchanges(): Promise<string[]> {
    return this.transport.request<string[]>('/futures/supported-exchanges');
  }

  getSupportedExchangePairs(exchange?: string): Promise<Record<string, CgInstrument[]>> {
    return this.transport.request<Record<string, CgInstrument[]>>(
      '/futures/supported-exchange-pairs',
      { exchange },
    );
  }

  getCoinsMarkets(params: CoinsMarketsParams = {}): Promise<CgCoinMarket[]> {
    return this.transport.request<CgCoinMarket[]>('/futures/coins-markets', {
      exchange_list: params.exchangeList,
      per_page: params.perPage,
      page: params.page,
    });
  }

  getPairsMarkets(symbol: string): Promise<CgPairMarket[]> {
    return this.transport.request<CgPairMarket[]>('/futures/pairs-markets', { symbol });
  }

  getPriceHistory(params: PairSeriesParams): Promise<CgPriceOhlcBar[]> {
    return this.transport.request<CgPriceOhlcBar[]>('/futures/price/history', pairSeriesQuery(params));
  }
}

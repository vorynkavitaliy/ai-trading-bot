import { PairSeriesParams, pairSeriesQuery } from '../params';
import {
  CgGlobalAccountRatioPoint,
  CgTakerVolumeSnapshot,
  CgTopAccountRatioPoint,
  CgTopPositionRatioPoint,
} from '../responses';
import { CgTransport } from '../transport';
import { CgRange } from '../types';

export class PositioningEndpoints {
  constructor(private readonly transport: CgTransport) {}

  getGlobalAccountRatio(params: PairSeriesParams): Promise<CgGlobalAccountRatioPoint[]> {
    return this.transport.request<CgGlobalAccountRatioPoint[]>(
      '/futures/global-long-short-account-ratio/history',
      pairSeriesQuery(params),
    );
  }

  getTopAccountRatio(params: PairSeriesParams): Promise<CgTopAccountRatioPoint[]> {
    return this.transport.request<CgTopAccountRatioPoint[]>(
      '/futures/top-long-short-account-ratio/history',
      pairSeriesQuery(params),
    );
  }

  getTopPositionRatio(params: PairSeriesParams): Promise<CgTopPositionRatioPoint[]> {
    return this.transport.request<CgTopPositionRatioPoint[]>(
      '/futures/top-long-short-position-ratio/history',
      pairSeriesQuery(params),
    );
  }

  getTakerVolumeExchangeList(symbol: string, range: CgRange): Promise<CgTakerVolumeSnapshot> {
    return this.transport.request<CgTakerVolumeSnapshot>(
      '/futures/taker-buy-sell-volume/exchange-list',
      { symbol, range },
    );
  }
}

import { CategoryV5, GetTickersParamsV5, RestClientV5 } from 'bybit-api';

export type SubmitOrderParams = Parameters<RestClientV5['submitOrder']>[0];
export type AmendOrderParams = Parameters<RestClientV5['amendOrder']>[0];
export type CancelOrderParams = Parameters<RestClientV5['cancelOrder']>[0];
export type CancelAllOrdersParams = Parameters<RestClientV5['cancelAllOrders']>[0];
export type SetLeverageParams = Parameters<RestClientV5['setLeverage']>[0];
export type SetTradingStopParams = Parameters<RestClientV5['setTradingStop']>[0];
export type GetPositionsParams = Parameters<RestClientV5['getPositionInfo']>[0];
export type GetActiveOrdersParams = Parameters<RestClientV5['getActiveOrders']>[0];
export type GetTickersParams = GetTickersParamsV5<CategoryV5>;
export type GetInstrumentsInfoParams = Parameters<RestClientV5['getInstrumentsInfo']>[0];

export interface AccountResult<T> {
  readonly accountId: string;
  readonly label: string;
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: Error;
}

export interface BroadcastResult<T> {
  readonly results: ReadonlyArray<AccountResult<T>>;
  readonly okCount: number;
  readonly failCount: number;
}

export interface PingResult {
  readonly ok: boolean;
  readonly equity?: number;
  readonly error?: string;
}

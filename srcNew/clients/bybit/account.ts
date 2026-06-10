import { GetTickersParamsV5, RestClientV5 } from 'bybit-api';

import { BybitAccountConfig } from '../../config/accounts';
import { ApiError, errorMessage } from '../../core/errors';
import { Logger } from '../../core/logger';
import { ExponentialBackoff, RetryPolicy, withRetry } from '../../core/retry';
import {
  AmendOrderParams,
  CancelAllOrdersParams,
  CancelOrderParams,
  GetActiveOrdersParams,
  GetInstrumentsInfoParams,
  GetPositionsParams,
  GetTickersParams,
  PingResult,
  SetLeverageParams,
  SetTradingStopParams,
  SubmitOrderParams,
} from './types';

interface BybitApiResponse<R> {
  retCode: number;
  retMsg: string;
  result: R;
}

export interface BybitAccountOptions {
  logger?: Logger;
  retryPolicy?: RetryPolicy;
  recvWindowMs?: number;
}

const RETRYABLE_RET_CODES = new Set<string | number>([10006, 10016]);

function defaultBybitRetryPolicy(): RetryPolicy {
  return new ExponentialBackoff({
    label: 'bybit',
    maxAttempts: 3,
    baseDelayMs: 500,
    isRetryable: error => {
      if (error instanceof ApiError) return RETRYABLE_RET_CODES.has(error.code);
      const code = (error as { code?: string })?.code;
      return code === 'ECONNRESET' || code === 'ETIMEDOUT';
    },
  });
}

export class BybitAccount {
  readonly id: string;
  readonly label: string;

  private readonly rest: RestClientV5;
  private readonly retryPolicy: RetryPolicy;
  private readonly logger?: Logger;

  constructor(config: BybitAccountConfig, options: BybitAccountOptions = {}) {
    this.id = config.id;
    this.label = config.label;
    this.logger = options.logger;
    this.retryPolicy = options.retryPolicy ?? defaultBybitRetryPolicy();
    this.rest = new RestClientV5({
      key: config.apiKey,
      secret: config.apiSecret,
      testnet: config.testnet,
      demoTrading: config.demoTrading,
      recv_window: options.recvWindowMs ?? 10_000,
    });
  }

  raw(): RestClientV5 {
    return this.rest;
  }

  async getEquity(accountType: 'UNIFIED' | 'CONTRACT' = 'UNIFIED'): Promise<number> {
    const result = await this.invoke('getWalletBalance', () =>
      this.rest.getWalletBalance({ accountType })
    );

    const totalEquity = result?.list?.[0]?.totalEquity;
    const equity = Number.parseFloat(totalEquity ?? '');
    if (!Number.isFinite(equity)) {
      throw new ApiError(
        'bybit',
        'getWalletBalance',
        'malformed',
        `${this.id} totalEquity missing or non-numeric: ${JSON.stringify(totalEquity)}`
      );
    }

    return equity;
  }

  async getWalletBalance(accountType: 'UNIFIED' | 'CONTRACT' = 'UNIFIED') {
    return this.invoke('getWalletBalance', () => this.rest.getWalletBalance({ accountType }));
  }

  async getPositions(params: GetPositionsParams) {
    return this.invoke('getPositionInfo', () => this.rest.getPositionInfo(params));
  }

  async getOpenOrders(params: GetActiveOrdersParams) {
    return this.invoke('getActiveOrders', () => this.rest.getActiveOrders(params));
  }

  async getTickers(params: GetTickersParams) {
    // SDK declares per-category overloads; the cast selects one — the wire call is identical.
    return this.invoke('getTickers', () =>
      this.rest.getTickers(params as GetTickersParamsV5<'linear' | 'inverse'>)
    );
  }

  async getInstrumentInfo(params: GetInstrumentsInfoParams) {
    return this.invoke('getInstrumentsInfo', () => this.rest.getInstrumentsInfo(params));
  }

  async placeOrder(params: SubmitOrderParams) {
    return this.invoke('submitOrder', () => this.rest.submitOrder(params));
  }

  async amendOrder(params: AmendOrderParams) {
    return this.invoke('amendOrder', () => this.rest.amendOrder(params));
  }

  async cancelOrder(params: CancelOrderParams) {
    return this.invoke('cancelOrder', () => this.rest.cancelOrder(params));
  }

  async cancelAllOrders(params: CancelAllOrdersParams) {
    return this.invoke('cancelAllOrders', () => this.rest.cancelAllOrders(params));
  }

  async setLeverage(params: SetLeverageParams) {
    return this.invoke('setLeverage', () => this.rest.setLeverage(params));
  }

  async setTradingStop(params: SetTradingStopParams) {
    return this.invoke('setTradingStop', () => this.rest.setTradingStop(params));
  }

  async ping(): Promise<PingResult> {
    try {
      const equity = await this.getEquity();
      return { ok: true, equity };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async invoke<R>(label: string, call: () => Promise<BybitApiResponse<R>>): Promise<R> {
    // retCode check lives inside the retried closure: the SDK resolves (not throws)
    // on non-zero retCode, so retryable codes (10006/10016) must become throws here.
    const execute = async (): Promise<R> => {
      const response = await call();
      if (response.retCode !== 0) {
        throw new ApiError('bybit', label, response.retCode, response.retMsg);
      }
      return response.result;
    };

    return withRetry(execute, this.retryPolicy, {
      callLabel: `${this.id}:${label}`,
      logger: this.logger,
    });
  }
}

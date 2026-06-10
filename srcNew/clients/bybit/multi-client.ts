import { BybitAccountConfig, loadAccounts } from '../../config/accounts';
import { ConfigError } from '../../core/errors';
import { Logger } from '../../core/logger';
import { BybitAccount, BybitAccountOptions } from './account';
import {
  AccountResult,
  BroadcastResult,
  CancelAllOrdersParams,
  PingResult,
  SetLeverageParams,
  SubmitOrderParams,
} from './types';

export interface BybitMultiClientOptions extends BybitAccountOptions {
  logger?: Logger;
}

export class BybitMultiClient {
  private readonly accounts: ReadonlyArray<BybitAccount>;
  private readonly byId: ReadonlyMap<string, BybitAccount>;

  constructor(configs: ReadonlyArray<BybitAccountConfig>, options: BybitMultiClientOptions = {}) {
    if (configs.length === 0) {
      throw new ConfigError('BybitMultiClient requires at least one account config');
    }

    this.accounts = configs.map(config => new BybitAccount(config, options));
    this.byId = new Map(this.accounts.map(account => [account.id, account]));
  }

  static fromFile(filePath?: string, options?: BybitMultiClientOptions): BybitMultiClient {
    return new BybitMultiClient(loadAccounts(filePath), options);
  }

  get accountIds(): string[] {
    return this.accounts.map(account => account.id);
  }

  get size(): number {
    return this.accounts.length;
  }

  account(id: string): BybitAccount {
    const account = this.byId.get(id);
    if (!account) throw new ConfigError(`unknown account id: ${id}`);
    return account;
  }

  async broadcast<T>(
    operation: (account: BybitAccount) => Promise<T>
  ): Promise<BroadcastResult<T>> {
    const results = await Promise.all(
      this.accounts.map(account => this.runForAccount(account, operation))
    );

    const okCount = results.filter(result => result.ok).length;
    return { results, okCount, failCount: results.length - okCount };
  }

  async pingAll(): Promise<BroadcastResult<PingResult>> {
    return this.broadcast(account => account.ping());
  }

  async equities(): Promise<BroadcastResult<number>> {
    return this.broadcast(account => account.getEquity());
  }

  async placeOrderAll(params: SubmitOrderParams): Promise<BroadcastResult<unknown>> {
    return this.broadcast(account => account.placeOrder(params));
  }

  async cancelAllOrdersAll(params: CancelAllOrdersParams): Promise<BroadcastResult<unknown>> {
    return this.broadcast(account => account.cancelAllOrders(params));
  }

  async setLeverageAll(params: SetLeverageParams): Promise<BroadcastResult<unknown>> {
    return this.broadcast(account => account.setLeverage(params));
  }

  private async runForAccount<T>(
    account: BybitAccount,
    operation: (account: BybitAccount) => Promise<T>
  ): Promise<AccountResult<T>> {
    try {
      const value = await operation(account);
      return { accountId: account.id, label: account.label, ok: true, value };
    } catch (error) {
      return {
        accountId: account.id,
        label: account.label,
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

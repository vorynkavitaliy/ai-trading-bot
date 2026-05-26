/**
 * BybitWs — typed wrapper around bybit-api's WebsocketClient for V5 private
 * channels (one connection per AccountKey).
 *
 * Subscribes to `position`, `execution`, `order` on category `linear` and
 * translates SDK events into typed PositionUpdate / ExecutionUpdate /
 * OrderUpdate. The SDK handles auth, ping/pong, exponential-backoff reconnect
 * and topic re-subscription automatically — this wrapper only re-emits the
 * relevant events plus a 'reconnected' hook the daemon uses to trigger REST
 * resync.
 *
 * Why a class: holds the WebsocketClient lifecycle for one account, owns
 * `lastEventTs` for the heartbeat staleness check, single responsibility.
 */

import { EventEmitter } from 'node:events';
import { WebsocketClient } from 'bybit-api';
import type {
  WSPositionV5,
  WSExecutionV5,
  WSAccountOrderV5,
} from 'bybit-api/lib/types/websockets/ws-events';
import { AccountKey } from './accounts';
import { log } from './logger';

export interface PositionUpdate {
  account: AccountKey;
  data: WSPositionV5;
  receivedAt: number;
}

export interface ExecutionUpdate {
  account: AccountKey;
  data: WSExecutionV5;
  receivedAt: number;
}

export interface OrderUpdate {
  account: AccountKey;
  data: WSAccountOrderV5;
  receivedAt: number;
}

export interface BybitWsEvents {
  position: (e: PositionUpdate) => void;
  execution: (e: ExecutionUpdate) => void;
  order: (e: OrderUpdate) => void;
  connected: () => void;
  reconnected: () => void;
  disconnected: (reason: string) => void;
  exception: (err: unknown) => void;
}

export declare interface BybitWs {
  on<K extends keyof BybitWsEvents>(event: K, listener: BybitWsEvents[K]): this;
  off<K extends keyof BybitWsEvents>(event: K, listener: BybitWsEvents[K]): this;
  emit<K extends keyof BybitWsEvents>(event: K, ...args: Parameters<BybitWsEvents[K]>): boolean;
}

export class BybitWs extends EventEmitter {
  private readonly _account: AccountKey;
  private readonly client: WebsocketClient;
  private _connected = false;
  private _lastEventTs = 0;
  private started = false;

  constructor(account: AccountKey) {
    super();
    this._account = account;
    this.client = new WebsocketClient({
      key: account.apiKey,
      secret: account.apiSecret,
      testnet: account.testnet,
      demoTrading: account.demoTrading,
      market: 'v5',
      pingInterval: 20_000,
      pongTimeout: 7_500,
    });
    this.wireListeners();
  }

  get account(): AccountKey {
    return this._account;
  }

  isConnected(): boolean {
    return this._connected;
  }

  get lastEventTs(): number {
    return this._lastEventTs;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await Promise.all(this.client.subscribeV5(['position', 'execution', 'order'], 'linear'));
    log.info('bybit-ws subscribed', {
      account: `${this._account.bucket}/${this._account.keyName}`,
      topics: ['position', 'execution', 'order'],
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    try {
      await Promise.all(this.client.unsubscribeV5(['position', 'execution', 'order'], 'linear'));
    } catch (e: any) {
      log.warn('bybit-ws unsubscribe error (continuing close)', {
        account: this._account.keyName, err: e?.message,
      });
    }
    try {
      this.client.closeAll(true);
    } catch (e: any) {
      log.warn('bybit-ws closeAll error', { account: this._account.keyName, err: e?.message });
    }
    this._connected = false;
  }

  private wireListeners(): void {
    const accLabel = `${this._account.bucket}/${this._account.keyName}`;

    this.client.on('open', () => {
      this._connected = true;
      this._lastEventTs = Date.now();
      log.info('bybit-ws open', { account: accLabel });
      this.emit('connected');
    });

    this.client.on('reconnect', () => {
      log.warn('bybit-ws reconnect attempt', { account: accLabel });
      this._connected = false;
    });

    this.client.on('reconnected', () => {
      this._connected = true;
      this._lastEventTs = Date.now();
      log.info('bybit-ws reconnected', { account: accLabel });
      this.emit('reconnected');
    });

    this.client.on('close', (evt: any) => {
      this._connected = false;
      log.warn('bybit-ws close', { account: accLabel, evt: evt?.event?.code });
      this.emit('disconnected', String(evt?.event?.code ?? 'unknown'));
    });

    this.client.on('authenticated', () => {
      this._lastEventTs = Date.now();
      log.info('bybit-ws authenticated', { account: accLabel });
    });

    this.client.on('response', (resp: any) => {
      this._lastEventTs = Date.now();
      if (resp?.success === false) {
        log.warn('bybit-ws subscribe failure response', { account: accLabel, resp });
      }
    });

    this.client.on('update', (evt: any) => {
      this._lastEventTs = Date.now();
      const topic = evt?.topic as string | undefined;
      if (!topic) return;
      const now = Date.now();
      if (topic === 'position' && Array.isArray(evt.data)) {
        for (const data of evt.data as WSPositionV5[]) {
          this.emit('position', { account: this._account, data, receivedAt: now });
        }
        return;
      }
      if (topic === 'execution' && Array.isArray(evt.data)) {
        for (const data of evt.data as WSExecutionV5[]) {
          this.emit('execution', { account: this._account, data, receivedAt: now });
        }
        return;
      }
      if (topic === 'order' && Array.isArray(evt.data)) {
        for (const data of evt.data as WSAccountOrderV5[]) {
          this.emit('order', { account: this._account, data, receivedAt: now });
        }
        return;
      }
    });

    this.client.on('exception', (err: unknown) => {
      log.error('bybit-ws exception', { account: accLabel, err: (err as any)?.message ?? String(err) });
      this.emit('exception', err);
    });
  }
}

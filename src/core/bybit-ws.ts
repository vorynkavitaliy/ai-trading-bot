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
 * Stale-WS watchdog (2026-05-29): bybit-api's app-layer ping/pong machinery
 * relies on `ws.send({op:'ping'})` succeeding. On a TCP half-open socket
 * (server-side stream silently dropped, no FIN received) the send buffers
 * locally and no pong-timeout ever arms, so the lib's `isConnected()` stays
 * true while events stop arriving. Observed 2026-05-29: 4 accounts went
 * silent simultaneously for >100min with `wsConnected:true`. The watchdog
 * runs every WATCHDOG_INTERVAL_MS, and if no event has arrived in
 * STALE_THRESHOLD_MS while we believe we're connected, force-terminates the
 * underlying socket. Terminating with the lib's connection-state still set
 * to CONNECTED triggers its onWsClose → reconnectWithDelay → auto-resubscribe
 * path (topics are remembered in the lib's WsStore).
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
  WSWalletV5,
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

export interface WalletUpdate {
  account: AccountKey;
  data: WSWalletV5;
  receivedAt: number;
}

export interface BybitWsEvents {
  position: (e: PositionUpdate) => void;
  execution: (e: ExecutionUpdate) => void;
  order: (e: OrderUpdate) => void;
  wallet: (e: WalletUpdate) => void;
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

const WATCHDOG_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 60_000;

export class BybitWs extends EventEmitter {
  private readonly _account: AccountKey;
  private readonly client: WebsocketClient;
  private _connected = false;
  private _lastEventTs = 0;
  private started = false;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastStaleKickTs = 0;
  private readonly hookedSockets = new WeakSet<object>();

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
    await Promise.all(this.client.subscribeV5(['position', 'execution', 'order', 'wallet'], 'linear'));
    log.info('bybit-ws subscribed', {
      account: `${this._account.bucket}/${this._account.keyName}`,
      topics: ['position', 'execution', 'order', 'wallet'],
    });
    this.startWatchdog();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.stopWatchdog();
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

  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => this.watchdogTick(), WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref();
  }

  private stopWatchdog(): void {
    if (!this.watchdogTimer) return;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /**
   * Attach a raw 'message' listener to each underlying ws socket so that ANY
   * inbound frame — server ping, our-ping's pong, or business data — refreshes
   * `_lastEventTs`. Without this the watchdog only sees business events (position/
   * execution/order) and false-fires on a HEALTHY-but-quiet private stream (no
   * trades for >60s), causing a ~90s reconnect flap. A genuinely half-open socket
   * receives NO frames, so the watchdog still catches it. Idempotent (WeakSet) and
   * re-run from open/reconnected/watchdogTick so new sockets after reconnect are
   * always hooked. Reaches into getWsStore() — same documented surface as
   * forceReconnect(); no-ops if the lib changes shape.
   */
  private attachLivenessHook(): void {
    try {
      const store: any = (this.client as any).getWsStore?.();
      if (!store || typeof store.getKeys !== 'function') return;
      for (const k of store.getKeys()) {
        const ws: any = store.getWs?.(k);
        if (!ws || typeof ws.on !== 'function' || this.hookedSockets.has(ws)) continue;
        this.hookedSockets.add(ws);
        ws.on('message', () => { this._lastEventTs = Date.now(); });
      }
    } catch (e: any) {
      log.warn('bybit-ws liveness hook attach failed', {
        account: this._account.keyName, err: e?.message,
      });
    }
  }

  /**
   * Detect TCP half-open sockets: lib still reports CONNECTED but no
   * messages (data OR pong) have arrived in STALE_THRESHOLD_MS. Force a
   * terminate so the lib's onWsClose reconnect path runs. Throttled to one
   * kick per WATCHDOG_INTERVAL_MS so we don't pile up terminates while the
   * reconnect handshake is in flight.
   */
  private watchdogTick(): void {
    if (!this.started || !this._connected) return;
    // Ensure the raw-socket liveness hook is attached to whatever socket(s) exist
    // now (covers reconnects that didn't route through our open/reconnected hooks).
    this.attachLivenessHook();
    if (this._lastEventTs === 0) return;
    const sinceLast = Date.now() - this._lastEventTs;
    if (sinceLast < STALE_THRESHOLD_MS) return;
    const sinceKick = Date.now() - this.lastStaleKickTs;
    if (sinceKick < WATCHDOG_INTERVAL_MS) return;
    this.lastStaleKickTs = Date.now();
    const accLabel = `${this._account.bucket}/${this._account.keyName}`;
    log.warn('bybit-ws stale — forcing reconnect', {
      account: accLabel, sinceLastEventMs: sinceLast,
    });
    this.forceReconnect();
  }

  /**
   * Reaches into the bybit-api WsStore, grabs each underlying ws, and calls
   * `terminate()` (forceful RST). The lib's connection-state remains CONNECTED
   * at the moment of termination, so its `onWsClose` handler treats it as
   * unintentional and triggers `reconnectWithDelay` + topic auto-resubscribe.
   * Public access via `getWsStore()` (documented surface); falls back to a
   * no-op if the lib changes shape.
   */
  private forceReconnect(): void {
    try {
      const store: any = (this.client as any).getWsStore?.();
      if (!store || typeof store.getKeys !== 'function') return;
      const keys: string[] = store.getKeys();
      for (const k of keys) {
        const ws: any = store.getWs?.(k);
        if (!ws) continue;
        try {
          if (typeof ws.terminate === 'function') ws.terminate();
          else if (typeof ws.close === 'function') ws.close();
        } catch (e: any) {
          log.warn('bybit-ws terminate failed', {
            account: this._account.keyName, wsKey: k, err: e?.message,
          });
        }
      }
      // Local state: mark disconnected so a parallel watchdog tick doesn't
      // double-kick. onWsClose will flip _connected=false too, but that's
      // async; this avoids the race.
      this._connected = false;
    } catch (e: any) {
      log.warn('bybit-ws forceReconnect failed', {
        account: this._account.keyName, err: e?.message,
      });
    }
  }

  private wireListeners(): void {
    const accLabel = `${this._account.bucket}/${this._account.keyName}`;

    this.client.on('open', () => {
      this._connected = true;
      this._lastEventTs = Date.now();
      this.attachLivenessHook();
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
      this.attachLivenessHook();
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
      if (topic === 'wallet' && Array.isArray(evt.data)) {
        for (const data of evt.data as WSWalletV5[]) {
          this.emit('wallet', { account: this._account, data, receivedAt: now });
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

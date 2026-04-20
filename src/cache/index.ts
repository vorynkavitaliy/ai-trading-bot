import Redis from 'ioredis';
import { config } from '../config';

/**
 * Redis layer for ephemeral state shared across pair-terminals:
 *   - daily peak equity per account (kill-switch source of truth)
 *   - portfolio heat map (per symbol → risk in USD)
 *   - cross-pair locks (advisory, prevent concurrent modifications)
 *   - pub/sub channels for kill-switch broadcasts
 *
 * If Redis is disabled, the layer still works but uses an in-process Map.
 * That is fine for single-pair operation; production multi-pair MUST have Redis.
 */

export interface PendingOrder {
  symbol: string;
  direction: 'Long' | 'Short';
  limitPrice: number;
  stopLoss: number;
  takeProfit: number;
  confluence: number;
  regime: string;
  placedAt: number;      // ms timestamp
  /** Max age before auto-cancel (ms) */
  maxAge: number;
  orderIds: string[];    // Bybit order IDs per sub-account
}

export interface SharedPosition {
  symbol: string;
  direction: 'Long' | 'Short';
  confluence: number;
  regime: string;
  entry: number;
  openedAt: number;       // ms timestamp
  terminal: string;       // pair name of the terminal that opened it
}

const KEYS = {
  dailyPeak: (account: string) => `peak:${account}:${utcDay()}`,
  heat: (account: string) => `heat:${account}`,
  lock: (key: string) => `lock:${key}`,
  killSwitch: 'channel:kill-switch',
  haltedAccount: (account: string) => `halted:${account}`,
  positions: 'positions:open',
  pendingOrders: 'orders:pending',
  telegramLastFullReport: 'telegram:last_full_report',
  /** Recent-close cooldown: blocks same-direction re-entry within TTL. */
  recentClose: (symbol: string, direction: string) => `recentClose:${symbol}:${direction}`,
};

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

class InMemoryFallback {
  private store = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async set(k: string, v: string, ..._args: any[]) { this.store.set(k, v); return 'OK'; }
  async del(...keys: string[]) { keys.forEach((k) => this.store.delete(k)); return keys.length; }
  async hset(k: string, field: string, v: string) {
    if (!this.hashes.has(k)) this.hashes.set(k, new Map());
    this.hashes.get(k)!.set(field, v);
    return 1;
  }
  async hget(k: string, field: string) { return this.hashes.get(k)?.get(field) ?? null; }
  async hgetall(k: string) {
    const m = this.hashes.get(k);
    if (!m) return {};
    return Object.fromEntries(m.entries());
  }
  async hdel(k: string, field: string) { return this.hashes.get(k)?.delete(field) ? 1 : 0; }
  async publish(_ch: string, _msg: string) { return 0; }
  async subscribe(_ch: string) { /* noop */ }
  on(_ev: string, _cb: any) { /* noop */ }
  duplicate() { return this; }
  async quit() { /* noop */ }
}

export class Cache {
  readonly enabled: boolean;
  private client: Redis | InMemoryFallback;
  private subscriber: Redis | InMemoryFallback | null = null;

  constructor() {
    this.enabled = config.redis.enabled;
    if (this.enabled) {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        db: config.redis.db,
        lazyConnect: false,
        maxRetriesPerRequest: 3,
      });
      (this.client as Redis).on('error', (e) => console.error('[Redis]', e.message));
    } else {
      console.log('[Cache] disabled — using in-memory fallback (single-process only)');
      this.client = new InMemoryFallback();
    }
  }

  // ─── Raw key/value with TTL (translations, misc caches) ───

  async getRaw(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setRaw(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec !== undefined) {
      await this.client.set(key, value, 'EX', ttlSec);
    } else {
      await this.client.set(key, value);
    }
  }

  // ─── Daily peak equity ───

  async setDailyPeak(account: string, equity: number): Promise<void> {
    const key = KEYS.dailyPeak(account);
    const cur = await this.client.get(key);
    if (!cur || equity > Number(cur)) {
      await this.client.set(key, String(equity), 'EX', 86400 * 2);
    }
  }

  async getDailyPeak(account: string): Promise<number | null> {
    const v = await this.client.get(KEYS.dailyPeak(account));
    return v ? Number(v) : null;
  }

  // ─── Portfolio heat (per-symbol risk USD) ───

  async setHeat(account: string, symbol: string, riskUsd: number): Promise<void> {
    await this.client.hset(KEYS.heat(account), symbol, String(riskUsd));
  }

  async clearHeat(account: string, symbol: string): Promise<void> {
    await this.client.hdel(KEYS.heat(account), symbol);
  }

  async getHeat(account: string): Promise<Record<string, number>> {
    const raw = await this.client.hgetall(KEYS.heat(account));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = Number(v);
    return out;
  }

  async getTotalHeat(account: string): Promise<number> {
    const map = await this.getHeat(account);
    return Object.values(map).reduce((s, v) => s + v, 0);
  }

  // ─── Cross-pair advisory lock (NX with TTL) ───

  async tryLock(name: string, ttlSec = 30): Promise<boolean> {
    const key = KEYS.lock(name);
    if (this.client instanceof InMemoryFallback) {
      const cur = await this.client.get(key);
      if (cur) return false;
      await this.client.set(key, '1', 'EX', ttlSec);
      return true;
    }
    const r = await (this.client as Redis).set(key, '1', 'EX', ttlSec, 'NX');
    return r === 'OK';
  }

  async unlock(name: string): Promise<void> {
    await this.client.del(KEYS.lock(name));
  }

  // ─── Halted accounts (set by kill switch) ───

  async setHalted(account: string, reason: string, ttlSec = 86400): Promise<void> {
    if (this.client instanceof InMemoryFallback) {
      await this.client.set(KEYS.haltedAccount(account), reason, 'EX', ttlSec);
    } else {
      await (this.client as Redis).set(KEYS.haltedAccount(account), reason, 'EX', ttlSec);
    }
  }

  async isHalted(account: string): Promise<string | null> {
    return this.client.get(KEYS.haltedAccount(account));
  }

  async clearHalt(account: string): Promise<void> {
    await this.client.del(KEYS.haltedAccount(account));
  }

  // ─── Shared position registry (cross-terminal visibility) ───

  async registerPosition(symbol: string, pos: SharedPosition): Promise<void> {
    await this.client.hset(KEYS.positions, symbol, JSON.stringify(pos));
  }

  async unregisterPosition(symbol: string): Promise<void> {
    await this.client.hdel(KEYS.positions, symbol);
  }

  async getAllPositions(): Promise<SharedPosition[]> {
    const raw = await this.client.hgetall(KEYS.positions);
    return Object.values(raw).map((v) => {
      try { return JSON.parse(v); } catch { return null; }
    }).filter(Boolean) as SharedPosition[];
  }

  /** Find the weakest open position (lowest confluence) across all terminals */
  async getWeakestPosition(): Promise<SharedPosition | null> {
    const all = await this.getAllPositions();
    if (all.length === 0) return null;
    return all.reduce((weakest, p) => p.confluence < weakest.confluence ? p : weakest);
  }

  async getPositionCount(): Promise<number> {
    const all = await this.client.hgetall(KEYS.positions);
    return Object.keys(all).length;
  }

  // ─── Pending limit orders registry ───

  async registerPendingOrder(symbol: string, order: PendingOrder): Promise<void> {
    await this.client.hset(KEYS.pendingOrders, symbol, JSON.stringify(order));
  }

  async removePendingOrder(symbol: string): Promise<void> {
    await this.client.hdel(KEYS.pendingOrders, symbol);
  }

  async getPendingOrder(symbol: string): Promise<PendingOrder | null> {
    const raw = await this.client.hget(KEYS.pendingOrders, symbol);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async getAllPendingOrders(): Promise<PendingOrder[]> {
    const raw = await this.client.hgetall(KEYS.pendingOrders);
    return Object.values(raw).map((v) => {
      try { return JSON.parse(v); } catch { return null; }
    }).filter(Boolean) as PendingOrder[];
  }

  // ─── Recent-close cooldown ───
  // After a position closes, block same-direction re-entry for a TTL window.
  // Prevents revenge re-entries (e.g. XRP scanner re-triggers immediately after a loss).
  // Direction-aware: a LONG close does NOT block a SHORT entry — only same-direction.

  async setRecentClose(symbol: string, direction: 'Long' | 'Short', ttlMinutes = 120): Promise<void> {
    const key = KEYS.recentClose(symbol, direction);
    const value = String(Date.now());
    if (this.client instanceof InMemoryFallback) {
      await this.client.set(key, value);
    } else {
      await (this.client as Redis).set(key, value, 'EX', ttlMinutes * 60);
    }
  }

  async hasRecentClose(symbol: string, direction: 'Long' | 'Short'): Promise<{ blocked: boolean; ageMin?: number }> {
    const key = KEYS.recentClose(symbol, direction);
    const v = await this.client.get(key);
    if (!v) return { blocked: false };
    const ageMin = Math.round((Date.now() - Number(v)) / 60_000);
    return { blocked: true, ageMin };
  }

  async clearRecentClose(symbol: string, direction: 'Long' | 'Short'): Promise<void> {
    await this.client.del(KEYS.recentClose(symbol, direction));
  }

  // ─── Time-series snapshots (funding/OI deltas, generic) ───
  // Stored as Redis hash `ts:${symbol}` — field = timestamp (ms), value = JSON payload.
  // Callers append via tsAppend, read all via tsGetAll, trim old entries via tsTrim.

  async tsAppend(symbol: string, data: unknown, timestampMs: number = Date.now()): Promise<void> {
    await this.client.hset(`ts:${symbol}`, String(timestampMs), JSON.stringify(data));
  }

  async tsGetAll<T = any>(symbol: string): Promise<Array<{ ts: number; data: T }>> {
    const raw = await this.client.hgetall(`ts:${symbol}`);
    const out: Array<{ ts: number; data: T }> = [];
    for (const [k, v] of Object.entries(raw)) {
      const ts = Number(k);
      if (!Number.isFinite(ts)) continue;
      try {
        out.push({ ts, data: JSON.parse(v) as T });
      } catch {
        /* skip corrupt */
      }
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  async tsTrim(symbol: string, maxAgeMs: number, nowMs: number = Date.now()): Promise<number> {
    const raw = await this.client.hgetall(`ts:${symbol}`);
    let removed = 0;
    const cutoff = nowMs - maxAgeMs;
    for (const k of Object.keys(raw)) {
      const ts = Number(k);
      if (!Number.isFinite(ts) || ts < cutoff) {
        await this.client.hdel(`ts:${symbol}`, k);
        removed++;
      }
    }
    return removed;
  }

  // ─── Telegram rate limits ───

  async getLastFullReport(): Promise<number | null> {
    const v = await this.client.get(KEYS.telegramLastFullReport);
    return v ? Number(v) : null;
  }

  async setLastFullReport(ts: number): Promise<void> {
    if (this.client instanceof InMemoryFallback) {
      await this.client.set(KEYS.telegramLastFullReport, String(ts), 'EX', 7200);
    } else {
      await (this.client as Redis).set(KEYS.telegramLastFullReport, String(ts), 'EX', 7200);
    }
  }

  // ─── Pub/sub: kill switch broadcasts ───

  async publishKill(payload: { account: string; reason: string; level: string }): Promise<void> {
    await this.client.publish(KEYS.killSwitch, JSON.stringify(payload));
  }

  onKill(cb: (payload: { account: string; reason: string; level: string }) => void): void {
    if (this.subscriber === null) {
      this.subscriber = this.client.duplicate ? this.client.duplicate() : this.client;
    }
    this.subscriber!.subscribe(KEYS.killSwitch);
    this.subscriber!.on('message', (_ch: string, msg: string) => {
      try { cb(JSON.parse(msg)); } catch (e) { console.error('[Cache] kill msg parse error', e); }
    });
  }

  async close(): Promise<void> {
    await this.client.quit();
    if (this.subscriber && this.subscriber !== this.client) {
      await this.subscriber.quit();
    }
  }
}

export const cache = new Cache();

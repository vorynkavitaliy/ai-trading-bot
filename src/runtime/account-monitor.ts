/**
 * AccountMonitor — one per AccountKey. Owns the WS connection, an in-memory
 * state Map keyed by symbol, the LRU dedup ring of recent execId fills, and
 * a 30s REST poll loop as fallback.
 *
 * WS-pushes-first invariant: every WS handler updates `state.lastSize` /
 * `state.lastSL` BEFORE spawning side-effect work. The REST poll reads the
 * same Map and skips work where state matches. This ensures REST never
 * re-processes a fill that WS already handled.
 *
 * Naked-SL detection has a 60s grace from createdTime to avoid racing
 * execute.ts during position open (it submits SL right after the entry
 * fills; WS push may arrive before SL is attached).
 *
 * execId LRU is capped at 1024 entries — well over the per-account daily
 * fill volume (a 30-trade day produces ~90 fills with TP1/TP2 partial).
 */

import { AccountKey } from '../core/accounts';
import { getRest, withRetry } from '../core/bybit';
import { closeAndVerify } from '../core/close-verifier';
import { log } from '../core/logger';
import { tradeRepo, OpenTrade } from '../data/trade-repo';
import {
  BybitWs,
  PositionUpdate,
  ExecutionUpdate,
  OrderUpdate,
} from '../core/bybit-ws';
import {
  BybitPos,
  Tp1FillGroup,
  isTp1PartialFromPosition,
  inferTp1Fill,
  handleTp1Fill,
  handleNakedSl,
  handleDcaFill,
  flushTp1Groups,
} from './position-events';
import { autoCloseTrade, fetchRecentClosedPnL, notifyConsolidatedCloses } from './trade-closer';

const NAKED_SL_GRACE_MS = 60_000;
const EXEC_ID_LRU_CAP = 1024;
const DUST_RATIO = 0.01;
const DEFAULT_REST_POLL_SEC = 30;

interface SymbolState {
  symbol: string;
  side: 'Buy' | 'Sell';
  lastSize: number;
  lastSL: number;
  lastTP: number | null;
  lastTp1Ts: number;
  lastFullCloseTs: number;
  lastSeq: number;
  createdMs: number;
}

interface AccountMonitorStatus {
  account: string;
  wsConnected: boolean;
  lastWsEventAt: number;
  lastRestPollAt: number;
  openSymbols: string[];
}

class ExecIdLru {
  private readonly cap: number;
  private readonly set = new Set<string>();
  private readonly order: string[] = [];

  constructor(cap: number) {
    this.cap = cap;
  }

  hasOrAdd(id: string): boolean {
    if (this.set.has(id)) return true;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.cap) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
    return false;
  }
}

export class AccountMonitor {
  private readonly account: AccountKey;
  private readonly ws: BybitWs;
  private readonly state = new Map<string, SymbolState>();
  private readonly recentExecIds = new ExecIdLru(EXEC_ID_LRU_CAP);
  private restTimer: NodeJS.Timeout | null = null;
  private lastRestPollAt = 0;
  private stopped = false;
  private readonly pollSec: number;

  constructor(account: AccountKey, pollSec: number = DEFAULT_REST_POLL_SEC) {
    this.account = account;
    this.pollSec = pollSec;
    this.ws = new BybitWs(account);
    this.ws.on('position', (e) => { void this.onPosition(e); });
    this.ws.on('execution', (e) => { void this.onExecution(e); });
    this.ws.on('order', (e) => { void this.onOrder(e); });
    this.ws.on('reconnected', () => { void this.restResync('reconnect'); });
  }

  async start(): Promise<void> {
    await this.restResync('startup');
    await this.ws.start();
    this.restTimer = setInterval(() => {
      void this.restResync('poll');
    }, this.pollSec * 1000);
    this.restTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restTimer) {
      clearInterval(this.restTimer);
      this.restTimer = null;
    }
    await this.ws.stop();
  }

  status(): AccountMonitorStatus {
    return {
      account: `${this.account.bucket}/${this.account.keyName}`,
      wsConnected: this.ws.isConnected(),
      lastWsEventAt: this.ws.lastEventTs,
      lastRestPollAt: this.lastRestPollAt,
      openSymbols: [...this.state.keys()],
    };
  }

  private async toBybitPos(symbol: string, raw: {
    side: 'Buy' | 'Sell';
    size: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number | null;
    unrealisedPnl: number;
    positionValue: number;
    createdMs: number;
  }): Promise<BybitPos | null> {
    const trades = await tradeRepo.openTradesForAccount(this.account.keyName);
    const db = mostRecentMatchingTrade(trades, this.account.bucket, this.account.keyName, symbol, raw.side);
    if (!db) return null;
    const openedMs = Date.parse(db.opened_at);
    return {
      symbol,
      side: raw.side,
      size: raw.size,
      initialSize: db.initial_qty,
      entryPrice: raw.entryPrice,
      curSL: raw.stopLoss,
      curTP: raw.takeProfit,
      unrealisedPnl: raw.unrealisedPnl,
      positionValue: raw.positionValue,
      createdTime: Number.isFinite(openedMs) && openedMs > 0 ? openedMs : raw.createdMs,
      account: this.account,
      dbTradeId: db.id,
      dbInitialSL: db.sl ?? 0,
      dbTP1: db.tp1,
      dbTP2: db.tp2,
      dbInitialQty: db.initial_qty,
      dbCurrentQty: db.qty,
      tp1AlreadyFilled: db.tp1_filled,
    };
  }

  private async onPosition(e: PositionUpdate): Promise<void> {
    if (this.stopped) return;
    const p = e.data;
    const symbol = p.symbol;
    const size = parseFloat(p.size);
    const stopLoss = parseFloat(p.stopLoss || '0');
    const takeProfit = p.takeProfit ? parseFloat(p.takeProfit) : null;
    const side = (p.side === 'Buy' || p.side === 'Sell') ? p.side : 'Buy';
    const createdMs = parseInt(p.createdTime || '0', 10);

    const prev = this.state.get(symbol);
    if (prev && prev.lastSeq >= p.seq) return;

    const prevSize = prev?.lastSize ?? 0;
    const prevSL = prev?.lastSL ?? 0;
    const prevTP = prev?.lastTP ?? null;

    if (size === 0 && prevSize === 0) return;

    this.state.set(symbol, {
      symbol,
      side,
      lastSize: size,
      lastSL: stopLoss,
      lastTP: takeProfit,
      lastTp1Ts: prev?.lastTp1Ts ?? 0,
      lastFullCloseTs: prev?.lastFullCloseTs ?? 0,
      lastSeq: p.seq,
      createdMs: createdMs > 0 ? createdMs : (prev?.createdMs ?? Date.now()),
    });

    if (size === 0) {
      if (prev && Date.now() - prev.lastFullCloseTs < 5_000) return;
      await this.handleFullCloseEvent(symbol, side);
      const after = this.state.get(symbol);
      if (after) after.lastFullCloseTs = Date.now();
      return;
    }

    if (size > 0 && stopLoss === 0) {
      const ageMs = Date.now() - (createdMs > 0 ? createdMs : (prev?.createdMs ?? Date.now()));
      if (ageMs < NAKED_SL_GRACE_MS) {
        log.debug('naked-SL grace skip', { account: this.account.keyName, symbol, ageMs });
        return;
      }
      const pos = await this.toBybitPos(symbol, {
        side,
        size,
        entryPrice: parseFloat(p.entryPrice || '0'),
        stopLoss: 0,
        takeProfit,
        unrealisedPnl: parseFloat(p.unrealisedPnl || '0'),
        positionValue: parseFloat(p.positionValue || '0'),
        createdMs,
      });
      if (pos) await handleNakedSl(pos);
      return;
    }

    const pos = await this.toBybitPos(symbol, {
      side,
      size,
      entryPrice: parseFloat(p.entryPrice || '0'),
      stopLoss,
      takeProfit,
      unrealisedPnl: parseFloat(p.unrealisedPnl || '0'),
      positionValue: parseFloat(p.positionValue || '0'),
      createdMs,
    });
    if (!pos) return;

    if (size > 0 && size < pos.dbInitialQty * DUST_RATIO) {
      try {
        await closeAndVerify(this.account, symbol, { reason: 'daemon-dust', cancelOrders: false });
      } catch (err: any) {
        log.warn('daemon dust close failed', { account: this.account.keyName, symbol, err: err?.message });
      }
      return;
    }

    if (!pos.tp1AlreadyFilled && size > pos.dbInitialQty * 1.01) {
      await handleDcaFill(pos);
      return;
    }

    if (isTp1PartialFromPosition(prevSize || pos.dbInitialQty, size, pos.dbInitialQty, pos.dbCurrentQty, pos.tp1AlreadyFilled)) {
      await this.handleTp1FromPosition(pos, prevSize || pos.dbInitialQty);
      return;
    }

    if (prevSL !== stopLoss || prevTP !== takeProfit) {
      log.debug('SL/TP amend ack', {
        account: this.account.keyName, symbol,
        prevSL, stopLoss, prevTP, takeProfit,
      });
    }
  }

  private async handleTp1FromPosition(pos: BybitPos, prevSize: number): Promise<void> {
    const tp1Groups = new Map<string, Tp1FillGroup>();
    try {
      const fill = await inferTp1Fill(
        this.account,
        pos.symbol,
        prevSize,
        pos.size,
        pos.dbTP1,
        pos.entryPrice,
        pos.side,
        pos.createdTime,
      );
      await handleTp1Fill(pos, fill, tp1Groups);
      const st = this.state.get(pos.symbol);
      if (st) st.lastTp1Ts = Date.now();
    } catch (e: any) {
      log.warn('daemon TP1 fill processing failed', {
        symbol: pos.symbol, account: this.account.keyName, err: e?.message,
      });
    }
    await flushTp1Groups(tp1Groups);
  }

  private async handleFullCloseEvent(symbol: string, side: 'Buy' | 'Sell'): Promise<void> {
    const trades = await tradeRepo.openTradesForAccount(this.account.keyName);
    const t = trades.find((row) => row.symbol === symbol && row.side === side);
    if (!t) return;
    try {
      const fills = await fetchRecentClosedPnL(this.account, symbol);
      const evt = await autoCloseTrade(t, fills);
      if (evt) await notifyConsolidatedCloses([evt]);
    } catch (e: any) {
      log.warn('daemon full-close handling failed', {
        symbol, account: this.account.keyName, err: e?.message,
      });
    }
  }

  private async onExecution(e: ExecutionUpdate): Promise<void> {
    if (this.stopped) return;
    const ex = e.data;
    if (ex.execType !== 'Trade') return;
    if (this.recentExecIds.hasOrAdd(ex.execId)) return;
    log.debug('ws execution', {
      account: this.account.keyName,
      symbol: ex.symbol,
      execId: ex.execId,
      qty: ex.execQty,
      price: ex.execPrice,
      closedSize: ex.closedSize,
    });
  }

  private async onOrder(e: OrderUpdate): Promise<void> {
    if (this.stopped) return;
    const o = e.data;
    if (o.orderStatus !== 'Filled' && o.orderStatus !== 'PartiallyFilled') return;
    log.debug('ws order', {
      account: this.account.keyName,
      symbol: o.symbol,
      orderId: o.orderId,
      status: o.orderStatus,
      reduceOnly: o.reduceOnly,
    });
  }

  private async restResync(reason: 'startup' | 'reconnect' | 'poll'): Promise<void> {
    if (this.stopped) return;
    this.lastRestPollAt = Date.now();
    try {
      const c = getRest(this.account);
      const r = await withRetry(
        () => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }),
        { label: `daemon-rest-${this.account.keyName}` },
      );
      if (r.retCode !== 0) return;
      const list = (r.result?.list ?? []) as any[];
      const seenSymbols = new Set<string>();
      for (const p of list) {
        const size = parseFloat(p.size ?? '0');
        if (size <= 0) continue;
        seenSymbols.add(p.symbol);
        const prev = this.state.get(p.symbol);
        const prevSize = prev?.lastSize ?? 0;
        const prevSL = prev?.lastSL ?? 0;
        if (prev && prevSize === size && prevSL === parseFloat(p.stopLoss ?? '0')) continue;
        await this.onPosition({
          account: this.account,
          data: {
            ...p,
            seq: (prev?.lastSeq ?? 0) + 1,
          } as any,
          receivedAt: Date.now(),
        });
      }
      for (const sym of [...this.state.keys()]) {
        if (!seenSymbols.has(sym) && (this.state.get(sym)?.lastSize ?? 0) > 0) {
          await this.onPosition({
            account: this.account,
            data: {
              symbol: sym,
              side: this.state.get(sym)?.side ?? 'Buy',
              size: '0',
              stopLoss: '0',
              takeProfit: '0',
              entryPrice: '0',
              unrealisedPnl: '0',
              positionValue: '0',
              createdTime: String(this.state.get(sym)?.createdMs ?? 0),
              seq: (this.state.get(sym)?.lastSeq ?? 0) + 1,
            } as any,
            receivedAt: Date.now(),
          });
        }
      }
      log.debug('daemon rest resync', {
        account: this.account.keyName, reason, positions: list.length,
      });
    } catch (e: any) {
      log.warn('daemon rest resync failed', {
        account: this.account.keyName, reason, err: e?.message,
      });
    }
  }
}

function mostRecentMatchingTrade(
  trades: OpenTrade[],
  bucket: string,
  keyName: string,
  symbol: string,
  side: string,
): OpenTrade | null {
  let best: OpenTrade | null = null;
  for (const t of trades) {
    if (t.account_bucket !== bucket) continue;
    if (t.account_key !== keyName) continue;
    if (t.symbol !== symbol) continue;
    if (t.side !== side) continue;
    if (best === null || t.opened_at > best.opened_at) best = t;
  }
  return best;
}

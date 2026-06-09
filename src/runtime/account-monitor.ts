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
  WalletUpdate,
} from '../core/bybit-ws';
import { DailyDdGuard, DailyDdGuardStatus } from './daily-dd-guard';
import { writeEmergencyHalt } from './emergency-halt';
import {
  BybitPos,
  Tp1FillGroup,
  isTp1PartialFromPosition,
  inferTp1Fill,
  handleTp1Fill,
  handleNakedSl,
  handleDcaFill,
} from './position-events';
import { autoCloseTrade, fetchRecentClosedPnL } from './trade-closer';
import { nakedTpRecovery } from './naked-tp-recovery';
import { findUnpromotedPending } from '../core/pending-orders';
import { promotePendingToTrade } from './pending-promoter';
import { coalesceEntryConfirmed, coalesceClose, coalesceNakedTpAlert } from './notification-coalescer';

const NAKED_SL_GRACE_MS = 60_000;
const EXEC_ID_LRU_CAP = 1024;
const DUST_RATIO = 0.01;
const DEFAULT_REST_POLL_SEC = 30;
// Emergency daily-DD flatten (operator spec 2026-06-03). Threshold = % of the
// account BASE bucket. DEFAULT IS SHADOW MODE: the guard tracks + logs what it
// WOULD do but does NOT close — flip DD_FLATTEN_ENABLED=1 to arm live closing.
const DD_FLATTEN_PCT = parseFloat(process.env.DD_FLATTEN_PCT ?? '4.3');
const DD_FLATTEN_ENABLED = process.env.DD_FLATTEN_ENABLED === '1';

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
  lastTpRecoveryTs?: number;
  // When Bybit signals size=0 but autoCloseTrade couldn't finalize (closed-pnl
  // API propagation delay), set closePending=true so next position update / REST
  // poll retries instead of being short-circuited by the "size==0 && prevSize==0"
  // dedup check. Cleared once autoCloseTrade succeeds.
  closePending: boolean;
}

interface AccountMonitorStatus {
  account: string;
  wsConnected: boolean;
  lastWsEventAt: number;
  lastRestPollAt: number;
  openSymbols: string[];
  ddGuard: DailyDdGuardStatus & { enabled: boolean };
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
  private readonly inflight = new Map<string, Promise<void>>();
  private restTimer: NodeJS.Timeout | null = null;
  private lastRestPollAt = 0;
  private stopped = false;
  private readonly pollSec: number;
  // ─── Emergency daily-DD guard state ───
  private readonly ddGuard: DailyDdGuard;
  private readonly posUpl = new Map<string, number>(); // symbol → latest unrealisedPnl
  private walletBalance = 0;                            // realized wallet balance (USDT)
  private ddFlattenInflight = false;

  constructor(account: AccountKey, pollSec: number = DEFAULT_REST_POLL_SEC) {
    this.account = account;
    this.pollSec = pollSec;
    this.ws = new BybitWs(account);
    this.ddGuard = new DailyDdGuard(parseFloat(account.bucket), DD_FLATTEN_PCT);
    this.ws.on('position', (e) => this.dispatchPosition(e));
    this.ws.on('execution', (e) => { void this.onExecution(e); });
    this.ws.on('order', (e) => { void this.onOrder(e); });
    this.ws.on('wallet', (e) => this.onWallet(e));
    this.ws.on('reconnected', () => { void this.restResync('reconnect'); });
  }

  private dispatchPosition(e: PositionUpdate): Promise<void> {
    const sym = e.data.symbol;
    const prev = this.inflight.get(sym) ?? Promise.resolve();
    const next = prev.then(() => this.onPosition(e)).catch((err: any) => {
      log.warn('onPosition crashed', { sym, err: err?.message });
    });
    this.inflight.set(sym, next);
    return next;
  }

  async start(): Promise<void> {
    await this.seedWalletBalance();
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
      // Filter to symbols actually held (lastSize > 0). Stale entries with
      // lastSize=0 are kept in the map for closePending tracking but should
      // not appear in operational "open" view.
      openSymbols: [...this.state.entries()]
        .filter(([, s]) => s.lastSize > 0 || s.closePending)
        .map(([sym]) => sym),
      ddGuard: { ...this.ddGuard.status(), enabled: DD_FLATTEN_ENABLED },
    };
  }

  // ─── Emergency daily-DD guard ──────────────────────────────────────────────
  // Wallet topic keeps the realized balance fresh; position topic feeds floating
  // PnL per symbol. equity = walletBalance + Σ floating. On every update we ask
  // the guard whether the intraday drawdown breached the base-relative threshold.
  private async seedWalletBalance(): Promise<void> {
    try {
      const res: any = await withRetry(
        () => getRest(this.account).getWalletBalance({ accountType: 'UNIFIED' }),
        { label: `seed-wallet-${this.account.keyName}` },
      );
      const bal = parseFloat(res?.result?.list?.[0]?.totalWalletBalance ?? '');
      if (Number.isFinite(bal) && bal > 0) this.walletBalance = bal;
    } catch (err: any) {
      log.warn('seed wallet balance failed', { account: `${this.account.bucket}/${this.account.keyName}`, err: err?.message });
    }
  }

  private onWallet(e: WalletUpdate): void {
    const bal = parseFloat((e.data as any).totalWalletBalance ?? '');
    if (Number.isFinite(bal) && bal > 0) this.walletBalance = bal;
    this.evaluateDailyDd();
  }

  private evaluateDailyDd(): void {
    if (this.stopped || this.walletBalance <= 0) return;
    let sumUpl = 0;
    for (const v of this.posUpl.values()) sumUpl += v;
    const equity = this.walletBalance + sumUpl;
    const { breach, status } = this.ddGuard.update(equity);
    if (!breach) return;
    const label = `${this.account.bucket}/${this.account.keyName}`;
    if (DD_FLATTEN_ENABLED) {
      log.warn('EMERGENCY DAILY-DD BREACH → flattening', { account: label, ...status });
      void this.triggerEmergencyFlatten(status);
    } else {
      log.warn('EMERGENCY DAILY-DD BREACH (SHADOW — no action taken)', { account: label, ...status });
    }
  }

  private async triggerEmergencyFlatten(status: DailyDdGuardStatus): Promise<void> {
    if (this.ddFlattenInflight) return;
    this.ddFlattenInflight = true;
    const label = `${this.account.bucket}/${this.account.keyName}`;
    try {
      const symbols = [...this.state.entries()].filter(([, s]) => s.lastSize > 0).map(([sym]) => sym);
      log.warn('emergency flatten: closing all', { account: label, symbols });
      // Cancel every pending order on the account first (settleCoin = all symbols).
      try {
        await withRetry(
          () => getRest(this.account).cancelAllOrders({ category: 'linear', settleCoin: 'USDT' }),
          { label: `emergency-cancel-${this.account.keyName}` },
        );
      } catch (err: any) {
        log.error('emergency cancel-all failed', { account: label, err: err?.message });
      }
      // Market-close each position reduce-only via the verified closer.
      for (const symbol of symbols) {
        try {
          const r = await closeAndVerify(this.account, symbol, { reason: 'emergency-daily-dd-flatten', cancelOrders: true });
          log.info('emergency flatten close', { account: label, symbol, status: r.status });
        } catch (err: any) {
          log.error('emergency flatten close failed', { account: label, symbol, err: err?.message });
        }
      }
      // Halt new entries on this account for the rest of the UTC day.
      writeEmergencyHalt(this.account.bucket, this.account.keyName, { ...status, symbols });
    } finally {
      this.ddFlattenInflight = false;
    }
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

  private async tryPromotePending(
    symbol: string,
    side: 'Buy' | 'Sell',
    size: number,
    avgPrice: number,
  ): Promise<void> {
    try {
      const pending = await findUnpromotedPending(
        this.account.bucket, this.account.keyName, symbol, side,
      );
      if (!pending) return;

      const r = await promotePendingToTrade(pending, { size, avgPrice });
      if (r?.created) {
        coalesceEntryConfirmed({
          symbol, side, size, avgPrice,
          sl: pending.sl, tp: pending.tp1,
          accountLabel: `${this.account.bucket}/${this.account.keyName}`,
        });
      }
    } catch (err: any) {
      log.warn('daemon pending promotion failed', {
        symbol, account: this.account.keyName, err: err?.message,
      });
    }
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

    // Feed the daily-DD guard: track this symbol's floating PnL (cleared on close).
    if (size > 0) this.posUpl.set(symbol, parseFloat(p.unrealisedPnl || '0'));
    else this.posUpl.delete(symbol);
    this.evaluateDailyDd();

    const prevSize = prev?.lastSize ?? 0;
    const prevSL = prev?.lastSL ?? 0;
    const prevTP = prev?.lastTP ?? null;
    const prevClosePending = prev?.closePending ?? false;

    // Early-exit only if BOTH sizes are 0 AND no close is pending. closePending
    // means a prior autoclose attempt couldn't finalize (Bybit closed-pnl API
    // propagation delay) — keep retrying until it succeeds.
    if (size === 0 && prevSize === 0 && !prevClosePending) return;

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
      closePending: prevClosePending,
    });

    if (size === 0) {
      // No more 5s dedup window — handleFullCloseEvent itself is idempotent
      // (autoCloseTrade UPDATE has `WHERE status = 'open'` guard, returns null
      // on already-closed rows). We DO retry on every poll/event until success.
      const closed = await this.handleFullCloseEvent(symbol, side);
      const after = this.state.get(symbol);
      if (after) {
        after.closePending = !closed;
        if (closed) after.lastFullCloseTs = Date.now();
      }
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
    if (!pos) {
      await this.tryPromotePending(symbol, side, size, parseFloat(p.entryPrice || '0'));
      return;
    }

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

    if (size > 0 && stopLoss > 0 && !pos.tp1AlreadyFilled) {
      const state = this.state.get(symbol);
      const tpRecoveryLast = state?.lastTpRecoveryTs ?? 0;
      if (Date.now() - tpRecoveryLast > 5 * 60_000) {
        try {
          const recovered = await nakedTpRecovery.check(pos, getRest(this.account), { notify: false });
          if (recovered) {
            log.info('daemon naked-TP recovery', {
              symbol: recovered.symbol,
              account: recovered.account,
              action: recovered.action,
              reason: recovered.reason,
            });
            if (pos.dbTP1 != null && pos.dbTP2 != null) {
              coalesceNakedTpAlert({
                symbol: pos.symbol,
                side: pos.side,
                accountLabel: `${this.account.bucket}/${this.account.keyName}`,
                tp1: pos.dbTP1,
                tp2: pos.dbTP2,
              });
            }
            if (state) {
              state.lastTpRecoveryTs = Date.now();
              this.state.set(symbol, state);
            }
          }
        } catch (err: any) {
          log.warn('daemon naked-TP check failed', {
            symbol, account: this.account.keyName, err: err?.message,
          });
        }
      }
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
    for (const grp of tp1Groups.values()) {
      for (const f of grp.fills) {
        coalesceClose({
          symbol: grp.symbol,
          side: grp.side,
          exitReason: 'tp1',
          entryPrice: grp.entryPrice,
          exitPrice: grp.exitPrice,
          qty: f.qty,
          pnlUsd: f.pnlUsd,
          pnlR: f.pnlR,
          accountLabel: f.label,
          comment: 'TP1 отработал. SL переведён в безубыток (BE). Остаток позиции 50% едет к TP2 без риска.',
        });
      }
    }
  }

  /**
   * Returns true if the close was finalized (DB updated + Telegram notify sent
   * OR no open trade existed to close). Returns false if autoCloseTrade couldn't
   * match closing fills yet (Bybit closed-pnl API propagation delay) — caller
   * should set closePending=true so the next poll/event retries.
   */
  private async handleFullCloseEvent(symbol: string, side: 'Buy' | 'Sell'): Promise<boolean> {
    const trades = await tradeRepo.openTradesForAccount(this.account.keyName);
    const t = trades.find((row) => row.symbol === symbol && row.side === side);
    if (!t) return true;  // nothing to close (DB already aligned) — counts as success
    try {
      const fills = await fetchRecentClosedPnL(this.account, symbol);
      const evt = await autoCloseTrade(t, fills);
      if (!evt) {
        // autoCloseTrade returned null — fills not yet propagated. Will retry.
        log.info('daemon full-close pending — fills not yet propagated, will retry', {
          symbol, account: this.account.keyName, dbId: t.id,
        });
        return false;
      }
      coalesceClose({
        symbol: evt.trade.symbol,
        side: evt.trade.side.toLowerCase() === 'buy' ? 'Buy' : 'Sell',
        exitReason: evt.exitReason,
        entryPrice: evt.entryPrice,
        exitPrice: evt.exitPrice,
        qty: evt.qty,
        pnlUsd: evt.pnlUsd,
        pnlR: evt.pnlR,
        accountLabel: `${evt.trade.account_bucket}/${evt.trade.account_key}`,
      });
      log.info('daemon full-close finalized', {
        symbol, account: this.account.keyName, dbId: t.id, pnlR: evt.pnlR?.toFixed(2),
      });
      return true;
    } catch (e: any) {
      log.warn('daemon full-close handling failed', {
        symbol, account: this.account.keyName, err: e?.message,
      });
      return false;
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
        // Refresh floating PnL for the daily-DD guard on EVERY poll — even when size/SL
        // are unchanged. Bybit's position WS doesn't push on price moves alone, and the
        // size/SL dedup below skips dispatch → without this the flatten's equity used STALE
        // floating and couldn't react to MTM drawdown (the guard's whole purpose). Found
        // 2026-06-04: a static BTC short's ddGuard.currentEquity stayed frozen at open while
        // the real floating swung −$1,815. (The dedup below still gates fill-PROCESSING.)
        this.posUpl.set(p.symbol, parseFloat(p.unrealisedPnl ?? '0'));
        this.evaluateDailyDd();
        const prev = this.state.get(p.symbol);
        const prevSize = prev?.lastSize ?? 0;
        const prevSL = prev?.lastSL ?? 0;
        if (prev && prevSize === size && prevSL === parseFloat(p.stopLoss ?? '0')) continue;
        await this.dispatchPosition({
          account: this.account,
          data: {
            ...p,
            seq: (prev?.lastSeq ?? 0) + 1,
          } as any,
          receivedAt: Date.now(),
        });
      }
      // Symbols Bybit no longer reports but our state still tracks: dispatch a
      // synthetic size=0 event. Trigger for both:
      //   - lastSize > 0 (was open, just closed)
      //   - closePending (was already detected as closed but autoclose didn't
      //     finalize because Bybit's closed-pnl API hadn't propagated yet)
      for (const sym of [...this.state.keys()]) {
        if (seenSymbols.has(sym)) continue;
        const s = this.state.get(sym);
        if (!s) continue;
        if (s.lastSize > 0 || s.closePending) {
          await this.dispatchPosition({
            account: this.account,
            data: {
              symbol: sym,
              side: s.side,
              size: '0',
              stopLoss: '0',
              takeProfit: '0',
              entryPrice: '0',
              unrealisedPnl: '0',
              positionValue: '0',
              createdTime: String(s.createdMs),
              seq: s.lastSeq + 1,
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

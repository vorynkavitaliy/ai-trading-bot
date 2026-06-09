/**
 * notification-coalescer — collapses per-account Telegram notifications into ONE
 * consolidated message per trade event.
 *
 * The position-monitor daemon runs one AccountMonitor per sub-key inside a SINGLE
 * process (position-monitor.ts). Each monitor independently detects the same
 * event (entry-fill, DCA fill, naked-SL) on its own account and would fire its
 * own Telegram message — N accounts → N duplicate messages. This module buffers
 * contributions keyed by (event, symbol, side) for a short window, then flushes
 * ONE message listing every account, mirroring how execute.ts/notifyOpen already
 * consolidate the initial entry.
 *
 * In-process only: contributions from separate processes (reconcile cron,
 * close-runner) are NOT seen here — those paths group synchronously on their own.
 */

import { log } from '../core/logger';
import {
  CloseArgs,
  notifyAlert,
  notifyClose,
  notifyDcaFill,
  notifyEntryConfirmedGroup,
} from '../core/tg-templates';

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const WINDOW_MS = envMs('NOTIFY_COALESCE_WINDOW_MS', 4_000);
const NAKED_SL_ALERT_THROTTLE_MS = envMs('NAKED_SL_ALERT_THROTTLE_MS', 30 * 60_000);

interface Bucket<T> {
  items: T[];
  timer: NodeJS.Timeout;
}

/**
 * Generic time-windowed coalescer. First add() for a key starts a flush timer;
 * subsequent adds within the window append to the same bucket. On flush the
 * collected items are handed to flushFn as a batch and the bucket is dropped.
 */
export class Coalescer<T> {
  private readonly buckets = new Map<string, Bucket<T>>();

  constructor(
    private readonly windowMs: number,
    private readonly flushFn: (key: string, items: T[]) => Promise<void>,
  ) {}

  add(key: string, item: T): void {
    const existing = this.buckets.get(key);
    if (existing) {
      existing.items.push(item);
      return;
    }
    const timer = setTimeout(() => { void this.flush(key); }, this.windowMs);
    timer.unref();
    this.buckets.set(key, { items: [item], timer });
  }

  private async flush(key: string): Promise<void> {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    this.buckets.delete(key);
    try {
      await this.flushFn(key, bucket.items);
    } catch (e: any) {
      log.error('notification coalescer flush failed', { key, err: e?.message });
    }
  }
}

// -----------------------------------------------------------
// ENTRY CONFIRMED (pending limit filled → promotion)
// -----------------------------------------------------------
export interface EntryConfirmedContribution {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  avgPrice: number;
  sl: number;
  tp: number | null;
  accountLabel: string;
}

const entryConfirmed = new Coalescer<EntryConfirmedContribution>(WINDOW_MS, async (_key, items) => {
  const first = items[0];
  const tag = first.symbol.replace(/USDT$/, '');
  await notifyEntryConfirmedGroup({
    symbol: first.symbol,
    side: first.side,
    sizeTotal: items.reduce((s, i) => s + i.size, 0),
    avgPrice: first.avgPrice,
    sl: first.sl,
    tp: first.tp,
    accountSummaries: items.map((i) => `${i.accountLabel} — ${i.size.toFixed(2)} ${tag}`),
  });
});

export function coalesceEntryConfirmed(c: EntryConfirmedContribution): void {
  entryConfirmed.add(`${c.symbol}-${c.side}`, c);
}

// -----------------------------------------------------------
// DCA FILL (grid scaled-in slot filled retroactively)
// -----------------------------------------------------------
export interface DcaFillContribution {
  symbol: string;
  side: 'buy' | 'sell';
  prevSize: number;
  newSize: number;
  newAvgPrice: number;
  sl: number;
  tp: number | null;
  accountSummary: string;
}

const dcaFill = new Coalescer<DcaFillContribution>(WINDOW_MS, async (_key, items) => {
  const first = items[0];
  await notifyDcaFill({
    symbol: first.symbol,
    side: first.side,
    prevSize: items.reduce((s, i) => s + i.prevSize, 0),
    newSize: items.reduce((s, i) => s + i.newSize, 0),
    newAvgPrice: first.newAvgPrice,
    sl: first.sl,
    tp: first.tp,
    accountSummaries: items.map((i) => i.accountSummary),
  });
});

export function coalesceDcaFill(c: DcaFillContribution): void {
  dcaFill.add(`${c.symbol}-${c.side}`, c);
}

// -----------------------------------------------------------
// CLOSE (TP1 partial, full close on SL/TP2) — one message per
// (symbol,side,reason), prices/R qty-weighted, per-account breakdown listed.
// -----------------------------------------------------------
export interface CloseContribution {
  symbol: string;
  side: 'Buy' | 'Sell';
  exitReason: CloseArgs['exitReason'];
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnlUsd: number;
  pnlR: number;
  accountLabel: string;
  comment?: string;
}

const closes = new Coalescer<CloseContribution>(WINDOW_MS, async (_key, items) => {
  const first = items[0];
  const totalQty = items.reduce((s, i) => s + i.qty, 0) || 1;
  await notifyClose({
    symbol: first.symbol,
    side: first.side === 'Buy' ? 'buy' : 'sell',
    exitReason: first.exitReason,
    entryPrice: items.reduce((s, i) => s + i.entryPrice * i.qty, 0) / totalQty,
    exitPrice: items.reduce((s, i) => s + i.exitPrice * i.qty, 0) / totalQty,
    pnlUsd: items.reduce((s, i) => s + i.pnlUsd, 0),
    pnlR: items.reduce((s, i) => s + i.pnlR * i.qty, 0) / totalQty,
    comment: first.comment,
    accountFills: items.map((i) => ({
      label: i.accountLabel, qty: i.qty, pnlUsd: i.pnlUsd, pnlR: i.pnlR,
    })),
  });
});

export function coalesceClose(c: CloseContribution): void {
  closes.add(`${c.symbol}-${c.side}-${c.exitReason}`, c);
}

// -----------------------------------------------------------
// NAKED-SL alert (divergence: position with size > 0 but no server SL)
// Coalesced across accounts AND throttled per (symbol,side) so repeated
// detections (daemon poll + closeall order-cancel) don't spam.
// -----------------------------------------------------------
export type NakedSlOutcome = 'sl_set' | 'closed' | 'dust' | 'critical';

export interface NakedSlContribution {
  symbol: string;
  side: 'Buy' | 'Sell';
  accountLabel: string;
  outcome: NakedSlOutcome;
  detail: string;
}

const nakedSlLastSent = new Map<string, number>();

const nakedSl = new Coalescer<NakedSlContribution>(WINDOW_MS, async (key, items) => {
  nakedSlLastSent.set(key, Date.now());
  const first = items[0];
  const hasCritical = items.some((i) => i.outcome === 'critical');
  const accountLines = items.map((i) => `${i.accountLabel} — ${i.detail}`).join('\n   • ');
  await notifyAlert({
    kind: 'reconcile_divergence',
    symbol: first.symbol,
    detail: `${first.symbol} ${first.side} был БЕЗ стоп-лосса на ${items.length} акк.:\n   • ${accountLines}`,
    action: hasCritical
      ? 'СРОЧНО: закрой вручную через Bybit UI. Проверь execute.ts — SL не привязался при open.'
      : 'Проверь execute.ts — почему SL не сохранился при open.',
  });
});

export function coalesceNakedSlAlert(c: NakedSlContribution): void {
  const key = `${c.symbol}-${c.side}`;
  const last = nakedSlLastSent.get(key) ?? 0;
  if (Date.now() - last < NAKED_SL_ALERT_THROTTLE_MS) {
    log.debug('naked-SL alert throttled', { key, sinceMs: Date.now() - last });
    return;
  }
  nakedSl.add(key, c);
}

// -----------------------------------------------------------
// NAKED-TP recovery alert (position had SL but no TP1/TP2 limit legs; watcher
// re-placed them). Coalesced across accounts + throttled per (symbol,side).
// -----------------------------------------------------------
export interface NakedTpContribution {
  symbol: string;
  side: 'Buy' | 'Sell';
  accountLabel: string;
  tp1: number;
  tp2: number;
}

const nakedTpLastSent = new Map<string, number>();

const nakedTp = new Coalescer<NakedTpContribution>(WINDOW_MS, async (key, items) => {
  nakedTpLastSent.set(key, Date.now());
  const first = items[0];
  const accountLines = items.map((i) => i.accountLabel).join(', ');
  await notifyAlert({
    kind: 'reconcile_divergence',
    symbol: first.symbol,
    detail: `${first.symbol} ${first.side} был БЕЗ TP1/TP2 на ${items.length} акк. (${accountLines}). Watcher восстановил из DB: TP1=${first.tp1.toFixed(4)}, TP2=${first.tp2.toFixed(4)}`,
    action: 'Проверь execute.ts — почему TP не выставились при open.',
  });
});

export function coalesceNakedTpAlert(c: NakedTpContribution): void {
  const key = `${c.symbol}-${c.side}`;
  const last = nakedTpLastSent.get(key) ?? 0;
  if (Date.now() - last < NAKED_SL_ALERT_THROTTLE_MS) {
    log.debug('naked-TP alert throttled', { key, sinceMs: Date.now() - last });
    return;
  }
  nakedTp.add(key, c);
}

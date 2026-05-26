import { randomUUID } from 'node:crypto';

import { AccountKey } from './accounts';
import { getRest, getInstrumentInfo, roundQtyToStep, withRetry } from './bybit';
import { log } from './logger';

export type CloseStatus = 'ok' | 'dust_below_min' | 'stuck' | 'no_position' | 'error';

export interface CloseAttempt {
  account: string;
  symbol: string;
  initialSize: number;
  finalSize: number;
  attempts: number;
  status: CloseStatus;
  detail?: string;
}

export interface CloseAndVerifyOpts {
  reason: string;
  maxAttempts?: number;
  pollDelayMs?: number;
  cancelOrders?: boolean;
}

export interface MultiCloseResult {
  attempts: CloseAttempt[];
  allClosed: boolean;
  stuck: CloseAttempt[];
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_POLL_DELAY_MS = 1500;

interface PositionSnapshot {
  size: number;
  side: 'Buy' | 'Sell' | null;
  markPrice: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPositionSnapshot(account: AccountKey, symbol: string): Promise<PositionSnapshot> {
  const c = getRest(account);
  const r = await withRetry(
    () => c.getPositionInfo({ category: 'linear', symbol }),
    { label: `verify-pos-${symbol}-${account.keyName}` },
  );
  if (r.retCode !== 0) {
    throw new Error(`getPositionInfo retCode=${r.retCode} ${r.retMsg}`);
  }
  const list = (r.result?.list ?? []).filter((p: any) => parseFloat(p.size ?? '0') > 0);
  if (list.length === 0) {
    return { size: 0, side: null, markPrice: 0 };
  }
  const p = list[0];
  const rawSide = p.side;
  const side: 'Buy' | 'Sell' | null = rawSide === 'Buy' || rawSide === 'Sell' ? rawSide : null;
  return {
    size: parseFloat(p.size ?? '0'),
    side,
    markPrice: parseFloat(p.markPrice ?? p.avgPrice ?? '0'),
  };
}

async function cancelSymbolOrders(account: AccountKey, symbol: string): Promise<void> {
  const c = getRest(account);
  try {
    await withRetry(
      () => c.cancelAllOrders({ category: 'linear', symbol }),
      { label: `verify-cancel-${symbol}-${account.keyName}` },
    );
  } catch (e: any) {
    log.warn('closeAndVerify: cancelAllOrders failed (non-fatal)', {
      account: `${account.bucket}/${account.keyName}`,
      symbol,
      err: e?.message ?? String(e),
    });
  }
}

export async function closeAndVerify(
  account: AccountKey,
  symbol: string,
  opts: CloseAndVerifyOpts,
): Promise<CloseAttempt> {
  const label = `${account.bucket}/${account.keyName}`;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const pollDelayMs = opts.pollDelayMs ?? DEFAULT_POLL_DELAY_MS;

  try {
    if (opts.cancelOrders !== false) {
      await cancelSymbolOrders(account, symbol);
    }

    const initial = await fetchPositionSnapshot(account, symbol);
    if (initial.size === 0 || initial.side === null) {
      return {
        account: label,
        symbol,
        initialSize: 0,
        finalSize: 0,
        attempts: 0,
        status: 'no_position',
      };
    }

    const initialSize = initial.size;
    const closeSide: 'Buy' | 'Sell' = initial.side === 'Buy' ? 'Sell' : 'Buy';
    const info = await getInstrumentInfo(account, symbol);
    const c = getRest(account);

    let attemptsTaken = 0;
    let lastSnapshot: PositionSnapshot = initial;
    let dustBelowMin = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const snap = await fetchPositionSnapshot(account, symbol);
      lastSnapshot = snap;

      if (snap.size === 0) break;

      const qtyStr = roundQtyToStep(snap.size, info);
      const qtyRounded = parseFloat(qtyStr);
      if (qtyRounded <= 0) {
        dustBelowMin = true;
        break;
      }

      const markPrice = snap.markPrice > 0 ? snap.markPrice : lastSnapshot.markPrice;
      const notional = snap.size * markPrice;
      if (markPrice > 0 && notional < info.minNotionalValue) {
        dustBelowMin = true;
        break;
      }

      attemptsTaken = attempt + 1;
      try {
        const r = await withRetry(
          () => c.submitOrder({
            category: 'linear',
            symbol,
            side: closeSide,
            orderType: 'Market',
            qty: qtyStr,
            timeInForce: 'IOC',
            reduceOnly: true,
            orderLinkId: `cv-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          }),
          { label: `verify-close-${symbol}-${account.keyName}-a${attempt}`, tries: 2 },
        );
        if (r.retCode !== 0) {
          log.warn('closeAndVerify: submitOrder non-zero retCode (position is source of truth)', {
            account: label, symbol, attempt, retCode: r.retCode, retMsg: r.retMsg,
          });
        }
      } catch (e: any) {
        log.warn('closeAndVerify: submitOrder threw (will re-poll)', {
          account: label, symbol, attempt, err: e?.message ?? String(e),
        });
      }

      await sleep(pollDelayMs);
    }

    const finalSnap = await fetchPositionSnapshot(account, symbol);
    const finalSize = finalSnap.size;
    const finalMark = finalSnap.markPrice > 0 ? finalSnap.markPrice : lastSnapshot.markPrice;

    let status: CloseStatus;
    if (finalSize === 0) {
      status = 'ok';
    } else if (dustBelowMin || (finalMark > 0 && finalSize * finalMark < info.minNotionalValue)) {
      status = 'dust_below_min';
    } else {
      status = 'stuck';
    }

    return {
      account: label,
      symbol,
      initialSize,
      finalSize,
      attempts: attemptsTaken,
      status,
      detail: opts.reason,
    };
  } catch (e: any) {
    log.error('closeAndVerify: unhandled error', {
      account: label, symbol, reason: opts.reason, err: e?.message ?? String(e),
    });
    return {
      account: label,
      symbol,
      initialSize: 0,
      finalSize: 0,
      attempts: 0,
      status: 'error',
      detail: e?.message ?? String(e),
    };
  }
}

export async function closeAcrossAccounts(
  accounts: AccountKey[],
  symbol: string,
  opts: CloseAndVerifyOpts,
): Promise<MultiCloseResult> {
  const attempts = await Promise.all(
    accounts.map((a) => closeAndVerify(a, symbol, opts)),
  );

  await Promise.all(
    accounts.map(async (a, idx) => {
      const att = attempts[idx];
      if (att.status !== 'ok') return;
      try {
        const snap = await fetchPositionSnapshot(a, symbol);
        if (snap.size > 0) {
          att.status = 'stuck';
          att.finalSize = snap.size;
          att.detail = (att.detail ? att.detail + ' | ' : '') + 'cross-check: residue reappeared';
          log.warn('closeAcrossAccounts: cross-check downgraded ok → stuck', {
            account: att.account, symbol, residue: snap.size,
          });
        }
      } catch (e: any) {
        log.warn('closeAcrossAccounts: cross-check fetch failed (non-fatal)', {
          account: att.account, symbol, err: e?.message ?? String(e),
        });
      }
    }),
  );

  const allClosed = attempts.every(
    (a) => a.status === 'ok' || a.status === 'no_position' || a.status === 'dust_below_min',
  );
  const stuck = attempts.filter((a) => a.status === 'stuck' || a.status === 'error');

  return { attempts, allClosed, stuck };
}

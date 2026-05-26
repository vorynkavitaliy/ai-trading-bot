// Position watcher — cron entry kept as a thin shim during the TASK-006 overlap.
// Pure detectors + side-effect handlers live in src/runtime/position-events.ts.
// This file only wires them into the legacy 5-min cron path so behaviour is
// unchanged during the 24-48h overlap migration to the WS daemon.

import { loadAccounts } from '../core/accounts';
import { getRest, withRetry } from '../core/bybit';
import { log } from '../core/logger';
import { tradeRepo, OpenTrade } from '../data/trade-repo';
import { nakedTpRecovery } from './naked-tp-recovery';
import {
  BybitPos,
  RecoveryAction,
  Tp1FillGroup,
  isTp1PartialFromPosition,
  inferTp1Fill,
  handleTp1Fill,
  handleDcaFill,
  flushTp1Groups,
  handleNakedSl,
} from './position-events';
import { sendDrawdownAlerts } from './drawdown-alerts';

function matchDbTrade(
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

async function fetchOpenPositionsWithDb(): Promise<BybitPos[]> {
  const accounts = loadAccounts();
  const dbTrades = await tradeRepo.openTrades();
  const results: BybitPos[] = [];

  for (const acc of accounts) {
    const c = getRest(acc);
    const r = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), {
      label: `pos-${acc.bucket}/${acc.keyName}`,
    });
    if (r.retCode !== 0) {
      log.warn('positions fetch failed', { account: acc.keyName, retCode: r.retCode });
      continue;
    }
    const list = (r.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);

    for (const p of list) {
      const db = matchDbTrade(dbTrades, acc.bucket, acc.keyName, p.symbol, p.side);
      if (!db) continue;
      const openedMs = Date.parse(db.opened_at);

      results.push({
        symbol: p.symbol,
        side: (p.side === 'Buy' || p.side === 'Sell') ? p.side : 'Buy',
        size: parseFloat(p.size),
        initialSize: db.initial_qty,
        entryPrice: parseFloat(p.avgPrice ?? '0'),
        curSL: parseFloat(p.stopLoss ?? '0'),
        curTP: p.takeProfit ? parseFloat(p.takeProfit) : null,
        unrealisedPnl: parseFloat(p.unrealisedPnl ?? '0'),
        positionValue: parseFloat(p.positionValue ?? '0'),
        createdTime: Number.isFinite(openedMs) && openedMs > 0 ? openedMs : parseInt(p.createdTime ?? '0', 10),
        account: acc,
        dbTradeId: db.id,
        dbInitialSL: db.sl ?? 0,
        dbTP1: db.tp1,
        dbTP2: db.tp2,
        dbInitialQty: db.initial_qty,
        dbCurrentQty: db.qty,
        tp1AlreadyFilled: db.tp1_filled,
      });
    }
  }
  return results;
}

export async function runPositionWatcher(): Promise<{
  inspected: number;
  actions: Array<{ symbol: string; account: string; action: string; reason: string }>;
}> {
  const positions = await fetchOpenPositionsWithDb();
  const actions: RecoveryAction[] = [];
  const tp1Groups = new Map<string, Tp1FillGroup>();

  for (const pos of positions) {
    if (!pos.curSL || pos.curSL === 0) {
      const nakedActions = await handleNakedSl(pos);
      actions.push(...nakedActions);
      continue;
    }

    const recovered = await nakedTpRecovery.check(pos, getRest(pos.account));
    if (recovered) actions.push(recovered);

    if (!pos.tp1AlreadyFilled && pos.size > pos.dbInitialQty * 1.01) {
      const dcaAction = await handleDcaFill(pos);
      if (dcaAction) actions.push(dcaAction);
    }

    const tp1Triggered = isTp1PartialFromPosition(
      pos.dbInitialQty,
      pos.size,
      pos.dbInitialQty,
      pos.dbCurrentQty,
      pos.tp1AlreadyFilled,
    );
    if (tp1Triggered) {
      try {
        const fill = await inferTp1Fill(
          pos.account,
          pos.symbol,
          pos.dbInitialQty,
          pos.size,
          pos.dbTP1,
          pos.entryPrice,
          pos.side,
          pos.createdTime,
        );
        const tp1Action = await handleTp1Fill(pos, fill, tp1Groups);
        actions.push(tp1Action);
      } catch (e: any) {
        log.warn('TP1 fill processing failed', {
          symbol: pos.symbol, account: pos.account.keyName, err: e.message,
        });
      }
      continue;
    }
  }

  await flushTp1Groups(tp1Groups);
  await sendDrawdownAlerts(positions);

  return { inspected: positions.length, actions };
}

async function main() {
  const r = await runPositionWatcher();
  console.log(JSON.stringify(r, null, 2));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      log.error('position-watcher crashed', { err: e?.message ?? String(e), stack: e?.stack });
      process.exit(1);
    });
}

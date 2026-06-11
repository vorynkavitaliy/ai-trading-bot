import { tx } from '../core/db';
import { log } from '../core/logger';
import { PromotablePending } from '../core/pending-orders';
import { writeTradeJournal } from './trade-journal';

export interface PromotionResult {
  tradeId: number;
  created: boolean;
}

export interface CreditedPosition {
  size: number;
  avgPrice: number;
}

// Materialize a trades row from a credited pending intent. Idempotent: the daemon
// and reconcile both call this; a `SELECT … FOR UPDATE WHERE trade_id IS NULL`
// row lock serializes them so only the first promotes (created:true) and the
// loser no-ops (created:false). Returns null if no eligible intent exists.
export async function promotePendingToTrade(
  pending: PromotablePending,
  bybitPos: CreditedPosition
): Promise<PromotionResult | null> {
  return tx(async (client) => {
    const locked = await client.query<{ id: string; trade_id: string | null }>(
      `SELECT id, trade_id FROM pending_orders WHERE id=$1 FOR UPDATE`,
      [pending.id]
    );
    const row = locked.rows[0];
    if (!row) return null;

    if (row.trade_id != null) {
      return { tradeId: parseInt(row.trade_id, 10), created: false };
    }

    const entryPrice = bybitPos.avgPrice > 0 ? bybitPos.avgPrice : pending.entryPrice;
    if (!(bybitPos.avgPrice > 0)) {
      log.warn('promotion: Bybit avgPrice<=0 — falling back to planned entry_price', {
        orderLinkId: pending.orderLinkId, symbol: pending.symbol, planned: pending.entryPrice,
      });
    }

    const sideForJournal = pending.side === 'Buy' ? 'buy' : 'sell';
    const orderTypeForJournal = pending.orderType === 'Market' ? 'market' : 'limit';
    const tradeFile = writeTradeJournal({
      symbol: pending.symbol,
      side: sideForJournal,
      orderType: orderTypeForJournal,
      entryPrice,
      sl: pending.sl,
      tp1: pending.tp1,
      tp2: pending.tp2,
      riskPct: pending.riskPct,
      totalQty: bybitPos.size,
      accounts: [`${pending.accountBucket}/${pending.accountKey}=${bybitPos.size}`],
      rationale: pending.rationale ?? '(promoted from pending intent)',
    });

    const ins = await client.query<{ id: string }>(
      `INSERT INTO trades (
         account_bucket, account_key, symbol, side, order_type, qty, initial_qty,
         entry_price, sl, tp1, tp2, status, rationale,
         bybit_order_id, vault_trade_file, signal_price, strategy, opened_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW())
       RETURNING id`,
      [
        pending.accountBucket, pending.accountKey, pending.symbol, pending.side,
        pending.orderType, bybitPos.size, bybitPos.size,
        // entry_price = actual fill (avgPrice); signal_price = the strategy decision price
        // the SL/TP/size were anchored to — slippage = signal_price − entry_price.
        entryPrice, pending.sl, pending.tp1, pending.tp2,
        'open', (pending.rationale ?? '').slice(0, 4000),
        pending.bybitOrderId, tradeFile, pending.entryPrice, pending.strategy,
      ]
    );
    const tradeId = parseInt(ins.rows[0].id, 10);

    await client.query(
      `UPDATE pending_orders SET trade_id=$1, resolved_at=NOW() WHERE id=$2`,
      [tradeId, pending.id]
    );

    log.info('pending promoted to trade', {
      orderLinkId: pending.orderLinkId, symbol: pending.symbol, side: pending.side,
      tradeId, size: bybitPos.size, entryPrice,
    });

    return { tradeId, created: true };
  });
}

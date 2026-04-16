import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';

const mgr = new AccountManager();
const client = new BybitClient(mgr);

(async () => {
  const allPos = await client.getAllPositions();
  for (const { sub, positions } of allPos) {
    for (const p of positions) {
      console.log(`[${sub.label}] ${p.symbol} ${p.side} ${p.size} @ ${p.entryPrice} | Mark: ${p.markPrice} | PnL: ${p.unrealisedPnl} USDT | SL: ${p.stopLoss} | TP: ${p.takeProfit} | Lev: ${p.leverage}x`);
    }
    if (positions.length === 0) {
      console.log(`[${sub.label}] нет открытых позиций`);
    }
  }
})();

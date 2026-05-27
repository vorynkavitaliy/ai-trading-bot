import fs from 'node:fs';
import path from 'node:path';

export interface TradeJournalArgs {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  entryPrice: number | null;
  sl: number;
  tp1: number | null;
  tp2: number | null;
  riskPct: number | null;
  totalQty: number;
  accounts: string[];
  rationale: string;
}

export function writeTradeJournal(a: TradeJournalArgs): string {
  const date = new Date().toISOString().slice(0, 10);
  const dir = a.side === 'buy' ? 'LONG' : 'SHORT';
  const tradeFile = path.join('vault/Trades', `${date}_${a.symbol}_${dir}.md`);
  fs.mkdirSync(path.dirname(tradeFile), { recursive: true });

  const fm = [
    '---',
    `symbol: ${a.symbol}`,
    `side: ${a.side}`,
    `order_type: ${a.orderType}`,
    `entry_price: ${a.entryPrice ?? ''}`,
    `sl: ${a.sl}`,
    `tp1: ${a.tp1 ?? ''}`,
    `tp2: ${a.tp2 ?? ''}`,
    `risk_pct: ${a.riskPct ?? ''}`,
    `total_qty: ${a.totalQty}`,
    `accounts: ${JSON.stringify(a.accounts)}`,
    `opened_at: ${new Date().toISOString()}`,
    `status: open`,
    '---',
    '',
    '## Rationale',
    '',
    a.rationale,
    '',
  ].join('\n');

  fs.writeFileSync(tradeFile, fm);
  return tradeFile;
}

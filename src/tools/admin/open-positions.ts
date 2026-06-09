/**
 * open-positions — read-only snapshot of currently open trades from the DB,
 * grouped by (symbol, side): account count, total qty, avg entry, SL, TP.
 *
 * Run: npx tsx src/tools/admin/open-positions.ts
 */

import { query, close as closePg } from '../../core/db';

interface Row {
  symbol: string;
  side: string;
  accts: string;
  qty: string;
  entry: string;
  sl: string;
  tp1: string;
  opened: string;
}

async function main(): Promise<void> {
  const { rows } = await query<Row>(
    `SELECT symbol, side,
            COUNT(*)::text          AS accts,
            SUM(qty)::text          AS qty,
            AVG(entry_price)::text  AS entry,
            MAX(sl)::text           AS sl,
            MAX(tp1)::text          AS tp1,
            MIN(opened_at)::text    AS opened
     FROM trades
     WHERE status = 'open'
     GROUP BY symbol, side
     ORDER BY symbol`,
  );
  if (rows.length === 0) {
    console.log('нет открытых позиций');
  } else {
    for (const r of rows) {
      const entry = parseFloat(r.entry);
      const sl = parseFloat(r.sl);
      const isLong = r.side.toLowerCase() === 'buy' || r.side.toLowerCase() === 'long';
      const slDistPct = entry > 0 ? ((sl - entry) / entry) * 100 : 0;
      console.log(
        `${r.symbol} ${r.side}  accts=${r.accts}  qty=${parseFloat(r.qty).toFixed(1)}  ` +
        `avgEntry=${entry}  SL=${sl} (${slDistPct >= 0 ? '+' : ''}${slDistPct.toFixed(2)}%)  ` +
        `TP1=${r.tp1}  opened=${r.opened}`,
      );
    }
  }
  await closePg();
}

main().catch((e) => { console.error(e); process.exit(1); });

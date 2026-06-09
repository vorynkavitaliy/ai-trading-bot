/**
 * place-market-btc — compute the BTC short entry params (live price + ATR-based SL/TP,
 * matching the live BTC config: ls_top_position fade, SL 2.0×ATR, TP 2.0×ATR, risk 1.25%)
 * and PRINT the exact execute.ts command to place a MARKET short on all accounts.
 * Read-only — does NOT place. Run: npx tsx src/tools/admin/place-market-btc.ts
 */
import { loadAccounts } from '../../core/accounts';
import { getLiveTickers } from '../../core/bybit';
import { atr } from '../../core/indicators';
import { query, close as closePg } from '../../core/db';

const SL_ATR = 2.0, TP_ATR = 2.0, RISK = 1.25;

async function main() {
  const { rows } = await query<any>(
    `SELECT ts, open::float o, high::float h, low::float l, close::float c
       FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts DESC LIMIT 30`);
  const bars = rows.reverse().map((r: any) => ({ ts: Number(r.ts), open: r.o, high: r.h, low: r.l, close: r.c }));
  const a = atr(bars as any, 14);
  const accts = loadAccounts();
  const tick = await getLiveTickers(accts[0], ['BTCUSDT']);
  const px = tick.get('BTCUSDT');
  if (!a || !px) { console.log('ERROR: atr or price missing', { a, px }); await closePg(); return; }

  // SHORT: SL above, TP below.
  const sl = +(px + SL_ATR * a).toFixed(1);
  const tp = +(px - TP_ATR * a).toFixed(1);
  console.log(`\nBTC SHORT (market) params:`);
  console.log(`  live price : ${px}`);
  console.log(`  ATR(14) 4H : ${a.toFixed(1)}  (${(a / px * 100).toFixed(2)}% of price)`);
  console.log(`  SL (2·ATR) : ${sl}  (+${((sl - px) / px * 100).toFixed(2)}%)`);
  console.log(`  TP (2·ATR) : ${tp}  (${((tp - px) / px * 100).toFixed(2)}%)`);
  console.log(`  risk       : ${RISK}% per account`);
  console.log(`\nExecute command (broadcasts to all accounts):`);
  console.log(`  npx tsx src/runtime/execute.ts --symbol BTCUSDT --side sell --order-type market --entry-price ${px} --sl ${sl} --tp1 ${tp} --tp2 ${tp} --risk-pct ${RISK} --rationale "manual market BTC short — recover missed 05:00 signal + verify market path"`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

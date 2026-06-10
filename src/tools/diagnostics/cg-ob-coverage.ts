/**
 * cg-ob-coverage — confirm candle availability + funding_oi join keys for the
 * depth-imbalance IC study. Read-only.
 */
import { query, close } from '../../core/db';

async function main() {
  // candle tf availability for one book pair
  const tf = await query<any>(
    `SELECT symbol, tf, COUNT(*)::int n, to_timestamp(MIN(ts)/1000)::date f, to_timestamp(MAX(ts)/1000)::date l
     FROM candles WHERE symbol IN ('BTCUSDT','SOLUSDT','ETHUSDT') AND tf IN ('240m','60m','1D')
     GROUP BY symbol, tf ORDER BY symbol, tf`);
  console.log('=== candles tf availability ==='); console.table(tf.rows);

  // funding_oi symbol naming + span
  const fo = await query<any>(
    `SELECT symbol, COUNT(*)::int n, to_timestamp(MIN(ts)/1000)::date f, to_timestamp(MAX(ts)/1000)::date l
     FROM cg_funding_oi_weighted WHERE symbol IN ('BTC','SOL','ETH','XRP','LTC') GROUP BY symbol ORDER BY symbol`);
  console.log('=== funding_oi_weighted span ==='); console.table(fo.rows);

  // ts alignment check: orderbook ts vs candle 240m ts (are they on the same 4h grid?)
  const align = await query<any>(
    `SELECT ob.ts AS ob_ts, c.ts AS candle_ts
     FROM cg_orderbook_pair ob
     LEFT JOIN candles c ON c.symbol = ob.pair AND c.tf='240m' AND c.ts = ob.ts
     WHERE ob.pair='BTCUSDT' ORDER BY ob.ts DESC LIMIT 5`);
  console.log('=== ob.ts vs 240m candle.ts alignment (candle_ts null = no match) ==='); console.table(align.rows);

  // how many ob rows match a 240m candle exactly
  const matchN = await query<any>(
    `SELECT COUNT(*)::int total,
            COUNT(c.ts)::int matched
     FROM cg_orderbook_pair ob
     LEFT JOIN candles c ON c.symbol = ob.pair AND c.tf='240m' AND c.ts = ob.ts
     WHERE ob.pair='BTCUSDT'`);
  console.log('BTC ob rows matched to 240m candle:', JSON.stringify(matchN.rows[0]));

  await close();
}
main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

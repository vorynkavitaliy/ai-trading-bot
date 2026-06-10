/** candle-range — print first/last 60m candle ts per book pair (read-only). */
import { query, close as closePg } from '../../core/db';

async function main() {
  const r = await query<{ symbol: string; first: string; last: string; n: string }>(
    `select symbol,
            to_char(to_timestamp(min(ts)/1000),'YYYY-MM-DD') as first,
            to_char(to_timestamp(max(ts)/1000),'YYYY-MM-DD') as last,
            count(*)::text as n
       from candles
      where tf = '60m'
        and symbol in ('BTCUSDT','SOLUSDT','ADAUSDT','LINKUSDT')
      group by symbol order by symbol`,
  );
  for (const row of r.rows) console.log(`${row.symbol.padEnd(9)} ${row.first} → ${row.last}  n=${row.n}`);
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

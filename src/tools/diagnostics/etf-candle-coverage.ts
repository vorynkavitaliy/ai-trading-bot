/**
 * etf-candle-coverage — read-only: report candle coverage (1D + 240m) for the
 * ETF-relevant pairs so we know whether the ETF daily flow series aligns to a
 * tradable daily-return series from OUR candles.
 */
import { query } from '../../core/db';

async function main() {
  const r = await query<any>(
    `SELECT symbol, tf, count(*) AS n,
            min(ts) AS first_ms, max(ts) AS last_ms
       FROM candles
      WHERE symbol IN ('BTCUSDT','ETHUSDT','SOLUSDT')
        AND tf IN ('1D','240m','60m')
      GROUP BY symbol, tf
      ORDER BY symbol, tf`,
  );
  for (const row of r.rows) {
    const first = new Date(Number(row.first_ms)).toISOString();
    const last = new Date(Number(row.last_ms)).toISOString();
    console.log(`${row.symbol} ${row.tf}: n=${row.n} first=${first} last=${last}`);
  }
  process.exit(0);
}
main();

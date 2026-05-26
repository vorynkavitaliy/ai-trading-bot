// One-shot diagnostic: list all cg_* tables in the database and report
// coverage (rows + date range) for a given pair/coin. Used to plan strategy
// research — knowing which CG datasets are dense vs. sparse before mining.
import { query, close as closePg } from '../../core/db';

async function main() {
  const coin = process.argv[2] ?? 'BTC';
  const pair = process.argv[3] ?? 'BTCUSDT';

  const tbls = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'cg_%'
     ORDER BY table_name`,
    []
  );

  console.log(`coin=${coin}  pair=${pair}\n`);
  console.log('table'.padEnd(36) + 'rows'.padStart(10) + '  ' + 'first'.padEnd(12) + 'last'.padEnd(12) + 'tf-hint');

  for (const { table_name } of tbls.rows) {
    const cols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table_name]
    );
    const cn = cols.rows.map(c => c.column_name);
    const filters: string[] = [];
    const params: any[] = [];
    if (cn.includes('symbol')) { filters.push(`symbol = $${params.length + 1}`); params.push(coin); }
    if (cn.includes('pair'))   { filters.push(`pair = $${params.length + 1}`);   params.push(pair); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const r = await query<any>(
      `SELECT COUNT(*)::int AS rows,
              to_timestamp(MIN(ts)/1000)::date AS first_day,
              to_timestamp(MAX(ts)/1000)::date AS last_day
       FROM ${table_name} ${where}`,
      params
    );
    const row = r.rows[0];
    const first = row.first_day ?? '—';
    const last = row.last_day ?? '—';

    // tf hint: sample 100 ts to infer interval
    let tfHint = '';
    if (row.rows > 1) {
      const sample = await query<{ ts: string }>(
        `SELECT ts FROM ${table_name} ${where} ORDER BY ts DESC LIMIT 100`,
        params
      );
      if (sample.rows.length >= 2) {
        const tss = sample.rows.map(r => Number(r.ts)).sort((a, b) => a - b);
        const dts: number[] = [];
        for (let i = 1; i < tss.length; i++) dts.push(tss[i] - tss[i - 1]);
        dts.sort((a, b) => a - b);
        const median = dts[Math.floor(dts.length / 2)];
        if (median < 60_000) tfHint = '~tick';
        else if (median <= 60_001) tfHint = '1m';
        else if (median <= 5 * 60_001) tfHint = '5m';
        else if (median <= 15 * 60_001) tfHint = '15m';
        else if (median <= 60 * 60_001) tfHint = '1h';
        else if (median <= 4 * 60 * 60_001) tfHint = '4h';
        else if (median <= 8 * 60 * 60_001) tfHint = '8h';
        else if (median <= 24 * 60 * 60_001) tfHint = '1d';
        else tfHint = `~${(median / 3600_000).toFixed(1)}h`;
      }
    }
    console.log(table_name.padEnd(36) + String(row.rows).padStart(10) + '  ' +
                String(first).padEnd(12) + String(last).padEnd(12) + tfHint);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

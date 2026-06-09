import { query } from '../../core/db';
import { percentile } from '../../core/indicators';

// Probe: are CG percentile series ever flat enough to make the percentile()
// function degenerate into a binary 0/1 signal? Checks the three series that
// cg-fade strategies actually feed into percentile().
async function main() {
  const pairs = ['SOLUSDT', 'INJUSDT', 'ATOMUSDT', 'ARBUSDT', 'XRPUSDT', 'LTCUSDT', 'HYPEUSDT', 'ETHUSDT', 'BNBUSDT', 'TAOUSDT'];
  const coinOf = (p: string) => p.replace('USDT', '');
  const WIN = 180;

  const probes: { table: string; col: string; key: 'pair' | 'symbol'; id: (p: string) => string }[] = [
    { table: 'cg_ls_top_position', col: 'ratio', key: 'pair', id: (p) => p },
    { table: 'cg_ls_top_account', col: 'ratio', key: 'pair', id: (p) => p },
    { table: 'cg_funding_oi_weighted', col: 'fr_close', key: 'symbol', id: (p) => coinOf(p) },
  ];

  for (const probe of probes) {
    for (const pair of pairs) {
      const exFilter = probe.key === 'pair' ? `AND exchange = 'Binance'` : '';
      const rows = await query<{ v: string }>(
        `SELECT ${probe.col}::text AS v FROM ${probe.table}
         WHERE ${probe.key} = $1 ${exFilter}
         ORDER BY ts DESC LIMIT ${WIN}`,
        [probe.id(pair)]
      );
      if (rows.rows.length < WIN) {
        console.log(`${probe.table} ${pair}: only ${rows.rows.length} rows (< ${WIN}) → strategy returns null (guarded)`);
        continue;
      }
      const series = rows.rows.map((r) => parseFloat(r.v)).reverse();
      const cur = series[series.length - 1];
      const uniq = new Set(series.map((x) => x.toFixed(8))).size;
      const min = Math.min(...series);
      const max = Math.max(...series);
      const pct = percentile(series, cur);
      const flat = uniq === 1;
      // How many distinct values equal cur — informs whether pct collapses to 1.0
      const eqCur = series.filter((x) => x === cur).length;
      console.log(
        `${probe.table.padEnd(24)} ${pair.padEnd(8)} n=${series.length} uniq=${uniq} ` +
        `min=${min} max=${max} cur=${cur} eqCur=${eqCur} pct=${pct.toFixed(4)} ${flat ? 'FLAT!' : ''}`
      );
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

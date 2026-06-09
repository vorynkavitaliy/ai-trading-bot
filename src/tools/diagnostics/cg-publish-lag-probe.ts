/**
 * cg-publish-lag-probe — measures the REAL availability lag of a just-closed 4H Coinglass bar.
 *
 * Polls every ~60s across a 4H boundary, checking when the boundary's bar (ts=boundary)
 * first appears in (a) the Coinglass API (publish lag → floor for "Option 2" prompt entry)
 * and (b) our DB cg_ls_top_position (ingest lag → what live scan-decide actually sees).
 *
 * The gap between these and the boundary is the entry-availability lag that the backtest
 * (which has the bar instantly) does NOT model. Appends to /tmp/cg-lag-probe.log.
 *
 * Run (background, spans the next boundary): npx tsx src/tools/diagnostics/cg-publish-lag-probe.ts [minutes=95]
 */
import { cgGet } from '../../core/coinglass';
import { query, close as closePg } from '../../core/db';
import fs from 'node:fs';

const FOURH = 4 * 3600_000;
const PAIR = 'BTCUSDT';
const COIN = 'BTC';
const POLL_MS = 60_000;
const LOG = '/tmp/cg-lag-probe.log';
const hm = (ts: number | null) => ts ? new Date(ts).toISOString().slice(11, 16) : '?';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll() {
  const now = Date.now();
  const boundary = Math.floor(now / FOURH) * FOURH;
  const minSince = ((now - boundary) / 60_000).toFixed(1);

  let apiPosTs: number | null = null, apiFundTs: number | null = null, apiErr = '';
  try {
    const r = await cgGet<any[]>('/futures/top-long-short-position-ratio/history', { exchange: 'Binance', symbol: PAIR, interval: '4h', limit: 3 });
    const rows = r.data ?? [];
    apiPosTs = rows.length ? Math.max(...rows.map((d: any) => Number(d.time))) : null;
  } catch (e: any) { apiErr = ' POS_API_ERR'; }
  try {
    const r = await cgGet<any[]>('/futures/funding-rate/oi-weight-history', { symbol: COIN, interval: '4h', limit: 3 });
    const rows = r.data ?? [];
    apiFundTs = rows.length ? Math.max(...rows.map((d: any) => Number(d.time))) : null;
  } catch (e: any) { apiErr += ' FUND_API_ERR'; }

  let dbPosTs: number | null = null;
  try {
    const r = await query<{ m: string }>(`SELECT max(ts)::text m FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance'`, [PAIR]);
    dbPosTs = r.rows[0]?.m ? Number(r.rows[0].m) : null;
  } catch {}

  const mark = (ts: number | null) => ts === boundary ? ' ✓BAR' : '';
  const line = `${new Date(now).toISOString().slice(11, 19)} | +${minSince.padStart(5)}min after ${hm(boundary)} | ` +
    `API_pos=${hm(apiPosTs)}${mark(apiPosTs)} API_fund=${hm(apiFundTs)}${mark(apiFundTs)} | DB_pos=${hm(dbPosTs)}${mark(dbPosTs)}${apiErr}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

async function main() {
  const minutes = parseFloat(process.argv[2] ?? '95');
  fs.appendFileSync(LOG, `\n=== probe start ${new Date().toISOString()} pair=${PAIR} dur=${minutes}min ===\n`);
  const end = Date.now() + minutes * 60_000;
  while (Date.now() < end) {
    try { await poll(); } catch (e: any) { console.log('poll err: ' + (e?.message ?? e)); }
    await sleep(POLL_MS);
  }
  await closePg();
  console.log('probe done');
}
main().catch((e) => { console.error(e); process.exit(1); });

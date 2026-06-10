/**
 * maxpain-probe (v3) — single-snapshot descriptive gap-to-max-pain for the
 * nearest BTC expiries vs current spot (from our own candles). This is N=1 in
 * TIME (one snapshot of the expiry term structure), NOT a validatable panel.
 * Read-only.
 */
import { cgGet } from '../../core/coinglass';
import { query, close } from '../../core/db';

function parseDate6(s: string): Date {
  const yy = +('20' + s.slice(0, 2)), mm = +s.slice(2, 4) - 1, dd = +s.slice(4, 6);
  return new Date(Date.UTC(yy, mm, dd));
}

async function main() {
  const mp = await cgGet<any>('/option/max-pain', { symbol: 'BTC', exchange: 'Deribit' });
  const rows = mp.data as any[];

  // current spot = last BTC 1m close from OUR candles (tradable reference)
  const c = await query<any>(
    `SELECT close, ts::text FROM candles WHERE symbol='BTCUSDT' AND tf='1m' ORDER BY ts DESC LIMIT 1`);
  const spot = parseFloat(c.rows[0].close);
  const spotTs = new Date(parseInt(c.rows[0].ts)).toISOString();
  console.log(`spot (BTC 1m close ${spotTs}) = ${spot}`);
  const now = Date.now();

  console.log('\nexpiry      daysToExp  max_pain   gap%(mp-spot)/spot   netCallPutOI');
  for (const r of rows) {
    const exp = parseDate6(String(r.date));
    const days = ((exp.getTime() - now) / 86400000).toFixed(1);
    const mpp = parseFloat(r.max_pain_price);
    const gap = ((mpp - spot) / spot * 100).toFixed(2);
    const netOI = (r.call_open_interest - r.put_open_interest).toFixed(0);
    console.log(`${parseDate6(String(r.date)).toISOString().slice(0,10)}  ${String(days).padStart(8)}  ${String(mpp).padStart(7)}   ${String(gap).padStart(8)}%          ${netOI}`);
  }
  console.log('\nNOTE: this is a SINGLE timestamp. No IS/OOS split possible. A pinning');
  console.log('edge requires observing spot->max_pain convergence across many expiries');
  console.log('over time, which requires a persisted daily history we do not ingest.');

  await close();
}

main().catch(async e => { console.error('crash', e?.message ?? e); await close(); process.exit(1); });

/**
 * cg-etf-premium-inspect — pull full AUM + premium/discount + grayscale histories and
 * print head/tail, null/zero patterns, and per-ticker availability so we can design the
 * aggregate signal correctly. Read-only HTTP.
 */
import { cgGet } from '../../core/coinglass';

function iso(ms: number) { return new Date(ms).toISOString().slice(0, 10); }

async function main() {
  // ---- AUM ----
  const aum: any = await cgGet<any>('/etf/bitcoin/aum', {});
  const a = aum.data as Array<{ time: number; aum_usd: number }>;
  const nonzero = a.filter(r => r.aum_usd && r.aum_usd > 0);
  console.log('=== AUM /etf/bitcoin/aum ===');
  console.log(`rows=${a.length} first=${iso(a[0].time)} last=${iso(a[a.length-1].time)}`);
  console.log(`nonzero rows=${nonzero.length} first-nonzero=${nonzero.length ? iso(nonzero[0].time) : 'NA'} last-nonzero=${nonzero.length ? iso(nonzero[nonzero.length-1].time) : 'NA'}`);
  console.log('head5:', JSON.stringify(a.slice(0, 5)));
  console.log('tail5:', JSON.stringify(a.slice(-5)));
  // weekday/daily? print gap distribution
  const gaps: Record<number, number> = {};
  for (let i = 1; i < a.length; i++) { const d = Math.round((a[i].time - a[i-1].time)/86400000); gaps[d] = (gaps[d]||0)+1; }
  console.log('AUM day-gaps:', JSON.stringify(gaps));

  // ---- Premium / discount ----
  const pd: any = await cgGet<any>('/etf/bitcoin/premium-discount/history', {});
  const p = pd.data as Array<{ timestamp: number; list: Array<{ ticker: string; nav_usd: number; market_price_usd: number; premium_discount_details: number }> }>;
  console.log('\n=== Premium/Discount /etf/bitcoin/premium-discount/history ===');
  console.log(`rows=${p.length} first=${iso(p[0].timestamp)} last=${iso(p[p.length-1].timestamp)}`);
  // tickers across all rows + how many have premium_discount_details populated
  const tickerCount: Record<string, number> = {};
  let rowsWithAny = 0;
  for (const row of p) {
    let any = false;
    for (const e of (row.list || [])) {
      tickerCount[e.ticker] = (tickerCount[e.ticker]||0)+1;
      if (e.premium_discount_details !== null && e.premium_discount_details !== undefined) any = true;
    }
    if (any) rowsWithAny++;
  }
  console.log('ticker coverage (rows present):', JSON.stringify(tickerCount));
  console.log(`rows with >=1 premium populated: ${rowsWithAny}`);
  const gaps2: Record<number, number> = {};
  for (let i = 1; i < p.length; i++) { const d = Math.round((p[i].timestamp - p[i-1].timestamp)/86400000); gaps2[d] = (gaps2[d]||0)+1; }
  console.log('PD day-gaps:', JSON.stringify(gaps2));
  console.log('head row:', JSON.stringify(p[0]).slice(0, 400));
  console.log('tail row:', JSON.stringify(p[p.length-1]).slice(0, 600));

  // ---- Grayscale premium (recency check) ----
  const gs: any = await cgGet<any>('/grayscale/premium-history', {});
  const g = gs.data;
  const tl = g.time_list as number[];
  console.log('\n=== Grayscale /grayscale/premium-history ===');
  console.log(`time_list len=${tl.length} first=${iso(tl[0])} last=${iso(tl[tl.length-1])}`);
  console.log('premium_rate_list tail5:', JSON.stringify((g.premium_rate_list as number[]).slice(-5)));

  process.exit(0);
}
main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });

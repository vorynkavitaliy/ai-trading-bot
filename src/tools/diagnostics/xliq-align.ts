/**
 * xliq-align — confirm (a) which book symbols the aggregated endpoints accept,
 * (b) CG time vs candle ts alignment (open-labelled, ms). Read-only.
 */
import { cgGet } from '../../core/coinglass';
import { query, close } from '../../core/db';

const EX = 'Binance,OKX,Bybit';

async function symCheck(cgSym: string) {
  try {
    const r = await cgGet<any[]>('/futures/liquidation/aggregated-history', { symbol: cgSym, exchange_list: EX, interval: '4h', limit: 3 });
    const d = r.data || [];
    console.log(`  ${cgSym.padEnd(6)} liq rows=${d.length} ${d.length ? new Date(d[0].time).toISOString() : ''}`);
  } catch (e: any) {
    console.log(`  ${cgSym.padEnd(6)} ERR ${e?.message}`);
  }
}

async function main() {
  console.log('=== symbol acceptance (aggregated liq) ===');
  for (const s of ['BTC', 'SOL', 'ADA', 'LINK', 'ETH']) await symCheck(s);

  console.log('\n=== time alignment: CG bar time vs candle ts (240m, BTCUSDT) ===');
  const r = await cgGet<any[]>('/futures/liquidation/aggregated-history', { symbol: 'BTC', exchange_list: EX, interval: '4h', limit: 5 });
  const d = r.data || [];
  for (const row of d) {
    const t = row.time;
    const c = await query<any>(`SELECT ts::text, open, close FROM candles WHERE symbol='BTCUSDT' AND tf='240m' AND ts=$1`, [t]);
    const match = c.rows[0];
    console.log(`  cg.time=${t} (${new Date(t).toISOString()})  candle@ts: ${match ? `open=${match.open} close=${match.close}` : 'NO MATCH'}`);
  }
  await close();
}

main().catch(async e => { console.error('crashed', e?.message); await close(); process.exit(1); });

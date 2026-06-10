/**
 * cvd-ts-probe — inspect raw timestamps + fields of the aggregated-taker-buy-sell
 * endpoint to confirm whether `time` is the bar OPEN or CLOSE, and what the buy/sell
 * field names actually are. Used to verify the no-look-ahead assumption of the
 * btc-cvd-filter research CLI. Read-only HTTP. Writes /tmp/cvd-ts-probe.json.
 */
import { cgGet } from '../../core/coinglass';
import fs from 'node:fs';

const FOUR_H = 4 * 3600_000;

async function main() {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', {
    symbol: 'BTC', exchange_list: 'Binance,OKX,Bybit', interval: '4h', limit: 8,
  });
  const arr = ((r as any).data as any[]).slice().sort((a, b) => a.time - b.time);
  const now = Date.now();
  const out: any = {
    fetchedAt: new Date(now).toISOString(),
    nowMs: now,
    currentBarOpen: Math.floor(now / FOUR_H) * FOUR_H,
    currentBarOpenIso: new Date(Math.floor(now / FOUR_H) * FOUR_H).toISOString(),
    firstRowKeys: arr.length ? Object.keys(arr[0]) : [],
    rows: arr.map(d => ({
      time: d.time,
      timeIso: new Date(Number(d.time)).toISOString(),
      // is `time` a 4h-aligned ms epoch?
      alignedTo4h: Number(d.time) % FOUR_H === 0,
      buy: d.aggregated_buy_volume_usd,
      sell: d.aggregated_sell_volume_usd,
    })),
  };
  // Distance of the LAST (newest) bar's time from now, in minutes — tells us if the
  // newest `time` is the just-OPENED current bar (time ≈ now, < 240min ago) or the
  // last CLOSED bar (time ≈ now - up to 240min, i.e. one bar back).
  const last = arr[arr.length - 1];
  out.newestTimeMinAgo = ((now - Number(last.time)) / 60_000).toFixed(1);
  out.newestTimeIso = new Date(Number(last.time)).toISOString();
  // If newest time == currentBarOpen → `time` is the OPEN of the in-progress bar
  // (data still accumulating → look-ahead risk if read as "closed"). If newest time
  // == currentBarOpen - 4h → `time` is the OPEN of the last CLOSED bar.
  out.newestEqualsCurrentOpen = Number(last.time) === Math.floor(now / FOUR_H) * FOUR_H;
  out.newestEqualsPrevOpen = Number(last.time) === Math.floor(now / FOUR_H) * FOUR_H - FOUR_H;
  fs.writeFileSync('/tmp/cvd-ts-probe.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e?.message ?? String(e)); process.exit(1); });

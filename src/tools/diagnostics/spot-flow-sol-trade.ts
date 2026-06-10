/**
 * spot-flow-sol-trade — practical directional check on SOL spot_taker_imb (h=6, 24h).
 * Each bar: if signal in top tertile -> LONG, bottom tertile -> SHORT, else flat.
 * Forward 24h close-to-close return is the realized return (sign-adjusted by side).
 * Reports per-half: n trades, hit-rate, mean ret/trade, sum return, and the
 * long-only vs short-only decomposition (to expose one-sided edges).
 *
 * Also runs FADE polarity (invert) for completeness. Read-only.
 * Run: npx tsx src/tools/diagnostics/spot-flow-sol-trade.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const COINS = ['SOL', 'BTC'];
const H = 6;
const ROLL = 180;

function rollingZ(xs: number[]): number[] { const out = new Array(xs.length).fill(NaN); for (let i = 0; i < xs.length; i++) { const win = xs.slice(Math.max(0, i - ROLL + 1), i + 1); if (win.length < 20) continue; let m = 0; for (const v of win) m += v; m /= win.length; let s = 0; for (const v of win) s += (v - m) * (v - m); s = Math.sqrt(s / win.length); out[i] = s === 0 ? 0 : (xs[i] - m) / s; } return out; }
async function fetchSpot(coin: string) { const r = await cgGet<any>('/spot/aggregated-cvd/history', { exchange_list: 'Binance', symbol: coin, interval: '4h', limit: 3000 }); return (r.data ?? []).map((d: any) => ({ time: d.time, buy: d.agg_taker_buy_vol, sell: d.agg_taker_sell_vol })); }
async function closes(pair: string): Promise<Map<number, number>> { const r = await query<any>(`SELECT ts, close::float c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]); const m = new Map<number, number>(); for (const x of r.rows) m.set(Number(x.ts), x.c as number); return m; }

// rolling-tertile thresholds: classify bar by where its signal sits within trailing ROLL window
function tertileSide(sig: number[]): number[] {
  const side = new Array(sig.length).fill(0);
  for (let i = 0; i < sig.length; i++) {
    const win = sig.slice(Math.max(0, i - ROLL + 1), i + 1).filter(Number.isFinite);
    if (win.length < 30) continue;
    const sorted = [...win].sort((a, b) => a - b);
    const loT = sorted[Math.floor(sorted.length / 3)];
    const hiT = sorted[Math.floor((2 * sorted.length) / 3)];
    if (sig[i] >= hiT) side[i] = 1; else if (sig[i] <= loT) side[i] = -1; else side[i] = 0;
  }
  return side;
}

function stats(side: number[], fwd: number[], lo: number, hi: number, polarity: number) {
  let n = 0, wins = 0, sum = 0, longSum = 0, shortSum = 0, nLong = 0, nShort = 0;
  for (let i = lo; i < hi; i++) {
    if (!Number.isFinite(fwd[i]) || side[i] === 0) continue;
    const s = side[i] * polarity;
    const ret = s * fwd[i];
    n++; sum += ret; if (ret > 0) wins++;
    if (s > 0) { longSum += ret; nLong++; } else { shortSum += ret; nShort++; }
  }
  return { n, hit: n ? wins / n : NaN, mean: n ? sum / n : NaN, sum, longMean: nLong ? longSum / nLong : NaN, shortMean: nShort ? shortSum / nShort : NaN, nLong, nShort };
}

async function main() {
  console.log(`=== spot-flow-sol-trade  (h=${H} bars=24h, rolling-tertile) ===`);
  console.log('Side=+1 (FOLLOW: top tertile spot-buy -> LONG; bottom -> SHORT). Returns are non-overlap-naive, full bar set.\n');
  for (const coin of COINS) {
    const pair = coin + 'USDT';
    const [spot, cl] = await Promise.all([fetchSpot(coin), closes(pair)]);
    const rows = spot.filter((s: any) => cl.has(s.time));
    const times = rows.map((r: any) => r.time);
    const closeArr = times.map((t: number) => cl.get(t)!);
    const n = times.length; const mid = Math.floor(n / 2);
    const imb = rows.map((r: any) => { const d = r.buy + r.sell; return d === 0 ? 0 : (r.buy - r.sell) / d; });
    const side = tertileSide(imb);
    const fwd: number[] = new Array(n).fill(NaN); for (let i = 0; i + H < n; i++) fwd[i] = closeArr[i + H] / closeArr[i] - 1;

    for (const pol of [1, -1]) {
      const sIS = stats(side, fwd, 0, mid, pol);
      const sOOS = stats(side, fwd, mid, n, pol);
      const dir = pol === 1 ? 'FOLLOW' : 'FADE  ';
      console.log(`${coin} ${dir}`);
      console.log(`  IS : n=${sIS.n} hit=${(sIS.hit*100).toFixed(1)}% mean=${(sIS.mean*100).toFixed(3)}% sum=${(sIS.sum*100).toFixed(1)}%  | longMean=${(sIS.longMean*100).toFixed(3)}% (n${sIS.nLong}) shortMean=${(sIS.shortMean*100).toFixed(3)}% (n${sIS.nShort})`);
      console.log(`  OOS: n=${sOOS.n} hit=${(sOOS.hit*100).toFixed(1)}% mean=${(sOOS.mean*100).toFixed(3)}% sum=${(sOOS.sum*100).toFixed(1)}%  | longMean=${(sOOS.longMean*100).toFixed(3)}% (n${sOOS.nLong}) shortMean=${(sOOS.shortMean*100).toFixed(3)}% (n${sOOS.nShort})`);
    }
    console.log('');
  }
  process.exit(0);
}
main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });

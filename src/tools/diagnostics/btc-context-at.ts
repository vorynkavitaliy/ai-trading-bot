// Diagnostic: print BTC 1H ADX/EMA-stack/regime at given timestamps to
// classify the regime at the moment of recent losing trades.
import { query, close as closePg } from '../../core/db';
import { ADX, EMA } from 'technicalindicators';
import { log } from '../../core/logger';

type Stack = 'bull' | 'bear' | 'mixed';
type Regime = 'range' | 'transition' | 'trend_bull' | 'trend_bear' | 'trend_other';

function classify(adx: number, stack: Stack): Regime {
  if (adx < 20) return 'range';
  if (adx < 25) return 'transition';
  if (stack === 'bull') return 'trend_bull';
  if (stack === 'bear') return 'trend_bear';
  return 'trend_other';
}

async function main() {
  const isoArgs = process.argv.slice(2);
  if (isoArgs.length === 0) {
    console.error('usage: npx tsx src/tools/diagnostics/btc-context-at.ts <iso1> [iso2 ...]');
    process.exit(1);
  }
  const targetMs = isoArgs.map((s) => Date.parse(s));
  const minTs = Math.min(...targetMs) - 350 * 3600_000; // 350h warmup
  const maxTs = Math.max(...targetMs) + 3600_000;

  const r = await query<any>(
    `SELECT ts, open::text, high::text, low::text, close::text
     FROM candles
     WHERE symbol = 'BTCUSDT' AND tf = '60m'
       AND ts >= $1 AND ts <= $2
     ORDER BY ts ASC`,
    [minTs, maxTs]
  );
  const bars = r.rows.map((b: any) => ({
    ts: Number(b.ts),
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
  }));
  if (bars.length < 250) {
    console.error(`only ${bars.length} BTC 1H bars in range — need 250+`);
    process.exit(1);
  }
  const highs = bars.map((b: any) => b.high);
  const lows = bars.map((b: any) => b.low);
  const closes = bars.map((b: any) => b.close);
  const adx14: any[] = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
  const ema8 = EMA.calculate({ period: 8, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });
  const ema55 = EMA.calculate({ period: 55, values: closes });
  const ema200 = EMA.calculate({ period: 200, values: closes });
  const e8 = new Array(closes.length - ema8.length).fill(NaN).concat(ema8);
  const e21 = new Array(closes.length - ema21.length).fill(NaN).concat(ema21);
  const e55 = new Array(closes.length - ema55.length).fill(NaN).concat(ema55);
  const e200 = new Array(closes.length - ema200.length).fill(NaN).concat(ema200);
  const adxArr = new Array(closes.length - adx14.length).fill(NaN).concat(adx14.map((x) => x.adx));
  // RSI
  const rsi14 = (function () {
    const period = 14;
    let g = 0, l = 0;
    const out: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      const up = ch > 0 ? ch : 0;
      const dn = ch < 0 ? -ch : 0;
      if (i <= period) {
        g += up;
        l += dn;
        if (i === period) {
          g /= period;
          l /= period;
          out.push(100 - 100 / (1 + g / Math.max(l, 1e-12)));
        } else out.push(NaN);
      } else {
        g = (g * (period - 1) + up) / period;
        l = (l * (period - 1) + dn) / period;
        out.push(100 - 100 / (1 + g / Math.max(l, 1e-12)));
      }
    }
    return [NaN, ...out];
  })();

  for (const tMs of targetMs) {
    // find bar with ts <= tMs (latest)
    let idx = -1;
    for (let i = bars.length - 1; i >= 0; i--) if (bars[i].ts <= tMs) { idx = i; break; }
    if (idx < 0) { console.log(`${new Date(tMs).toISOString()} — no bar`); continue; }
    const a = adxArr[idx];
    let stack: Stack = 'mixed';
    const v8 = e8[idx], v21 = e21[idx], v55 = e55[idx], v200 = e200[idx];
    if (v8 > v21 && v21 > v55 && v55 > v200) stack = 'bull';
    else if (v8 < v21 && v21 < v55 && v55 < v200) stack = 'bear';
    const reg = classify(a, stack);
    const c = closes[idx];
    const c1h = closes[idx - 1];
    const c4h = closes[idx - 4];
    const c24h = closes[idx - 24];
    console.log(
      `${new Date(bars[idx].ts).toISOString()}  close=${c.toFixed(0)}  ` +
      `adx=${a?.toFixed(1)}  stack=${stack}  regime=${reg}  ` +
      `rsi=${rsi14[idx]?.toFixed(1)}  1h%=${(((c - c1h) / c1h) * 100).toFixed(2)}  ` +
      `4h%=${(((c - c4h) / c4h) * 100).toFixed(2)}  24h%=${(((c - c24h) / c24h) * 100).toFixed(2)}`
    );
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('btc-context-at failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});

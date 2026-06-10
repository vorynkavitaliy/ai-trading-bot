/**
 * cg-vesting-clean-events — for each candle symbol with a vesting chart, count how many
 * CLEAN, sizeable, in-window unlock events we can actually build an event study on.
 *
 * "clean" = positive monthly delta in cumulative unlocked tokens, >= MIN_PCT of supply,
 * date inside the symbol's own price-candle window, and the cumulative series is treated
 * monotonically (we clamp: cumulative = running max so spurious decreases don't create
 * fake negative deltas; a real unlock only ever ADDS supply).
 *
 * Crucially also reports: is the chart monotonic at all? (sanity on data quality)
 * Builds the final event set used by the study and writes it to /tmp/unlock-events-clean.json.
 */
import { cgGet } from '../../core/coinglass';
import { query, close } from '../../core/db';

const T = 20_000;
const MIN_PCT_SUPPLY = 0.5; // event must release >= 0.5% of total supply to be a "shock"
function withTimeout<T2>(p: Promise<T2>, ms: number, label: string): Promise<T2> {
  return Promise.race([p, new Promise<T2>((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${label})`)), ms))]);
}

interface CandleWin { symbol: string; firstTs: number; lastTs: number; }

async function priceWindows(): Promise<Map<string, CandleWin>> {
  const r = await query<{ symbol: string; first_ts: string; last_ts: string }>(
    `SELECT symbol, min(ts)::text AS first_ts, max(ts)::text AS last_ts
     FROM candles WHERE tf = '1D' GROUP BY symbol`
  );
  const m = new Map<string, CandleWin>();
  for (const row of r.rows) m.set(row.symbol, { symbol: row.symbol, firstTs: +row.first_ts, lastTs: +row.last_ts });
  return m;
}

async function main() {
  const wins = await priceWindows();
  const symbols = [...wins.keys()].sort();
  const events: any[] = [];
  console.log(`MIN_PCT_SUPPLY=${MIN_PCT_SUPPLY}%\n`);
  console.log('symbol\tchartPts\tmonotonic?\tallPosDeltas\tbigClean\tinWindowBig');
  for (const sym of symbols) {
    const coin = sym.replace(/USDT$/, '');
    let chart: any[] = []; let totalSupply = 0;
    try {
      const rr = await withTimeout(cgGet<any>('/coin/vesting', { symbol: coin }), T, coin);
      const d = (rr as any).data;
      if (Array.isArray(d?.chart)) { chart = d.chart; totalSupply = d.total_supply ?? 0; }
    } catch { /* empty */ }
    await new Promise(r => setTimeout(r, 320));
    if (!chart.length) { console.log(`${sym}\t0\t-\t-\t-\t-`); continue; }

    const sorted = [...chart].sort((a, b) => a.date - b.date);
    // monotonic check on raw top-level cumulative
    let monotonic = true;
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i].unlocked_token_amount ?? 0) < (sorted[i - 1].unlocked_token_amount ?? 0) - 1) { monotonic = false; break; }
    }
    // running-max clamp to get only true releases
    let runMax = 0; let allPos = 0; let bigClean = 0; let inWinBig = 0;
    const win = wins.get(sym)!;
    for (const pt of sorted) {
      const raw = pt.unlocked_token_amount ?? 0;
      const clamped = Math.max(runMax, raw);
      const delta = clamped - runMax;
      runMax = clamped;
      if (delta <= 0) continue;
      allPos++;
      const pct = totalSupply > 0 ? (delta / totalSupply) * 100 : 0;
      if (pct >= MIN_PCT_SUPPLY) {
        bigClean++;
        if (pt.date >= win.firstTs && pt.date <= win.lastTs) {
          inWinBig++;
          events.push({ symbol: sym, date: pt.date, dateStr: new Date(pt.date).toISOString().slice(0,10), deltaTokens: delta, pctOfSupply: pct });
        }
      }
    }
    console.log(`${sym}\t${sorted.length}\t${monotonic}\t${allPos}\t${bigClean}\t${inWinBig}`);
  }

  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/unlock-events-clean.json', JSON.stringify(events, null, 0));
  console.log(`\nTOTAL clean in-window big events: ${events.length}`);
  console.log(events.map(e => `${e.symbol} ${e.dateStr} ${e.pctOfSupply.toFixed(2)}%`).join('  |  '));
  await close();
}
main().catch(e => { console.error(e); process.exit(1); });

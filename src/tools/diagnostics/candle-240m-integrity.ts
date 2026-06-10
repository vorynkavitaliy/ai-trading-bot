/**
 * candle-240m-integrity — verify DB 240m candles against (a) fresh Bybit linear klines
 * (production public API) and (b) aggregation of DB 15m bars into 4H buckets.
 * Recomputes ATR(14)/EMA8/EMA21/SMA20(BB mid)/EMA20/EMA50 on DB vs exchange series.
 * Run: npx tsx src/tools/diagnostics/candle-240m-integrity.ts BTCUSDT SOLUSDT 14
 */
import { query, close as closePg } from '../../core/db';
import { fetchKlines } from '../../data/bybit-public';

interface Bar { ts: number; o: number; h: number; l: number; c: number }

function atr14(bars: Bar[]): number[] {
  const out: number[] = [];
  let atr = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const pc = i > 0 ? bars[i - 1].c : b.o;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    if (i < 14) { atr = (atr * i + tr) / (i + 1); } else { atr = (atr * 13 + tr) / 14; }
    out.push(atr);
  }
  return out;
}

function ema(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let e = closes[0];
  for (let i = 0; i < closes.length; i++) {
    e = i === 0 ? closes[0] : closes[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function sma(closes: number[], period: number): number[] {
  return closes.map((_, i) => {
    const s = closes.slice(Math.max(0, i - period + 1), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
}

async function loadDb(symbol: string, tf: string, fromMs: number): Promise<Bar[]> {
  const { rows } = await query<any>(
    `SELECT ts, open::float8 o, high::float8 h, low::float8 l, close::float8 c
     FROM candles WHERE symbol=$1 AND tf=$2 AND ts >= $3 ORDER BY ts ASC`,
    [symbol, tf, fromMs]);
  return rows.map((r: any) => ({ ts: Number(r.ts), o: r.o, h: r.h, l: r.l, c: r.c }));
}

function agg4h(bars15: Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const b of bars15) {
    const bucket = Math.floor(b.ts / 14_400_000) * 14_400_000;
    const cur = map.get(bucket);
    if (!cur) map.set(bucket, { ts: bucket, o: b.o, h: b.h, l: b.l, c: b.c });
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

function fmtTs(ts: number): string { return new Date(ts).toISOString().slice(5, 16).replace('T', ' '); }

async function main() {
  const args = process.argv.slice(2);
  const days = Number(args[args.length - 1]) > 0 ? Number(args[args.length - 1]) : 14;
  const symbols = args.filter(a => !(Number(a) > 0));
  if (symbols.length === 0) symbols.push('BTCUSDT');
  const fromMs = Date.now() - days * 86_400_000;

  for (const symbol of symbols) {
    const db = await loadDb(symbol, '240m', fromMs);
    const db15 = await loadDb(symbol, '15m', fromMs);
    const ex = (await fetchKlines(symbol, '240m', fromMs, Date.now()))
      .map(k => ({ ts: k.startTime, o: k.open, h: k.high, l: k.low, c: k.close }));
    const agg = agg4h(db15);
    const exByTs = new Map(ex.map(b => [b.ts, b]));
    const aggByTs = new Map(agg.map(b => [b.ts, b]));

    const px = ex[ex.length - 1].c;
    const d = px >= 1000 ? 1 : px >= 100 ? 2 : px >= 1 ? 3 : 5;
    const f = (x: number | undefined) => x === undefined ? '      n/a' : x.toFixed(d).padStart(9);

    let bad = 0, checked = 0;
    let sumRangeDb = 0, sumRangeEx = 0;
    console.log(`\n=== ${symbol} 240m DB vs EXCHANGE (linear, prod) vs DB-15m-agg — last ${days}d, ${db.length} db bars / ${ex.length} ex bars ===`);
    console.log('  time         | db.H      db.L      db.C    | ex.H      ex.L      ex.C    | aggH      aggL      aggC    | H err%  L err%  C err%');
    for (const b of db) {
      const e = exByTs.get(b.ts);
      const a = aggByTs.get(b.ts);
      if (!e) continue;
      checked++;
      const isOpen = b.ts + 14_400_000 > Date.now();
      const hErr = (b.h - e.h) / e.h * 100, lErr = (b.l - e.l) / e.l * 100, cErr = (b.c - e.c) / e.c * 100;
      const mismatch = Math.abs(hErr) > 0.02 || Math.abs(lErr) > 0.02 || Math.abs(cErr) > 0.02;
      if (mismatch && !isOpen) bad++;
      if (!isOpen) { sumRangeDb += b.h - b.l; sumRangeEx += e.h - e.l; }
      console.log(`  ${fmtTs(b.ts)}${isOpen ? '*' : ' '}| ${f(b.h)} ${f(b.l)} ${f(b.c)} | ${f(e.h)} ${f(e.l)} ${f(e.c)} | ${f(a?.h)} ${f(a?.l)} ${f(a?.c)} | ${hErr.toFixed(2).padStart(6)} ${lErr.toFixed(2).padStart(7)} ${cErr.toFixed(2).padStart(7)}${mismatch ? '  <-- MISMATCH' : ''}`);
    }
    console.log(`  (* = bar still open)  closed bars checked=${checked - 1} mismatched=${bad}  avg(H-L) db=${(sumRangeDb / Math.max(1, checked - 1)).toFixed(d)} ex=${(sumRangeEx / Math.max(1, checked - 1)).toFixed(d)}  range capture=${(sumRangeDb / sumRangeEx * 100).toFixed(1)}%`);

    for (const [name, series] of [['DB-240m', db], ['EXCHANGE-240m', ex]] as const) {
      const closes = series.map(b => b.c);
      const A = atr14(series), e8 = ema(closes, 8), e21 = ema(closes, 21), e20 = ema(closes, 20), e50 = ema(closes, 50), bb = sma(closes, 20);
      console.log(`  [${name}] indicators at last 4 bars:`);
      for (let i = Math.max(0, series.length - 4); i < series.length; i++) {
        const isOpen = series[i].ts + 14_400_000 > Date.now();
        console.log(`    ${fmtTs(series[i].ts)}${isOpen ? '*' : ' '} close=${f(closes[i])} ATR14=${f(A[i])} EMA8=${f(e8[i])} EMA21=${f(e21[i])} BBmid20=${f(bb[i])} EMA20=${f(e20[i])} EMA50=${f(e50[i])} trend20v50=${e20[i] > e50[i] ? 'UP' : 'DOWN'}`);
      }
    }
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

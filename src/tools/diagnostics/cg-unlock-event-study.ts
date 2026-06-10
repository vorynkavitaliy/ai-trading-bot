/**
 * cg-unlock-event-study — final attempt. Build the widest possible unlock-event set
 * from /coin/vesting across ALL 4h-candle symbols, running-max-clamped positive monthly
 * deltas >= MIN_PCT of supply, in each symbol's 4h price window. Then run an abnormal-
 * return event study (token return minus BTC return) over windows -5d..+5d and report
 * pre/post mean abnormal return + hit-rate, split IS/OOS by event date midpoint.
 *
 * If event count is too small to split, report data-insufficient honestly.
 */
import { cgGet } from '../../core/coinglass';
import { query, close } from '../../core/db';
import { loadBars } from '../../data/candles';

const T = 20_000;
const MIN_PCT_SUPPLY = 0.3; // lower bar to maximize event count
const DAY = 86_400_000;
function withTimeout<T2>(p: Promise<T2>, ms: number, label: string): Promise<T2> {
  return Promise.race([p, new Promise<T2>((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${label})`)), ms))]);
}

interface Ev { symbol: string; date: number; dateStr: string; pctOfSupply: number; }

// Daily close from 4h bars: take last 4h close on/before end-of-day.
function dailyCloseFromBars(bars: { ts: number; close: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bars) {
    const day = new Date(b.ts).toISOString().slice(0, 10);
    m.set(day, b.close); // later bar overwrites -> last close of day
  }
  return m;
}

function closeAtOrBefore(daily: Map<string, number>, ts: number): number | null {
  for (let d = 0; d <= 6; d++) {
    const key = new Date(ts - d * DAY).toISOString().slice(0, 10);
    const v = daily.get(key);
    if (v != null) return v;
  }
  return null;
}

async function main() {
  const symRows = await query<{ symbol: string; first_ts: string; last_ts: string }>(
    `SELECT symbol, min(ts)::text AS first_ts, max(ts)::text AS last_ts
     FROM candles WHERE tf = '240m' GROUP BY symbol`
  );
  const wins = new Map<string, { f: number; l: number }>();
  for (const r of symRows.rows) wins.set(r.symbol, { f: +r.first_ts, l: +r.last_ts });

  // Build events
  const events: Ev[] = [];
  for (const [sym, w] of wins) {
    const coin = sym.replace(/USDT$/, '');
    let chart: any[] = []; let totalSupply = 0;
    try {
      const rr = await withTimeout(cgGet<any>('/coin/vesting', { symbol: coin }), T, coin);
      const d = (rr as any).data;
      if (Array.isArray(d?.chart)) { chart = d.chart; totalSupply = d.total_supply ?? 0; }
    } catch { /* */ }
    await new Promise(r => setTimeout(r, 300));
    if (!chart.length || totalSupply <= 0) continue;
    const sorted = [...chart].sort((a, b) => a.date - b.date);
    let runMax = 0;
    for (const pt of sorted) {
      const raw = pt.unlocked_token_amount ?? 0;
      const clamped = Math.max(runMax, raw);
      const delta = clamped - runMax;
      runMax = clamped;
      if (delta <= 0) continue;
      const pct = (delta / totalSupply) * 100;
      if (pct < MIN_PCT_SUPPLY) continue;
      // need +5d of price after the event and -5d before, inside window
      if (pt.date < w.f + 6 * DAY || pt.date > w.l - 6 * DAY) continue;
      events.push({ symbol: sym, date: pt.date, dateStr: new Date(pt.date).toISOString().slice(0, 10), pctOfSupply: pct });
    }
  }
  events.sort((a, b) => a.date - b.date);
  console.log(`built ${events.length} candidate in-window unlock events (>=${MIN_PCT_SUPPLY}% supply, 4h universe)`);
  console.log(events.map(e => `${e.symbol} ${e.dateStr} ${e.pctOfSupply.toFixed(2)}%`).join('  |  '));

  if (events.length < 6) {
    console.log(`\nVERDICT: data-insufficient — only ${events.length} clean in-window events; cannot run an event study (let alone IS/OOS split).`);
    await close();
    return;
  }

  // Preload BTC daily + each symbol daily-from-4h
  const symList = [...new Set(events.map(e => e.symbol))];
  const dailyMap = new Map<string, Map<string, number>>();
  const btcBars = (await loadBars('BTCUSDT', '240m', { limit: 20000 })).map(b => ({ ts: b.ts, close: b.close }));
  const btcDaily = dailyCloseFromBars(btcBars);
  for (const s of symList) {
    const bars = (await loadBars(s, '240m', { limit: 20000 })).map(b => ({ ts: b.ts, close: b.close }));
    dailyMap.set(s, dailyCloseFromBars(bars));
  }

  // For each event compute abnormal returns: token ret minus BTC ret over the same span.
  // Pre-window: t-5 -> t0 ; Post-window: t0 -> t+5.
  interface Row { ev: Ev; preAbn: number | null; postAbn: number | null; }
  const rows: Row[] = [];
  function ret(daily: Map<string, number>, t0: number, t1: number): number | null {
    const c0 = closeAtOrBefore(daily, t0); const c1 = closeAtOrBefore(daily, t1);
    if (c0 == null || c1 == null || c0 <= 0) return null;
    return (c1 - c0) / c0;
  }
  for (const ev of events) {
    const d = dailyMap.get(ev.symbol)!;
    const tokPre = ret(d, ev.date - 5 * DAY, ev.date);
    const btcPre = ret(btcDaily, ev.date - 5 * DAY, ev.date);
    const tokPost = ret(d, ev.date, ev.date + 5 * DAY);
    const btcPost = ret(btcDaily, ev.date, ev.date + 5 * DAY);
    rows.push({
      ev,
      preAbn: tokPre != null && btcPre != null ? tokPre - btcPre : null,
      postAbn: tokPost != null && btcPost != null ? tokPost - btcPost : null,
    });
  }

  function stats(vals: number[]): string {
    if (!vals.length) return 'n=0';
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    const hit = vals.filter(x => x < 0).length / vals.length; // underperform = negative abnormal
    return `n=${vals.length} meanAbn=${(mean * 100).toFixed(2)}% hitNeg=${(hit * 100).toFixed(0)}%`;
  }

  const mid = events[Math.floor(events.length / 2)].date;
  const isRows = rows.filter(r => r.ev.date < mid);
  const oosRows = rows.filter(r => r.ev.date >= mid);

  console.log('\n=== ABNORMAL RETURN (token minus BTC), underperform = negative ===');
  console.log(`ALL  pre : ${stats(rows.map(r => r.preAbn).filter((x): x is number => x != null))}`);
  console.log(`ALL  post: ${stats(rows.map(r => r.postAbn).filter((x): x is number => x != null))}`);
  console.log(`IS   pre : ${stats(isRows.map(r => r.preAbn).filter((x): x is number => x != null))}`);
  console.log(`IS   post: ${stats(isRows.map(r => r.postAbn).filter((x): x is number => x != null))}`);
  console.log(`OOS  pre : ${stats(oosRows.map(r => r.preAbn).filter((x): x is number => x != null))}`);
  console.log(`OOS  post: ${stats(oosRows.map(r => r.postAbn).filter((x): x is number => x != null))}`);

  console.log('\nper-event:');
  for (const r of rows) {
    console.log(`${r.ev.symbol} ${r.ev.dateStr} ${r.ev.pctOfSupply.toFixed(2)}%  preAbn=${r.preAbn != null ? (r.preAbn*100).toFixed(2)+'%' : 'na'}  postAbn=${r.postAbn != null ? (r.postAbn*100).toFixed(2)+'%' : 'na'}`);
  }

  await close();
}
main().catch(e => { console.error(e); process.exit(1); });

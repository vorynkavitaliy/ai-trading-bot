/**
 * cg-unlock-events-extract — pull /coin/vesting for each symbol we have price candles
 * for, and extract discrete unlock EVENTS from the vesting `chart` time-series.
 *
 * The chart is an array of { date, allocations:[{name, unlocked_token_amount, ...}],
 * unlocked_token_amount (total) }. We diff consecutive chart points to get the
 * incremental tokens unlocked at each date. Size of event = delta tokens * price_at_date
 * (we use circulating-relative metrics where possible). Output a flat event list
 * { symbol, date, deltaTokens, pctOfSupply, pctOfCirc } for the event study.
 *
 * Read-only. Prints JSON event list + per-symbol summary so we can eyeball coverage.
 */
import { cgGet } from '../../core/coinglass';
import { query, close } from '../../core/db';

const T = 20_000;
function withTimeout<T2>(p: Promise<T2>, ms: number, label: string): Promise<T2> {
  return Promise.race([p, new Promise<T2>((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${label})`)), ms))]);
}

interface ChartPoint {
  date: number;
  unlocked_token_amount?: number;
  unlocked_percent?: number;
  allocations?: { name: string; unlocked_token_amount?: number; token_amount?: number }[];
  is_tge?: boolean;
}

interface UnlockEvent {
  symbol: string;
  date: number; // ms
  dateStr: string;
  deltaTokens: number;
  cumUnlocked: number;
  totalSupply: number;
  circulating: number;
  pctOfSupply: number;   // delta / total_supply
  pctOfCirc: number;     // delta / circulating (current circ as proxy)
  isTge: boolean;
}

// Map our candle symbols (XXXUSDT) to CG coin symbols.
function coinOf(sym: string): string {
  return sym.replace(/USDT$/, '');
}

async function vestingFor(coin: string): Promise<{ chart: ChartPoint[]; totalSupply: number; circ: number } | null> {
  try {
    const r = await withTimeout(cgGet<any>('/coin/vesting', { symbol: coin }), T, coin);
    const d = (r as any).data;
    if (!d || !Array.isArray(d.chart)) return null;
    return { chart: d.chart, totalSupply: d.total_supply ?? 0, circ: d.circulating_supply ?? 0 };
  } catch (e: any) {
    console.log(`  vesting FAIL ${coin}: ${(e?.message ?? String(e)).slice(0, 120)}`);
    return null;
  }
}

async function main() {
  // symbols we have daily candles for (event-study horizon is daily/3d/7d)
  const symRows = await query<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM candles WHERE tf = '1D' ORDER BY symbol`
  );
  const symbols = symRows.rows.map(r => r.symbol);
  console.log(`candle symbols (1D): ${symbols.join(', ')}\n`);

  const allEvents: UnlockEvent[] = [];
  const summary: { symbol: string; events: number; firstEvt: string; lastEvt: string; chartPts: number }[] = [];

  for (const sym of symbols) {
    const coin = coinOf(sym);
    const v = await vestingFor(coin);
    await new Promise(r => setTimeout(r, 350));
    if (!v) { summary.push({ symbol: sym, events: 0, firstEvt: '-', lastEvt: '-', chartPts: 0 }); continue; }
    const chart = [...v.chart].sort((a, b) => a.date - b.date);
    let prevCum = 0;
    let first = true;
    const evs: UnlockEvent[] = [];
    for (const pt of chart) {
      const cum = pt.unlocked_token_amount ?? 0;
      const delta = first ? cum : cum - prevCum;
      first = false;
      prevCum = cum;
      if (delta <= 0) continue;
      const ev: UnlockEvent = {
        symbol: sym,
        date: pt.date,
        dateStr: new Date(pt.date).toISOString().slice(0, 10),
        deltaTokens: delta,
        cumUnlocked: cum,
        totalSupply: v.totalSupply,
        circulating: v.circ,
        pctOfSupply: v.totalSupply > 0 ? (delta / v.totalSupply) * 100 : 0,
        pctOfCirc: v.circ > 0 ? (delta / v.circ) * 100 : 0,
        isTge: !!pt.is_tge,
      };
      evs.push(ev);
    }
    allEvents.push(...evs);
    summary.push({
      symbol: sym,
      events: evs.length,
      firstEvt: evs[0]?.dateStr ?? '-',
      lastEvt: evs[evs.length - 1]?.dateStr ?? '-',
      chartPts: chart.length,
    });
  }

  console.log('=== per-symbol summary ===');
  console.log('symbol\tevents\tchartPts\tfirstEvt\tlastEvt');
  for (const s of summary) console.log(`${s.symbol}\t${s.events}\t${s.chartPts}\t${s.firstEvt}\t${s.lastEvt}`);

  // Write events to /tmp for the event-study tool.
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/unlock-events.json', JSON.stringify(allEvents, null, 0));
  console.log(`\nwrote ${allEvents.length} events to /tmp/unlock-events.json`);

  // quick distribution of pctOfCirc
  const sizes = allEvents.map(e => e.pctOfCirc).filter(x => x > 0).sort((a, b) => a - b);
  if (sizes.length) {
    const q = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))];
    console.log(`\npctOfCirc distribution (all events): n=${sizes.length} p10=${q(0.1).toFixed(3)} p50=${q(0.5).toFixed(3)} p75=${q(0.75).toFixed(3)} p90=${q(0.9).toFixed(3)} max=${sizes[sizes.length-1].toFixed(3)}`);
  }

  await close();
}
main().catch(e => { console.error(e); process.exit(1); });

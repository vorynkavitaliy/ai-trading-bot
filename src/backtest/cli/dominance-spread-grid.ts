/**
 * dominance-spread-grid — robustness GRID for the BTC-dominance-LEVEL relative-value
 * spread. Reuses the EXACT backtest mechanics of dominance-spread.ts (same data
 * sources, same cost model, same neutrality sizing) but sweeps:
 *
 *   basket:    broad-10 | book-only (SOL,ADA,LINK) | majors (ETH,SOL)
 *   domWindow: 90 | 180
 *   band:      75/25 | 80/20 | 85/15
 *   hold:      6 | 9 | 12
 *   neutrality: dollar | beta
 *
 * For each cell it reports net ret% + MaxDD% + worst-day% on BOTH halves (older/recent),
 * derived from a SINGLE continuous run sliced at the IS/OOS midpoint of the per-cell
 * usable window (each basket has its own usable window — see data note below).
 *
 * Verdict bookkeeping: a cell is "positive both halves" if older AND recent net ret > 0
 * and neither half blew the account. We count positive-both vs flipped to judge whether
 * the edge is a stable plateau or knife-edge.
 *
 * DATA NOTE (observed, not assumed): in the project `candles` table the broad alts
 * (BNB/LINK/LTC/ATOM/INJ/ARB) only have hourly history back to ~2025-04-29 and ADA to
 * ~2025-06-03. Any basket containing one of those is intersection-truncated to a
 * ~10-13 month window (small sample). ETH/SOL/XRP go back to 2021. The grid reports the
 * actual usable window per basket so sample size is explicit in the verdict.
 *
 * Read-only. No live-path files touched. Same costs as base CLI:
 *   taker 0.055%/fill + slip 0.25%/fill on EVERY leg (entry+exit) + funding over hold.
 *
 * Usage: npx tsx src/backtest/cli/dominance-spread-grid.ts
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { query, close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

// ---------------- fixed config (matches base CLI) ----------------
const BETA_WINDOW = 90;
const TAKER = BACKTEST_COMMON.takerFeeRate;       // 0.00055
const SLIP = BACKTEST_COMMON.slippagePct / 100;   // 0.0025
const START_EQUITY = 200_000;
const GROSS_PER_SIDE_FRAC = 0.5;                  // 0.5x equity/side (1.0x gross), fixed notional
const FUNDING_FALLBACK_PER_DAY = 0.0001;          // 0.01%/day conservative cost fallback
const DAY_MS = 86_400_000;
const BTC = 'BTCUSDT';

// ---------------- grid axes ----------------
interface Basket { name: string; symbols: string[]; }
const BASKETS: Basket[] = [
  { name: 'broad-10', symbols: ['SOLUSDT','ETHUSDT','XRPUSDT','BNBUSDT','ADAUSDT','LINKUSDT','LTCUSDT','ATOMUSDT','INJUSDT','ARBUSDT'] },
  { name: 'book-only', symbols: ['SOLUSDT','ADAUSDT','LINKUSDT'] },
  { name: 'majors',    symbols: ['ETHUSDT','SOLUSDT'] },
];
const DOM_WINDOWS = [90, 180];
const BANDS: { hi: number; lo: number; label: string }[] = [
  { hi: 0.75, lo: 0.25, label: '75/25' },
  { hi: 0.80, lo: 0.20, label: '80/20' },
  { hi: 0.85, lo: 0.15, label: '85/15' },
];
const HOLDS = [6, 9, 12];
const MODES = ['dollar', 'beta'] as const;
type Mode = typeof MODES[number];

// ---------------- helpers (verbatim from base CLI) ----------------
function utcMidnight(ts: number): number { return Math.floor(ts / DAY_MS) * DAY_MS; }

async function dailyCloses(symbol: string): Promise<Map<number, number>> {
  const bars = await loadBars(symbol, '60m', { limit: 200_000 });
  const m = new Map<number, number>();
  for (const b of bars) m.set(utcMidnight(b.ts), b.close);
  return m;
}

async function loadDominance(): Promise<Map<number, number>> {
  const r = await cgGet<any>('/index/bitcoin-dominance', {});
  const d: any = r.data;
  const arr: any[] = Array.isArray(d) ? d : (Array.isArray(d?.list) ? d.list : []);
  const m = new Map<number, number>();
  for (const row of arr) {
    const ts = Number(row.timestamp);
    const dom = Number(row.bitcoin_dominance);
    if (Number.isFinite(ts) && Number.isFinite(dom)) m.set(utcMidnight(ts), dom);
  }
  return m;
}

async function loadFunding(symbols: string[]): Promise<Map<string, { ts: number; rate: number }[]>> {
  const out = new Map<string, { ts: number; rate: number }[]>();
  for (const s of symbols) {
    const r = await query<any>(`SELECT ts, rate FROM funding_history WHERE symbol=$1 ORDER BY ts ASC`, [s]);
    out.set(s, r.rows.map((x: any) => ({ ts: parseInt(x.ts, 10), rate: parseFloat(x.rate) })));
  }
  return out;
}

const fundingTally = { actual: 0, fallback: 0 };
function sumFunding(fund: Map<string, { ts: number; rate: number }[]>, symbol: string, startMs: number, endMs: number): { sumRate: number } {
  const rows = fund.get(symbol);
  const holdDays = Math.max(0, (endMs - startMs) / DAY_MS);
  if (!rows || rows.length === 0) { fundingTally.fallback++; return { sumRate: FUNDING_FALLBACK_PER_DAY * holdDays }; }
  let sum = 0, n = 0;
  for (const r of rows) if (r.ts >= startMs && r.ts < endMs) { sum += r.rate; n++; }
  if (n === 0) { fundingTally.fallback++; return { sumRate: FUNDING_FALLBACK_PER_DAY * holdDays }; }
  fundingTally.actual++;
  return { sumRate: sum };
}

function pctRank(history: number[], value: number): number {
  if (history.length === 0) return 0.5;
  let le = 0;
  for (const h of history) if (h <= value) le++;
  return le / history.length;
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}
function beta(assetRet: number[], btcRet: number[]): number {
  const n = Math.min(assetRet.length, btcRet.length);
  if (n < 5) return 1;
  const a = assetRet.slice(-n), b = btcRet.slice(-n);
  const ma = mean(a), mb = mean(b);
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); varb += (b[i] - mb) * (b[i] - mb); }
  return varb === 0 ? 1 : cov / varb;
}

// ---------------- backtest (verbatim mechanics from base CLI) ----------------
interface Trade { entryDay: number; exitDay: number; dir: number; pnlUsd: number; pnlPct: number; }
interface DailyMark { day: number; equity: number; }
interface Result { trades: Trade[]; daily: DailyMark[]; blownDay: number | null; }

function runMode(
  days: number[],
  btcClose: Map<number, number>,
  altCloses: Map<string, Map<number, number>>,
  alts: string[],
  domByDay: Map<number, number>,
  domHistByDay: Map<number, number[]>,
  fund: Map<string, { ts: number; rate: number }[]>,
  betaByDayAlt: Map<number, Map<string, number>>,
  mode: Mode,
  hi: number, lo: number, maxHoldDays: number, domWindow: number,
): Result {
  const trades: Trade[] = [];
  const daily: DailyMark[] = [];
  let equity = START_EQUITY;
  let blownDay: number | null = null;

  let inPos = false, dir = 0, entryDay = 0;
  let btcEntry = 0, btcNotional = 0;
  let altEntry: Record<string, number> = {};
  let altNotional: Record<string, number> = {};
  let entryFeeSlip = 0;
  const grossPerSide = () => START_EQUITY * GROSS_PER_SIDE_FRAC;
  const legCost = (nAbs: number) => nAbs * (TAKER + SLIP);

  function openPosition(day: number, newDir: number) {
    const btcPx = btcClose.get(day)!;
    const gps = grossPerSide();
    const betaMap = betaByDayAlt.get(day) || new Map();
    const w = 1 / alts.length;
    let basketBeta = 0;
    for (const a of alts) basketBeta += w * (betaMap.get(a) ?? 1);
    if (!Number.isFinite(basketBeta) || basketBeta <= 0) basketBeta = 1;
    let btcGross = gps, altGross = gps;
    if (mode === 'beta') altGross = gps / basketBeta;
    btcNotional = -newDir * btcGross;
    btcEntry = btcPx;
    altEntry = {}; altNotional = {};
    let cost = legCost(Math.abs(btcNotional));
    const perAlt = altGross * w;
    for (const a of alts) {
      altEntry[a] = altCloses.get(a)!.get(day)!;
      altNotional[a] = newDir * perAlt;
      cost += legCost(Math.abs(altNotional[a]));
    }
    entryFeeSlip = cost;
    equity -= cost;
    inPos = true; dir = newDir; entryDay = day;
  }

  function markPnl(day: number): number {
    if (!inPos) return 0;
    const btcPx = btcClose.get(day);
    if (btcPx == null) return 0;
    let pnl = btcNotional * (btcPx / btcEntry - 1);
    for (const a of Object.keys(altNotional)) {
      const px = altCloses.get(a)!.get(day);
      if (px == null) continue;
      pnl += altNotional[a] * (px / altEntry[a] - 1);
    }
    return pnl;
  }

  function closePosition(day: number) {
    const pricePnl = markPnl(day);
    let exitCost = legCost(Math.abs(btcNotional));
    for (const a of Object.keys(altNotional)) exitCost += legCost(Math.abs(altNotional[a]));
    const startMs = entryDay, endMs = day;
    let fundingCost = 0;
    {
      const f = sumFunding(fund, BTC, startMs, endMs);
      const sign = btcNotional >= 0 ? 1 : -1;
      fundingCost += sign * f.sumRate * Math.abs(btcNotional);
    }
    for (const a of Object.keys(altNotional)) {
      const f = sumFunding(fund, a, startMs, endMs);
      const sign = altNotional[a] >= 0 ? 1 : -1;
      fundingCost += sign * f.sumRate * Math.abs(altNotional[a]);
    }
    const net = pricePnl - exitCost - fundingCost;
    equity += net;
    const tradeNet = net - entryFeeSlip;
    trades.push({ entryDay, exitDay: day, dir, pnlUsd: tradeNet, pnlPct: tradeNet / START_EQUITY * 100 });
    inPos = false; dir = 0; btcNotional = 0; altNotional = {}; entryFeeSlip = 0;
  }

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (btcClose.get(day) == null) { daily.push({ day, equity: equity + markPnl(day) }); continue; }
    const dom = domByDay.get(day);
    const hist = domHistByDay.get(day);
    let signal = 0;
    if (dom != null && hist && hist.length >= Math.min(20, domWindow)) {
      const pr = pctRank(hist, dom);
      if (pr >= hi) signal = +1;
      else if (pr <= lo) signal = -1;
    }
    if (inPos) {
      const heldDays = (day - entryDay) / DAY_MS;
      const leftBand = signal === 0 || signal !== dir;
      if (leftBand || heldDays >= maxHoldDays) {
        closePosition(day);
        if (signal !== 0) openPosition(day, signal);
      }
    } else if (signal !== 0) {
      openPosition(day, signal);
    }
    const eq = equity + markPnl(day);
    if (blownDay == null && eq <= 0) blownDay = day;
    daily.push({ day, equity: eq });
  }
  if (inPos) {
    const last = days[days.length - 1];
    if (btcClose.get(last) != null) closePosition(last);
  }
  return { trades, daily, blownDay };
}

// ---------------- metrics ----------------
interface Metrics { nTrades: number; netRetPct: number; maxDDPct: number; worstDayDDPct: number; winPct: number; blown: boolean; }
function computeMetrics(daily: DailyMark[], trades: Trade[], blownDay: number | null): Metrics {
  if (daily.length === 0) return { nTrades: 0, netRetPct: 0, maxDDPct: 0, worstDayDDPct: 0, winPct: 0, blown: false };
  const startEq = daily[0].equity, endEq = daily[daily.length - 1].equity;
  const netRetPct = (endEq / startEq - 1) * 100;
  const FLOOR = 1;
  const eqF = daily.map(d => Math.max(d.equity, FLOOR));
  let peak = eqF[0], maxDD = 0;
  for (const e of eqF) { if (e > peak) peak = e; const dd = (e - peak) / peak; if (dd < maxDD) maxDD = dd; }
  if (maxDD < -1) maxDD = -1;
  let worstDay = 0;
  for (let i = 1; i < eqF.length; i++) { const dd = eqF[i] / eqF[i - 1] - 1; if (dd < worstDay) worstDay = dd; }
  if (worstDay < -1) worstDay = -1;
  const wins = trades.filter(t => t.pnlUsd > 0).length;
  return {
    nTrades: trades.length, netRetPct, maxDDPct: maxDD * 100, worstDayDDPct: worstDay * 100,
    winPct: trades.length ? wins / trades.length * 100 : 0, blown: blownDay != null,
  };
}

// ---------------- per-basket data prep ----------------
interface BasketData {
  chosen: string[];
  allDays: number[];
  decisionStart: number;
  windowStr: string;
}

/** Build the usable day index for a basket at a given domWindow (warmup). */
function prepBasket(
  symbols: string[],
  domWindow: number,
  btcClose: Map<number, number>,
  domByDay: Map<number, number>,
  altClosesAll: Map<string, Map<number, number>>,
  altRange: Record<string, { mn: number; mx: number; n: number }>,
): BasketData {
  const chosen = symbols.filter(a => altRange[a] && altRange[a].n > 0);
  const altStart = Math.max(...chosen.map(a => altRange[a].mn));
  const altEnd = Math.min(...chosen.map(a => altRange[a].mx));
  const btcKeys = [...btcClose.keys()].sort((x, y) => x - y);
  const domKeys = [...domByDay.keys()].sort((x, y) => x - y);
  const rawStart = Math.max(altStart, btcKeys[0], domKeys[0]);
  const decisionEnd = Math.min(altEnd, btcKeys[btcKeys.length - 1], domKeys[domKeys.length - 1]);
  const decisionStart = rawStart + domWindow * DAY_MS;
  const allDays: number[] = [];
  for (let day = rawStart; day <= decisionEnd; day += DAY_MS) {
    if (btcClose.get(day) == null) continue;
    if (domByDay.get(day) == null) continue;
    let ok = true;
    for (const a of chosen) if (altClosesAll.get(a)!.get(day) == null) { ok = false; break; }
    if (ok) allDays.push(day);
  }
  const windowStr = `${new Date(rawStart).toISOString().slice(0,10)}..${new Date(decisionEnd).toISOString().slice(0,10)}`;
  return { chosen, allDays, decisionStart, windowStr };
}

// ---------------- main ----------------
interface CellRow {
  basket: string; domWindow: number; band: string; hold: number; mode: Mode;
  decisionDays: number;
  older: Metrics; recent: Metrics;
  positiveBoth: boolean;
}

async function main() {
  console.log('=== dominance-spread ROBUSTNESS GRID ===');
  console.log(`costs: taker=${(TAKER*100).toFixed(3)}%/fill slip=${(SLIP*100).toFixed(3)}%/fill (each leg, entry+exit); funding=actual funding_history per-8h, fallback ${(FUNDING_FALLBACK_PER_DAY*100).toFixed(3)}%/day`);
  console.log(`grossPerSide=${GROSS_PER_SIDE_FRAC}x equity ($${(START_EQUITY*GROSS_PER_SIDE_FRAC).toLocaleString()}/side), startEquity=$${START_EQUITY.toLocaleString()}, betaWindow=${BETA_WINDOW}d\n`);

  // shared loads
  const domByDay = await loadDominance();
  const btcClose = await dailyCloses(BTC);

  // collect all alt symbols used across baskets
  const allAltSyms = Array.from(new Set(BASKETS.flatMap(b => b.symbols)));
  const altClosesAll = new Map<string, Map<number, number>>();
  const altRange: Record<string, { mn: number; mx: number; n: number }> = {};
  for (const a of allAltSyms) {
    const m = await dailyCloses(a);
    altClosesAll.set(a, m);
    if (m.size === 0) { altRange[a] = { mn: 0, mx: 0, n: 0 }; continue; }
    const keys = [...m.keys()].sort((x, y) => x - y);
    altRange[a] = { mn: keys[0], mx: keys[keys.length - 1], n: keys.length };
  }
  const fund = await loadFunding([BTC, ...allAltSyms]);

  console.log('=== alt history coverage (candles 60m → daily) ===');
  for (const a of allAltSyms) {
    const r = altRange[a];
    const rng = r.n ? `${new Date(r.mn).toISOString().slice(0,10)}..${new Date(r.mx).toISOString().slice(0,10)} (${r.n}d)` : 'NONE';
    console.log(`  ${a.padEnd(10)} ${rng}`);
  }
  console.log('');

  const rows: CellRow[] = [];

  for (const basket of BASKETS) {
    for (const domWindow of DOM_WINDOWS) {
      const bd = prepBasket(basket.symbols, domWindow, btcClose, domByDay, altClosesAll, altRange);
      if (bd.chosen.length === 0 || bd.allDays.length < 30) {
        console.log(`-- basket=${basket.name} domWindow=${domWindow}: insufficient data (chosen=${bd.chosen.join(',')||'none'}, days=${bd.allDays.length}) --\n`);
        continue;
      }
      // dominance rolling history per day
      const domHistByDay = new Map<number, number[]>();
      const domSeries = bd.allDays.map(d => domByDay.get(d)!);
      for (let i = 0; i < bd.allDays.length; i++) {
        const lo = Math.max(0, i - domWindow);
        domHistByDay.set(bd.allDays[i], domSeries.slice(lo, i));
      }
      // per-day per-alt beta
      const btcRetSeries: number[] = [0];
      for (let i = 1; i < bd.allDays.length; i++) btcRetSeries.push(btcClose.get(bd.allDays[i])! / btcClose.get(bd.allDays[i - 1])! - 1);
      const altRetSeries: Record<string, number[]> = {};
      for (const a of bd.chosen) {
        const arr: number[] = [0];
        for (let i = 1; i < bd.allDays.length; i++) arr.push(altClosesAll.get(a)!.get(bd.allDays[i])! / altClosesAll.get(a)!.get(bd.allDays[i - 1])! - 1);
        altRetSeries[a] = arr;
      }
      const betaByDayAlt = new Map<number, Map<string, number>>();
      for (let i = 0; i < bd.allDays.length; i++) {
        const lo = Math.max(1, i - BETA_WINDOW);
        const bret = btcRetSeries.slice(lo, i);
        const m = new Map<string, number>();
        for (const a of bd.chosen) m.set(a, beta(altRetSeries[a].slice(lo, i), bret));
        betaByDayAlt.set(bd.allDays[i], m);
      }
      const decisionDays = bd.allDays.filter(d => d >= bd.decisionStart);
      if (decisionDays.length < 20) {
        console.log(`-- basket=${basket.name} domWindow=${domWindow}: only ${decisionDays.length} decision days after warmup, skipping --\n`);
        continue;
      }
      const midIdx = Math.floor(decisionDays.length / 2);
      const olderDays = decisionDays.slice(0, midIdx);
      const recentDays = decisionDays.slice(midIdx);
      const altClosesChosen = new Map<string, Map<number, number>>();
      for (const a of bd.chosen) altClosesChosen.set(a, altClosesAll.get(a)!);

      const olderSplit = `${new Date(olderDays[0]).toISOString().slice(0,10)}..${new Date(olderDays[olderDays.length-1]).toISOString().slice(0,10)}`;
      const recentSplit = `${new Date(recentDays[0]).toISOString().slice(0,10)}..${new Date(recentDays[recentDays.length-1]).toISOString().slice(0,10)}`;
      console.log(`### basket=${basket.name} (${bd.chosen.length}: ${bd.chosen.join(',')}) domWindow=${domWindow}d`);
      console.log(`    decisionDays=${decisionDays.length}  OLDER ${olderSplit} | RECENT ${recentSplit}`);

      for (const band of BANDS) {
        for (const hold of HOLDS) {
          for (const mode of MODES) {
            const older = runMode(olderDays, btcClose, altClosesChosen, bd.chosen, domByDay, domHistByDay, fund, betaByDayAlt, mode, band.hi, band.lo, hold, domWindow);
            const recent = runMode(recentDays, btcClose, altClosesChosen, bd.chosen, domByDay, domHistByDay, fund, betaByDayAlt, mode, band.hi, band.lo, hold, domWindow);
            const mo = computeMetrics(older.daily, older.trades, older.blownDay);
            const mr = computeMetrics(recent.daily, recent.trades, recent.blownDay);
            const positiveBoth = mo.netRetPct > 0 && mr.netRetPct > 0 && !mo.blown && !mr.blown;
            rows.push({ basket: basket.name, domWindow, band: band.label, hold, mode, decisionDays: decisionDays.length, older: mo, recent: mr, positiveBoth });
            const tag = positiveBoth ? 'BOTH+' : (mo.netRetPct > 0 || mr.netRetPct > 0 ? 'mixed' : 'BOTH-');
            console.log(
              `    ${band.label} hold=${String(hold).padStart(2)} ${mode.padEnd(6)} | ` +
              `OLDER ret=${mo.netRetPct.toFixed(2).padStart(7)}% maxDD=${mo.maxDDPct.toFixed(2).padStart(7)}% wd=${mo.worstDayDDPct.toFixed(2).padStart(6)}% n=${String(mo.nTrades).padStart(2)} | ` +
              `RECENT ret=${mr.netRetPct.toFixed(2).padStart(7)}% maxDD=${mr.maxDDPct.toFixed(2).padStart(7)}% wd=${mr.worstDayDDPct.toFixed(2).padStart(6)}% n=${String(mr.nTrades).padStart(2)} | ${tag}` +
              `${mo.blown||mr.blown?' *** BLOWN ***':''}`,
            );
          }
        }
      }
      console.log('');
    }
  }

  // ---------------- verdict tally ----------------
  console.log('=== GRID TALLY ===');
  const total = rows.length;
  const both = rows.filter(r => r.positiveBoth).length;
  const bothMinus = rows.filter(r => r.older.netRetPct <= 0 && r.recent.netRetPct <= 0).length;
  const mixed = total - both - bothMinus;
  const blown = rows.filter(r => r.older.blown || r.recent.blown).length;
  console.log(`total cells: ${total}`);
  console.log(`positive BOTH halves: ${both} (${(both/total*100).toFixed(0)}%)`);
  console.log(`mixed (one half +): ${mixed} (${(mixed/total*100).toFixed(0)}%)`);
  console.log(`negative BOTH halves: ${bothMinus} (${(bothMinus/total*100).toFixed(0)}%)`);
  console.log(`cells with a BLOWN half: ${blown}`);

  // by basket
  console.log('\nby basket (positive-both / total):');
  for (const b of BASKETS) {
    const sub = rows.filter(r => r.basket === b.name);
    if (sub.length === 0) { console.log(`  ${b.name.padEnd(10)} no cells`); continue; }
    const sb = sub.filter(r => r.positiveBoth).length;
    console.log(`  ${b.name.padEnd(10)} ${sb}/${sub.length}`);
  }
  // by mode
  console.log('\nby neutrality mode (positive-both / total):');
  for (const mode of MODES) {
    const sub = rows.filter(r => r.mode === mode);
    const sb = sub.filter(r => r.positiveBoth).length;
    console.log(`  ${mode.padEnd(6)} ${sb}/${sub.length}`);
  }
  // best positive-both cells by min(older,recent) ret
  const bestBoth = rows.filter(r => r.positiveBoth).sort((a, b) => Math.min(b.older.netRetPct, b.recent.netRetPct) - Math.min(a.older.netRetPct, a.recent.netRetPct)).slice(0, 8);
  console.log('\ntop positive-both cells (by worst-half ret):');
  for (const r of bestBoth) {
    console.log(`  ${r.basket.padEnd(10)} dw=${r.domWindow} ${r.band} hold=${r.hold} ${r.mode.padEnd(6)} older=${r.older.netRetPct.toFixed(2)}% recent=${r.recent.netRetPct.toFixed(2)}% (n_o=${r.older.nTrades} n_r=${r.recent.nTrades})`);
  }

  console.log(`\nfunding leg-evaluations: actual=${fundingTally.actual} fallback=${fundingTally.fallback}`);
  await closePg();
  process.exit(0);
}

main().catch(e => { console.error('dominance-spread-grid crashed:', e?.stack ?? e?.message ?? String(e)); process.exit(1); });

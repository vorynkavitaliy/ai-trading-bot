/**
 * dominance-spread — relative-value spread backtest driven by BTC-dominance LEVEL.
 *
 * Thesis (from the signal sweep): high BTC dominance percentile predicts BTC
 * UNDERPERFORMING alts over ~9 days, and low dominance the reverse. This is a
 * SPREAD trade (short BTC + long alt basket, or reverse), NOT a single-pair
 * directional fade. It is NOT market-neutral by construction because alts carry
 * higher beta than BTC — so we test BOTH dollar-neutral and beta-neutral sizing.
 *
 * Data sources (read-only):
 *   - BTC dominance: Coinglass /index/bitcoin-dominance via cgGet (daily, 00:00 UTC,
 *     keys: timestamp, price, bitcoin_dominance, market_cap).
 *   - Price candles: project `candles` table, tf=60m, aggregated to daily UTC close
 *     via the project's own loader (src/data/candles.ts loadBars).
 *   - Funding: funding_history table (Bybit native per-8h-settlement rate). Where a
 *     symbol/timestamp is missing, a conservative flat fallback is charged as a cost.
 *
 * Costs: taker fee (0.055%) on entry+exit of EVERY leg, slippage 0.25% per fill on
 * EVERY leg (entry+exit), funding accrued over the hold on EVERY leg.
 *
 * IS/OOS split at the midpoint of the usable (decision-eligible) history.
 *
 * Usage:
 *   npx tsx src/backtest/cli/dominance-spread.ts [hi=0.80] [lo=0.20] [domWindow=90] [maxHold=9] [basket=broad|deep]
 *     broad = all liquid alts with continuous history (~10mo window, more breadth)
 *     deep  = only SOL,ETH,XRP (history to 2021 → multi-year IS/OOS, more sample)
 *
 * Reports, per recent-half / older-half / full, for BOTH dollar-neutral and
 * beta-neutral modes: nTrades, net ret%, annualized%, Sharpe, equity MaxDD%,
 * worst rolling-24h DD% (Hyro daily-DD proxy), win%.
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { query, close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

// ---------------- config ----------------
const HI = process.argv[2] != null ? parseFloat(process.argv[2]) : 0.80;
const LO = process.argv[3] != null ? parseFloat(process.argv[3]) : 0.20;
const DOM_WINDOW = process.argv[4] != null ? parseInt(process.argv[4], 10) : 90;
const MAX_HOLD_DAYS = process.argv[5] != null ? parseInt(process.argv[5], 10) : 9;
const BASKET_MODE = (process.argv[6] === 'deep' ? 'deep' : 'broad') as 'broad' | 'deep';

const BETA_WINDOW = 90;                 // days for beta estimation
const TAKER = BACKTEST_COMMON.takerFeeRate;       // 0.00055
const SLIP = BACKTEST_COMMON.slippagePct / 100;   // 0.25% -> 0.0025 fraction
const START_EQUITY = 200_000;
// Gross notional deployed PER SIDE, as a fraction of equity (dollar-neutral baseline).
// 0.5x equity per side = 1.0x total gross — a conservative spread allocation. Sized off
// STARTING equity (fixed notional), NOT compounding equity, so a deep drawdown does not
// dynamically de-lever the book and mask the true crash exposure.
const GROSS_PER_SIDE_FRAC = process.argv[7] != null ? parseFloat(process.argv[7]) : 0.5;
// Conservative flat funding fallback when funding_history lacks a row (per day, decimal).
const FUNDING_FALLBACK_PER_DAY = 0.0001; // 0.01%/day

const DAY_MS = 86_400_000;

// Alt basket candidates (liquid perps). We keep only those with continuous history
// over the common window to avoid survivorship distortion.
const ALT_BROAD = ['SOLUSDT','ETHUSDT','XRPUSDT','BNBUSDT','ADAUSDT','LINKUSDT','LTCUSDT','ATOMUSDT','INJUSDT','ARBUSDT'];
const ALT_DEEP = ['SOLUSDT','ETHUSDT','XRPUSDT'];   // continuous history back to 2021
const ALT_CANDIDATES = BASKET_MODE === 'deep' ? ALT_DEEP : ALT_BROAD;
const BTC = 'BTCUSDT';

// ---------------- types ----------------
interface DailyClose { day: number; close: number; }   // day = UTC midnight epoch ms

// ---------------- daily-close derivation ----------------
/** UTC-midnight epoch ms for a given epoch ms. */
function utcMidnight(ts: number): number { return Math.floor(ts / DAY_MS) * DAY_MS; }

/**
 * Derive a daily-close series (close of the last hourly bar within each UTC day).
 * Crypto is 24/7, so "daily close" = the 23:00-UTC bar's close (last bar of the day).
 */
async function dailyCloses(symbol: string): Promise<Map<number, number>> {
  const bars = await loadBars(symbol, '60m', { limit: 200_000 });
  const m = new Map<number, number>();
  for (const b of bars) {
    const d = utcMidnight(b.ts);
    // last bar of the day wins (bars are chronological ascending)
    m.set(d, b.close);
  }
  return m;
}

// ---------------- dominance load ----------------
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

// ---------------- funding load ----------------
/** Map symbol -> sorted array of {ts, rate} per-8h-settlement. */
async function loadFunding(symbols: string[]): Promise<Map<string, { ts: number; rate: number }[]>> {
  const out = new Map<string, { ts: number; rate: number }[]>();
  for (const s of symbols) {
    const r = await query<any>(
      `SELECT ts, rate FROM funding_history WHERE symbol=$1 ORDER BY ts ASC`, [s]);
    out.set(s, r.rows.map((x: any) => ({ ts: parseInt(x.ts, 10), rate: parseFloat(x.rate) })));
  }
  return out;
}

/**
 * Sum funding rate over [startMs, endMs) for a symbol. Returns the summed settlement
 * rate (sum of per-8h rates). If no rows fall in the window, falls back to a flat
 * conservative per-day rate scaled by the hold length (always charged as a cost).
 * Returns { sumRate, usedFallback }.
 */
const fundingTally = { actual: 0, fallback: 0 };
function sumFunding(fund: Map<string, { ts: number; rate: number }[]>, symbol: string, startMs: number, endMs: number): { sumRate: number; usedFallback: boolean } {
  const rows = fund.get(symbol);
  const holdDays = Math.max(0, (endMs - startMs) / DAY_MS);
  if (!rows || rows.length === 0) {
    fundingTally.fallback++;
    return { sumRate: FUNDING_FALLBACK_PER_DAY * holdDays, usedFallback: true };
  }
  let sum = 0; let n = 0;
  for (const r of rows) {
    if (r.ts >= startMs && r.ts < endMs) { sum += r.rate; n++; }
  }
  if (n === 0) { fundingTally.fallback++; return { sumRate: FUNDING_FALLBACK_PER_DAY * holdDays, usedFallback: true }; }
  fundingTally.actual++;
  return { sumRate: sum, usedFallback: false };
}

// ---------------- percentile ----------------
/** Percentile rank (0..1) of `value` within `history` (fraction of history <= value). */
function pctRank(history: number[], value: number): number {
  if (history.length === 0) return 0.5;
  let le = 0;
  for (const h of history) if (h <= value) le++;
  return le / history.length;
}

// ---------------- stats ----------------
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}
/** OLS beta of asset daily returns vs BTC daily returns. */
function beta(assetRet: number[], btcRet: number[]): number {
  const n = Math.min(assetRet.length, btcRet.length);
  if (n < 5) return 1;
  const a = assetRet.slice(-n), b = btcRet.slice(-n);
  const ma = mean(a), mb = mean(b);
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); varb += (b[i] - mb) * (b[i] - mb); }
  return varb === 0 ? 1 : cov / varb;
}

// ---------------- backtest ----------------
interface Trade {
  entryDay: number;
  exitDay: number;
  dir: number;           // +1 = long alts/short BTC (dom high), -1 = reverse
  pnlUsd: number;        // net of fees+slip+funding
  pnlPct: number;        // on START_EQUITY
}

interface DailyMark {
  day: number;
  equity: number;        // mark-to-market equity at this day's close
}

interface Result {
  trades: Trade[];
  daily: DailyMark[];    // mark-to-market equity curve (daily)
  blownDay: number | null; // first UTC-day equity touched <= 0 (account would be dead)
}

type Mode = 'dollar' | 'beta';

function runMode(
  days: number[],                                   // sorted decision-eligible UTC-day index
  btcClose: Map<number, number>,
  altCloses: Map<string, Map<number, number>>,
  alts: string[],
  domByDay: Map<number, number>,
  domHistByDay: Map<number, number[]>,              // rolling history (prior DOM_WINDOW values) per day
  fund: Map<string, { ts: number; rate: number }[]>,
  betaByDayAlt: Map<number, Map<string, number>>,   // per-day per-alt 90d beta
  mode: Mode,
): Result {
  const trades: Trade[] = [];
  const daily: DailyMark[] = [];
  let equity = START_EQUITY;
  let blownDay: number | null = null;

  // position state
  let inPos = false;
  let dir = 0;
  let entryDay = 0;
  // per-leg entry prices + signed notionals (signed: + = long, - = short)
  let btcEntry = 0, btcNotional = 0;            // signed notional (USD) at entry
  let altEntry: Record<string, number> = {};
  let altNotional: Record<string, number> = {};
  let entryFeeSlip = 0;                          // USD cost already charged at entry

  const grossPerSide = () => START_EQUITY * GROSS_PER_SIDE_FRAC;

  function legCost(notionalAbs: number): number {
    // one fill: taker fee + slip on the notional
    return notionalAbs * (TAKER + SLIP);
  }

  function openPosition(day: number, newDir: number) {
    const btcPx = btcClose.get(day)!;
    const gps = grossPerSide();
    // dollar-neutral: BTC side gross = gps; alt side gross = gps split equally.
    // beta-neutral: scale alt side so basket beta * altGross == btcGross (BTC beta=1).
    const betaMap = betaByDayAlt.get(day) || new Map();
    const w = 1 / alts.length;
    let basketBeta = 0;
    for (const a of alts) basketBeta += w * (betaMap.get(a) ?? 1);
    if (!Number.isFinite(basketBeta) || basketBeta <= 0) basketBeta = 1;

    let btcGross = gps;
    let altGross = gps;
    if (mode === 'beta') {
      // net beta = btcGross*1 (one side) must equal altGross*basketBeta (other side).
      // Keep BTC side at gps, scale alt side down/up so beta matches.
      altGross = gps / basketBeta;
    }

    // dir = +1: long alts (+altGross), short BTC (-btcGross). dir=-1: reverse.
    btcNotional = -newDir * btcGross;             // short BTC when dir=+1
    btcEntry = btcPx;
    altEntry = {}; altNotional = {};
    let cost = 0;
    cost += legCost(Math.abs(btcNotional));
    const perAlt = altGross * w;
    for (const a of alts) {
      altEntry[a] = altCloses.get(a)!.get(day)!;
      altNotional[a] = newDir * perAlt;           // long alts when dir=+1
      cost += legCost(Math.abs(altNotional[a]));
    }
    entryFeeSlip = cost;
    equity -= cost;                               // charge entry fee+slip immediately
    inPos = true; dir = newDir; entryDay = day;
  }

  /** Mark-to-market unrealized PnL of open legs at `day` (price effect only, no exit cost). */
  function markPnl(day: number): number {
    if (!inPos) return 0;
    const btcPx = btcClose.get(day);
    if (btcPx == null) return 0;
    let pnl = 0;
    // signed notional * (px/entry - 1) = USD pnl on that leg
    pnl += btcNotional * (btcPx / btcEntry - 1);
    for (const a of Object.keys(altNotional)) {
      const px = altCloses.get(a)!.get(day);
      if (px == null) continue;
      pnl += altNotional[a] * (px / altEntry[a] - 1);
    }
    return pnl;
  }

  /** Close position at `day`: realize price pnl - exit cost - funding over hold. */
  function closePosition(day: number) {
    const pricePnl = markPnl(day);
    // exit fee+slip on each leg (notionals approx at entry size — Bybit charges on
    // fill notional; using entry notional is a conservative, standard approximation).
    let exitCost = legCost(Math.abs(btcNotional));
    for (const a of Object.keys(altNotional)) exitCost += legCost(Math.abs(altNotional[a]));

    // funding over hold on every leg. funding cost sign:
    //   a LONG leg PAYS funding when rate>0 (cost = +rate*notional);
    //   a SHORT leg RECEIVES it (cost = -rate*|notional|, i.e. negative cost).
    // Charged on |notional| with the sign of the position.
    const startMs = entryDay; const endMs = day;
    let fundingCost = 0;
    {
      const f = sumFunding(fund, BTC, startMs, endMs);
      const sign = btcNotional >= 0 ? 1 : -1;     // long pays, short receives
      fundingCost += sign * f.sumRate * Math.abs(btcNotional);
    }
    for (const a of Object.keys(altNotional)) {
      const f = sumFunding(fund, a, startMs, endMs);
      const sign = altNotional[a] >= 0 ? 1 : -1;
      fundingCost += sign * f.sumRate * Math.abs(altNotional[a]);
    }

    const net = pricePnl - exitCost - fundingCost; // entry cost already deducted from equity
    equity += pricePnl - exitCost - fundingCost;
    const tradeNet = net - entryFeeSlip;           // full round-trip net for reporting
    trades.push({
      entryDay, exitDay: day, dir,
      pnlUsd: tradeNet,
      pnlPct: tradeNet / START_EQUITY * 100,
    });
    inPos = false; dir = 0;
    btcNotional = 0; altNotional = {}; entryFeeSlip = 0;
  }

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    // need prices for all legs this day
    if (btcClose.get(day) == null) { daily.push({ day, equity: equity + markPnl(day) }); continue; }

    const dom = domByDay.get(day);
    const hist = domHistByDay.get(day);
    let signal = 0; // 0 flat, +1 long-alts/short-btc, -1 reverse
    if (dom != null && hist && hist.length >= Math.min(20, DOM_WINDOW)) {
      const pr = pctRank(hist, dom);
      if (pr >= HI) signal = +1;
      else if (pr <= LO) signal = -1;
    }

    if (inPos) {
      const heldDays = (day - entryDay) / DAY_MS;
      // exit if signal left the band (signal==0 or flipped) OR maxHold reached
      const leftBand = signal === 0 || signal !== dir;
      if (leftBand || heldDays >= MAX_HOLD_DAYS) {
        closePosition(day);
        // after closing, allow immediate re-entry on a fresh same-day signal (rebalance)
        if (signal !== 0) openPosition(day, signal);
      }
    } else if (signal !== 0) {
      openPosition(day, signal);
    }

    const eq = equity + markPnl(day);
    if (blownDay == null && eq <= 0) blownDay = day; // account would be terminated long before this
    daily.push({ day, equity: eq });
  }

  // force-close any open position at the last day
  if (inPos) {
    const last = days[days.length - 1];
    if (btcClose.get(last) != null) closePosition(last);
  }

  return { trades, daily, blownDay };
}

// ---------------- metrics ----------------
interface Metrics {
  nTrades: number;
  netRetPct: number;
  annPct: number;
  sharpe: number;
  maxDDPct: number;        // peak-to-trough drawdown as % of running peak (capped at -100% on blow-up)
  worstDayDDPct: number;   // worst rolling-24h equity drop as % of prior-day balance
  winPct: number;
  blown: boolean;          // equity touched <= 0 during the window (account terminated)
}

function computeMetrics(daily: DailyMark[], trades: Trade[], blownDay: number | null): Metrics {
  if (daily.length === 0) {
    return { nTrades: 0, netRetPct: 0, annPct: 0, sharpe: 0, maxDDPct: 0, worstDayDDPct: 0, winPct: 0, blown: false };
  }
  const startEq = daily[0].equity;
  const endEq = daily[daily.length - 1].equity;
  const spanDays = (daily[daily.length - 1].day - daily[0].day) / DAY_MS || 1;
  const netRetPct = (endEq / startEq - 1) * 100;
  // annualized only meaningful if not blown; otherwise -100% (account dead).
  const annPct = blownDay != null ? -100 : (Math.pow(Math.max(endEq, 1) / startEq, 365 / spanDays) - 1) * 100;

  // Hyro rules are framed as % of ACCOUNT BALANCE, not peak-relative compounding ratios.
  // We measure drops against the prior-day equity but FLOOR equity at a small positive
  // value so a blow-through-zero in the 2022 alt collapse does not produce sign-flipped
  // ratios. A blown account is reported via the `blown` flag (the true Hyro outcome).
  const FLOOR = 1;
  const eqF = daily.map(d => Math.max(d.equity, FLOOR));

  // daily simple returns for Sharpe (on floored equity)
  const rets: number[] = [];
  for (let i = 1; i < eqF.length; i++) rets.push(eqF[i] / eqF[i - 1] - 1);
  const sd = std(rets);
  const sharpe = sd === 0 ? 0 : (mean(rets) / sd) * Math.sqrt(365);

  // equity MaxDD (peak-to-trough), peak-relative, capped at -100%.
  let peak = eqF[0], maxDD = 0;
  for (const e of eqF) {
    if (e > peak) peak = e;
    const dd = (e - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  if (maxDD < -1) maxDD = -1;

  // worst rolling-24h DD (Hyro daily-DD proxy): worst single-day equity drop, capped -100%.
  let worstDay = 0;
  for (let i = 1; i < eqF.length; i++) {
    const dd = eqF[i] / eqF[i - 1] - 1;
    if (dd < worstDay) worstDay = dd;
  }
  if (worstDay < -1) worstDay = -1;

  const wins = trades.filter(t => t.pnlUsd > 0).length;
  const winPct = trades.length ? wins / trades.length * 100 : 0;

  return {
    nTrades: trades.length,
    netRetPct,
    annPct,
    sharpe,
    maxDDPct: maxDD * 100,
    worstDayDDPct: worstDay * 100,
    winPct,
    blown: blownDay != null,
  };
}

function fmt(n: number, d = 2): string { return n.toFixed(d); }

function printMetrics(label: string, m: Metrics) {
  const flag = m.blown ? '  *** ACCOUNT BLOWN (equity<=0) ***' : '';
  console.log(`  ${label.padEnd(12)} n=${String(m.nTrades).padStart(3)} ret=${fmt(m.netRetPct).padStart(8)}% ann=${fmt(m.annPct).padStart(8)}% sharpe=${fmt(m.sharpe).padStart(6)} maxDD=${fmt(m.maxDDPct).padStart(7)}% worst24h=${fmt(m.worstDayDDPct).padStart(7)}% win=${fmt(m.winPct, 1).padStart(5)}%${flag}`);
}

// ---------------- main ----------------
async function main() {
  console.log('=== dominance-spread backtest ===');
  console.log(`config: HI=${HI} LO=${LO} domWindow=${DOM_WINDOW}d maxHold=${MAX_HOLD_DAYS}d betaWindow=${BETA_WINDOW}d basket=${BASKET_MODE}`);
  console.log(`costs: taker=${(TAKER*100).toFixed(3)}%/fill slip=${(SLIP*100).toFixed(3)}%/fill (each leg, entry+exit); funding=actual funding_history per-8h, fallback ${(FUNDING_FALLBACK_PER_DAY*100).toFixed(3)}%/day`);
  console.log(`grossPerSide=${GROSS_PER_SIDE_FRAC}x equity ($${(START_EQUITY*GROSS_PER_SIDE_FRAC).toLocaleString()}/side), startEquity=$${START_EQUITY.toLocaleString()}\n`);

  // 1. load dominance + BTC daily
  const domByDay = await loadDominance();
  const btcClose = await dailyCloses(BTC);

  // 2. determine usable alt set: continuous history over the common window.
  // First find each alt's day-range.
  const altRange: Record<string, { mn: number; mx: number; n: number }> = {};
  const altClosesAll: Map<string, Map<number, number>> = new Map();
  for (const a of ALT_CANDIDATES) {
    const m = await dailyCloses(a);
    altClosesAll.set(a, m);
    if (m.size === 0) { altRange[a] = { mn: 0, mx: 0, n: 0 }; continue; }
    const keys = [...m.keys()].sort((x, y) => x - y);
    altRange[a] = { mn: keys[0], mx: keys[keys.length - 1], n: keys.length };
  }

  // Common window = intersection start (max of mins) .. (min of maxes), among alts
  // that have a "reasonable" history. We drop the latest-starting alt(s) only if they
  // would shorten the window by > ~20d vs the median start, to balance breadth vs span.
  // DEEP mode: keep ALL named candidates explicitly (we *want* the long window), so
  // the truncation filter is bypassed — the window simply intersects their starts.
  const starts = ALT_CANDIDATES.map(a => altRange[a].mn).filter(x => x > 0).sort((x, y) => x - y);
  const medianStart = starts[Math.floor(starts.length / 2)];

  const chosen: string[] = [];
  for (const a of ALT_CANDIDATES) {
    const r = altRange[a];
    if (r.n === 0) continue;
    if (BASKET_MODE === 'broad' && r.mn > medianStart + 20 * DAY_MS) continue; // truncation guard (broad only)
    chosen.push(a);
  }

  const altStart = Math.max(...chosen.map(a => altRange[a].mn));
  const altEnd = Math.min(...chosen.map(a => altRange[a].mx));

  // intersect with BTC + dominance availability
  const btcKeys = [...btcClose.keys()].sort((x, y) => x - y);
  const btcStart = btcKeys[0], btcEnd = btcKeys[btcKeys.length - 1];
  const domKeys = [...domByDay.keys()].sort((x, y) => x - y);
  const domStart = domKeys[0], domEnd = domKeys[domKeys.length - 1];

  // dominance percentile needs DOM_WINDOW days of dom history BEFORE the first decision.
  const rawStart = Math.max(altStart, btcStart, domStart);
  const decisionStart = rawStart + DOM_WINDOW * DAY_MS; // warmup for percentile + beta
  const decisionEnd = Math.min(altEnd, btcEnd, domEnd);

  console.log('=== universe selection ===');
  for (const a of ALT_CANDIDATES) {
    const r = altRange[a];
    const tag = chosen.includes(a) ? 'KEEP' : 'DROP';
    const rng = r.n ? `${new Date(r.mn).toISOString().slice(0,10)}..${new Date(r.mx).toISOString().slice(0,10)} (${r.n}d)` : 'NONE';
    console.log(`  ${tag} ${a.padEnd(10)} ${rng}`);
  }
  console.log(`  BTC ${new Date(btcStart).toISOString().slice(0,10)}..${new Date(btcEnd).toISOString().slice(0,10)}`);
  console.log(`  DOM ${new Date(domStart).toISOString().slice(0,10)}..${new Date(domEnd).toISOString().slice(0,10)}`);
  console.log(`  basket (${chosen.length}): ${chosen.join(',')}`);
  console.log(`  raw window ${new Date(rawStart).toISOString().slice(0,10)}..${new Date(decisionEnd).toISOString().slice(0,10)}`);
  console.log(`  decision window ${new Date(decisionStart).toISOString().slice(0,10)}..${new Date(decisionEnd).toISOString().slice(0,10)} (after ${DOM_WINDOW}d warmup)\n`);

  // 3. build day index (all UTC days where BTC + all chosen alts + dom have a close).
  const allDays: number[] = [];
  for (let day = rawStart; day <= decisionEnd; day += DAY_MS) {
    if (btcClose.get(day) == null) continue;
    if (domByDay.get(day) == null) continue;
    let ok = true;
    for (const a of chosen) if (altClosesAll.get(a)!.get(day) == null) { ok = false; break; }
    if (ok) allDays.push(day);
  }

  // dominance rolling history (prior DOM_WINDOW dom values, strictly before each day)
  const domHistByDay = new Map<number, number[]>();
  const domSeries = allDays.map(d => domByDay.get(d)!);
  for (let i = 0; i < allDays.length; i++) {
    const lo = Math.max(0, i - DOM_WINDOW);
    domHistByDay.set(allDays[i], domSeries.slice(lo, i)); // strictly prior
  }

  // per-day per-alt beta (trailing BETA_WINDOW daily returns vs BTC)
  const betaByDayAlt = new Map<number, Map<string, number>>();
  // precompute daily returns aligned on allDays
  const btcRetSeries: number[] = [0];
  for (let i = 1; i < allDays.length; i++) {
    btcRetSeries.push(btcClose.get(allDays[i])! / btcClose.get(allDays[i - 1])! - 1);
  }
  const altRetSeries: Record<string, number[]> = {};
  for (const a of chosen) {
    const arr: number[] = [0];
    for (let i = 1; i < allDays.length; i++) {
      arr.push(altClosesAll.get(a)!.get(allDays[i])! / altClosesAll.get(a)!.get(allDays[i - 1])! - 1);
    }
    altRetSeries[a] = arr;
  }
  for (let i = 0; i < allDays.length; i++) {
    const lo = Math.max(1, i - BETA_WINDOW);
    const bret = btcRetSeries.slice(lo, i);
    const m = new Map<string, number>();
    for (const a of chosen) {
      const aret = altRetSeries[a].slice(lo, i);
      m.set(a, beta(aret, bret));
    }
    betaByDayAlt.set(allDays[i], m);
  }

  // decision-eligible days (after warmup)
  const decisionDays = allDays.filter(d => d >= decisionStart);
  console.log(`day index: ${allDays.length} total, ${decisionDays.length} decision-eligible\n`);

  // 4. load funding
  const fund = await loadFunding([BTC, ...chosen]);

  // 5. run both modes over the FULL decision window, then slice IS/OOS at midpoint.
  const altClosesChosen = new Map<string, Map<number, number>>();
  for (const a of chosen) altClosesChosen.set(a, altClosesAll.get(a)!);

  const midIdx = Math.floor(decisionDays.length / 2);
  const olderDays = decisionDays.slice(0, midIdx);
  const recentDays = decisionDays.slice(midIdx);
  const olderSplit = `${new Date(olderDays[0]).toISOString().slice(0,10)}..${new Date(olderDays[olderDays.length-1]).toISOString().slice(0,10)}`;
  const recentSplit = `${new Date(recentDays[0]).toISOString().slice(0,10)}..${new Date(recentDays[recentDays.length-1]).toISOString().slice(0,10)}`;
  console.log(`IS/OOS midpoint split: OLDER ${olderSplit} | RECENT ${recentSplit}\n`);

  for (const mode of ['dollar', 'beta'] as Mode[]) {
    console.log(`===== MODE: ${mode === 'dollar' ? 'DOLLAR-NEUTRAL' : 'BETA-NEUTRAL'} =====`);
    // run each window as an independent backtest (equity resets per window so the
    // half-metrics are clean; full is the continuous run).
    const full = runMode(decisionDays, btcClose, altClosesChosen, chosen, domByDay, domHistByDay, fund, betaByDayAlt, mode);
    const older = runMode(olderDays, btcClose, altClosesChosen, chosen, domByDay, domHistByDay, fund, betaByDayAlt, mode);
    const recent = runMode(recentDays, btcClose, altClosesChosen, chosen, domByDay, domHistByDay, fund, betaByDayAlt, mode);

    printMetrics('RECENT', computeMetrics(recent.daily, recent.trades, recent.blownDay));
    printMetrics('OLDER', computeMetrics(older.daily, older.trades, older.blownDay));
    printMetrics('FULL', computeMetrics(full.daily, full.trades, full.blownDay));
    console.log('');
  }

  console.log(`funding leg-evaluations: actual=${fundingTally.actual} fallback=${fundingTally.fallback} (fallback used pre-2025-04-29 where funding_history has no rows)`);

  await closePg();
  process.exit(0);
}

main().catch(e => { console.error('dominance-spread crashed:', e?.message ?? String(e)); process.exit(1); });

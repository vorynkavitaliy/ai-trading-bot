/**
 * cvd-confluence-overlay (OVERLAY C) — signal-level test of a CROSS-EXCHANGE
 * AGGREGATED-CVD CONFLUENCE FILTER on the LIVE fade book.
 *
 * Hypothesis: the fade is worse when it fights a strong order-flow trend. Drop
 *   fade-SHORT entries when CVD is strongly RISING (buyers in control) and drop
 *   fade-LONG entries when CVD is strongly FALLING (sellers in control). Keep the
 *   rest. Does the SURVIVING set of entries have a better fade forward-return on
 *   BOTH the IS (older) and OOS (recent) halves?
 *
 * Method (cheap, no engine):
 *   - Reconstruct each live pair's fade ENTRY events exactly as its strategy does:
 *       percentile of the pair's CG signal over the trailing 180×4h window
 *       (windowBars), side from pctHi/pctLo, then the SAME trend filters live uses.
 *       BTC  = lsTopPositionFade .85/.15, useBtcTrend  (pair trend off)
 *       SOL  = fundingFade       .70/.30, FundingFade defaults usePairTrend+useBtcTrend
 *       ADA  = fundingFade       .75/.25, same defaults
 *       LINK = fundingTaConfluence .70/.30 (funding+ls_top_account confluence), both trends
 *   - For each entry at bar i, FAVORABLE forward return = +fwdret if long, −fwdret if
 *       short (the fade "R proxy"; higher = the fade worked). fwd at 24h (6 bars) & 48h (12 bars).
 *   - CVD = cumulative (buy − sell) of cross-exchange aggregated taker volume
 *       (/futures/aggregated-taker-buy-sell-volume/history, Binance,OKX,Bybit, 4h).
 *       Order-flow trend strength at bar i = z-score of the 6-bar (24h) sum of
 *       per-bar normalized delta (buy−sell)/(buy+sell), trailing 30-bar window
 *       (same construction as xliq-edge cvdDelta_6barSum + z()). Positive z = buyers
 *       strongly in control; negative z = sellers strongly in control.
 *   - OVERLAY drops an entry when order flow strongly OPPOSES the fade:
 *       fade-SHORT dropped when zSlope >= +T ; fade-LONG dropped when zSlope <= −T.
 *   - Compare mean favorable fwd-return WITH vs WITHOUT the filter, split IS/OOS at
 *       the midpoint of CG-covered bars. Report n removed. Tests several thresholds.
 *
 * "Survives" only if the overlay improves mean favorable fwd-return on BOTH halves
 *   with adequate surviving n (and not by over-filtering to a tiny set).
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/cvd-confluence-overlay.ts
 */
import { cgGet } from '../../core/coinglass';
import { loadBars } from '../../data/candles';
import { close as closePg } from '../../core/db';
import { percentile, trendUp } from '../../core/indicators';
import { Bar } from '../../backtest/types';

const EX = 'Binance,OKX,Bybit';
const WINDOW = 180;          // percentile window (bars) — matches strategy windowBars
const EMA_FAST = 20, EMA_SLOW = 50;
const ZWIN = 30;             // trailing window for CVD-slope z-score (30 * 4h = 5d)
const CVD_SLOPE_BARS = 6;    // 24h order-flow trend
const THRESHOLDS = [0.5, 1.0, 1.5];   // z-score opposition thresholds to sweep

type Row = { ts: number; val: number };

// latest CG value at-or-before each bar ts (no look-ahead)
function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) {
    while (j < series.length && series[j].ts <= barTs[i]) j++;
    out[i] = j > 0 ? series[j - 1].val : null;
  }
  return out;
}

function emaSeries(values: number[], period: number): (number | null)[] {
  const N = values.length;
  const out: (number | null)[] = new Array(N).fill(null);
  if (N < period) return out;
  const k = 2 / (period + 1);
  let e = values[0];
  out[0] = e;
  for (let i = 1; i < N; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

async function loadCgSeries(table: string, col: string, keyCol: 'symbol' | 'pair', key: string): Promise<Row[]> {
  const { query } = await import('../../core/db');
  const exClause = keyCol === 'pair' ? `AND exchange='Binance'` : '';
  const { rows } = await query<any>(
    `SELECT ts, ${col}::text AS val FROM ${table} WHERE ${keyCol}=$1 ${exClause} ORDER BY ts ASC`, [key]);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val));
}

// aggregated taker from CG API -> map bar-open-ts -> {buy,sell}
async function fetchTaker(cgSym: string): Promise<Map<number, { buy: number; sell: number }>> {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history',
    { symbol: cgSym, exchange_list: EX, interval: '4h', limit: 4500 });
  const m = new Map<number, { buy: number; sell: number }>();
  for (const row of r.data || []) {
    m.set(Number(row.time), { buy: +row.aggregated_buy_volume_usd, sell: +row.aggregated_sell_volume_usd });
  }
  return m;
}

interface PairCfg {
  pair: string; cg: string;
  signal: 'ls_top_position' | 'funding' | 'confluence';
  pctHi: number; pctLo: number;
  usePairTrend: boolean; useBtcTrend: boolean;
}

// Mirrors live pair-strategies.ts. FundingFade overrides default usePairTrend+useBtcTrend=true
// (pair-strategies passes only pctHi/pctLo/sl/tp). FundingTaConfluence same.
const PAIRS: PairCfg[] = [
  { pair: 'BTCUSDT', cg: 'BTC', signal: 'ls_top_position', pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true },
  { pair: 'SOLUSDT', cg: 'SOL', signal: 'funding',         pctHi: 0.70, pctLo: 0.30, usePairTrend: true,  useBtcTrend: true },
  { pair: 'ADAUSDT', cg: 'ADA', signal: 'funding',         pctHi: 0.75, pctLo: 0.25, usePairTrend: true,  useBtcTrend: true },
  { pair: 'LINKUSDT', cg: 'LINK', signal: 'confluence',    pctHi: 0.70, pctLo: 0.30, usePairTrend: true,  useBtcTrend: true },
];

interface Entry { i: number; ts: number; side: 'long' | 'short'; fwd24: number | null; fwd48: number | null; zSlope: number | null; }

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }

async function main() {
  // BTC 4h closes for the BTC-trend filter (shared)
  const btcBars = await loadBars('BTCUSDT', '240m', { limit: 4500 });
  const btcTs = btcBars.map(b => b.ts);
  const btcClose = btcBars.map(b => b.close);
  const btcE20 = emaSeries(btcClose, EMA_FAST);
  const btcE50 = emaSeries(btcClose, EMA_SLOW);
  const btcUpByTs = new Map<number, boolean | null>();
  for (let i = 0; i < btcTs.length; i++) {
    btcUpByTs.set(btcTs[i], btcE20[i] != null && btcE50[i] != null ? btcE20[i]! > btcE50[i]! : null);
  }

  console.log(`\n══════ OVERLAY C — CVD CONFLUENCE FILTER on the live fade book ══════`);
  console.log(`CVD = cross-exchange aggregated cumulative (buy−sell), ${EX}, 4h.`);
  console.log(`Order-flow trend z = zscore(6-bar sum of normalized taker delta, trailing ${ZWIN}-bar).`);
  console.log(`Overlay drops fades that FIGHT strong flow: short dropped if zSlope>=+T, long dropped if zSlope<=−T.`);
  console.log(`FAVORABLE fwd-return = +ret(long) / −ret(short). Higher = fade worked. Split IS(older)/OOS(recent).\n`);

  for (const pc of PAIRS) {
    const bars = await loadBars(pc.pair, '240m', { limit: 4500 });
    if (bars.length < WINDOW + 60) { console.log(`${pc.pair}: too few bars (${bars.length}) — skip`); continue; }
    const barTs = bars.map(b => b.ts);
    const closeArr = bars.map(b => b.close);
    const N = bars.length;
    const e20 = emaSeries(closeArr, EMA_FAST);
    const e50 = emaSeries(closeArr, EMA_SLOW);

    // CG signal series for entry reconstruction
    let primary: (number | null)[];   // funding or ls_top_position
    let secondary: (number | null)[] | null = null;   // ls_top_account for confluence
    if (pc.signal === 'ls_top_position') {
      primary = alignLatest(barTs, await loadCgSeries('cg_ls_top_position', 'ratio', 'pair', pc.pair));
    } else {
      primary = alignLatest(barTs, await loadCgSeries('cg_funding_oi_weighted', 'fr_close', 'symbol', pc.cg));
      if (pc.signal === 'confluence') {
        secondary = alignLatest(barTs, await loadCgSeries('cg_ls_top_account', 'ratio', 'pair', pc.pair));
      }
    }

    // Aggregated taker -> CVD slope z aligned to bars
    const taker = await fetchTaker(pc.cg);
    const normDelta: (number | null)[] = barTs.map(t => {
      const tk = taker.get(t);
      if (!tk) return null;
      const s = tk.buy + tk.sell;
      return s > 0 ? (tk.buy - tk.sell) / s : null;
    });
    // 6-bar sum of normDelta (24h order-flow trend); null if any of the 6 missing
    const slope6: (number | null)[] = new Array(N).fill(null);
    for (let i = CVD_SLOPE_BARS - 1; i < N; i++) {
      let s = 0, ok = true;
      for (let k = i - CVD_SLOPE_BARS + 1; k <= i; k++) { const d = normDelta[k]; if (d == null) { ok = false; break; } s += d; }
      if (ok) slope6[i] = s;
    }
    // trailing z of slope6
    const zSlope: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i < N; i++) {
      if (slope6[i] == null) continue;
      const win: number[] = [];
      for (let k = Math.max(0, i - ZWIN); k < i; k++) if (slope6[k] != null) win.push(slope6[k]!);
      if (win.length < 10) continue;
      const m = mean(win);
      const sd = Math.sqrt(mean(win.map(v => (v - m) ** 2)));
      if (sd > 0) zSlope[i] = (slope6[i]! - m) / sd;
    }

    // forward favorable returns
    const fwdFav = (i: number, side: 'long' | 'short', K: number): number | null => {
      if (i + K >= N || closeArr[i] <= 0) return null;
      const r = (closeArr[i + K] - closeArr[i]) / closeArr[i];
      return side === 'long' ? r : -r;
    };

    // Reconstruct entries (decide at each bar close i; need full 180-bar trailing window)
    const entries: Entry[] = [];
    for (let i = WINDOW; i < N; i++) {
      const cur = primary[i];
      if (cur == null) continue;
      // trailing window of primary signal values, ending at i (inclusive — strategy uses
      // hist.slice(-windowBars) where the last element is the current value at decision time)
      const histRaw: number[] = [];
      for (let k = i - WINDOW + 1; k <= i; k++) if (primary[k] != null) histRaw.push(primary[k]!);
      if (histRaw.length < WINDOW) continue;
      const pct = percentile(histRaw, cur);

      let side: 'long' | 'short' | null = null;
      if (pc.signal === 'confluence') {
        const sec = secondary![i];
        if (sec == null) continue;
        const secRaw: number[] = [];
        for (let k = i - WINDOW + 1; k <= i; k++) if (secondary![k] != null) secRaw.push(secondary![k]!);
        if (secRaw.length < WINDOW) continue;
        const sPct = percentile(secRaw, sec);
        if (pct >= pc.pctHi && sPct >= pc.pctHi) side = 'short';
        else if (pct <= pc.pctLo && sPct <= pc.pctLo) side = 'long';
      } else {
        if (pct >= pc.pctHi) side = 'short';
        else if (pct <= pc.pctLo) side = 'long';
      }
      if (!side) continue;

      // trend filters (exactly as live strategy gates)
      if (pc.usePairTrend) {
        const up = e20[i] != null && e50[i] != null ? e20[i]! > e50[i]! : null;
        if (up == null) continue;
        if (side === 'short' && up) continue;
        if (side === 'long' && !up) continue;
      }
      if (pc.useBtcTrend) {
        const bUp = btcUpByTs.get(barTs[i]);
        if (bUp == null || bUp === undefined) continue;
        if (side === 'short' && bUp) continue;
        if (side === 'long' && !bUp) continue;
      }

      entries.push({ i, ts: barTs[i], side, fwd24: fwdFav(i, side, 6), fwd48: fwdFav(i, side, 12), zSlope: zSlope[i] });
    }

    // IS/OOS split at midpoint of entries (chronological)
    if (entries.length < 20) { console.log(`\n##### ${pc.pair}: only ${entries.length} reconstructed fade entries — skip\n`); continue; }
    const midTs = entries[Math.floor(entries.length / 2)].ts;
    const isE = entries.filter(e => e.ts < midTs);
    const oosE = entries.filter(e => e.ts >= midTs);

    const span = `${new Date(entries[0].ts).toISOString().slice(0, 10)} -> ${new Date(entries[entries.length - 1].ts).toISOString().slice(0, 10)}`;
    console.log(`\n##### ${pc.pair} (cg=${pc.cg}, ${pc.signal} ${pc.pctHi}/${pc.pctLo}, pairTrend=${pc.usePairTrend} btcTrend=${pc.useBtcTrend})`);
    console.log(`  entries=${entries.length} (${entries.filter(e => e.side === 'long').length}L/${entries.filter(e => e.side === 'short').length}S)  ${span}  IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
    const cvdCov = entries.filter(e => e.zSlope != null).length;
    console.log(`  CVD-slope coverage on entries: ${cvdCov}/${entries.length}`);

    // base metrics
    const baseStat = (es: Entry[], key: 'fwd24' | 'fwd48') => {
      const v = es.map(e => e[key]).filter((x): x is number => x != null);
      return { n: v.length, mean: mean(v) * 100, win: v.length ? v.filter(x => x > 0).length / v.length : NaN };
    };
    const bIS24 = baseStat(isE, 'fwd24'), bOOS24 = baseStat(oosE, 'fwd24');
    const bIS48 = baseStat(isE, 'fwd48'), bOOS48 = baseStat(oosE, 'fwd48');
    console.log(`  BASE  fwd24h favRet  IS ${bIS24.mean.toFixed(3)}% (n${bIS24.n}, WR${(bIS24.win * 100).toFixed(0)}%)  |  OOS ${bOOS24.mean.toFixed(3)}% (n${bOOS24.n}, WR${(bOOS24.win * 100).toFixed(0)}%)`);
    console.log(`  BASE  fwd48h favRet  IS ${bIS48.mean.toFixed(3)}% (n${bIS48.n})  |  OOS ${bOOS48.mean.toFixed(3)}% (n${bOOS48.n})`);

    // overlay: keep entry unless flow strongly opposes the fade.
    // opposes: short & zSlope >= +T (buyers control) -> DROP ;  long & zSlope <= −T (sellers control) -> DROP.
    // entries with null zSlope are KEPT (can't filter what we can't measure) — report separately.
    const keep = (e: Entry, T: number): boolean => {
      if (e.zSlope == null) return true;
      if (e.side === 'short' && e.zSlope >= T) return false;
      if (e.side === 'long' && e.zSlope <= -T) return false;
      return true;
    };

    console.log(`  ─ overlay sweep (favRet on SURVIVING entries; Δ vs base; both-halves lift?) ─`);
    for (const T of THRESHOLDS) {
      const kIS = isE.filter(e => keep(e, T)), kOOS = oosE.filter(e => keep(e, T));
      const dropIS = isE.filter(e => !keep(e, T)), dropOOS = oosE.filter(e => !keep(e, T));
      const removedIS = isE.length - kIS.length, removedOOS = oosE.length - kOOS.length;
      const oIS24 = baseStat(kIS, 'fwd24'), oOOS24 = baseStat(kOOS, 'fwd24');
      const oIS48 = baseStat(kIS, 'fwd48'), oOOS48 = baseStat(kOOS, 'fwd48');
      // dropped-set favRet (the entries the filter throws away — should be worse if filter is real)
      const dIS24 = baseStat(dropIS, 'fwd24'), dOOS24 = baseStat(dropOOS, 'fwd24');
      const d = (a: number, b: number) => (a - b >= 0 ? '+' : '') + (a - b).toFixed(3);
      const lift24 = oIS24.mean > bIS24.mean && oOOS24.mean > bOOS24.mean;
      const lift48 = oIS48.mean > bIS48.mean && oOOS48.mean > bOOS48.mean;
      console.log(
        `   T=${T.toFixed(1)} removed IS ${removedIS}/${isE.length} OOS ${removedOOS}/${oosE.length}` +
        `  | 24h IS ${oIS24.mean.toFixed(3)}% (${d(oIS24.mean, bIS24.mean)}) OOS ${oOOS24.mean.toFixed(3)}% (${d(oOOS24.mean, bOOS24.mean)}) ${lift24 ? 'BOTH↑24' : ''}` +
        `  | 48h IS ${oIS48.mean.toFixed(3)}% (${d(oIS48.mean, bIS48.mean)}) OOS ${oOOS48.mean.toFixed(3)}% (${d(oOOS48.mean, bOOS48.mean)}) ${lift48 ? 'BOTH↑48' : ''}` +
        `  | DROPPED 24h favRet IS ${isFinite(dIS24.mean) ? dIS24.mean.toFixed(3) : 'NaN'}% OOS ${isFinite(dOOS24.mean) ? dOOS24.mean.toFixed(3) : 'NaN'}%`,
      );
    }

    // CONTROL: inverted overlay — drop fades that AGREE with flow (keep the flow-fighters).
    // If the CVD filter is real, this should HURT on both halves (mirror image of the lift).
    const keepInv = (e: Entry, T: number): boolean => {
      if (e.zSlope == null) return true;
      if (e.side === 'short' && e.zSlope <= -T) return false;  // drop short when sellers already dumping (flow agrees)
      if (e.side === 'long' && e.zSlope >= T) return false;    // drop long when buyers already lifting (flow agrees)
      return true;
    };
    console.log(`  ─ CONTROL inverted overlay (drop FLOW-AGREEING fades — expect this to HURT if filter is real) ─`);
    {
      const T = 1.0;
      const kIS = isE.filter(e => keepInv(e, T)), kOOS = oosE.filter(e => keepInv(e, T));
      const oIS24 = baseStat(kIS, 'fwd24'), oOOS24 = baseStat(kOOS, 'fwd24');
      const d = (a: number, b: number) => (a - b >= 0 ? '+' : '') + (a - b).toFixed(3);
      console.log(`   T=1.0 inv: 24h IS ${oIS24.mean.toFixed(3)}% (${d(oIS24.mean, bIS24.mean)}) OOS ${oOOS24.mean.toFixed(3)}% (${d(oOOS24.mean, bOOS24.mean)})  removed IS ${isE.length - kIS.length} OOS ${oosE.length - kOOS.length}`);
    }

    // QUARTILE robustness (T=1.0): is the lift carried by one regime window, or present
    // in every chronological quarter? A real overlay should lift most/all quarters.
    {
      const T = 1.0;
      const q = Math.floor(entries.length / 4);
      console.log(`  ─ quartile robustness (T=1.0, fwd24h favRet base→overlay; Δ) ─`);
      const parts: string[] = [];
      for (let qi = 0; qi < 4; qi++) {
        const lo = qi * q, hi = qi === 3 ? entries.length : (qi + 1) * q;
        const seg = entries.slice(lo, hi);
        const b = baseStat(seg, 'fwd24');
        const o = baseStat(seg.filter(e => keep(e, T)), 'fwd24');
        const dlt = o.mean - b.mean;
        parts.push(`Q${qi + 1}[${new Date(seg[0].ts).toISOString().slice(2, 7)}] ${b.mean.toFixed(2)}→${o.mean.toFixed(2)}(${dlt >= 0 ? '+' : ''}${dlt.toFixed(2)})`);
      }
      console.log(`   ${parts.join('  ')}`);
    }
  }

  console.log(`\n(BOTH↑ flag = overlay improves favorable fwd-return on IS AND OOS at that horizon. Anything else = not a survivor.)`);
  await closePg();
}

main().catch(async e => { console.error('crashed', e?.message ?? String(e)); try { await closePg(); } catch {} process.exit(1); });

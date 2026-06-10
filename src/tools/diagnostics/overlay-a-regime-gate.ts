/**
 * overlay-a-regime-gate — OVERLAY A test: does TIGHTENING the regime gate beyond what
 * the live fade config already does (useBtcTrend / usePairTrend) improve the per-entry
 * forward return on BOTH the IS (older) and OOS (recent) halves?
 *
 * Method (signal-level, no full engine):
 *   - Reconstruct the strategy's entry events exactly: percentile of the pair's CG signal
 *     over the trailing 180×4h window (same as cg-fade.ts), SHORT if pct>=pctHi, LONG if
 *     pct<=pctLo. Apply the pair's CURRENT trend filters (usePairTrend / useBtcTrend) — this
 *     is the BASE entry set.
 *   - Forward return signed by side (LONG: +ret, SHORT: -ret) so positive = fade worked.
 *     Measured at +24h (6 bars) and +48h (12 bars).
 *   - Overlay variants ADD or TIGHTEN a regime gate on top of base, and we compare the
 *     surviving entries' mean signed fwd-return + win-rate, split IS / OOS.
 *
 * An overlay "survives" only if mean signed fwd-return improves vs base on BOTH halves
 * AND it keeps a reasonable number of entries (n>=15/half — below that it's noise).
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/overlay-a-regime-gate.ts
 */
import { query, close as closePg } from '../../core/db';

type Row = { ts: number; val: number };

function alignLatest(barTs: number[], series: Row[]): (number | null)[] {
  const out: (number | null)[] = new Array(barTs.length).fill(null);
  let j = 0;
  for (let i = 0; i < barTs.length; i++) {
    while (j < series.length && series[j].ts <= barTs[i]) j++;
    out[i] = j > 0 ? series[j - 1].val : null;
  }
  return out;
}

async function loadSeries(sql: string, params: any[]): Promise<Row[]> {
  const { rows } = await query<any>(sql, params);
  return rows.map((r: any) => ({ ts: Number(r.ts), val: parseFloat(r.val) })).filter(r => isFinite(r.val)).sort((a, b) => a.ts - b.ts);
}

// Rolling percentile of value v within window — matches core/indicators.percentile()
// EXACTLY: fraction of window at-or-below v (<=).
function pctOf(window: number[], v: number): number {
  let cnt = 0;
  for (const w of window) if (w <= v) cnt++;
  return cnt / window.length;
}

function emaSeries(values: number[], period: number): (number | null)[] {
  const N = values.length;
  const out: (number | null)[] = new Array(N).fill(null);
  if (N < period) return out;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  out[period - 1] = e;
  for (let i = period; i < N; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

// Wilder ADX(14)
function computeADX(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  const N = high.length;
  const out: (number | null)[] = new Array(N).fill(null);
  if (N < period * 2) return out;
  const tr: number[] = new Array(N).fill(0);
  const plusDM: number[] = new Array(N).fill(0);
  const minusDM: number[] = new Array(N).fill(0);
  for (let i = 1; i < N; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  let atr = 0, sPlus = 0, sMinus = 0;
  for (let i = 1; i <= period; i++) { atr += tr[i]; sPlus += plusDM[i]; sMinus += minusDM[i]; }
  const dxArr: number[] = [];
  const dxIdx: number[] = [];
  for (let i = period + 1; i < N; i++) {
    atr = atr - atr / period + tr[i];
    sPlus = sPlus - sPlus / period + plusDM[i];
    sMinus = sMinus - sMinus / period + minusDM[i];
    if (atr === 0) continue;
    const pdi = 100 * sPlus / atr;
    const mdi = 100 * sMinus / atr;
    const denom = pdi + mdi;
    const dx = denom === 0 ? 0 : 100 * Math.abs(pdi - mdi) / denom;
    dxArr.push(dx);
    dxIdx.push(i);
  }
  if (dxArr.length < period) return out;
  let adx = 0;
  for (let k = 0; k < period; k++) adx += dxArr[k];
  adx /= period;
  out[dxIdx[period - 1]] = adx;
  for (let k = period; k < dxArr.length; k++) {
    adx = (adx * (period - 1) + dxArr[k]) / period;
    out[dxIdx[k]] = adx;
  }
  return out;
}

type SigKind = 'funding_oi' | 'ls_top_position' | 'funding_ta_confluence';

interface PairCfg {
  pair: string;
  label: string;          // BTC/SOL/ADA/LINK/ETH/XRP
  kind: SigKind;
  pctHi: number;
  pctLo: number;
  usePairTrend: boolean;
  useBtcTrend: boolean;
  emaFast: number;
  emaSlow: number;
  windowBars: number;
}

// Mirror of live pair-strategies.ts + the two candidates (ETH/XRP). Trend-filter
// defaults come from cg-fade.ts factory defaultOverrides.
const PAIRS: PairCfg[] = [
  // BTC: lsTopPositionFade .85/.15, usePairTrend:false, useBtcTrend:true
  { pair: 'BTCUSDT', label: 'BTC', kind: 'ls_top_position', pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, emaFast: 20, emaSlow: 50, windowBars: 180 },
  // SOL: fundingFade .70/.30 — FundingFade defaults usePairTrend:true useBtcTrend:true
  { pair: 'SOLUSDT', label: 'SOL', kind: 'funding_oi', pctHi: 0.70, pctLo: 0.30, usePairTrend: true, useBtcTrend: true, emaFast: 20, emaSlow: 50, windowBars: 180 },
  // ADA: fundingFade .75/.25 — same trend defaults
  { pair: 'ADAUSDT', label: 'ADA', kind: 'funding_oi', pctHi: 0.75, pctLo: 0.25, usePairTrend: true, useBtcTrend: true, emaFast: 20, emaSlow: 50, windowBars: 180 },
  // LINK: fundingTaConfluence .70/.30 — defaults usePairTrend:true useBtcTrend:true
  { pair: 'LINKUSDT', label: 'LINK', kind: 'funding_ta_confluence', pctHi: 0.70, pctLo: 0.30, usePairTrend: true, useBtcTrend: true, emaFast: 20, emaSlow: 50, windowBars: 180 },
  // ETH candidate: lsTopPositionFade .85/.15 usePairTrend:true useBtcTrend:false (archived config)
  { pair: 'ETHUSDT', label: 'ETH', kind: 'ls_top_position', pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, emaFast: 20, emaSlow: 50, windowBars: 180 },
  // XRP candidate: fundingTaConfluence .70/.30 (archived config; confluence defaults trend true/true)
  { pair: 'XRPUSDT', label: 'XRP', kind: 'funding_ta_confluence', pctHi: 0.70, pctLo: 0.30, usePairTrend: true, useBtcTrend: true, emaFast: 20, emaSlow: 50, windowBars: 180 },
];

interface Entry {
  i: number;
  ts: number;
  side: 'long' | 'short';
  isHalf: boolean;
  fwd24: number | null;   // signed (positive = fade worked)
  fwd48: number | null;
  // regime context at entry
  btcUp: boolean | null;   // BTC 4h EMA20>EMA50
  pairUp: boolean | null;  // pair 4h EMA20>EMA50
  adx: number | null;      // pair ADX(14)
}

function stats(vals: number[]): { n: number; mean: number; wr: number } {
  const n = vals.length;
  if (n === 0) return { n: 0, mean: NaN, wr: NaN };
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  const wr = vals.filter(v => v > 0).length / n;
  return { n, mean, wr };
}

function fmtPct(x: number): string {
  return isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '  NaN';
}
function fmtWr(x: number): string {
  return isFinite(x) ? (x * 100).toFixed(0) + '%' : '--';
}

async function main() {
  // BTC 4h trend (shared)
  const btcCndl = await query<any>(`SELECT ts, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts ASC`, []);
  const btcTs = btcCndl.rows.map((r: any) => Number(r.ts));
  const btcClose = btcCndl.rows.map((r: any) => parseFloat(r.close));
  const btcEma20 = emaSeries(btcClose, 20);
  const btcEma50 = emaSeries(btcClose, 50);
  const btcUpByTs = new Map<number, boolean | null>();
  for (let i = 0; i < btcTs.length; i++) {
    const e20 = btcEma20[i], e50 = btcEma50[i];
    btcUpByTs.set(btcTs[i], e20 != null && e50 != null ? e20 > e50 : null);
  }

  for (const cfg of PAIRS) {
    const coin = cfg.pair.replace(/USDT$/, '');
    const cndl = await query<any>(`SELECT ts, high::text, low::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [cfg.pair]);
    const barTs = cndl.rows.map((r: any) => Number(r.ts));
    const high = cndl.rows.map((r: any) => parseFloat(r.high));
    const low = cndl.rows.map((r: any) => parseFloat(r.low));
    const close = cndl.rows.map((r: any) => parseFloat(r.close));
    const N = barTs.length;
    if (N < 250) { console.log(`\n### ${cfg.label} (${cfg.pair}) — insufficient candles (${N})`); continue; }

    // pair trend
    const pEma20 = emaSeries(close, cfg.emaFast);
    const pEma50 = emaSeries(close, cfg.emaSlow);
    const pairUp: (boolean | null)[] = barTs.map((_, i) => pEma20[i] != null && pEma50[i] != null ? pEma20[i]! > pEma50[i]! : null);
    const adx = computeADX(high, low, close, 14);
    const btcUp: (boolean | null)[] = barTs.map(t => btcUpByTs.has(t) ? btcUpByTs.get(t)! : null);

    // CG signal series aligned to bars
    let primary: (number | null)[];
    let secondary: (number | null)[] | null = null; // for confluence
    if (cfg.kind === 'funding_oi') {
      const fr = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
      primary = alignLatest(barTs, fr);
    } else if (cfg.kind === 'ls_top_position') {
      const lp = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_position WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [cfg.pair]);
      primary = alignLatest(barTs, lp);
    } else {
      // confluence: funding_oi AND ls_top_account both extreme same side
      const fr = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
      const la = await loadSeries(`SELECT ts, ratio::text AS val FROM cg_ls_top_account WHERE pair=$1 AND exchange='Binance' ORDER BY ts`, [cfg.pair]);
      primary = alignLatest(barTs, fr);
      secondary = alignLatest(barTs, la);
    }

    // forward returns
    const fwd = (i: number, K: number): number | null => (i + K < N && close[i] > 0) ? (close[i + K] - close[i]) / close[i] : null;

    // IS/OOS split at midpoint of bars with CG data
    const cgIdx = barTs.map((_, i) => i).filter(i => primary[i] != null);
    if (cgIdx.length < 100) { console.log(`\n### ${cfg.label} (${cfg.pair}) — insufficient CG coverage (${cgIdx.length})`); continue; }
    const midTs = barTs[cgIdx[Math.floor(cgIdx.length / 2)]];

    // Reconstruct entries with the BASE (current) trend filters applied
    const entries: Entry[] = [];
    const W = cfg.windowBars;
    for (let i = W; i < N; i++) {
      const cur = primary[i];
      if (cur == null) continue;
      // build trailing window of non-null primary values
      const win: number[] = [];
      for (let k = i - W; k < i; k++) { const v = primary[k]; if (v != null) win.push(v); }
      if (win.length < W * 0.8) continue;
      const pctP = pctOf(win, cur);

      let side: 'long' | 'short' | null = null;
      if (cfg.kind === 'funding_ta_confluence') {
        const curS = secondary![i];
        if (curS == null) continue;
        const winS: number[] = [];
        for (let k = i - W; k < i; k++) { const v = secondary![k]; if (v != null) winS.push(v); }
        if (winS.length < W * 0.8) continue;
        const pctS = pctOf(winS, curS);
        if (pctP >= cfg.pctHi && pctS >= cfg.pctHi) side = 'short';
        else if (pctP <= cfg.pctLo && pctS <= cfg.pctLo) side = 'long';
      } else {
        if (pctP >= cfg.pctHi) side = 'short';
        else if (pctP <= cfg.pctLo) side = 'long';
      }
      if (!side) continue;

      // BASE trend filter (current live behaviour)
      if (cfg.usePairTrend) {
        const up = pairUp[i];
        if (up == null) continue;
        if (side === 'short' && up) continue;
        if (side === 'long' && !up) continue;
      }
      if (cfg.useBtcTrend) {
        const up = btcUp[i];
        if (up == null) continue;
        if (side === 'short' && up) continue;
        if (side === 'long' && !up) continue;
      }

      const r24 = fwd(i, 6), r48 = fwd(i, 12);
      const sgn = side === 'long' ? 1 : -1;
      entries.push({
        i, ts: barTs[i], side, isHalf: barTs[i] < midTs,
        fwd24: r24 == null ? null : sgn * r24,
        fwd48: r48 == null ? null : sgn * r48,
        btcUp: btcUp[i], pairUp: pairUp[i], adx: adx[i],
      });
    }

    // Overlay variants. Each is a predicate on an entry that further restricts the base set.
    // 'BASE' keeps all entries. Others add/tighten regime conditions.
    const overlays: { name: string; keep: (e: Entry) => boolean }[] = [
      { name: 'BASE (live filters)', keep: () => true },
      // O1: require BTC-DOWN for SHORT side specifically (already implied if useBtcTrend, but
      //     for BTC/SOL/ADA/LINK useBtcTrend=true so this is a no-op there; for ETH it ADDS).
      { name: 'O1 short→BTC-down', keep: (e) => e.side === 'long' ? true : e.btcUp === false },
      // O2: require BTC-DOWN for SHORT *and* BTC-UP for LONG (full BTC gate). No-op where useBtcTrend.
      { name: 'O2 full BTC gate', keep: (e) => e.side === 'short' ? e.btcUp === false : e.btcUp === true },
      // O3: double gate — pair-trend AND btc-trend aligned with fade side (on top of base).
      { name: 'O3 pair+btc double', keep: (e) => {
          const pairOk = e.side === 'short' ? e.pairUp === false : e.pairUp === true;
          const btcOk = e.side === 'short' ? e.btcUp === false : e.btcUp === true;
          return pairOk && btcOk;
        } },
      // O4: SHORT-only require BTC-DOWN (regime-finding said edge concentrates BTC-DOWN);
      //     drop SHORTs taken in BTC-up (only relevant where useBtcTrend=false, i.e. ETH).
      { name: 'O4 drop short in BTC-up', keep: (e) => !(e.side === 'short' && e.btcUp === true) },
      // O5: ranging-only (ADX<20) — fade should be stronger in ranging.
      { name: 'O5 ADX<20 ranging', keep: (e) => e.adx != null && e.adx < 20 },
      // O6: avoid strong trend (ADX<25) — drop only high-ADX bars.
      { name: 'O6 ADX<25', keep: (e) => e.adx != null && e.adx < 25 },
    ];

    console.log(`\n══════ ${cfg.label} (${cfg.pair}) ══════  kind=${cfg.kind} ${cfg.pctHi}/${cfg.pctLo} pairTrend=${cfg.usePairTrend} btcTrend=${cfg.useBtcTrend}`);
    console.log(`base entries=${entries.length}  IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS  (signed fwd-ret: + = fade worked)`);
    console.log('overlay'.padEnd(24) + ' │ IS  n  mean24   wr   mean48  │ OOS n  mean24   wr   mean48  │ both-halves lift?');
    console.log('─'.repeat(110));

    // base stats for comparison
    const baseIS24 = stats(entries.filter(e => e.isHalf && e.fwd24 != null).map(e => e.fwd24!));
    const baseOOS24 = stats(entries.filter(e => !e.isHalf && e.fwd24 != null).map(e => e.fwd24!));

    for (const ov of overlays) {
      const kept = entries.filter(ov.keep);
      const is24 = stats(kept.filter(e => e.isHalf && e.fwd24 != null).map(e => e.fwd24!));
      const oos24 = stats(kept.filter(e => !e.isHalf && e.fwd24 != null).map(e => e.fwd24!));
      const is48 = stats(kept.filter(e => e.isHalf && e.fwd48 != null).map(e => e.fwd48!));
      const oos48 = stats(kept.filter(e => !e.isHalf && e.fwd48 != null).map(e => e.fwd48!));

      let verdict = '';
      if (ov.name.startsWith('BASE')) {
        verdict = '(reference)';
      } else {
        const liftIS = isFinite(is24.mean) && isFinite(baseIS24.mean) ? is24.mean - baseIS24.mean : NaN;
        const liftOOS = isFinite(oos24.mean) && isFinite(baseOOS24.mean) ? oos24.mean - baseOOS24.mean : NaN;
        const enoughN = is24.n >= 15 && oos24.n >= 15;
        if (!enoughN) verdict = 'thin-n';
        else if (isFinite(liftIS) && isFinite(liftOOS) && liftIS > 0 && liftOOS > 0) {
          verdict = `✓ LIFT both (IS ${fmtPct(liftIS)} / OOS ${fmtPct(liftOOS)})`;
        } else if (isFinite(liftIS) && isFinite(liftOOS) && (liftIS > 0 || liftOOS > 0)) {
          verdict = `~one-half (IS ${fmtPct(liftIS)} / OOS ${fmtPct(liftOOS)})`;
        } else {
          verdict = `no lift (IS ${fmtPct(liftIS)} / OOS ${fmtPct(liftOOS)})`;
        }
      }

      console.log(
        ov.name.padEnd(24) + ' │ ' +
        String(is24.n).padStart(3) + ' ' + fmtPct(is24.mean).padStart(7) + ' ' + fmtWr(is24.wr).padStart(4) + ' ' + fmtPct(is48.mean).padStart(7) + ' │ ' +
        String(oos24.n).padStart(3) + ' ' + fmtPct(oos24.mean).padStart(7) + ' ' + fmtWr(oos24.wr).padStart(4) + ' ' + fmtPct(oos48.mean).padStart(7) + ' │ ' +
        verdict,
      );
    }

    // Per-side breakdown for the strongest non-BTC-gate refinement (ADX<25) and the BTC gate,
    // so a both-halves lift can be checked for long/short balance (robustness, not one-sided).
    const sideBreak = (label: string, keep: (e: Entry) => boolean) => {
      for (const sd of ['long', 'short'] as const) {
        const k = entries.filter(e => e.side === sd && keep(e));
        const is = stats(k.filter(e => e.isHalf && e.fwd24 != null).map(e => e.fwd24!));
        const oos = stats(k.filter(e => !e.isHalf && e.fwd24 != null).map(e => e.fwd24!));
        console.log(`   ${label} ${sd.padEnd(5)} │ IS ${String(is.n).padStart(3)} ${fmtPct(is.mean).padStart(7)} ${fmtWr(is.wr).padStart(4)} │ OOS ${String(oos.n).padStart(3)} ${fmtPct(oos.mean).padStart(7)} ${fmtWr(oos.wr).padStart(4)}`);
      }
    };
    sideBreak('BASE  ', () => true);
    sideBreak('ADX<25', (e) => e.adx != null && e.adx < 25);

    // Quantify what useBtcTrend ALREADY removes: rebuild entries WITHOUT the base BTC gate
    // (keep pair-trend + percentile), so we can see how many BTC-counter-trend entries the
    // live config already drops, and whether those dropped entries were actually bad (which
    // is what the regime-finding claims). This proves "already captured" with magnitude.
    if (cfg.useBtcTrend) {
      let nWithBtc = 0, nNoBtc = 0;
      let sumDroppedIS = 0, nDroppedIS = 0, sumDroppedOOS = 0, nDroppedOOS = 0;
      for (let i = W; i < N; i++) {
        const cur = primary[i];
        if (cur == null) continue;
        const win: number[] = [];
        for (let k = i - W; k < i; k++) { const v = primary[k]; if (v != null) win.push(v); }
        if (win.length < W * 0.8) continue;
        const pctP = pctOf(win, cur);
        let side: 'long' | 'short' | null = null;
        if (cfg.kind === 'funding_ta_confluence') {
          const curS = secondary![i]; if (curS == null) continue;
          const winS: number[] = [];
          for (let k = i - W; k < i; k++) { const v = secondary![k]; if (v != null) winS.push(v); }
          if (winS.length < W * 0.8) continue;
          const pctS = pctOf(winS, curS);
          if (pctP >= cfg.pctHi && pctS >= cfg.pctHi) side = 'short';
          else if (pctP <= cfg.pctLo && pctS <= cfg.pctLo) side = 'long';
        } else {
          if (pctP >= cfg.pctHi) side = 'short';
          else if (pctP <= cfg.pctLo) side = 'long';
        }
        if (!side) continue;
        if (cfg.usePairTrend) {
          const up = pairUp[i]; if (up == null) continue;
          if (side === 'short' && up) continue;
          if (side === 'long' && !up) continue;
        }
        const bu = btcUp[i]; if (bu == null) continue;
        nNoBtc++;
        const passesBtc = side === 'short' ? bu === false : bu === true;
        if (passesBtc) { nWithBtc++; }
        else {
          // this entry is DROPPED by the live BTC gate — was it a bad entry?
          const sgn = side === 'long' ? 1 : -1;
          const r = fwd(i, 6);
          if (r != null) {
            if (barTs[i] < midTs) { sumDroppedIS += sgn * r; nDroppedIS++; }
            else { sumDroppedOOS += sgn * r; nDroppedOOS++; }
          }
        }
      }
      const dIS = nDroppedIS ? sumDroppedIS / nDroppedIS : NaN;
      const dOOS = nDroppedOOS ? sumDroppedOOS / nDroppedOOS : NaN;
      console.log(`   [btc-gate audit] no-gate entries=${nNoBtc} → live keeps ${nWithBtc} (drops ${nNoBtc - nWithBtc}). DROPPED entries' signed fwd24: IS ${fmtPct(dIS)} (n${nDroppedIS}) / OOS ${fmtPct(dOOS)} (n${nDroppedOOS})  [negative ⇒ gate correctly removed losers]`);
    }
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

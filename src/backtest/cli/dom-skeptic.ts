/**
 * dom-skeptic — adversarial refutation of the BTC-dominance LEVEL -> BTC-vs-alt
 * relative-return edge. The sweep (macro-dom-rel-stress.ts) claimed:
 *   IC -0.149/-0.362 IS/OOS at 9d, OOS quintile spread -6.5%, 4/4 quarters negative.
 * This CLI tries to REFUTE that as an artifact via four attacks:
 *
 *   1. OVERLAP INFLATION  — a 9d-hold daily signal => ~9x overlapping windows => IC
 *      t-stats inflated. Re-derive IC + quintile spread on NON-OVERLAPPING 9d blocks.
 *   2. EPISODE CONCENTRATION — how much of the OOS spread is a few big rebalances?
 *      Rank the non-overlapping-block relative returns by |signed contribution|, drop
 *      the top-3 episodes, recompute spread.
 *   3. SURVIVORSHIP — re-run with a FIXED always-listed basket (ETH, XRP, LTC only).
 *   4. SIGN STABILITY — IC per INDEPENDENT (non-overlapping-block) quarter.
 *
 * Data path mirrors the original claim EXACTLY:
 *   - dominance LEVEL: CG /index/bitcoin-dominance (raw level, percentile-ranked over a
 *     trailing window for the quintile/spread test; raw level for Spearman IC).
 *   - prices: candles table tf='1D' (UTC daily close), the same table the sweep used.
 *   - relative return = btcRet(H) - meanAltRet(H)  (BTC-minus-alt; NEGATIVE IC means
 *     high dominance -> BTC underperforms alts, i.e. rel return falls).
 *   - H = 9 days.
 *
 * Costs are irrelevant to an IC/spread attack on the SIGNAL itself, so this CLI reports
 * raw relative returns (the signal's predictive content); a separate P&L backtest
 * (dominance-spread.ts) handles fee/slip/funding net economics.
 *
 * Read-only. Usage: npx tsx src/backtest/cli/dom-skeptic.ts [H=9] [pctWindow=90]
 */
import { cgGet } from '../../core/coinglass';
import { query, close as closePg } from '../../core/db';

const H = process.argv[2] != null ? parseInt(process.argv[2], 10) : 9;
const PCT_WINDOW = process.argv[3] != null ? parseInt(process.argv[3], 10) : 90; // trailing days for dom percentile
const DAY = 86_400_000;

// Full ("broad") basket the sweep used, and the fixed always-listed deep basket.
const ALT_BROAD = ['ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','ADAUSDT','LINKUSDT','LTCUSDT','ATOMUSDT','ARBUSDT','INJUSDT'];
const ALT_FIXED = ['ETHUSDT','XRPUSDT','LTCUSDT']; // oldest, always-listed
const WIN_START = Date.parse('2024-05-25T00:00:00Z');

function dayKey(t: number): number { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

async function loadDailyCloses(symbol: string): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts, close FROM candles WHERE symbol=$1 AND tf='1D' ORDER BY ts ASC`, [symbol]);
  const m = new Map<number, number>();
  for (const row of r.rows) m.set(dayKey(Number(row.ts)), parseFloat(row.close));
  return m;
}

// ---- stats ----
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}
function spearman(x: number[], y: number[]): number {
  const n = x.length; if (n < 8) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n).fill(0); let i = 0;
    while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}
// Spearman t-stat under the (over-stated for overlapping data) iid assumption.
function icTstat(ic: number, n: number): number {
  if (!Number.isFinite(ic) || n < 4 || Math.abs(ic) >= 1) return NaN;
  return ic * Math.sqrt((n - 2) / (1 - ic * ic));
}

// ---- one aligned observation ----
interface Obs {
  ts: number;       // signal date (epoch ms, UTC midnight)
  domLvl: number;   // raw dominance level
  domPct: number;   // percentile rank of dom over trailing PCT_WINDOW (NaN if insufficient)
  rel: number;      // btcRet(H) - meanAltRet(H)
}

function buildObs(rows: { ts: number; dom: number }[], btc: Map<number, number>, alts: Map<number, number>[]): Obs[] {
  const out: Obs[] = [];
  // dominance percentile needs a trailing history of dom levels keyed by day
  const domByDay = new Map<number, number>();
  for (const r of rows) domByDay.set(dayKey(r.ts), r.dom);
  for (let i = 0; i < rows.length; i++) {
    const k0 = dayKey(rows[i].ts);
    const b0 = btc.get(k0), b1 = btc.get(k0 + H * DAY);
    if (b0 === undefined || b1 === undefined || b0 <= 0) continue;
    const btcRet = b1 / b0 - 1;
    const ar: number[] = [];
    for (const m of alts) { const a0 = m.get(k0), a1 = m.get(k0 + H * DAY); if (a0 !== undefined && a1 !== undefined && a0 > 0) ar.push(a1 / a0 - 1); }
    if (ar.length < Math.min(3, alts.length)) continue;
    const altMean = mean(ar);
    // trailing percentile of dom level over PCT_WINDOW prior days
    const histVals: number[] = [];
    for (let d = 1; d <= PCT_WINDOW; d++) { const v = domByDay.get(k0 - d * DAY); if (v !== undefined) histVals.push(v); }
    let pct = NaN;
    if (histVals.length >= Math.min(20, PCT_WINDOW)) {
      let le = 0; for (const h of histVals) if (h <= rows[i].dom) le++;
      pct = le / histVals.length;
    }
    out.push({ ts: rows[i].ts, domLvl: rows[i].dom, domPct: pct, rel: btcRet - altMean });
  }
  return out;
}

// quintile spread: mean rel in top-quintile-dom minus mean rel in bottom-quintile-dom,
// using the RAW dominance level for ranking (matches "high dominance -> BTC under-performs").
// Returns spread (top-bottom). For BTC-minus-alt rel and a TRUE edge this is NEGATIVE.
function quintileSpread(obs: Obs[]): { spread: number; nTop: number; nBot: number; topMean: number; botMean: number } {
  const sorted = [...obs].sort((a, b) => a.domLvl - b.domLvl);
  const q = Math.max(1, Math.floor(sorted.length / 5));
  const bot = sorted.slice(0, q);          // lowest dominance
  const top = sorted.slice(sorted.length - q); // highest dominance
  const topMean = mean(top.map(o => o.rel));
  const botMean = mean(bot.map(o => o.rel));
  return { spread: topMean - botMean, nTop: top.length, nBot: bot.length, topMean, botMean };
}

// Non-overlapping 9d blocks: walk the day index in strides of H, taking the FIRST
// eligible observation in each stride (>= startOffset days into the window). Guarantees
// disjoint [k0, k0+H) holding windows. startOffset lets us prove the result is not a
// fluke of where the stride grid begins.
function nonOverlapping(obs: Obs[], startOffsetDays = 0): Obs[] {
  if (obs.length === 0) return [];
  const sorted = [...obs].sort((a, b) => a.ts - b.ts);
  const out: Obs[] = [];
  let nextEligible = dayKey(sorted[0].ts) + startOffsetDays * DAY;
  for (const o of sorted) {
    if (dayKey(o.ts) >= nextEligible) { out.push(o); nextEligible = dayKey(o.ts) + H * DAY; }
  }
  return out;
}

function midSplit<T>(arr: T[]): { is: T[]; oos: T[] } {
  const mid = Math.floor(arr.length / 2);
  return { is: arr.slice(0, mid), oos: arr.slice(mid) };
}

function pctf(n: number, d = 2): string { return (n * 100).toFixed(d) + '%'; }

async function main() {
  console.log('=== dom-skeptic: adversarial refutation of dominance->relative edge ===');
  console.log(`H=${H}d  pctWindow=${PCT_WINDOW}d  rel = btcRet(H) - meanAltRet(H)  (NEG IC = high-dom -> BTC underperforms)`);
  console.log(`window from ${new Date(WIN_START).toISOString().slice(0,10)} (mirrors the original sweep's 1D-candle window)\n`);

  // load data
  const dom = await cgGet<any>('/index/bitcoin-dominance', {});
  const domRows = (dom.data as any[]).map((r) => ({ ts: Number(r.timestamp), dom: Number(r.bitcoin_dominance) }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.dom) && r.ts >= WIN_START - PCT_WINDOW * DAY)
    .sort((a, b) => a.ts - b.ts);
  const btc = await loadDailyCloses('BTCUSDT');
  const broadMaps = await Promise.all(ALT_BROAD.map(loadDailyCloses));
  const fixedMaps = await Promise.all(ALT_FIXED.map(loadDailyCloses));

  // restrict signal dates to >= WIN_START (the warmup history is loaded above but not traded)
  const domRowsTraded = domRows.filter(r => r.ts >= WIN_START);

  const obsBroad = buildObs(domRowsTraded, btc, broadMaps);
  const obsFixed = buildObs(domRowsTraded, btc, fixedMaps);

  // ================= BASELINE (overlapping, broad basket) — reproduce the claim =================
  console.log('========== BASELINE (overlapping daily, broad 10-alt basket) ==========');
  const baseIc = spearman(obsBroad.map(o => o.domLvl), obsBroad.map(o => o.rel));
  const baseSplit = midSplit(obsBroad);
  const baseIcIs = spearman(baseSplit.is.map(o => o.domLvl), baseSplit.is.map(o => o.rel));
  const baseIcOos = spearman(baseSplit.oos.map(o => o.domLvl), baseSplit.oos.map(o => o.rel));
  const baseQ = quintileSpread(obsBroad);
  const baseQoos = quintileSpread(baseSplit.oos);
  console.log(`  n(overlapping)=${obsBroad.length}`);
  console.log(`  IC all=${baseIc.toFixed(3)} (t=${icTstat(baseIc, obsBroad.length).toFixed(2)} naive)  IS=${baseIcIs.toFixed(3)}  OOS=${baseIcOos.toFixed(3)}`);
  console.log(`  quintile spread (top-dom minus bot-dom rel): ALL=${pctf(baseQ.spread)}  OOS=${pctf(baseQoos.spread)}  [topMeanOOS=${pctf(baseQoos.topMean)} botMeanOOS=${pctf(baseQoos.botMean)}]`);
  console.log(`  (overlapping n inflates the t-stat ~${H}x; see Attack 1)\n`);

  // ================= ATTACK 1: NON-OVERLAPPING 9d BLOCKS =================
  console.log('========== ATTACK 1: NON-OVERLAPPING 9d BLOCKS ==========');
  const noBroad = nonOverlapping(obsBroad);
  const icNo = spearman(noBroad.map(o => o.domLvl), noBroad.map(o => o.rel));
  const noSplit = midSplit(noBroad);
  const icNoIs = spearman(noSplit.is.map(o => o.domLvl), noSplit.is.map(o => o.rel));
  const icNoOos = spearman(noSplit.oos.map(o => o.domLvl), noSplit.oos.map(o => o.rel));
  const qNo = quintileSpread(noBroad);
  const qNoOos = quintileSpread(noSplit.oos);
  console.log(`  n(non-overlapping)=${noBroad.length}  (was ${obsBroad.length} overlapping)`);
  console.log(`  IC all=${icNo.toFixed(3)} (t=${icTstat(icNo, noBroad.length).toFixed(2)})  IS=${icNoIs.toFixed(3)}  OOS=${icNoOos.toFixed(3)}`);
  console.log(`  quintile spread: ALL=${pctf(qNo.spread)} (nTop=${qNo.nTop} nBot=${qNo.nBot})  OOS=${pctf(qNoOos.spread)} (nTop=${qNoOos.nTop} nBot=${qNoOos.nBot})`);
  console.log(`  SURVIVES if IC stays clearly negative AND |t|>~2 on the honest (non-overlapping) sample.\n`);

  // ================= ATTACK 2: EPISODE CONCENTRATION =================
  // Decompose the OOS quintile spread: the spread is driven by the top/bottom quintile
  // rel returns. Identify which individual NON-OVERLAPPING blocks contribute most to the
  // signed spread, drop the top-3, recompute.
  console.log('========== ATTACK 2: EPISODE CONCENTRATION (drop top-3 OOS episodes) ==========');
  {
    // Use the full non-overlapping OOS sample. The "edge" P&L per block = -sign(domLvl-centred)*rel?
    // Cleaner: build a per-block signed signal pnl: position = -1 if dom in top quintile,
    // +1 if dom in bottom quintile, 0 otherwise; blockPnl = position * (-rel)  [we WANT rel to fall
    // when dom high, so shorting BTC/long alt = -rel gain when dom high]. Equivalent: pnl = sign * rel
    // where sign = +1 in bottom-dom (expect rel up) and -1 in top-dom (expect rel down).
    const oos = noSplit.oos;
    const sorted = [...oos].sort((a, b) => a.domLvl - b.domLvl);
    const q = Math.max(1, Math.floor(sorted.length / 5));
    const botSet = new Set(sorted.slice(0, q).map(o => o.ts));
    const topSet = new Set(sorted.slice(sorted.length - q).map(o => o.ts));
    const contrib: { ts: number; pnl: number; pos: number; rel: number }[] = [];
    for (const o of oos) {
      let pos = 0;
      if (topSet.has(o.ts)) pos = -1;      // high dom -> short BTC / long alt -> profit if rel falls
      else if (botSet.has(o.ts)) pos = +1; // low dom -> long BTC / short alt -> profit if rel rises
      if (pos !== 0) contrib.push({ ts: o.ts, pnl: pos * o.rel, pos, rel: o.rel });
    }
    const totalPnl = contrib.reduce((s, c) => s + c.pnl, 0);
    const meanPnl = totalPnl / contrib.length;
    const sorted2 = [...contrib].sort((a, b) => b.pnl - a.pnl); // best first
    console.log(`  OOS extreme-quintile blocks=${contrib.length}  total signed edge pnl=${pctf(totalPnl)}  mean/block=${pctf(meanPnl)}`);
    console.log(`  top-5 contributing blocks:`);
    for (const c of sorted2.slice(0, 5)) {
      console.log(`    ${new Date(c.ts).toISOString().slice(0,10)} pos=${c.pos > 0 ? 'LONG-BTC' : 'SHORT-BTC'} rel=${pctf(c.rel)} pnl=${pctf(c.pnl)}`);
    }
    const drop3 = totalPnl - sorted2.slice(0, 3).reduce((s, c) => s + c.pnl, 0);
    const drop3Mean = (contrib.length - 3) > 0 ? drop3 / (contrib.length - 3) : 0;
    const top3Share = totalPnl !== 0 ? sorted2.slice(0, 3).reduce((s, c) => s + c.pnl, 0) / totalPnl : 0;
    console.log(`  drop top-3 episodes: total edge pnl ${pctf(totalPnl)} -> ${pctf(drop3)}  (top-3 = ${(top3Share*100).toFixed(0)}% of edge)  mean/block ${pctf(meanPnl)} -> ${pctf(drop3Mean)}`);
    console.log(`  SURVIVES if remaining edge stays clearly positive (mean/block > 0) after dropping top-3.\n`);
  }

  // ================= ATTACK 3: SURVIVORSHIP (fixed ETH/XRP/LTC basket) =================
  console.log('========== ATTACK 3: SURVIVORSHIP (fixed ETH,XRP,LTC basket) ==========');
  {
    const icF = spearman(obsFixed.map(o => o.domLvl), obsFixed.map(o => o.rel));
    const split = midSplit(obsFixed);
    const icFIs = spearman(split.is.map(o => o.domLvl), split.is.map(o => o.rel));
    const icFOos = spearman(split.oos.map(o => o.domLvl), split.oos.map(o => o.rel));
    const noF = nonOverlapping(obsFixed);
    const icFno = spearman(noF.map(o => o.domLvl), noF.map(o => o.rel));
    const noFSplit = midSplit(noF);
    const icFnoOos = spearman(noFSplit.oos.map(o => o.domLvl), noFSplit.oos.map(o => o.rel));
    const qF = quintileSpread(noF);
    const qFOos = quintileSpread(noFSplit.oos);
    console.log(`  overlapping: n=${obsFixed.length} IC all=${icF.toFixed(3)} IS=${icFIs.toFixed(3)} OOS=${icFOos.toFixed(3)}`);
    console.log(`  non-overlapping: n=${noF.length} IC all=${icFno.toFixed(3)} OOS=${icFnoOos.toFixed(3)}  quintile spread ALL=${pctf(qF.spread)} OOS=${pctf(qFOos.spread)}`);
    console.log(`  SURVIVES if the sign/magnitude hold with only the oldest 3 alts (not driven by pumpy newcomers).\n`);
  }

  // ================= ATTACK 4: SIGN STABILITY (independent non-overlapping quarters) =================
  console.log('========== ATTACK 4: SIGN STABILITY (independent quarters, non-overlapping blocks) ==========');
  {
    const no = nonOverlapping(obsBroad).sort((a, b) => a.ts - b.ts);
    // split into 4 contiguous calendar quarters of the non-overlapping sample
    const nq = 4;
    const per = Math.floor(no.length / nq);
    let negCount = 0;
    for (let qi = 0; qi < nq; qi++) {
      const a = qi * per, b = qi === nq - 1 ? no.length : (qi + 1) * per;
      const slice = no.slice(a, b);
      const ic = spearman(slice.map(o => o.domLvl), slice.map(o => o.rel));
      const t0 = new Date(slice[0].ts).toISOString().slice(0, 10);
      const t1 = new Date(slice[slice.length - 1].ts).toISOString().slice(0, 10);
      const domLo = Math.min(...slice.map(o => o.domLvl)).toFixed(1);
      const domHi = Math.max(...slice.map(o => o.domLvl)).toFixed(1);
      if (Number.isFinite(ic) && ic < 0) negCount++;
      console.log(`  Q${qi + 1} ${t0}..${t1} n=${slice.length} IC=${ic.toFixed(3)} (t=${icTstat(ic, slice.length).toFixed(2)}) domRange ${domLo}..${domHi}`);
    }
    console.log(`  ${negCount}/${nq} independent quarters negative.`);
    console.log(`  SURVIVES if >=3/4 stay negative on the non-overlapping (honest n) sample.\n`);
  }

  // ================= ATTACK 2b: secular-trend decomposition + IC robustness to dropping episodes =================
  console.log('========== ATTACK 2b: SECULAR DRIFT + IC robustness ==========');
  {
    const no = nonOverlapping(obsBroad).sort((a, b) => a.ts - b.ts);
    // detrend dom level by subtracting trailing-MA already-removed? Use raw-level vs time.
    const idx = no.map((_, i) => i);
    const corrDomTime = spearman(no.map(o => o.domLvl), idx);
    const corrRelTime = spearman(no.map(o => o.rel), idx);
    console.log(`  corr(dom, time)=${corrDomTime.toFixed(3)}  corr(rel, time)=${corrRelTime.toFixed(3)}  (both nonzero => secular co-trend can fake IC)`);
    // IC after removing the 3 most extreme |rel| observations from the FULL non-overlap sample
    const byAbs = [...no].sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
    const dropSet = new Set(byAbs.slice(0, 3).map(o => o.ts));
    const trimmed = no.filter(o => !dropSet.has(o.ts));
    const icTrim = spearman(trimmed.map(o => o.domLvl), trimmed.map(o => o.rel));
    console.log(`  full non-overlap IC=${spearman(no.map(o=>o.domLvl), no.map(o=>o.rel)).toFixed(3)} -> drop 3 largest |rel|: IC=${icTrim.toFixed(3)} (n=${trimmed.length})`);
    // OOS-only equivalent
    const oos = midSplit(no).oos;
    const byAbsO = [...oos].sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
    const dropO = new Set(byAbsO.slice(0, 3).map(o => o.ts));
    const trimO = oos.filter(o => !dropO.has(o.ts));
    const icOosFull = spearman(oos.map(o => o.domLvl), oos.map(o => o.rel));
    const icOosTrim = spearman(trimO.map(o => o.domLvl), trimO.map(o => o.rel));
    const qOosTrim = quintileSpread(trimO);
    console.log(`  OOS IC=${icOosFull.toFixed(3)} -> drop 3 largest |rel|: IC=${icOosTrim.toFixed(3)} (n=${trimO.length})  trimmed OOS quintile spread=${pctf(qOosTrim.spread)}`);
    console.log('');
  }

  // ================= ROBUSTNESS: stride-offset + horizon sweep (is 9d / grid cherry-picked?) =================
  console.log('========== ROBUSTNESS: non-overlap IC across stride start-offsets (H fixed) ==========');
  {
    const allOff: number[] = [];
    for (let off = 0; off < H; off++) {
      const no = nonOverlapping(obsBroad, off);
      const ic = spearman(no.map(o => o.domLvl), no.map(o => o.rel));
      allOff.push(ic);
      console.log(`  offset=${off}d n=${no.length} IC=${ic.toFixed(3)} (t=${icTstat(ic, no.length).toFixed(2)})`);
    }
    console.log(`  mean IC across ${H} disjoint grids = ${mean(allOff).toFixed(3)}  (all should agree if not a grid fluke)\n`);
  }

  await closePg();
  process.exit(0);
}
main().catch(e => { console.error('dom-skeptic crashed:', e?.message ?? String(e)); process.exit(1); });

/**
 * cg-altseason-ic — IS/OOS Spearman-IC + quintile-spread test of the Altcoin
 * Season Index, BTC Macro Oscillator, and BTC-vs-M2 families against forward
 * price returns, plus orthogonality checks (vs funding_oi percentile, vs
 * trailing same-horizon price return).
 *
 * READ-ONLY. Pulls signals live from CG, prices from the candles table, funding
 * from cg_funding_oi_weighted. No live-path files touched.
 *
 * Run: npx tsx src/tools/diagnostics/cg-altseason-ic.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY = 86400000;

// ---------- stats helpers ----------
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // average rank, 1-based
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}
function spearman(a: number[], b: number[]): number {
  return pearson(rank(a), rank(b));
}
function mean(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }

// quintile spread: mean fwd-ret of top quintile minus bottom quintile (by signal)
function quintileSpread(sig: number[], fwd: number[]): { top: number; bot: number; spread: number; n: number } {
  const pairs = sig.map((s, i) => [s, fwd[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const q = Math.floor(pairs.length / 5);
  if (q < 3) return { top: NaN, bot: NaN, spread: NaN, n: pairs.length };
  const bot = mean(pairs.slice(0, q).map(p => p[1]));
  const top = mean(pairs.slice(pairs.length - q).map(p => p[1]));
  return { top, bot, spread: top - bot, n: pairs.length };
}

// ---------- price loaders (daily, 24/7, 00:00 UTC) ----------
// Build daily closes from 60m candles: close of the bar at HH=00 next day == the
// 23:00 bar close. We take the close of the last 60m bar strictly < (t0+DAY).
async function dailyCloses(symbol: string): Promise<Map<number, number>> {
  // pull all 60m bars, aggregate to day buckets keyed by UTC midnight, value = last close in bucket
  const r = await query<any>(
    `SELECT ts, close FROM candles WHERE symbol=$1 AND tf='60m' ORDER BY ts ASC`, [symbol]);
  const m = new Map<number, number>();
  for (const row of r.rows) {
    const ts = Number(row.ts);
    const day = Math.floor(ts / DAY) * DAY;
    m.set(day, parseFloat(row.close)); // last write wins -> last close in the day
  }
  return m;
}

// ---------- funding percentile (BTC, recent year) for orthogonality ----------
async function fundingPctByDay(): Promise<Map<number, number>> {
  // 4h funding fr_close for BTC; compute rolling-180-bar percentile (the live fade
  // basis), then map each day -> percentile of the last 4h bar that day.
  const r = await query<any>(
    `SELECT ts, fr_close FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`, []);
  const rows = r.rows.map((x: any) => ({ ts: Number(x.ts), fr: parseFloat(x.fr_close) }));
  const out = new Map<number, number>(); // day -> last percentile that day
  const WIN = 180;
  for (let i = 0; i < rows.length; i++) {
    if (i < WIN) continue;
    const window = rows.slice(i - WIN, i).map(x => x.fr);
    const cur = rows[i].fr;
    let below = 0;
    for (const v of window) if (v < cur) below++;
    const pct = below / window.length;
    const day = Math.floor(rows[i].ts / DAY) * DAY;
    out.set(day, pct); // last 4h bar of the day wins
  }
  return out;
}

// ---------- generic forward return ----------
function fwdRet(closes: Map<number, number>, day: number, h: number): number | null {
  const c0 = closes.get(day);
  const c1 = closes.get(day + h * DAY);
  if (c0 == null || c1 == null || c0 <= 0) return null;
  return c1 / c0 - 1;
}
function trailRet(closes: Map<number, number>, day: number, h: number): number | null {
  const c0 = closes.get(day - h * DAY);
  const c1 = closes.get(day);
  if (c0 == null || c1 == null || c0 <= 0) return null;
  return c1 / c0 - 1;
}

interface SignalSeries { name: string; byDay: Map<number, number>; }

async function loadSignals(): Promise<SignalSeries[]> {
  const out: SignalSeries[] = [];

  const alt = (await cgGet<any[]>('/index/altcoin-season', {})).data;
  const altByDay = new Map<number, number>();
  for (const r of alt) altByDay.set(Math.floor(Number(r.timestamp) / DAY) * DAY, Number(r.altcoin_index));
  out.push({ name: 'altseason_level', byDay: altByDay });
  // 7d change
  const altChg = new Map<number, number>();
  for (const [d, v] of altByDay) { const p = altByDay.get(d - 7 * DAY); if (p != null) altChg.set(d, v - p); }
  out.push({ name: 'altseason_chg7d', byDay: altChg });

  const bmo = (await cgGet<any[]>('/index/bitcoin-macro-oscillator', {})).data;
  const bmoByDay = new Map<number, number>();
  for (const r of bmo) bmoByDay.set(Math.floor(Number(r.timestamp) / DAY) * DAY, Number(r.bmo_value));
  out.push({ name: 'bmo_level', byDay: bmoByDay });
  const bmoChg = new Map<number, number>();
  for (const [d, v] of bmoByDay) { const p = bmoByDay.get(d - 7 * DAY); if (p != null) bmoChg.set(d, v - p); }
  out.push({ name: 'bmo_chg7d', byDay: bmoChg });

  const m2 = (await cgGet<any[]>('/index/bitcoin-vs-global-m2-growth', {})).data;
  // weekly -> forward-fill to daily so it aligns to daily forward returns
  const m2Pts = m2.map((r: any) => ({ d: Math.floor(Number(r.timestamp) / DAY) * DAY, yoy: Number(r.global_m2_yoy_growth) }))
    .sort((a, b) => a.d - b.d);
  const m2Lvl = new Map<number, number>();
  const m2Chg = new Map<number, number>();
  for (let i = 0; i < m2Pts.length; i++) {
    m2Lvl.set(m2Pts[i].d, m2Pts[i].yoy);
    if (i >= 4) m2Chg.set(m2Pts[i].d, m2Pts[i].yoy - m2Pts[i - 4].yoy); // ~4wk change
  }
  out.push({ name: 'm2_yoy_level(weekly)', byDay: m2Lvl });
  out.push({ name: 'm2_yoy_chg4w(weekly)', byDay: m2Chg });

  return out;
}

interface Cell {
  signal: string; asset: string; horizon: number;
  icIS: number; icOOS: number; nIS: number; nOOS: number;
  spIS: number; spOOS: number;
}

function runCell(
  sig: Map<number, number>, closes: Map<number, number>, h: number, days: number[],
  splitDay: number,
): { icIS: number; icOOS: number; nIS: number; nOOS: number; spIS: number; spOOS: number } {
  const isS: number[] = [], isF: number[] = [], oosS: number[] = [], oosF: number[] = [];
  for (const d of days) {
    const s = sig.get(d);
    if (s == null || isNaN(s)) continue;
    const f = fwdRet(closes, d, h);
    if (f == null) continue;
    if (d < splitDay) { isS.push(s); isF.push(f); } else { oosS.push(s); oosF.push(f); }
  }
  const qIS = quintileSpread(isS, isF);
  const qOOS = quintileSpread(oosS, oosF);
  return {
    icIS: spearman(isS, isF), icOOS: spearman(oosS, oosF),
    nIS: isS.length, nOOS: oosS.length,
    spIS: qIS.spread, spOOS: qOOS.spread,
  };
}

function f3(x: number): string { return isNaN(x) ? '  NaN ' : (x >= 0 ? '+' : '') + x.toFixed(3); }
function pct(x: number): string { return isNaN(x) ? ' NaN ' : (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%'; }

async function main() {
  const signals = await loadSignals();
  const btc = await dailyCloses('BTCUSDT');
  const eth = await dailyCloses('ETHUSDT');
  // ETH/BTC ratio "closes" for alt-relative test
  const ethbtc = new Map<number, number>();
  for (const [d, c] of eth) { const b = btc.get(d); if (b) ethbtc.set(d, c / b); }

  const assets: Record<string, Map<number, number>> = {
    BTC: btc,
    'ETH/BTC': ethbtc,
  };

  const horizons = [3, 5, 7, 9];

  // overlap range = days where BTC price exists (longest price overlap)
  const priceDays = [...btc.keys()].sort((a, b) => a - b);
  const firstDay = priceDays[0], lastDay = priceDays[priceDays.length - 1];
  const splitDay = firstDay + Math.floor((lastDay - firstDay) / 2);
  console.log(`\nPrice overlap: ${new Date(firstDay).toISOString().slice(0,10)} .. ${new Date(lastDay).toISOString().slice(0,10)}`);
  console.log(`IS/OOS split at: ${new Date(splitDay).toISOString().slice(0,10)} (IS=older, OOS=recent)\n`);

  const allDays: number[] = [];
  for (let d = firstDay; d <= lastDay; d += DAY) allDays.push(d);

  console.log('signal                    asset    h   icIS    icOOS   nIS/nOOS    spreadIS   spreadOOS   sameSign  bothPass');
  console.log('-'.repeat(118));

  const cells: Cell[] = [];
  for (const s of signals) {
    // alt-relative signals tested vs ETH/BTC AND BTC; macro signals vs BTC only
    const isAlt = s.name.startsWith('altseason');
    const targets = isAlt ? ['ETH/BTC', 'BTC'] : ['BTC'];
    for (const a of targets) {
      for (const h of horizons) {
        const r = runCell(s.byDay, assets[a], h, allDays, splitDay);
        cells.push({ signal: s.name, asset: a, horizon: h, ...r });
        const sameSign = !isNaN(r.icIS) && !isNaN(r.icOOS) && Math.sign(r.icIS) === Math.sign(r.icOOS);
        const bothPass = sameSign && Math.abs(r.icIS) >= 0.05 && Math.abs(r.icOOS) >= 0.05;
        console.log(
          `${s.name.padEnd(25)} ${a.padEnd(8)} ${String(h).padStart(2)}  ${f3(r.icIS)}  ${f3(r.icOOS)}  ${String(r.nIS).padStart(4)}/${String(r.nOOS).padEnd(4)}  ${pct(r.spIS).padStart(8)}  ${pct(r.spOOS).padStart(8)}   ${sameSign ? 'YES' : ' no'}      ${bothPass ? '*** PASS' : ''}`,
        );
      }
    }
  }

  // ---------- pick best by min(|icIS|,|icOOS|) among same-sign cells ----------
  const robust = cells.filter(c => !isNaN(c.icIS) && !isNaN(c.icOOS) && Math.sign(c.icIS) === Math.sign(c.icOOS));
  robust.sort((a, b) => Math.min(Math.abs(b.icIS), Math.abs(b.icOOS)) - Math.min(Math.abs(a.icIS), Math.abs(a.icOOS)));
  const best = robust[0];
  console.log('\n=== best same-sign cell ===');
  if (best) {
    console.log(`${best.signal} | ${best.asset} | h=${best.horizon}d  icIS=${f3(best.icIS)} icOOS=${f3(best.icOOS)}  spreadIS=${pct(best.spIS)} spreadOOS=${pct(best.spOOS)}`);
  } else {
    console.log('none same-sign across halves');
  }

  // ---------- orthogonality for the best signal ----------
  if (best) {
    const bestSig = signals.find(s => s.name === best.signal)!;
    const fundPct = await fundingPctByDay();
    const closes = assets[best.asset];
    // align days where signal + fundPct both exist (recent year), corr signal vs funding pct
    const sA: number[] = [], fA: number[] = [];
    for (const [d, sv] of bestSig.byDay) {
      const fp = fundPct.get(d);
      if (fp != null && !isNaN(sv)) { sA.push(sv); fA.push(fp); }
    }
    const corrFund = sA.length >= 30 ? spearman(sA, fA) : NaN;

    // signal vs trailing same-horizon return (lagged-momentum repackaging check)
    const sB: number[] = [], tB: number[] = [];
    for (const d of allDays) {
      const sv = bestSig.byDay.get(d);
      if (sv == null || isNaN(sv)) continue;
      const tr = trailRet(closes, d, best.horizon);
      if (tr == null) continue;
      sB.push(sv); tB.push(tr);
    }
    const corrTrail = spearman(sB, tB);

    console.log('\n=== orthogonality (best signal) ===');
    console.log(`corr(${best.signal}, funding_oi pct[BTC, recent yr])  = ${f3(corrFund)}  (n=${sA.length})`);
    console.log(`corr(${best.signal}, trailing ${best.horizon}d ${best.asset} return)  = ${f3(corrTrail)}  (n=${sB.length})`);
  }

  process.exit(0);
}

main().catch(e => { console.error('crashed', e?.stack ?? e?.message ?? String(e)); process.exit(1); });

/**
 * spot-flow-ic — Spearman IC / quintile-spread analysis of Coinglass SPOT order-flow
 * signals vs forward price returns, with IS/OOS split + orthogonality checks.
 *
 * Endpoints (verified 200, 360d / 2160 4h-bars each):
 *   /spot/aggregated-cvd/history            -> agg_taker_buy_vol, agg_taker_sell_vol, cum_vol_delta
 *   /spot/aggregated-taker-buy-sell-volume/history -> aggregated_buy/sell_volume_usd
 *   /futures/aggregated-cvd/history         -> (perp analog, for spot-minus-perp divergence)
 *
 * Forward returns from project candles (symbol+"USDT", tf 240m). Crypto 24/7.
 *
 * Signals (all PER-BAR or windowed-delta -> NOT the cumulative level, which is a
 * price proxy):
 *   spot_taker_imb     = (sbuy - ssell)/(sbuy+ssell)            [bar]
 *   spot_cvd_z         = zscore of (sbuy - ssell)              [bar, rolling 180]
 *   spot_minus_perp    = spot_taker_imb - perp_taker_imb        [divergence, bar]
 *   spot_cvd_slope_h   = (cvd[t] - cvd[t-h]) normalized by rolling vol [windowed]
 *
 * Direction: archetype = FOLLOW (spot-led buying -> forward up => positive IC).
 * We report signed IC so a stable negative is a FADE edge.
 *
 * Orthogonality: corr(best signal, funding_oi percentile) and corr(best signal,
 * trailing same-horizon return) -> catch funding-fade overlap & lagged momentum.
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/spot-flow-ic.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const COINS = ['BTC', 'ETH', 'SOL'];
const HORIZONS_BARS = [3, 6, 12]; // 12h, 24h, 48h (4h bars)
const ROLL = 180; // rolling window for z-scores / percentiles (30d of 4h bars)
const SLOPE_H = 6; // window for cvd slope signal (24h)

// ---------- stats ----------
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
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
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}
function spearman(a: number[], b: number[]): number {
  return pearson(rank(a), rank(b));
}
// filter NaN-paired
function clean(sig: number[], ret: number[]): [number[], number[]] {
  const s: number[] = [], r: number[] = [];
  for (let i = 0; i < sig.length; i++) {
    if (Number.isFinite(sig[i]) && Number.isFinite(ret[i])) { s.push(sig[i]); r.push(ret[i]); }
  }
  return [s, r];
}
// quintile spread: mean fwd-ret of top quintile minus bottom quintile (by signal)
function quintileSpread(sig: number[], ret: number[]): { spread: number; monoOk: boolean; means: number[] } {
  const [s, r] = clean(sig, ret);
  if (s.length < 25) return { spread: NaN, monoOk: false, means: [] };
  const idx = s.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const q = 5;
  const means: number[] = [];
  for (let k = 0; k < q; k++) {
    const lo = Math.floor((k * idx.length) / q);
    const hi = Math.floor(((k + 1) * idx.length) / q);
    let sum = 0, cnt = 0;
    for (let t = lo; t < hi; t++) { sum += r[idx[t][1]]; cnt++; }
    means.push(cnt ? sum / cnt : NaN);
  }
  const spread = means[q - 1] - means[0];
  // monotone (allow either direction): strictly increasing OR strictly decreasing across quintiles
  let inc = true, dec = true;
  for (let k = 1; k < q; k++) { if (!(means[k] > means[k - 1])) inc = false; if (!(means[k] < means[k - 1])) dec = false; }
  return { spread, monoOk: inc || dec, means };
}

// ---------- data loaders ----------
interface CgRow { time: number; }
async function fetchSpotCvd(coin: string): Promise<{ time: number; buy: number; sell: number; cvd: number }[]> {
  const r = await cgGet<any>('/spot/aggregated-cvd/history', { exchange_list: 'Binance', symbol: coin, interval: '4h', limit: 3000 });
  return (r.data ?? []).map((d: any) => ({ time: d.time, buy: d.agg_taker_buy_vol, sell: d.agg_taker_sell_vol, cvd: d.cum_vol_delta }));
}
async function fetchPerpCvd(coin: string): Promise<{ time: number; buy: number; sell: number; cvd: number }[]> {
  const r = await cgGet<any>('/futures/aggregated-cvd/history', { exchange_list: 'Binance', symbol: coin, interval: '4h', limit: 3000 });
  return (r.data ?? []).map((d: any) => ({ time: d.time, buy: d.agg_taker_buy_vol, sell: d.agg_taker_sell_vol, cvd: d.cum_vol_delta }));
}
async function fetchFundingPct(coin: string): Promise<Map<number, number>> {
  // build a rolling-percentile of fr_close, keyed by ts (ms), matching the live fade.
  const r = await query<any>(`SELECT ts, fr_close::float fr FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts ASC`, [coin]);
  const rows = r.rows.map((x: any) => ({ ts: Number(x.ts), fr: x.fr as number }));
  const out = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const start = Math.max(0, i - ROLL + 1);
    const win = rows.slice(start, i + 1).map(w => w.fr);
    const cur = rows[i].fr;
    let le = 0; for (const v of win) if (v <= cur) le++;
    out.set(rows[i].ts, le / win.length); // 0..1 percentile
  }
  return out;
}
async function loadCandleCloses(pair: string): Promise<Map<number, number>> {
  const r = await query<any>(`SELECT ts, close::float c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const m = new Map<number, number>();
  for (const x of r.rows) m.set(Number(x.ts), x.c as number);
  return m;
}

// rolling z-score of a series (uses trailing ROLL window incl. current)
function rollingZ(xs: number[]): number[] {
  const out = new Array(xs.length).fill(NaN);
  for (let i = 0; i < xs.length; i++) {
    const start = Math.max(0, i - ROLL + 1);
    const win = xs.slice(start, i + 1);
    if (win.length < 20) continue;
    let m = 0; for (const v of win) m += v; m /= win.length;
    let s = 0; for (const v of win) s += (v - m) * (v - m); s = Math.sqrt(s / win.length);
    out[i] = s === 0 ? 0 : (xs[i] - m) / s;
  }
  return out;
}

interface SeriesResult {
  coin: string;
  signal: string;
  horizonBars: number;
  icIS: number; icOOS: number;
  spreadIS: number; spreadOOS: number;
  monoIS: boolean; monoOOS: boolean;
  nIS: number; nOOS: number;
}

async function main() {
  console.log('=== spot-flow-ic ===');
  console.log(`coins=${COINS.join(',')} horizons(bars)=${HORIZONS_BARS.join(',')} (12h/24h/48h) roll=${ROLL}\n`);

  const allResults: SeriesResult[] = [];
  // store best-signal arrays for orthogonality at the end (per coin)
  const orthoStore: Record<string, { ts: number[]; bestSig: number[]; fundPct: number[]; trailRet: number[]; sigName: string; h: number }> = {};

  for (const coin of COINS) {
    const pair = coin + 'USDT';
    const [spot, perp, fundPctMap, closes] = await Promise.all([
      fetchSpotCvd(coin), fetchPerpCvd(coin), fetchFundingPct(coin), loadCandleCloses(pair),
    ]);
    // align spot & perp on time
    const perpByTime = new Map<number, { buy: number; sell: number; cvd: number }>();
    for (const p of perp) perpByTime.set(p.time, p);

    // base rows where we have spot, perp, and a candle close at that ts
    const rows = spot.filter(s => perpByTime.has(s.time) && closes.has(s.time));
    if (rows.length < 200) { console.log(`${coin}: insufficient aligned rows (${rows.length})`); continue; }

    const times = rows.map(r => r.time);
    const spotBuy = rows.map(r => r.buy);
    const spotSell = rows.map(r => r.sell);
    const spotCvd = rows.map(r => r.cvd);
    const perpRows = rows.map(r => perpByTime.get(r.time)!);
    const closeArr = times.map(t => closes.get(t)!);

    // ---- signals ----
    const spotTakerImb = rows.map((r) => {
      const d = r.buy + r.sell; return d === 0 ? 0 : (r.buy - r.sell) / d;
    });
    const perpTakerImb = perpRows.map((p) => {
      const d = p.buy + p.sell; return d === 0 ? 0 : (p.buy - p.sell) / d;
    });
    const spotNetRaw = rows.map((r) => r.buy - r.sell);
    const spotCvdZ = rollingZ(spotNetRaw);
    const spotMinusPerp = spotTakerImb.map((v, i) => v - perpTakerImb[i]);
    // cvd slope over SLOPE_H bars, normalized by rolling stdev of the diff
    const slopeRaw = spotCvd.map((v, i) => i >= SLOPE_H ? v - spotCvd[i - SLOPE_H] : NaN);
    const spotCvdSlope = rollingZ(slopeRaw.map(v => Number.isFinite(v) ? v : 0)).map((z, i) => i >= SLOPE_H ? z : NaN);

    const signals: Record<string, number[]> = {
      spot_taker_imb: spotTakerImb,
      spot_cvd_z: spotCvdZ,
      spot_minus_perp: spotMinusPerp,
      spot_cvd_slope: spotCvdSlope,
    };

    // funding percentile aligned (for orthogonality)
    const fundPctArr = times.map(t => fundPctMap.has(t) ? fundPctMap.get(t)! : NaN);

    const n = times.length;
    const mid = Math.floor(n / 2);

    for (const [sigName, sigArr] of Object.entries(signals)) {
      for (const h of HORIZONS_BARS) {
        // forward return: close[t+h]/close[t]-1
        const fwd: number[] = new Array(n).fill(NaN);
        for (let i = 0; i + h < n; i++) fwd[i] = closeArr[i + h] / closeArr[i] - 1;

        // IS = first half, OOS = second half (by index over aligned chronological rows)
        const isSig = sigArr.slice(0, mid), isRet = fwd.slice(0, mid);
        const oosSig = sigArr.slice(mid), oosRet = fwd.slice(mid);
        const [csIS, crIS] = clean(isSig, isRet);
        const [csOOS, crOOS] = clean(oosSig, oosRet);
        const icIS = spearman(csIS, crIS);
        const icOOS = spearman(csOOS, crOOS);
        const qIS = quintileSpread(isSig, isRet);
        const qOOS = quintileSpread(oosSig, oosRet);
        allResults.push({
          coin, signal: sigName, horizonBars: h,
          icIS, icOOS, spreadIS: qIS.spread, spreadOOS: qOOS.spread,
          monoIS: qIS.monoOk, monoOOS: qOOS.monoOk, nIS: csIS.length, nOOS: csOOS.length,
        });
      }
    }

    // ---- orthogonality storage: pick the signal+horizon with best |min(|icIS|,|icOOS|)| same-sign for this coin ----
    let best: { name: string; h: number; score: number } | null = null;
    for (const sigName of Object.keys(signals)) {
      for (const h of HORIZONS_BARS) {
        const rr = allResults.find(x => x.coin === coin && x.signal === sigName && x.horizonBars === h)!;
        const sameSign = Number.isFinite(rr.icIS) && Number.isFinite(rr.icOOS) && Math.sign(rr.icIS) === Math.sign(rr.icOOS);
        const score = sameSign ? Math.min(Math.abs(rr.icIS), Math.abs(rr.icOOS)) : -1;
        if (!best || score > best.score) best = { name: sigName, h, score };
      }
    }
    if (best) {
      const sigArr = signals[best.name];
      const h = best.h;
      // trailing same-horizon return (close[t]/close[t-h]-1)
      const trail: number[] = new Array(n).fill(NaN);
      for (let i = h; i < n; i++) trail[i] = closeArr[i] / closeArr[i - h] - 1;
      orthoStore[coin] = { ts: times.slice(), bestSig: sigArr.slice(), fundPct: fundPctArr.slice(), trailRet: trail, sigName: best.name, h };
    }
  }

  // ---- results table ----
  console.log('coin   signal           h(bar)  icIS     icOOS    sameSign  spreadIS   spreadOOS  monoIS monoOOS  nIS/nOOS');
  console.log('-'.repeat(118));
  for (const r of allResults) {
    const same = Number.isFinite(r.icIS) && Number.isFinite(r.icOOS) && Math.sign(r.icIS) === Math.sign(r.icOOS);
    const clears = same && Math.abs(r.icIS) >= 0.05 && Math.abs(r.icOOS) >= 0.05;
    const flag = clears ? ' <== CLEARS BAR' : '';
    console.log(
      `${r.coin.padEnd(6)} ${r.signal.padEnd(16)} ${String(r.horizonBars).padStart(4)}   ` +
      `${r.icIS.toFixed(4).padStart(8)} ${r.icOOS.toFixed(4).padStart(8)}  ${(same ? 'Y' : 'n').padEnd(8)} ` +
      `${(r.spreadIS * 100).toFixed(3).padStart(8)}%  ${(r.spreadOOS * 100).toFixed(3).padStart(8)}%  ` +
      `${(r.monoIS ? 'Y' : 'n').padEnd(6)} ${(r.monoOOS ? 'Y' : 'n').padEnd(7)} ${r.nIS}/${r.nOOS}${flag}`,
    );
  }

  // ---- orthogonality ----
  console.log('\n=== ORTHOGONALITY (best same-sign signal per coin) ===');
  for (const coin of Object.keys(orthoStore)) {
    const o = orthoStore[coin];
    const [s1, f1] = clean(o.bestSig, o.fundPct);
    const corrFund = spearman(s1, f1);
    const [s2, t2] = clean(o.bestSig, o.trailRet);
    const corrTrail = spearman(s2, t2);
    console.log(`${coin}: best=${o.sigName} h=${o.h}  corr(signal, funding_oi_pct)=${corrFund.toFixed(3)}  corr(signal, trailing_${o.h}bar_ret)=${corrTrail.toFixed(3)}`);
  }

  process.exit(0);
}
main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });

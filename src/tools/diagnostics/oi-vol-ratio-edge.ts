/**
 * oi-vol-ratio-edge — does the Options-OI/Futures-OI ratio (confirmed v4 path
 * /index/option-vs-futures-oi-ratio, daily, BTC) — and a constructed
 * futures-vs-spot taker-volume ratio — carry a real, OOS-robust, ORTHOGONAL edge
 * on BTC forward returns?
 *
 * Discipline bar: same-sign on BOTH halves (IS older / OOS recent) with
 * |Spearman IC|>=0.05 at some horizon OR clean monotone quintile spread both
 * halves, AND not just lagged price momentum.
 *
 * Signals tested (daily):
 *   OI ratio:
 *     - raw level
 *     - 30d-trailing percentile (regime: high opt/fut OI = hedging/vol regime)
 *     - 5d momentum (Δ level)
 *   Fut/Spot taker volume ratio (= fut total / spot total):
 *     - raw level
 *     - 30d percentile (froth -> FADE: high fut/spot = speculative froth)
 *     - 5d momentum
 *
 * Horizons (daily data): 1d, 3d, 7d forward log-return.
 * IS/OOS split at midpoint of matched-pairs history.
 * Orthogonality: corr of best signal vs funding_oi 30d percentile (the live fade)
 *   AND vs trailing same-horizon price return (lagged-momentum repackaging check).
 *
 * Forward returns from BTC daily closes, aggregated from 240m candles (full depth
 * back to 2020) since 1D candles only start 2024-05.
 * Read-only. No live-path file touched.
 */
import { query } from '../../core/db';
import { cgGet } from '../../core/coinglass';

const DAY = 86400000;
function dayKey(t: number): number { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

// ---------- stats ----------
function spearman(x: number[], y: number[]): number {
  const n = x.length; if (n < 12) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n).fill(0); let i = 0;
    while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

function quintileSpread(x: number[], fwd: number[]): { spread: number; top: number; bot: number; nq: number } {
  const n = x.length; if (n < 25) return { spread: NaN, top: NaN, bot: NaN, nq: 0 };
  const order = x.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const q = Math.floor(n / 5);
  const botIdx = order.slice(0, q), topIdx = order.slice(n - q);
  const mean = (idxs: number[]) => idxs.reduce((s, i) => s + fwd[i], 0) / idxs.length;
  const top = mean(topIdx), bot = mean(botIdx);
  return { spread: top - bot, top, bot, nq: q };
}

// ---------- BTC daily closes from 240m candles ----------
async function loadDailyCloses(symbol: string): Promise<Map<number, number>> {
  // aggregate 240m bars to a daily close = last 240m close of each UTC day
  const r = await query<any>(
    `SELECT ts::text, close FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`,
    [symbol],
  );
  const byDay = new Map<number, { ts: number; close: number }>();
  for (const row of r.rows) {
    const ts = parseInt(row.ts, 10);
    const k = dayKey(ts);
    const prev = byDay.get(k);
    if (!prev || ts > prev.ts) byDay.set(k, { ts, close: parseFloat(row.close) });
  }
  const out = new Map<number, number>();
  for (const [k, v] of byDay) out.set(k, v.close);
  return out;
}

interface Pt { ts: number; sig: number; }

// align signal point (at day D close) with forward H-day log return (D -> D+H)
function buildPairs(pts: Pt[], closes: Map<number, number>, H: number): { x: number[]; fwd: number[]; ts: number[] } {
  const x: number[] = [], fwd: number[] = [], ts: number[] = [];
  for (const p of pts) {
    const k0 = dayKey(p.ts);
    const kH = dayKey(p.ts + H * DAY);
    const c0 = closes.get(k0), cH = closes.get(kH);
    if (c0 != null && cH != null && c0 > 0 && cH > 0 && Number.isFinite(p.sig)) {
      x.push(p.sig); fwd.push(Math.log(cH / c0)); ts.push(p.ts);
    }
  }
  return { x, fwd, ts };
}

// trailing H-day log return ENDING at day D (for lagged-momentum orthogonality)
function trailingReturns(pts: Pt[], closes: Map<number, number>, H: number): number[] {
  const out: number[] = [];
  for (const p of pts) {
    const kEnd = dayKey(p.ts);
    const kStart = dayKey(p.ts - H * DAY);
    const cE = closes.get(kEnd), cS = closes.get(kStart);
    out.push(cE != null && cS != null && cS > 0 ? Math.log(cE / cS) : NaN);
  }
  return out;
}

function fmtP(x: number): string { return Number.isNaN(x) ? 'NaN' : (x * 100).toFixed(2) + '%'; }

interface RowOut { signalDef: string; horizon: string; icIS: number; icOOS: number; qIS: number; qOOS: number; nIS: number; nOOS: number; robust: boolean; }
const collected: RowOut[] = [];

function report(label: string, x: number[], fwd: number[], ts: number[], horizonLabel: string): RowOut | null {
  const n = x.length;
  if (n < 60) { console.log(`  ${label}: n=${n} too few -> skip`); return null; }
  const order = ts.map((t, i) => [t, i] as [number, number]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const xs = order.map((i) => x[i]), fs = order.map((i) => fwd[i]);
  const mid = Math.floor(n / 2);
  const xIS = xs.slice(0, mid), fIS = fs.slice(0, mid);
  const xOOS = xs.slice(mid), fOOS = fs.slice(mid);
  const icIS = spearman(xIS, fIS), icOOS = spearman(xOOS, fOOS);
  const qIS = quintileSpread(xIS, fIS), qOOS = quintileSpread(xOOS, fOOS);
  const icRobust = !Number.isNaN(icIS) && !Number.isNaN(icOOS) && Math.sign(icIS) === Math.sign(icOOS) && Math.min(Math.abs(icIS), Math.abs(icOOS)) >= 0.05;
  const qRobust = !Number.isNaN(qIS.spread) && !Number.isNaN(qOOS.spread) && Math.sign(qIS.spread) === Math.sign(qOOS.spread) && Math.min(Math.abs(qIS.spread), Math.abs(qOOS.spread)) >= 0.005;
  const robust = icRobust || qRobust;
  console.log(`  ${label}  [n=${n} IS=${mid} OOS=${n - mid}]`);
  console.log(`     IC  IS=${icIS.toFixed(3)}  OOS=${icOOS.toFixed(3)}   ${icRobust ? 'IC-ROBUST' : ''}`);
  console.log(`     Qsp IS=${fmtP(qIS.spread)} [t ${fmtP(qIS.top)}/b ${fmtP(qIS.bot)}]  OOS=${fmtP(qOOS.spread)} [t ${fmtP(qOOS.top)}/b ${fmtP(qOOS.bot)}]  ${qRobust ? 'Q-ROBUST' : ''}`);
  const out: RowOut = { signalDef: label, horizon: horizonLabel, icIS, icOOS, qIS: qIS.spread, qOOS: qOOS.spread, nIS: mid, nOOS: n - mid, robust };
  collected.push(out);
  return out;
}

// ---------- signal builders ----------
function trailingPct(pts: Pt[], window: number): Pt[] {
  // sort by ts, replace sig with its percentile within trailing `window` days
  const sorted = [...pts].sort((a, b) => a.ts - b.ts);
  const out: Pt[] = [];
  for (let i = window; i < sorted.length; i++) {
    const wnd = sorted.slice(i - window, i).map((p) => p.sig).filter(Number.isFinite);
    if (wnd.length < window * 0.6) continue;
    const cur = sorted[i].sig;
    const pct = wnd.filter((v) => v <= cur).length / wnd.length;
    out.push({ ts: sorted[i].ts, sig: pct });
  }
  return out;
}
function momentum(pts: Pt[], lag: number): Pt[] {
  const sorted = [...pts].sort((a, b) => a.ts - b.ts);
  const out: Pt[] = [];
  for (let i = lag; i < sorted.length; i++) {
    if (sorted[i].ts - sorted[i - lag].ts <= (lag + 1) * DAY) out.push({ ts: sorted[i].ts, sig: sorted[i].sig - sorted[i - lag].sig });
  }
  return out;
}

// ---------- funding-OI percentile (the live fade) for orthogonality ----------
async function fundingOiPct(): Promise<Pt[]> {
  // oi-weighted funding, daily; percentile over trailing 30d like the live fade
  const paths = [
    { p: '/futures/funding-rate/oi-weight-history', params: { symbol: 'BTC', interval: '1d', limit: 2000 } },
    { p: '/futures/funding-rate/oi-weight-ohlc-history', params: { symbol: 'BTC', interval: '1d', limit: 2000 } },
  ];
  for (const c of paths) {
    try {
      const r = await cgGet<any>(c.p, c.params);
      const d = (r as any).data;
      const raw: Pt[] = [];
      if (Array.isArray(d)) {
        for (const row of d) {
          const t = Number(row.time ?? row.timestamp ?? row.t);
          const v = Number(row.close ?? row.funding_rate ?? row.value ?? row.fundingRate);
          if (Number.isFinite(t) && Number.isFinite(v)) raw.push({ ts: t, sig: v });
        }
      } else if (d && d.time_list) {
        const tl = d.time_list, vl = d.close_list ?? d.data_list ?? d.value_list;
        for (let i = 0; i < tl.length; i++) raw.push({ ts: Number(tl[i]), sig: Number(vl[i]) });
      }
      if (raw.length > 100) { console.log(`  [funding via ${c.p}: ${raw.length} rows]`); return trailingPct(raw, 30); }
    } catch { /* next */ }
  }
  console.log('  [funding-OI series unavailable -> orthogonality-vs-funding skipped]');
  return [];
}

function alignByDay(a: Pt[], b: Pt[]): { av: number[]; bv: number[] } {
  const bm = new Map<number, number>();
  for (const p of b) bm.set(dayKey(p.ts), p.sig);
  const av: number[] = [], bv: number[] = [];
  for (const p of a) { const k = dayKey(p.ts); if (bm.has(k)) { av.push(p.sig); bv.push(bm.get(k)!); } }
  return { av, bv };
}

async function main() {
  console.log('=== OI-ratio + Fut/Spot vol-ratio edge on BTC fwd returns (daily) ===\n');
  const closes = await loadDailyCloses('BTCUSDT');
  console.log(`BTC daily closes (from 240m): ${closes.size} days, ${new Date(Math.min(...closes.keys())).toISOString().slice(0,10)}..${new Date(Math.max(...closes.keys())).toISOString().slice(0,10)}`);

  // ---- (1) OI ratio ----
  const oi = await cgGet<any>('/index/option-vs-futures-oi-ratio', {});
  const oiRows = (oi as any).data as any[];
  const oiPts: Pt[] = oiRows.map((r) => ({ ts: Number(r.timestamp), sig: Number(r.btc_option_vs_futures_radio) })).filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.sig));
  console.log(`OI ratio pts: ${oiPts.length}\n`);

  const oiPct = trailingPct(oiPts, 30);
  const oiMom = momentum(oiPts, 5);

  console.log('--- (1A) OI ratio RAW level -> BTC fwd ---');
  for (const H of [1, 3, 7]) { const { x, fwd, ts } = buildPairs(oiPts, closes, H); report(`OI-ratio raw -> ${H}d`, x, fwd, ts, `${H}d`); }
  console.log('--- (1B) OI ratio 30d-percentile -> BTC fwd ---');
  for (const H of [1, 3, 7]) { const { x, fwd, ts } = buildPairs(oiPct, closes, H); report(`OI-ratio 30d-pct -> ${H}d`, x, fwd, ts, `${H}d`); }
  console.log('--- (1C) OI ratio 5d-momentum -> BTC fwd ---');
  for (const H of [1, 3, 7]) { const { x, fwd, ts } = buildPairs(oiMom, closes, H); report(`OI-ratio 5d-mom -> ${H}d`, x, fwd, ts, `${H}d`); }

  // ---- (2) Fut/Spot taker volume ratio ----
  let volPts: Pt[] = [];
  try {
    const fut = await cgGet<any>('/futures/aggregated-taker-buy-sell-volume/history', { exchange_list: 'Binance,OKX,Bybit', symbol: 'BTC', interval: '1d', limit: 3000 });
    const spot = await cgGet<any>('/spot/aggregated-taker-buy-sell-volume/history', { exchange_list: 'Binance,OKX,Bybit', symbol: 'BTC', interval: '1d', limit: 3000 });
    const fm = new Map<number, number>();
    for (const r of (fut as any).data as any[]) { const t = Number(r.time); const v = Number(r.aggregated_buy_volume_usd) + Number(r.aggregated_sell_volume_usd); if (Number.isFinite(t) && v > 0) fm.set(dayKey(t), v); }
    const sm = new Map<number, number>();
    for (const r of (spot as any).data as any[]) { const t = Number(r.time); const v = Number(r.aggregated_buy_volume_usd) + Number(r.aggregated_sell_volume_usd); if (Number.isFinite(t) && v > 0) sm.set(dayKey(t), v); }
    for (const [k, fv] of fm) { const sv = sm.get(k); if (sv && sv > 0) volPts.push({ ts: k, sig: fv / sv }); }
    volPts.sort((a, b) => a.ts - b.ts);
    console.log(`\nFut/Spot vol ratio pts: ${volPts.length} (fut days=${fm.size} spot days=${sm.size})`);
  } catch (e: any) { console.log('\nFut/Spot vol ratio build FAILED:', (e?.message ?? String(e)).slice(0, 120)); }

  if (volPts.length > 120) {
    const volPct = trailingPct(volPts, 30);
    const volMom = momentum(volPts, 5);
    console.log('--- (2A) Fut/Spot vol ratio RAW -> BTC fwd ---');
    for (const H of [1, 3, 7]) { const { x, fwd, ts } = buildPairs(volPts, closes, H); report(`Vol-ratio raw -> ${H}d`, x, fwd, ts, `${H}d`); }
    console.log('--- (2B) Fut/Spot vol ratio 30d-percentile -> BTC fwd ---');
    for (const H of [1, 3, 7]) { const { x, fwd, ts } = buildPairs(volPct, closes, H); report(`Vol-ratio 30d-pct -> ${H}d`, x, fwd, ts, `${H}d`); }
    console.log('--- (2C) Fut/Spot vol ratio 5d-momentum -> BTC fwd ---');
    for (const H of [1, 3, 7]) { const { x, fwd, ts } = buildPairs(volMom, closes, H); report(`Vol-ratio 5d-mom -> ${H}d`, x, fwd, ts, `${H}d`); }
  }

  // ---- orthogonality on best candidate ----
  console.log('\n=== ORTHOGONALITY ===');
  const robustRows = collected.filter((r) => r.robust);
  console.log(`robust rows: ${robustRows.length ? robustRows.map((r) => r.signalDef).join('; ') : 'NONE'}`);
  // choose best by max min(|IC_IS|,|IC_OOS|) among robust, else among all
  const pool = robustRows.length ? robustRows : collected;
  const best = pool.slice().sort((a, b) => Math.min(Math.abs(b.icIS), Math.abs(b.icOOS)) - Math.min(Math.abs(a.icIS), Math.abs(a.icOOS)))[0];
  console.log(`best-by-min|IC|: ${best?.signalDef ?? 'none'} (IC IS=${best?.icIS.toFixed(3)} OOS=${best?.icOOS.toFixed(3)})`);

  const fund = await fundingOiPct();
  // reconstruct the best signal's pts to correlate
  function bestSignalPts(): Pt[] {
    if (!best) return [];
    const d = best.signalDef;
    if (d.startsWith('OI-ratio raw')) return oiPts;
    if (d.startsWith('OI-ratio 30d-pct')) return oiPct;
    if (d.startsWith('OI-ratio 5d-mom')) return oiMom;
    if (d.startsWith('Vol-ratio raw')) return volPts;
    if (d.startsWith('Vol-ratio 30d-pct')) return trailingPct(volPts, 30);
    if (d.startsWith('Vol-ratio 5d-mom')) return momentum(volPts, 5);
    return [];
  }
  const bp = bestSignalPts();
  if (bp.length && fund.length) {
    const { av, bv } = alignByDay(bp, fund);
    console.log(`vs funding-OI 30d pct: matched=${av.length} Spearman=${spearman(av, bv).toFixed(3)}  (|corr| small => orthogonal to live fade)`);
  }
  // vs trailing same-horizon price return (lagged-momentum)
  if (bp.length && best) {
    const H = parseInt(best.horizon, 10) || 3;
    const tr = trailingReturns(bp, closes, H);
    const sig: number[] = [], tret: number[] = [];
    for (let i = 0; i < bp.length; i++) { if (Number.isFinite(bp[i].sig) && Number.isFinite(tr[i])) { sig.push(bp[i].sig); tret.push(tr[i]); } }
    console.log(`vs trailing ${H}d price-return: matched=${sig.length} Spearman=${spearman(sig, tret).toFixed(3)}  (|corr| small => NOT lagged price momentum)`);
  }

  // ---- machine-readable dump ----
  console.log('\n=== ROWS_JSON ===');
  console.log(JSON.stringify(collected));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });

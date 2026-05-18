// BTC research: correlate CG metrics with future BTC returns.
//
// For each 4H BTC candle close:
//   features (computed from CG data at that ts or earlier):
//     - cb_premium_rate
//     - cb_premium_z (rolling 30d z-score)
//     - etf_flow_1d (most recent daily ETF net flow)
//     - etf_flow_3d_sum
//     - agg_taker_imbalance = (buy - sell) / (buy + sell)
//     - agg_taker_imbalance_z
//     - agg_liq_long_share = long / (long + short)
//     - agg_liq_total_z (total liq volume z-score)
//     - oi_delta_24h (% change in OI over last 24h, from cg_oi_aggregated)
//     - funding_oi_weighted (current)
//     - ls_top_pos_ratio (top trader long/short position ratio)
//     - taker_imbalance_binance (single-exchange comparison)
//
//   targets: forward returns at horizons 1, 6, 24, 72 hours (i.e. 1,2,6,18 × 4H bars)
//
// Output: Spearman correlation + decile analysis (top/bottom decile mean return).

import { query, close as closePg } from '../../core/db';

type Bar = { ts: number; close: number };

const TF_4H = '240m';
const SYMBOL = 'BTCUSDT';
const HORIZONS_BARS = [1, 6, 24, 72];  // 4h, 24h, 4d, 12d at 4H cadence

async function loadBtcBars(): Promise<Bar[]> {
  const r = await query<{ ts: string; close: string }>(
    `SELECT ts::text, close::text FROM candles WHERE symbol = $1 AND tf = $2 ORDER BY ts`,
    [SYMBOL, TF_4H]
  );
  return r.rows.map(row => ({ ts: Number(row.ts), close: Number(row.close) }));
}

// Generic "latest ≤ ts" series helper
function latestAt<T extends { ts: number }>(series: T[], ts: number): T | null {
  let lo = 0, hi = series.length - 1, found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (series[m].ts <= ts) { found = m; lo = m + 1; } else hi = m - 1;
  }
  return found >= 0 ? series[found] : null;
}

function rollingZ(series: number[], idx: number, window: number): number | null {
  if (idx < window) return null;
  const slice = series.slice(idx - window, idx);
  const mean = slice.reduce((a, b) => a + b, 0) / window;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / window;
  const sd = Math.sqrt(variance);
  if (sd < 1e-12) return null;
  return (series[idx] - mean) / sd;
}

// Spearman correlation: rank-based, robust to non-linearity.
function rank(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  // average rank for ties
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(a: number[], b: number[]): number {
  const ra = rank(a), rb = rank(b);
  const n = a.length;
  const meanA = ra.reduce((s, v) => s + v, 0) / n;
  const meanB = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const dA = ra[i] - meanA, dB = rb[i] - meanB;
    num += dA * dB; denA += dA ** 2; denB += dB ** 2;
  }
  if (denA < 1e-12 || denB < 1e-12) return 0;
  return num / Math.sqrt(denA * denB);
}

function decileAnalysis(featValues: number[], targetValues: number[]): { decile: number; mean: number; n: number }[] {
  const paired = featValues.map((v, i) => ({ v, t: targetValues[i] }));
  paired.sort((a, b) => a.v - b.v);
  const result: { decile: number; mean: number; n: number }[] = [];
  for (let d = 0; d < 10; d++) {
    const lo = Math.floor(paired.length * d / 10);
    const hi = Math.floor(paired.length * (d + 1) / 10);
    const slice = paired.slice(lo, hi);
    const mean = slice.reduce((s, x) => s + x.t, 0) / slice.length;
    result.push({ decile: d + 1, mean, n: slice.length });
  }
  return result;
}

async function main() {
  const bars = await loadBtcBars();
  console.log(`Loaded ${bars.length} BTC ${TF_4H} bars: ${new Date(bars[0].ts).toISOString().slice(0,10)} → ${new Date(bars[bars.length-1].ts).toISOString().slice(0,10)}`);

  // Load all features into arrays
  type T = { ts: number };
  const premium = (await query<{ ts: string; premium_rate: string }>(`SELECT ts::text, premium_rate::text FROM cg_cb_premium ORDER BY ts`)).rows.map(r => ({ ts: Number(r.ts), v: Number(r.premium_rate) }));
  const etf = (await query<{ ts: string; flow_usd: string }>(`SELECT ts::text, flow_usd::text FROM cg_btc_etf_flow ORDER BY ts`)).rows.map(r => ({ ts: Number(r.ts), v: Number(r.flow_usd) }));
  const aggTaker = (await query<{ ts: string; agg_buy_usd: string; agg_sell_usd: string }>(`SELECT ts::text, agg_buy_usd::text, agg_sell_usd::text FROM cg_agg_taker_coin WHERE symbol='BTC' ORDER BY ts`)).rows.map(r => ({ ts: Number(r.ts), buy: Number(r.agg_buy_usd), sell: Number(r.agg_sell_usd) }));
  const aggLiq = (await query<{ ts: string; agg_long_liq_usd: string; agg_short_liq_usd: string }>(`SELECT ts::text, agg_long_liq_usd::text, agg_short_liq_usd::text FROM cg_agg_liq_coin WHERE symbol='BTC' ORDER BY ts`)).rows.map(r => ({ ts: Number(r.ts), longL: Number(r.agg_long_liq_usd), shortL: Number(r.agg_short_liq_usd) }));
  const oi = (await query<{ ts: string; oi_close: string }>(`SELECT ts::text, oi_close::text FROM cg_oi_aggregated WHERE symbol='BTC' ORDER BY ts`)).rows.map(r => ({ ts: Number(r.ts), v: Number(r.oi_close) }));
  const fund = (await query<{ ts: string; fr_close: string }>(`SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts`)).rows.map(r => ({ ts: Number(r.ts), v: Number(r.fr_close) }));
  const lsTop = (await query<{ ts: string; ratio: string }>(`SELECT ts::text, ratio::text FROM cg_ls_top_position WHERE pair='BTCUSDT' ORDER BY ts`)).rows.map(r => ({ ts: Number(r.ts), v: Number(r.ratio) }));

  console.log(`Premium: ${premium.length}, ETF: ${etf.length}, AggTaker: ${aggTaker.length}, AggLiq: ${aggLiq.length}, OI: ${oi.length}, Fund: ${fund.length}, L/S: ${lsTop.length}`);

  // Build feature time-series
  const featNames = [
    'premium_rate', 'premium_z30',
    'etf_flow_1d', 'etf_flow_3d_sum',
    'agg_taker_imbal', 'agg_taker_imbal_z',
    'agg_liq_long_share', 'agg_liq_total_z',
    'oi_delta_24h', 'funding',
    'ls_top_pos_ratio',
  ] as const;

  // Compute features at each BTC bar ts
  type Row = { ts: number; price: number; feats: Map<string, number>; rets: Map<number, number> };
  const rows: Row[] = [];

  // pre-compute rolling values used by z-scores
  const aggTakerImbalSeries: number[] = aggTaker.map(d => (d.buy - d.sell) / (d.buy + d.sell));
  const aggLiqTotalSeries: number[] = aggLiq.map(d => d.longL + d.shortL);
  const premRateSeries: number[] = premium.map(d => d.v);

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const f = new Map<string, number>();

    const p = latestAt(premium, b.ts);
    if (p) {
      f.set('premium_rate', p.v);
      const idx = premium.indexOf(p);
      const z = rollingZ(premRateSeries, idx, 180); // 30d (180 × 4h)
      if (z !== null) f.set('premium_z30', z);
    }

    // ETF flow at this BTC ts: take most recent daily flow ≤ ts
    const e = latestAt(etf, b.ts);
    if (e) {
      const idx = etf.indexOf(e);
      f.set('etf_flow_1d', e.v);
      if (idx >= 3) f.set('etf_flow_3d_sum', e.v + etf[idx-1].v + etf[idx-2].v);
    }

    const at = latestAt(aggTaker, b.ts);
    if (at) {
      const idx = aggTaker.indexOf(at);
      const imbal = (at.buy - at.sell) / (at.buy + at.sell);
      f.set('agg_taker_imbal', imbal);
      const z = rollingZ(aggTakerImbalSeries, idx, 180);
      if (z !== null) f.set('agg_taker_imbal_z', z);
    }

    const al = latestAt(aggLiq, b.ts);
    if (al) {
      const idx = aggLiq.indexOf(al);
      const total = al.longL + al.shortL;
      if (total > 0) f.set('agg_liq_long_share', al.longL / total);
      const z = rollingZ(aggLiqTotalSeries, idx, 180);
      if (z !== null) f.set('agg_liq_total_z', z);
    }

    const o = latestAt(oi, b.ts);
    if (o) {
      const idx = oi.indexOf(o);
      if (idx >= 6) {  // 24h ago = 6 × 4h
        const prev = oi[idx - 6].v;
        if (prev > 0) f.set('oi_delta_24h', (o.v - prev) / prev);
      }
    }

    const fund1 = latestAt(fund, b.ts);
    if (fund1) f.set('funding', fund1.v);

    const ls = latestAt(lsTop, b.ts);
    if (ls) f.set('ls_top_pos_ratio', ls.v);

    // Forward returns
    const rets = new Map<number, number>();
    for (const h of HORIZONS_BARS) {
      if (i + h < bars.length) {
        rets.set(h, (bars[i + h].close - b.close) / b.close);
      }
    }

    rows.push({ ts: b.ts, price: b.close, feats: f, rets });
  }

  console.log(`\nProduced ${rows.length} rows. Now correlating...\n`);

  // Spearman + decile analysis for each feature × horizon
  console.log('=== Spearman correlation ===');
  console.log('feature                  h=1bar    h=6bar    h=24bar   h=72bar  ');
  console.log('                         (4h)      (24h)     (4d)      (12d)    ');
  console.log('-------------------------------------------------------------');
  const sigEntries: { feat: string; horizon: number; rho: number; n: number }[] = [];
  for (const featName of featNames) {
    const line: string[] = [featName.padEnd(24)];
    for (const h of HORIZONS_BARS) {
      const valid = rows.filter(r => r.feats.has(featName) && r.rets.has(h));
      if (valid.length < 50) { line.push(' n/a    '); continue; }
      const x = valid.map(r => r.feats.get(featName)!);
      const y = valid.map(r => r.rets.get(h)!);
      const rho = spearman(x, y);
      sigEntries.push({ feat: featName, horizon: h, rho, n: valid.length });
      const star = Math.abs(rho) > 0.10 ? '*' : Math.abs(rho) > 0.05 ? '·' : ' ';
      line.push(`${rho >= 0 ? '+' : ''}${rho.toFixed(3).padStart(6)}${star}  `);
    }
    console.log(line.join(''));
  }
  console.log('(· = |rho|>0.05, * = |rho|>0.10)\n');

  // Top features (|rho| > 0.05), decile analysis
  const promising = sigEntries.filter(e => Math.abs(e.rho) > 0.05).sort((a,b) => Math.abs(b.rho) - Math.abs(a.rho));
  console.log(`\n=== Decile analysis for promising features (|rho|>0.05): ${promising.length} entries ===`);
  for (const entry of promising.slice(0, 10)) {
    const valid = rows.filter(r => r.feats.has(entry.feat) && r.rets.has(entry.horizon));
    const x = valid.map(r => r.feats.get(entry.feat)!);
    const y = valid.map(r => r.rets.get(entry.horizon)!);
    const deciles = decileAnalysis(x, y);
    console.log(`\n${entry.feat} → ${entry.horizon}-bar return (n=${valid.length}, rho=${entry.rho.toFixed(3)})`);
    console.log('decile   feat_range     mean_ret_pct');
    for (const d of deciles) {
      console.log(`  D${String(d.decile).padStart(2)}    ${'  '.repeat(d.decile)}#${' '.repeat(11-d.decile)}  ${(d.mean * 100).toFixed(3)}%   (n=${d.n})`);
    }
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

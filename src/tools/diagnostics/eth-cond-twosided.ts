/**
 * eth-cond-twosided — ANGLE 1 follow-up. The only conditional candidate from
 * eth-cond-ic was "fade funding_oi when BTC 4H trend is DOWN" (IC neg both halves
 * at 48h). The robustness discriminator demands TWO-SIDED: the LONG-fade leg
 * (funding low → go long, expect rise) AND the SHORT-fade leg (funding high → go
 * short, expect drop) must BOTH be profitable in BOTH halves. If only the short
 * leg works, it is a down-regime directional bet, not an edge.
 *
 * Method: within {hasCG, BTC-trend-down} bars, take rolling-180 funding percentile.
 *   pct>=0.75 → SHORT-fade signal; expect fwd48h < 0.
 *   pct<=0.25 → LONG-fade  signal; expect fwd48h > 0.
 * Report mean fwd24h & fwd48h per leg, per IS/OOS half, with n.
 * Also do the same UNCONDITIONALLY (all BTC regimes) for contrast.
 *
 * Run: npx tsx src/tools/diagnostics/eth-cond-twosided.ts
 */
import { query, close as closePg } from '../../core/db';
import { ema } from '../../core/indicators';

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

async function load4h(symbol: string) {
  const c = await query<any>(`SELECT ts, close::text AS c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [symbol]);
  return { ts: c.rows.map((r: any) => Number(r.ts)), close: c.rows.map((r: any) => parseFloat(r.c)) };
}

function rollingTrendUp(close: number[], fast = 20, slow = 50): (boolean | null)[] {
  const out: (boolean | null)[] = new Array(close.length).fill(null);
  for (let i = slow; i < close.length; i++) {
    const win = close.slice(0, i + 1);
    const eF = ema(win, fast), eS = ema(win, slow);
    out[i] = (eF == null || eS == null) ? null : eF > eS;
  }
  return out;
}

function rollingPct(vals: (number | null)[], win = 180): (number | null)[] {
  const N = vals.length;
  const out: (number | null)[] = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const cur = vals[i];
    if (cur == null) continue;
    const lo = Math.max(0, i - win);
    const hist: number[] = [];
    for (let k = lo; k < i; k++) if (vals[k] != null) hist.push(vals[k]!);
    if (hist.length < 30) continue;
    let cnt = 0; for (const v of hist) if (v <= cur) cnt++;
    out[i] = cnt / hist.length;
  }
  return out;
}

function meanStats(idx: number[], fwd: (number | null)[]): { mean: number; n: number; wr: number } {
  let sum = 0, n = 0, win = 0;
  for (const i of idx) { const r = fwd[i]; if (r == null || !isFinite(r)) continue; sum += r; n++; if (r > 0) win++; }
  return { mean: n ? sum / n : NaN, n, wr: n ? win / n : NaN };
}

async function main() {
  const pair = 'ETHUSDT', coin = 'ETH';
  const eth = await load4h(pair);
  const btc = await load4h('BTCUSDT');
  const barTs = eth.ts, N = barTs.length, close = eth.close;

  const fundOi = await loadSeries(`SELECT ts, fr_close::text AS val FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`, [coin]);
  const aFundOi = alignLatest(barTs, fundOi);
  const pctFund = rollingPct(aFundOi);

  const btcTrendOwn = rollingTrendUp(btc.close);
  const btcTrendSeries: Row[] = [];
  for (let i = 0; i < btc.ts.length; i++) if (btcTrendOwn[i] != null) btcTrendSeries.push({ ts: btc.ts[i], val: btcTrendOwn[i] ? 1 : 0 });
  const aBtcTrend = alignLatest(barTs, btcTrendSeries);

  const fwd = (K: number): (number | null)[] => {
    const out: (number | null)[] = new Array(N).fill(null);
    for (let i = 0; i + K < N; i++) if (close[i] > 0) out[i] = (close[i + K] - close[i]) / close[i];
    return out;
  };
  const fwd24 = fwd(6), fwd48 = fwd(12);

  const cgIdx = barTs.map((_, i) => i).filter(i => aFundOi[i] != null);
  const midTs = barTs[cgIdx[Math.floor(cgIdx.length / 2)]];
  const isHalf = (i: number) => barTs[i] < midTs, oosHalf = (i: number) => barTs[i] >= midTs;

  const pm = (s: { mean: number; n: number; wr: number }) => s.n ? `${(s.mean * 100 >= 0 ? '+' : '')}${(s.mean * 100).toFixed(2)}% wr${(s.wr * 100).toFixed(0)}% n${s.n}` : 'n=0';

  // Build leg index sets given a regime predicate
  function legSets(regimePred: (i: number) => boolean) {
    const shortIS: number[] = [], shortOOS: number[] = [], longIS: number[] = [], longOOS: number[] = [];
    for (let i = 0; i < N; i++) {
      if (aFundOi[i] == null || pctFund[i] == null || !regimePred(i)) continue;
      const p = pctFund[i]!;
      if (p >= 0.75) { (isHalf(i) ? shortIS : shortOOS).push(i); }
      else if (p <= 0.25) { (isHalf(i) ? longIS : longOOS).push(i); }
    }
    return { shortIS, shortOOS, longIS, longOOS };
  }

  function report(title: string, regimePred: (i: number) => boolean) {
    const L = legSets(regimePred);
    console.log(`\n── ${title} ──`);
    console.log(`SHORT-fade (funding pct>=.75 → expect DROP, profit if fwd<0):`);
    console.log(`   IS  fwd24 ${pm(meanStats(L.shortIS, fwd24))} | fwd48 ${pm(meanStats(L.shortIS, fwd48))}`);
    console.log(`   OOS fwd24 ${pm(meanStats(L.shortOOS, fwd24))} | fwd48 ${pm(meanStats(L.shortOOS, fwd48))}`);
    console.log(`LONG-fade (funding pct<=.25 → expect RISE, profit if fwd>0):`);
    console.log(`   IS  fwd24 ${pm(meanStats(L.longIS, fwd24))} | fwd48 ${pm(meanStats(L.longIS, fwd48))}`);
    console.log(`   OOS fwd24 ${pm(meanStats(L.longOOS, fwd24))} | fwd48 ${pm(meanStats(L.longOOS, fwd48))}`);
    // two-sided verdict on fwd48
    const sIS = meanStats(L.shortIS, fwd48).mean, sOO = meanStats(L.shortOOS, fwd48).mean;
    const lIS = meanStats(L.longIS, fwd48).mean, lOO = meanStats(L.longOOS, fwd48).mean;
    const shortOk = sIS < 0 && sOO < 0;
    const longOk = lIS > 0 && lOO > 0;
    console.log(`   → SHORT leg profitable both halves: ${shortOk ? 'YES' : 'no'} | LONG leg profitable both halves: ${longOk ? 'YES' : 'no'} | TWO-SIDED: ${shortOk && longOk ? 'YES ✓' : 'NO ✗'}`);
  }

  console.log(`\n══ ETH funding-fade TWO-SIDED TEST ══`);
  console.log(`bars=${N} CG=${cgIdx.length} IS<${new Date(midTs).toISOString().slice(0, 10)}<=OOS`);
  report('UNCONDITIONAL (all BTC regimes)', () => true);
  report('BTC TREND DOWN only', (i) => aBtcTrend[i] === 0);
  report('BTC TREND UP only', (i) => aBtcTrend[i] === 1);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });

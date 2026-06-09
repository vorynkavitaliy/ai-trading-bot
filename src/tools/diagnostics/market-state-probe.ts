import { query } from '../../core/db';
import { percentile } from '../../core/indicators';

const PAIRS = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];
const WINDOW = 180;

async function main() {
  const now = Date.now();
  for (const pair of PAIRS) {
    const coin = pair.replace('USDT', '');
    // L/S top position ratio history (Binance) ascending, last 200
    const posHist = await query<{ ratio: string }>(
      `SELECT ratio::text FROM cg_ls_top_position
       WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2
       ORDER BY ts DESC LIMIT 200`,
      [pair, now]
    );
    const posSeries = posHist.rows.map(r => parseFloat(r.ratio)).reverse();
    const posCur = posSeries.length ? posSeries[posSeries.length - 1] : null;
    const posPct = posCur != null ? percentile(posSeries.slice(-WINDOW), posCur) : null;

    // funding oi-weighted history (symbol = coin)
    const fHist = await query<{ fr_close: string }>(
      `SELECT fr_close::text FROM cg_funding_oi_weighted
       WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 200`,
      [coin, now]
    );
    const fSeries = fHist.rows.map(r => parseFloat(r.fr_close)).reverse();
    const fCur = fSeries.length ? fSeries[fSeries.length - 1] : null;
    const fPct = fCur != null ? percentile(fSeries.slice(-WINDOW), fCur) : null;

    // L/S top account long pct (current)
    const accRow = await query<{ long_pct: string; ts: string }>(
      `SELECT long_pct::text, ts::text FROM cg_ls_top_account
       WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2
       ORDER BY ts DESC LIMIT 1`,
      [pair, now]
    );
    const accLong = accRow.rows[0] ? parseFloat(accRow.rows[0].long_pct) : null;
    const accTs = accRow.rows[0] ? Number(accRow.rows[0].ts) : null;

    // freshness of the cg position series
    const lastTs = await query<{ ts: string }>(
      `SELECT ts::text FROM cg_ls_top_position
       WHERE pair = $1 AND exchange = 'Binance' ORDER BY ts DESC LIMIT 1`,
      [pair]
    );
    const lastCgTs = lastTs.rows[0] ? Number(lastTs.rows[0].ts) : null;

    console.log(JSON.stringify({
      pair,
      cgLastTs: lastCgTs ? new Date(lastCgTs).toISOString() : null,
      cgAgeH: lastCgTs ? +(((now - lastCgTs) / 3600_000).toFixed(1)) : null,
      lsTopPosRatio: posCur,
      lsTopPosPctile: posPct != null ? +(posPct * 100).toFixed(1) : null,
      fundingOiWeighted: fCur,
      fundingPctile: fPct != null ? +(fPct * 100).toFixed(1) : null,
      lsTopAccountLongPct: accLong,
      lsTopAccountTs: accTs ? new Date(accTs).toISOString() : null,
      nPosBars: posSeries.length,
    }));
  }

  // BTC price + drawdown from bot's own 240m candles (ground truth)
  const btc240 = await query<{ ts: string; high: string; low: string; close: string }>(
    `SELECT ts::text, high::text, low::text, close::text FROM candles
     WHERE symbol = 'BTCUSDT' AND tf = '240m' ORDER BY ts DESC LIMIT 200`,
    []
  );
  const rows = btc240.rows.map(r => ({
    ts: Number(r.ts), high: parseFloat(r.high), low: parseFloat(r.low), close: parseFloat(r.close),
  })).reverse();
  const last = rows[rows.length - 1];
  const peak = Math.max(...rows.map(r => r.high));
  const peakRow = rows.find(r => r.high === peak)!;
  // recent low: lowest low AFTER the peak
  const afterPeak = rows.filter(r => r.ts >= peakRow.ts);
  const recentLow = Math.min(...afterPeak.map(r => r.low));
  const price = last.close;
  const ddFromPeak = ((peak - price) / peak) * 100;
  const ddPeakToTrough = ((peak - recentLow) / peak) * 100;

  console.log(JSON.stringify({
    btcPrice: price,
    btcLastBarTs: new Date(last.ts).toISOString(),
    btc240Peak: peak,
    btc240PeakTs: new Date(peakRow.ts).toISOString(),
    btc240RecentLowAfterPeak: recentLow,
    drawdownFromPeakToCurrentPct: +ddFromPeak.toFixed(2),
    drawdownPeakToTroughPct: +ddPeakToTrough.toFixed(2),
    nBars: rows.length,
    windowStart: new Date(rows[0].ts).toISOString(),
  }));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

import fs from 'node:fs';
import path from 'node:path';
import { query } from '../../lib/db';
import { computeFeatures, CandleRow, FeatureSnapshot } from '../../data/features';
import { log } from '../../lib/logger';
import { CandidateReason, CoinglassFeatures, QueueEntry, Snapshot, SnapshotMeta } from './types';

const VAULT_BACKTEST = path.resolve(__dirname, '../../../vault/Backtest');

interface PrepareConfig {
  symbol: string;
  startTs: number;
  endTs: number;
  // Candidate filters
  bbTouchAtrFraction: number;     // 0.3 — within this many ATRs of BB band counts as touch
  ema55BandPct: number;           // 0.5 — within ±0.5% of EMA55
  rsiLow: number;                 // 32
  rsiHigh: number;                // 68
  volSpikeMin: number;            // 1.5
}

const DEFAULTS: Omit<PrepareConfig, 'symbol' | 'startTs' | 'endTs'> = {
  bbTouchAtrFraction: 0.3,
  ema55BandPct: 0.5,
  rsiLow: 32,
  rsiHigh: 68,
  volSpikeMin: 1.5,
};

async function loadAllCandles(symbol: string, tf: string, fromTs: number, toTs: number) {
  const sql = `SELECT ts::text, open, high, low, close, volume
               FROM candles WHERE symbol = $1 AND tf = $2
               AND ts >= $3 AND ts <= $4 ORDER BY ts ASC`;
  const r = await query<any>(sql, [symbol, tf, fromTs, toTs]);
  return r.rows.map<CandleRow>((row) => ({
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
  }));
}

function checkCandidate(
  f: FeatureSnapshot,
  cfg: PrepareConfig
): CandidateReason[] {
  const reasons: CandidateReason[] = [];
  if (f.bb_lower != null && f.atr != null) {
    const dist = Math.abs(f.close - f.bb_lower);
    if (dist <= cfg.bbTouchAtrFraction * f.atr) {
      reasons.push({
        kind: 'bb_touch_lower',
        detail: `close ${f.close.toFixed(2)} within ${cfg.bbTouchAtrFraction}×ATR of BB.lower ${f.bb_lower.toFixed(2)}`,
      });
    }
  }
  if (f.bb_upper != null && f.atr != null) {
    const dist = Math.abs(f.close - f.bb_upper);
    if (dist <= cfg.bbTouchAtrFraction * f.atr) {
      reasons.push({
        kind: 'bb_touch_upper',
        detail: `close ${f.close.toFixed(2)} within ${cfg.bbTouchAtrFraction}×ATR of BB.upper ${f.bb_upper.toFixed(2)}`,
      });
    }
  }
  if (f.ema55 != null && f.ema_stack_aligned !== null) {
    const dist = Math.abs(f.close - f.ema55);
    const band = f.ema55 * (cfg.ema55BandPct / 100);
    if (dist <= band) {
      reasons.push({
        kind: 'ema55_pullback',
        detail: `close ${f.close.toFixed(2)} within ${cfg.ema55BandPct}% of EMA55 ${f.ema55.toFixed(2)}, stack=${f.ema_stack_aligned}`,
      });
    }
  }
  if (f.rsi != null) {
    if (f.rsi < cfg.rsiLow) {
      reasons.push({ kind: 'rsi_extreme_low', detail: `RSI ${f.rsi.toFixed(1)} < ${cfg.rsiLow}` });
    } else if (f.rsi > cfg.rsiHigh) {
      reasons.push({ kind: 'rsi_extreme_high', detail: `RSI ${f.rsi.toFixed(1)} > ${cfg.rsiHigh}` });
    }
  }
  if (f.volume_spike != null && f.volume_spike >= cfg.volSpikeMin) {
    reasons.push({
      kind: 'volume_spike',
      detail: `volume ${f.volume_spike.toFixed(2)}× SMA20`,
    });
  }
  return reasons;
}

function compactBars(bars: CandleRow[]): { ts: number; o: number; h: number; l: number; c: number; v: number }[] {
  return bars.map((b) => ({
    ts: b.ts, o: b.open, h: b.high, l: b.low, c: b.close, v: Math.round(b.volume * 1000) / 1000,
  }));
}

// Resolve cross-exchange aggregates at-or-before atTs. All queries enforce
// `ts <= atTs` to prevent lookahead.
async function loadCoinglassAt(coin: string, pair: string, atTs: number): Promise<CoinglassFeatures> {
  const ms24h = 24 * 3600_000;
  // Aggregated OI (sym = coin, e.g. 'BTC')
  const oiNow = await query<{ oi_close: string }>(
    `SELECT oi_close::text FROM cg_oi_aggregated
     WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs]
  );
  const oi24 = await query<{ oi_close: string }>(
    `SELECT oi_close::text FROM cg_oi_aggregated
     WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs - ms24h]
  );
  const oiClose = oiNow.rows[0] ? parseFloat(oiNow.rows[0].oi_close) : null;
  const oi24Close = oi24.rows[0] ? parseFloat(oi24.rows[0].oi_close) : null;
  const oiDelta = oiClose != null && oi24Close != null ? oiClose - oi24Close : null;
  const oiPct = oiDelta != null && oi24Close != null && oi24Close > 0 ? (oiDelta / oi24Close) * 100 : null;

  // Funding (cross-exchange) — close of last 4h bar
  const fOi = await query<{ fr_close: string }>(
    `SELECT fr_close::text FROM cg_funding_oi_weighted
     WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs]
  );
  const fVol = await query<{ fr_close: string }>(
    `SELECT fr_close::text FROM cg_funding_vol_weighted
     WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs]
  );

  // L/S ratios on Binance (pair-level)
  const lsGlobal = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_global_account
     WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [pair, atTs]
  );
  const lsTopAcc = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_top_account
     WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [pair, atTs]
  );
  const lsTopPos = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_top_position
     WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [pair, atTs]
  );

  // Liquidation last 24h (sum of last 6 4h-bars on Binance pair series)
  const liqRows = await query<{ long_liq_usd: string; short_liq_usd: string }>(
    `SELECT long_liq_usd::text, short_liq_usd::text FROM cg_liq_pair
     WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 AND ts > $3
     ORDER BY ts DESC`,
    [pair, atTs, atTs - ms24h]
  );
  const liqLong = liqRows.rows.reduce((s, r) => s + parseFloat(r.long_liq_usd), 0);
  const liqShort = liqRows.rows.reduce((s, r) => s + parseFloat(r.short_liq_usd), 0);

  // Taker buy/sell last 24h (Binance pair series)
  const takerRows = await query<{ buy_usd: string; sell_usd: string }>(
    `SELECT buy_usd::text, sell_usd::text FROM cg_taker_pair
     WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 AND ts > $3
     ORDER BY ts DESC`,
    [pair, atTs, atTs - ms24h]
  );
  const takerBuy = takerRows.rows.reduce((s, r) => s + parseFloat(r.buy_usd), 0);
  const takerSell = takerRows.rows.reduce((s, r) => s + parseFloat(r.sell_usd), 0);

  return {
    oi_close: oiClose,
    oi_delta_24h: oiDelta,
    oi_pct_chg_24h: oiPct,
    funding_oi_weighted: fOi.rows[0] ? parseFloat(fOi.rows[0].fr_close) : null,
    funding_vol_weighted: fVol.rows[0] ? parseFloat(fVol.rows[0].fr_close) : null,
    ls_global_account: lsGlobal.rows[0] ? parseFloat(lsGlobal.rows[0].ratio) : null,
    ls_top_account: lsTopAcc.rows[0] ? parseFloat(lsTopAcc.rows[0].ratio) : null,
    ls_top_position: lsTopPos.rows[0] ? parseFloat(lsTopPos.rows[0].ratio) : null,
    liq_long_24h_usd: liqLong > 0 ? Math.round(liqLong) : null,
    liq_short_24h_usd: liqShort > 0 ? Math.round(liqShort) : null,
    taker_buy_24h_usd: takerBuy > 0 ? Math.round(takerBuy) : null,
    taker_sell_24h_usd: takerSell > 0 ? Math.round(takerSell) : null,
    taker_delta_24h_usd: takerBuy + takerSell > 0 ? Math.round(takerBuy - takerSell) : null,
  };
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export async function prepareWalk(symbol: string, startTs: number, endTs: number): Promise<QueueEntry[]> {
  const cfg: PrepareConfig = { symbol, startTs, endTs, ...DEFAULTS };
  ensureDir(path.join(VAULT_BACKTEST, 'snapshots'));
  ensureDir(path.join(VAULT_BACKTEST, 'decisions'));
  ensureDir(path.join(VAULT_BACKTEST, 'outcomes'));

  log.info('claude-walk prepare', { symbol, fromIso: new Date(startTs).toISOString(), toIso: new Date(endTs).toISOString() });

  // Load all 1H bars including warmup, then iterate decision points.
  const warmupMs = 300 * 60 * 60_000;
  const bars1hAll = await loadAllCandles(symbol, '60m', startTs - warmupMs, endTs);
  const bars15m = await loadAllCandles(symbol, '15m', startTs - warmupMs, endTs);
  const bars5m = await loadAllCandles(symbol, '5m', startTs - 50 * 60 * 60_000, endTs);
  const fundingRows = await query<any>(
    `SELECT ts::text, rate::text FROM funding_history WHERE symbol = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
    [symbol, startTs - warmupMs, endTs]
  );
  const fundingByTs = new Map<number, number>();
  for (const row of fundingRows.rows) fundingByTs.set(parseInt(row.ts, 10), parseFloat(row.rate));

  const queue: QueueEntry[] = [];
  let candidatesFound = 0;

  for (let i = 0; i < bars1hAll.length; i++) {
    const bar = bars1hAll[i];
    if (bar.ts < startTs) continue;
    if (bar.ts > endTs) break;
    if (i < 200) continue; // warmup
    const slice1h = bars1hAll.slice(Math.max(0, i - 299), i + 1);
    const f1h = computeFeatures(symbol, '60m', slice1h);
    const reasons = checkCandidate(f1h, cfg);
    if (reasons.length === 0) continue;
    candidatesFound++;

    // Build snapshot
    const idIso = new Date(bar.ts).toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const id = `${symbol}_${idIso}`;
    // 15m features
    const slice15m = bars15m.filter((b) => b.ts <= bar.ts).slice(-300);
    const f15m = slice15m.length >= 100 ? computeFeatures(symbol, '15m', slice15m) : null;
    // 5m features
    const slice5m = bars5m.filter((b) => b.ts <= bar.ts).slice(-300);
    const f5m = slice5m.length >= 100 ? computeFeatures(symbol, '5m', slice5m) : null;

    const fundingTsList = [...fundingByTs.keys()].filter((t) => t <= bar.ts);
    const fundingRate = fundingTsList.length ? fundingByTs.get(Math.max(...fundingTsList))! : null;

    const coin = symbol.replace(/USDT$/, '');
    const coinglass = await loadCoinglassAt(coin, symbol, bar.ts);

    const meta: SnapshotMeta = {
      id, symbol, ts: bar.ts,
      iso: new Date(bar.ts).toISOString(),
      reasons, price: bar.close,
    };
    const snapshot: Snapshot = {
      meta,
      bars1h: compactBars(slice1h.slice(-50)),
      bars15m: compactBars(slice15m.slice(-100)),
      bars5m: compactBars(slice5m.slice(-100)),
      features: { h1: f1h, m15: f15m, m5: f5m },
      fundingRate,
      coinglass,
      hint: {
        bb_upper_1h: f1h.bb_upper,
        bb_middle_1h: f1h.bb_middle,
        bb_lower_1h: f1h.bb_lower,
        ema55_1h: f1h.ema55,
        atr_1h: f1h.atr,
        adx_1h: f1h.adx,
      },
    };
    const snapPath = path.join(VAULT_BACKTEST, 'snapshots', `${id}.json`);
    fs.writeFileSync(snapPath, JSON.stringify(snapshot));
    queue.push({
      id, symbol, ts: bar.ts, iso: meta.iso,
      snapshotPath: path.relative(path.resolve(__dirname, '../../..'), snapPath),
      status: 'pending',
      reasons: reasons.map((r) => r.kind),
    });
  }

  log.info('claude-walk prepared', { symbol, candidates: candidatesFound, queueWritten: queue.length });
  return queue;
}

export async function prepareAll(symbols: string[], daysBack: number) {
  const now = Date.now();
  const startTs = now - daysBack * 24 * 60 * 60_000;
  const endTs = now;
  ensureDir(VAULT_BACKTEST);
  let allQueue: QueueEntry[] = [];
  for (const sym of symbols) {
    const q = await prepareWalk(sym, startTs, endTs);
    allQueue = allQueue.concat(q);
  }
  // Merge with existing queue.json (don't overwrite already-decided)
  const queuePath = path.join(VAULT_BACKTEST, 'queue.json');
  let existing: QueueEntry[] = [];
  if (fs.existsSync(queuePath)) {
    existing = JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueEntry[];
  }
  const existingById = new Map(existing.map((e) => [e.id, e]));
  for (const q of allQueue) {
    if (!existingById.has(q.id)) existingById.set(q.id, q);
  }
  const merged = [...existingById.values()].sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(queuePath, JSON.stringify(merged, null, 2));
  log.info('claude-walk queue written', { path: queuePath, total: merged.length });
}

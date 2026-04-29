import { query } from './lib/db';
import { getFeatures, FeatureSnapshot } from './data/features';
import { getRiskState, RiskState } from './risk-guard';
import { log } from './lib/logger';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const TFS = ['5m', '15m', '60m', '240m'] as const;

interface CgRecentRow {
  ts: number;
  [k: string]: any;
}

async function fetchLatest<T = any>(table: string, symbolField: string, symbol: string, n = 6): Promise<T[]> {
  const r = await query<any>(
    `SELECT * FROM ${table} WHERE ${symbolField} = $1 ORDER BY ts DESC LIMIT $2`,
    [symbol, n]
  );
  return r.rows.reverse() as T[];
}

async function fetchLatestPair<T = any>(table: string, pair: string, exchange: string, n = 6): Promise<T[]> {
  const r = await query<any>(
    `SELECT * FROM ${table} WHERE pair = $1 AND exchange = $2 ORDER BY ts DESC LIMIT $3`,
    [pair, exchange, n]
  );
  return r.rows.reverse() as T[];
}

interface PairSnapshot {
  symbol: string;
  price: number;
  features: {
    m5: FeatureSnapshot | null;
    m15: FeatureSnapshot | null;
    h1: FeatureSnapshot;
    h4: FeatureSnapshot | null;
  };
  regime: 'range' | 'trend_bull' | 'trend_bear' | 'transition';
  funding: {
    last3h: number[];                       // recent 3 funding rates (Bybit own)
    cgOiWeightedClose: number | null;        // last 4h close from cg_funding_oi_weighted
    cgVolWeightedClose: number | null;
  };
  oi: {
    cgAggregatedClose: number | null;
    cgAggregatedDelta24h: number | null;     // close - close 24h ago, USD
  };
  longShort: {
    globalAccountRatio: number | null;       // last
    topTraderAccountRatio: number | null;
    topTraderPositionRatio: number | null;
  };
  liquidation: {
    cgPair24hLong: number | null;
    cgPair24hShort: number | null;
    cgCoin24h: number | null;
    cgCoin1h: number | null;
  };
  taker: {
    cgPairBuy24h: number | null;
    cgPairSell24h: number | null;
    cgPairDelta24h: number | null;            // buy - sell
  };
}

function determineRegime(f: FeatureSnapshot): PairSnapshot['regime'] {
  if (f.adx == null) return 'transition';
  if (f.adx < 22) return 'range';
  if (f.adx >= 25 && f.ema_stack_aligned === 'bull') return 'trend_bull';
  if (f.adx >= 25 && f.ema_stack_aligned === 'bear') return 'trend_bear';
  return 'transition';
}

async function buildPairSnapshot(symbol: string): Promise<PairSnapshot> {
  // Multi-TF features
  const [f5m, f15m, f1h, f4h] = await Promise.all([
    getFeatures(symbol, '5m', undefined, false).catch(() => null),
    getFeatures(symbol, '15m', undefined, false).catch(() => null),
    getFeatures(symbol, '60m', undefined, false),
    getFeatures(symbol, '240m', undefined, false).catch(() => null),
  ]);

  // Funding (Bybit own)
  const fr = await query<{ rate: string }>(
    `SELECT rate::text FROM funding_history WHERE symbol = $1 ORDER BY ts DESC LIMIT 3`,
    [symbol]
  );
  const last3hFr = fr.rows.map((r) => parseFloat(r.rate)).reverse();

  // Coinglass aggregates
  const coin = symbol.replace(/USDT$/, '');     // BTC/ETH
  const [cgOi, cgFundingOi, cgFundingVol, cgLiqPair, cgLiqCoinSnap, cgTakerPair, cgLsGlobal, cgLsTopAcc, cgLsTopPos] = await Promise.all([
    fetchLatest<CgRecentRow>('cg_oi_aggregated', 'symbol', coin, 7),
    fetchLatest<CgRecentRow>('cg_funding_oi_weighted', 'symbol', coin, 1),
    fetchLatest<CgRecentRow>('cg_funding_vol_weighted', 'symbol', coin, 1),
    fetchLatestPair<CgRecentRow>('cg_liq_pair', symbol, 'Binance', 6),
    query<any>(
      `SELECT * FROM cg_liq_coin_snapshot WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
      [coin]
    ).then(r => r.rows),
    fetchLatestPair<CgRecentRow>('cg_taker_pair', symbol, 'Binance', 6),
    fetchLatestPair<CgRecentRow>('cg_ls_global_account', symbol, 'Binance', 1),
    fetchLatestPair<CgRecentRow>('cg_ls_top_account', symbol, 'Binance', 1),
    fetchLatestPair<CgRecentRow>('cg_ls_top_position', symbol, 'Binance', 1),
  ]);

  const oiClose = cgOi.length > 0 ? parseFloat(cgOi[cgOi.length - 1].oi_close) : null;
  const oi24hAgo = cgOi.length === 7 ? parseFloat(cgOi[0].oi_close) : null;
  const oiDelta = oiClose != null && oi24hAgo != null ? oiClose - oi24hAgo : null;

  const liq24hLong = cgLiqPair.reduce((s, r) => s + parseFloat(r.long_liq_usd ?? '0'), 0);
  const liq24hShort = cgLiqPair.reduce((s, r) => s + parseFloat(r.short_liq_usd ?? '0'), 0);

  const takerBuy24h = cgTakerPair.reduce((s, r) => s + parseFloat(r.buy_usd ?? '0'), 0);
  const takerSell24h = cgTakerPair.reduce((s, r) => s + parseFloat(r.sell_usd ?? '0'), 0);

  return {
    symbol,
    price: f1h.close,
    features: {
      m5: f5m,
      m15: f15m,
      h1: f1h,
      h4: f4h,
    },
    regime: determineRegime(f1h),
    funding: {
      last3h: last3hFr,
      cgOiWeightedClose: cgFundingOi[0] ? parseFloat(cgFundingOi[0].fr_close) : null,
      cgVolWeightedClose: cgFundingVol[0] ? parseFloat(cgFundingVol[0].fr_close) : null,
    },
    oi: {
      cgAggregatedClose: oiClose,
      cgAggregatedDelta24h: oiDelta,
    },
    longShort: {
      globalAccountRatio: cgLsGlobal[0] ? parseFloat(cgLsGlobal[0].ratio) : null,
      topTraderAccountRatio: cgLsTopAcc[0] ? parseFloat(cgLsTopAcc[0].ratio) : null,
      topTraderPositionRatio: cgLsTopPos[0] ? parseFloat(cgLsTopPos[0].ratio) : null,
    },
    liquidation: {
      cgPair24hLong: liq24hLong,
      cgPair24hShort: liq24hShort,
      cgCoin24h: cgLiqCoinSnap[0]?.liq_24h ? parseFloat(cgLiqCoinSnap[0].liq_24h) : null,
      cgCoin1h: cgLiqCoinSnap[0]?.liq_1h ? parseFloat(cgLiqCoinSnap[0].liq_1h) : null,
    },
    taker: {
      cgPairBuy24h: takerBuy24h,
      cgPairSell24h: takerSell24h,
      cgPairDelta24h: takerBuy24h - takerSell24h,
    },
  };
}

export interface ScanSnapshot {
  cycle: { ts: number; iso: string };
  risk: RiskState;
  pairs: PairSnapshot[];
}

export async function scanAll(): Promise<ScanSnapshot> {
  const now = new Date();
  const [risk, ...pairs] = await Promise.all([
    getRiskState(now),
    ...SYMBOLS.map(s => buildPairSnapshot(s)),
  ]);
  return {
    cycle: { ts: now.getTime(), iso: now.toISOString() },
    risk,
    pairs,
  };
}

async function main() {
  const arg = process.argv[2];
  if (arg && arg !== 'all' && !SYMBOLS.includes(arg)) {
    console.error(`unknown symbol ${arg}; use 'all' or one of ${SYMBOLS.join(', ')}`);
    process.exit(1);
  }
  const snap = await scanAll();
  if (arg && arg !== 'all') {
    const found = snap.pairs.find(p => p.symbol === arg);
    if (!found) {
      console.error(`no snapshot for ${arg}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ cycle: snap.cycle, risk: snap.risk, pair: found }, null, 2));
  } else {
    console.log(JSON.stringify(snap, null, 2));
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(e => {
      log.error('scan-summary failed', { err: e?.message ?? String(e), stack: e?.stack });
      process.exit(1);
    });
}

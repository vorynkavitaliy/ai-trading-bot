/**
 * cg-catalog-probe — exhaustive, read-only access-map probe of the Coinglass v4 API
 * surface that we do NOT already verify in cg-tier-probe / cg-large-ob-probe / backfill.
 *
 * For every endpoint family it tries the inferred v4 path (one or two attempts) with
 * BTC/BTCUSDT params, classifies the outcome, and on 200 records the first-row keys +
 * a rough history span (from any time/ts-like field across the first vs last row).
 *
 * Pure HTTP. Each call try/catch + per-call timeout; 300ms paced (Standard 300/min).
 * Run: npx tsx src/tools/diagnostics/cg-catalog-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 12_000;
const PACE_MS = 320;

interface Probe {
  name: string;
  section: string;
  path: string;
  params: Record<string, string | number>;
  altPath?: string;
  altParams?: Record<string, string | number>;
}

const SYM = 'BTC';
const PAIR = 'BTCUSDT';
const EX = 'Binance';

const probes: Probe[] = [
  // ============ Trading-Market (general / futures support) ============
  { name: 'supported-coins',       section: 'Trading-Market', path: '/futures/supported-coins', params: {} },
  { name: 'supported-exchange-pairs', section: 'Trading-Market', path: '/futures/supported-exchange-pairs', params: {} },
  { name: 'pairs-markets',         section: 'Trading-Market', path: '/futures/pairs-markets', params: { symbol: SYM } },
  { name: 'coins-markets',         section: 'Trading-Market', path: '/futures/coins-markets', params: {} },
  { name: 'price-ohlc',            section: 'Trading-Market', path: '/futures/price/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'delisted-pairs',        section: 'Trading-Market', path: '/futures/delisted-pair', params: {}, altPath: '/futures/delisted-pairs', altParams: {} },
  { name: 'exchange-rank',         section: 'Trading-Market', path: '/futures/exchange-rank', params: {} },

  // ============ Open Interest ============
  { name: 'oi-history',            section: 'OI', path: '/futures/open-interest/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'oi-agg-stablecoin',     section: 'OI', path: '/futures/open-interest/aggregated-stablecoin-margin-history', params: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'oi-agg-coin-margin',    section: 'OI', path: '/futures/open-interest/aggregated-coin-margin-history', params: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'oi-exchange-list',      section: 'OI', path: '/futures/open-interest/exchange-list', params: { symbol: SYM } },

  // ============ Funding rate ============
  { name: 'funding-exchange-list', section: 'Funding', path: '/futures/funding-rate/exchange-list', params: { symbol: SYM } },
  { name: 'funding-cumulative',    section: 'Funding', path: '/futures/funding-rate/accumulated-exchange-list', params: { range: '7d' }, altPath: '/futures/funding-rate/cumulative-history', altParams: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'funding-arbitrage',     section: 'Funding', path: '/futures/funding-rate/arbitrage', params: { usd: 10000 } },

  // ============ Long/Short ratio ============
  { name: 'ls-taker-ratio',        section: 'LS', path: '/futures/taker-buy-sell-volume/exchange-list', params: { symbol: SYM, range: '4h' } },

  // ============ Liquidation ============
  { name: 'liq-coin-history',      section: 'Liquidation', path: '/futures/liquidation/aggregated-coin-history', params: { symbol: SYM, interval: '4h', limit: 5 }, altPath: '/futures/liquidation/coin-history', altParams: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'liq-order',             section: 'Liquidation', path: '/futures/liquidation/order', params: { exchange: EX, symbol: PAIR } },
  { name: 'liq-map',               section: 'Liquidation', path: '/futures/liquidation/map', params: { exchange: EX, symbol: PAIR } },
  { name: 'liq-agg-map',           section: 'Liquidation', path: '/futures/liquidation/aggregated-map', params: { symbol: SYM } },

  // ============ Order book ============
  { name: 'ob-pair-bidask',        section: 'OrderBook', path: '/futures/orderbook/ask-bids-history', params: { exchange: EX, symbol: PAIR, interval: '4h', range: 5, limit: 5 } },
  { name: 'ob-coin-bidask',        section: 'OrderBook', path: '/futures/orderbook/aggregated-ask-bids-history', params: { symbol: SYM, interval: '4h', range: 5, limit: 5, exchange_list: EX } },
  { name: 'ob-heatmap',            section: 'OrderBook', path: '/futures/orderbook/heatmap', params: { exchange: EX, symbol: PAIR } },

  // ============ Hyperliquid ============
  { name: 'hl-whale-position',     section: 'Hyperliquid', path: '/hyperliquid/whale-position', params: {} },
  { name: 'hl-whale-alert',        section: 'Hyperliquid', path: '/hyperliquid/whale-alert', params: {} },
  { name: 'hl-positions',          section: 'Hyperliquid', path: '/hyperliquid/positions', params: { symbol: SYM } },
  { name: 'hl-balance',            section: 'Hyperliquid', path: '/hyperliquid/balance', params: {} },
  { name: 'hl-funding',            section: 'Hyperliquid', path: '/hyperliquid/funding-rate/history', params: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'hl-oi',                 section: 'Hyperliquid', path: '/hyperliquid/open-interest/history', params: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'hl-trader',             section: 'Hyperliquid', path: '/hyperliquid/trader', params: {} },
  { name: 'hl-leaderboard',        section: 'Hyperliquid', path: '/hyperliquid/leaderboard', params: {} },
  { name: 'hl-vault',              section: 'Hyperliquid', path: '/hyperliquid/vault', params: {} },

  // ============ Taker buy/sell & flows ============
  { name: 'taker-pair',            section: 'Taker', path: '/futures/taker-buy-sell-volume/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'taker-coin-agg',        section: 'Taker', path: '/futures/aggregated-taker-buy-sell-volume/history', params: { symbol: SYM, exchange_list: EX, interval: '4h', limit: 5 } },
  { name: 'taker-footprint',       section: 'Taker', path: '/futures/taker-buy-sell-volume/footprint', params: { exchange: EX, symbol: PAIR } },
  { name: 'taker-cvd',             section: 'Taker', path: '/futures/cvd/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'taker-agg-cvd',         section: 'Taker', path: '/futures/aggregated-cvd/history', params: { symbol: SYM, exchange_list: EX, interval: '4h', limit: 5 } },
  { name: 'taker-netflow-list',    section: 'Taker', path: '/futures/netflow/exchange-list', params: { symbol: SYM } },
  { name: 'taker-coin-netflow',    section: 'Taker', path: '/futures/netflow/history', params: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'taker-vol-exch-hist',   section: 'Taker', path: '/futures/taker-buy-sell-volume/exchange-history', params: { symbol: SYM, interval: '4h', limit: 5 } },

  // ============ Spot ============
  { name: 'spot-supported-coins',  section: 'Spot', path: '/spot/supported-coins', params: {} },
  { name: 'spot-price-ohlc',       section: 'Spot', path: '/spot/price/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'spot-market-history',   section: 'Spot', path: '/spot/pairs-markets', params: { symbol: SYM }, altPath: '/spot/market-data/history', altParams: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'spot-orderbook',        section: 'Spot', path: '/spot/orderbook/ask-bids-history', params: { exchange: EX, symbol: PAIR, interval: '4h', range: 5, limit: 5 } },
  { name: 'spot-taker',            section: 'Spot', path: '/spot/taker-buy-sell-volume/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'spot-cvd',              section: 'Spot', path: '/spot/aggregated-cvd/history', params: { symbol: SYM, exchange_list: EX, interval: '4h', limit: 5 } },
  { name: 'spot-netflow',          section: 'Spot', path: '/spot/netflow/exchange-list', params: { symbol: SYM } },

  // ============ Options ============
  { name: 'opt-exch-oi-history',   section: 'Options', path: '/option/exchange-oi-history', params: { symbol: SYM, interval: '4h', limit: 5 } },
  { name: 'opt-exch-vol-history',  section: 'Options', path: '/option/exchange-vol-history', params: { symbol: SYM, interval: '4h', limit: 5 } },

  // ============ On-Chain ============
  { name: 'oc-exchange-assets',    section: 'On-Chain', path: '/exchange/assets', params: { exchange: EX }, altPath: '/exchange/assets/history', altParams: { exchange: EX, symbol: SYM } },
  { name: 'oc-balance-list',       section: 'On-Chain', path: '/exchange/balance/list', params: { symbol: SYM } },
  { name: 'oc-onchain-transfers',  section: 'On-Chain', path: '/exchange/chain/tx/list', params: { symbol: SYM } },
  { name: 'oc-erc20-transfers',    section: 'On-Chain', path: '/exchange/onchain/transfers', params: { symbol: SYM } },
  { name: 'oc-whale-transfer',     section: 'On-Chain', path: '/exchange/chain/whale-transfer', params: { symbol: SYM }, altPath: '/exchange/whale-transfer', altParams: { symbol: SYM } },
  { name: 'oc-coin-unlock',        section: 'On-Chain', path: '/coin/unlock-list', params: { per_page: 50, page: 1 } },
  { name: 'oc-token-vesting',      section: 'On-Chain', path: '/coin/vesting', params: { symbol: 'ARB' } },

  // ============ ETF ============
  { name: 'etf-btc-list',          section: 'ETF', path: '/etf/bitcoin/list', params: {} },
  { name: 'etf-btc-hk-flow',       section: 'ETF', path: '/hk-etf/bitcoin/flow-history', params: {}, altPath: '/etf/bitcoin/hk-flow-history', altParams: {} },
  { name: 'etf-btc-netassets',     section: 'ETF', path: '/etf/bitcoin/net-assets/history', params: {}, altPath: '/etf/bitcoin/net-assets-history', altParams: {} },
  { name: 'etf-btc-flows',         section: 'ETF', path: '/etf/bitcoin/flow-history', params: {} },
  { name: 'etf-btc-history',       section: 'ETF', path: '/etf/bitcoin/history', params: {} },
  { name: 'etf-btc-price',         section: 'ETF', path: '/etf/bitcoin/price/history', params: { ticker: 'GBTC' } },
  { name: 'etf-btc-detail',        section: 'ETF', path: '/etf/bitcoin/detail', params: { ticker: 'GBTC' } },
  { name: 'etf-btc-aum',           section: 'ETF', path: '/etf/bitcoin/aum', params: {} },
  { name: 'etf-eth-list',          section: 'ETF', path: '/etf/ethereum/list', params: {} },
  { name: 'etf-eth-flow',          section: 'ETF', path: '/etf/ethereum/flow-history', params: {} },
  { name: 'etf-eth-netassets',     section: 'ETF', path: '/etf/ethereum/net-assets/history', params: {}, altPath: '/etf/ethereum/net-assets-history', altParams: {} },
  { name: 'etf-grayscale-hold',    section: 'ETF', path: '/grayscale/holdings-list', params: {}, altPath: '/grayscale/holdings', altParams: {} },
  { name: 'etf-grayscale-premium', section: 'ETF', path: '/grayscale/premium-history', params: {} },
  { name: 'etf-sol-flow',          section: 'ETF', path: '/etf/solana/flow-history', params: {} },
  { name: 'etf-xrp-flow',          section: 'ETF', path: '/etf/xrp/flow-history', params: {} },
  { name: 'etf-hype-flow',         section: 'ETF', path: '/etf/hyperliquid/flow-history', params: {} },

  // ============ Indicators (futures-derived) ============
  { name: 'ind-rsi-list',          section: 'Indic-futures', path: '/futures/rsi/list', params: {} },
  { name: 'ind-ma',                section: 'Indic-futures', path: '/futures/ma/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 }, altPath: '/futures/ma-list', altParams: {} },
  { name: 'ind-ema-list',          section: 'Indic-futures', path: '/futures/ema-list', params: {} },
  { name: 'ind-boll',              section: 'Indic-futures', path: '/futures/bollinger-band/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'ind-macd-list',         section: 'Indic-futures', path: '/futures/macd-list', params: {} },
  { name: 'ind-atr-list',          section: 'Indic-futures', path: '/futures/atr-list', params: {} },
  { name: 'ind-td-list',           section: 'Indic-futures', path: '/futures/td-sequential-list', params: {}, altPath: '/futures/td-list', altParams: {} },
  { name: 'ind-whale-index',       section: 'Indic-futures', path: '/index/whale-index/history', params: { interval: '4h', limit: 5 }, altPath: '/futures/whale-index/history', altParams: { interval: '4h', limit: 5 } },
  { name: 'ind-cgdi',              section: 'Indic-futures', path: '/futures/cgdi-index/history', params: { interval: '4h', limit: 5 } },
  { name: 'ind-cdri',              section: 'Indic-futures', path: '/futures/cdri-index/history', params: { interval: '4h', limit: 5 } },

  // ============ Indicators (BTC on-chain / cycle indices) ============
  { name: 'idx-ahr999',            section: 'Indic-other', path: '/index/ahr999', params: {} },
  { name: 'idx-bull-peak',         section: 'Indic-other', path: '/bull-market-peak-indicator', params: {}, altPath: '/index/bull-market-peak-indicator', altParams: {} },
  { name: 'idx-puell',             section: 'Indic-other', path: '/index/puell-multiple', params: {} },
  { name: 'idx-stock-flow',        section: 'Indic-other', path: '/index/stock-flow', params: {} },
  { name: 'idx-pi-cycle',          section: 'Indic-other', path: '/index/pi-cycle-indicator', params: {} },
  { name: 'idx-golden-ratio',      section: 'Indic-other', path: '/index/golden-ratio-multiplier', params: {} },
  { name: 'idx-profitable-days',   section: 'Indic-other', path: '/index/bitcoin-profitable-days', params: {} },
  { name: 'idx-rainbow',           section: 'Indic-other', path: '/index/bitcoin-rainbow-chart', params: {} },
  { name: 'idx-bubble',            section: 'Indic-other', path: '/index/bitcoin-bubble-index', params: {} },
  { name: 'idx-2yr-ma',            section: 'Indic-other', path: '/index/two-year-ma-multiplier', params: {} },
  { name: 'idx-200w-ma',           section: 'Indic-other', path: '/index/200-week-moving-avg-heatmap', params: {} },
  { name: 'idx-altcoin-season',    section: 'Indic-other', path: '/index/altcoin-season', params: {} },
  { name: 'idx-sth-sopr',          section: 'Indic-other', path: '/index/sth-sopr', params: {} },
  { name: 'idx-lth-sopr',          section: 'Indic-other', path: '/index/lth-sopr', params: {} },
  { name: 'idx-realized-price',    section: 'Indic-other', path: '/index/realized-price', params: {} },
  { name: 'idx-sth-realized',      section: 'Indic-other', path: '/index/sth-realized-price', params: {} },
  { name: 'idx-supply',            section: 'Indic-other', path: '/index/bitcoin-supply', params: {}, altPath: '/index/sth-supply', altParams: {} },
  { name: 'idx-rhodl',             section: 'Indic-other', path: '/index/rhodl-ratio', params: {} },
  { name: 'idx-reserve-risk',      section: 'Indic-other', path: '/index/reserve-risk', params: {} },
  { name: 'idx-active-addr',       section: 'Indic-other', path: '/index/active-addresses', params: {} },
  { name: 'idx-new-addr',          section: 'Indic-other', path: '/index/new-addresses', params: {} },
  { name: 'idx-nupl',              section: 'Indic-other', path: '/index/net-unrealized-profit-loss', params: {} },
  { name: 'idx-btc-correlations',  section: 'Indic-other', path: '/index/bitcoin-correlations', params: {} },
  { name: 'idx-bmo',               section: 'Indic-other', path: '/index/bitcoin-macro-oscillator', params: {} },
  { name: 'idx-opt-fut-oi-ratio',  section: 'Indic-other', path: '/index/option-vs-futures-oi-ratio', params: {} },
  { name: 'idx-btc-vs-global-m2',  section: 'Indic-other', path: '/index/bitcoin-vs-global-m2-growth', params: {} },
  { name: 'idx-btc-vs-us-m2',      section: 'Indic-other', path: '/index/bitcoin-vs-us-m2-growth', params: {} },
  { name: 'idx-exch-transparency', section: 'Indic-other', path: '/index/exchanges-transparency', params: {} },
  { name: 'idx-fut-spot-vol',      section: 'Indic-other', path: '/index/futures-spot-volume-ratio', params: {} },
  { name: 'idx-stablecoin-mcap',   section: 'Indic-other', path: '/index/stableCoin-marketCap-history', params: {} },

  // ============ Calendar / News ============
  { name: 'cal-economic-data',     section: 'Calendar/News', path: '/calendar/economic-data', params: {} },
  { name: 'news-article-list',     section: 'Calendar/News', path: '/news/article-list', params: {}, altPath: '/article/list', altParams: {} },

  // ============ Account (our tier!) ============
  { name: 'account-subscription',  section: 'Account', path: '/user/account-subscription', params: {}, altPath: '/account/subscription', altParams: {} },
];

type Classification = '200-ok' | 'tier-locked' | '404-path' | 'bad-params' | 'other-error';

interface Result {
  name: string; section: string; path: string;
  outcome: Classification; rows: number | null; keys: string[] | null;
  span: string | null; detail: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ]);
}

const TIME_KEYS = ['time', 'ts', 'timestamp', 'date', 'createTime', 'create_time', 'start_time', 'datetime', 'tradeTime'];

function asMillis(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (v > 1e15) return Math.floor(v / 1000);     // micros
    if (v > 1e12) return v;                          // millis
    if (v > 1e9)  return v * 1000;                   // seconds
    return null;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n) && n > 1e9) return asMillis(n);
    const d = Date.parse(v);
    return Number.isNaN(d) ? null : d;
  }
  return null;
}

function spanOf(arr: any[]): string | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  const last = arr[arr.length - 1];
  // object rows with a time-like key
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    for (const k of TIME_KEYS) {
      if (k in first) {
        const a = asMillis(first[k]); const b = asMillis(last[k]);
        if (a && b) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          const days = ((hi - lo) / 86_400_000).toFixed(0);
          return `${new Date(lo).toISOString().slice(0, 10)}..${new Date(hi).toISOString().slice(0, 10)} (~${days}d, n=${arr.length})`;
        }
      }
    }
    return `n=${arr.length} (no time key)`;
  }
  // tuple rows [ts, ...]
  if (Array.isArray(first)) {
    const a = asMillis(first[0]); const b = asMillis(last[0]);
    if (a && b) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const days = ((hi - lo) / 86_400_000).toFixed(0);
      return `${new Date(lo).toISOString().slice(0, 10)}..${new Date(hi).toISOString().slice(0, 10)} (~${days}d, n=${arr.length})`;
    }
  }
  return `n=${arr.length}`;
}

function shapeOf(data: any): { rows: number | null; keys: string[] | null; span: string | null } {
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' && !Array.isArray(first) ? Object.keys(first)
      : Array.isArray(first) ? ['<tuple>'] : null;
    return { rows: data.length, keys, span: spanOf(data) };
  }
  if (data && typeof data === 'object') {
    // nested list shapes
    for (const k of ['list', 'data', 'data_list', 'dataList', 'rows']) {
      if (Array.isArray((data as any)[k])) {
        const arr = (data as any)[k];
        const first = arr[0];
        const keys = first && typeof first === 'object' ? Object.keys(first) : Object.keys(data);
        return { rows: arr.length, keys, span: spanOf(arr) };
      }
    }
    // column-array shape e.g. { time:[...], close:[...] }
    const colArr = Object.keys(data).filter(k => Array.isArray((data as any)[k]));
    if (colArr.length) {
      const n = (data as any)[colArr[0]].length;
      return { rows: n, keys: Object.keys(data), span: `cols=${colArr.join(',')} n=${n}` };
    }
    return { rows: 1, keys: Object.keys(data), span: null };
  }
  return { rows: data == null ? 0 : 1, keys: null, span: null };
}

function classifyError(msg: string): { outcome: Classification; detail: string } {
  const codeMatch = msg.match(/code=([^\s]+)\s+msg=(.*)$/);
  if (codeMatch) {
    const code = codeMatch[1];
    const cgMsg = codeMatch[2].trim();
    const lm = cgMsg.toLowerCase();
    if (code === '404' || lm.includes('endpoint not found') || lm.includes('not found') ||
        lm.includes('no such') || lm.includes('invalid path') || lm.includes('does not exist')) {
      return { outcome: '404-path', detail: `code=${code} ${cgMsg}` };
    }
    if (lm.includes('upgrade') || lm.includes('permission') || lm.includes('plan') ||
        lm.includes('not authorized') || lm.includes('unauthorized') || lm.includes('forbidden') ||
        lm.includes('subscribe') || code === '403' || code === '40001' || lm.includes('api key') ||
        lm.includes('insufficient') || lm.includes('access')) {
      return { outcome: 'tier-locked', detail: `code=${code} ${cgMsg}` };
    }
    if (lm.includes('param') || lm.includes('missing') || lm.includes('required') ||
        lm.includes('invalid') || lm.includes('illegal') || code === '400' || lm.includes('must')) {
      return { outcome: 'bad-params', detail: `code=${code} ${cgMsg}` };
    }
    return { outcome: 'other-error', detail: `code=${code} ${cgMsg}` };
  }
  const httpMatch = msg.match(/HTTP\s+(\d{3})/i);
  if (httpMatch) {
    const status = httpMatch[1];
    if (status === '404') return { outcome: '404-path', detail: `HTTP ${status} ${msg.slice(0, 100)}` };
    if (status === '403' || status === '401') return { outcome: 'tier-locked', detail: `HTTP ${status} ${msg.slice(0, 100)}` };
    if (status === '400') return { outcome: 'bad-params', detail: `HTTP ${status} ${msg.slice(0, 100)}` };
    return { outcome: 'other-error', detail: `HTTP ${status} ${msg.slice(0, 100)}` };
  }
  return { outcome: 'other-error', detail: msg.slice(0, 150) };
}

async function runOne(path: string, params: Record<string, string | number>, label: string): Promise<Result> {
  const r = await withTimeout(cgGet<any>(path, params), PER_CALL_TIMEOUT_MS, label);
  const { rows, keys, span } = shapeOf((r as any).data);
  return { name: label, section: '', path, outcome: '200-ok', rows, keys, span, detail: `code=${(r as any).code}` };
}

async function probeOne(p: Probe): Promise<Result> {
  try {
    const r = await runOne(p.path, p.params, p.name);
    return { ...r, section: p.section };
  } catch (e: any) {
    const primary = classifyError(e?.message ?? String(e));
    if ((primary.outcome === '404-path' || primary.outcome === 'bad-params') && p.altPath) {
      try {
        const alt = await runOne(p.altPath, p.altParams ?? p.params, p.name);
        return { ...alt, section: p.section, path: p.altPath, detail: `${alt.detail} (alt ${p.altPath})` };
      } catch (e2: any) {
        const altC = classifyError(e2?.message ?? String(e2));
        // prefer the more informative (non-404) of the two
        const better = primary.outcome === '404-path' && altC.outcome !== '404-path' ? altC : primary;
        return { name: p.name, section: p.section, path: `${p.path} | ${p.altPath}`, outcome: better.outcome, rows: null, keys: null, span: null, detail: `p:${primary.detail} || a:${altC.detail}`.slice(0, 200) };
      }
    }
    return { name: p.name, section: p.section, path: p.path, outcome: primary.outcome, rows: null, keys: null, span: null, detail: primary.detail };
  }
}

function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

async function main() {
  const startedAt = Date.now();
  console.log('=== Coinglass v4 CATALOG PROBE (Standard-plan key) ===');
  console.log(`base https://open-api-v4.coinglass.com/api  probes=${probes.length}\n`);

  const results: Result[] = [];
  let section = '';
  for (const p of probes) {
    if (p.section !== section) { section = p.section; console.log(`\n## ${section}`); }
    const res = await probeOne(p);
    results.push(res);
    const tag =
      res.outcome === '200-ok'     ? `OK  ${pad(String(res.rows ?? '?'), 5)}rows` :
      res.outcome === 'tier-locked'? 'LOCK         ' :
      res.outcome === '404-path'   ? 'PATH-404     ' :
      res.outcome === 'bad-params' ? 'BADPARAM     ' :
      'ERR          ';
    console.log(`${tag} ${pad(res.name, 22)} ${res.path}`);
    if (res.outcome === '200-ok') {
      console.log(`   keys: ${(res.keys ?? []).join(',').slice(0, 200)}`);
      if (res.span) console.log(`   span: ${res.span}`);
    } else {
      console.log(`   ${res.detail.slice(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }

  // ---- compact final table ----
  console.log('\n\n=== FINAL ACCESS MAP (machine-parse) ===');
  console.log('SECTION\tNAME\tPATH\tOUTCOME\tROWS\tKEYS\tSPAN');
  for (const r of results) {
    console.log([
      r.section, r.name, r.path, r.outcome,
      r.rows ?? '', (r.keys ?? []).join('|'), r.span ?? r.detail.slice(0, 80),
    ].join('\t'));
  }

  // ---- buckets ----
  const by = (o: Classification) => results.filter(r => r.outcome === o).map(r => `${r.name}`);
  console.log('\n=== BUCKETS ===');
  console.log(`ACCESSIBLE (${by('200-ok').length}): ${by('200-ok').join(', ')}`);
  console.log(`TIER-LOCKED (${by('tier-locked').length}): ${by('tier-locked').join(', ')}`);
  console.log(`NEEDS-PATH-CHECK 404 (${by('404-path').length}): ${by('404-path').join(', ')}`);
  console.log(`BAD-PARAMS path-valid (${by('bad-params').length}): ${by('bad-params').join(', ')}`);
  console.log(`OTHER-ERROR (${by('other-error').length}): ${by('other-error').join(', ')}`);
  console.log(`\nelapsed ${Date.now() - startedAt}ms`);
}

main().catch(e => { console.error('cg-catalog-probe crashed', e?.message ?? String(e)); process.exit(1); });

import 'dotenv/config';

/**
 * Centralised typed config.
 * All env vars are validated/coerced once at startup — fail fast.
 */

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number env var ${name}=${v}`);
  return n;
}

function str(name: string, def: string): string {
  return process.env[name] ?? def;
}

function list(name: string, def: string[]): string[] {
  const v = process.env[name];
  if (!v) return def;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },

  pg: {
    host: str('PG_HOST', '127.0.0.1'),
    port: num('PG_PORT', 5432),
    user: str('PG_USER', 'trading'),
    password: str('PG_PASSWORD', 'trading123'),
    database: str('PG_DATABASE', 'trading'),
    enabled: process.env.PG_ENABLED !== 'false',
  },

  redis: {
    host: str('REDIS_HOST', '127.0.0.1'),
    port: num('REDIS_PORT', 6379),
    db: num('REDIS_DB', 0),
    enabled: process.env.REDIS_ENABLED !== 'false',
  },

  trade: {
    defaultRiskPct: num('DEFAULT_RISK_PCT', 0.2),
    /** A+ setups (4/4 confluence) */
    maxRiskPct: num('MAX_RISK_PCT', 0.6),
    minConfluence: num('MIN_CONFLUENCE', 3),
    minRR: num('MIN_RR', 1.5),
    atrSlMult: num('ATR_SL_MULT', 1.0),
    trailActivateR: num('TRAIL_ACTIVATE_R', 1.5),
    maxPositions: num('MAX_POSITIONS', 5),
    maxHeatPct: num('MAX_HEAT_PCT', 5.0),
    /** Max position hold time in hours. Prefer intraday, hard close at this limit. */
    maxHoldHours: num('MAX_HOLD_HOURS', 72),
    /** Fixed leverage applied to every position. Keep low — risk is controlled by qty, not leverage. */
    leverage: num('LEVERAGE', 3),
  },

  risk: {
    /** Kill switch — close all if equity drops to this daily DD% */
    dailyDdKill: num('DAILY_DD_KILL', 4.0),
    /** Kill switch — halt all trading if total DD% reached */
    totalDdKill: num('TOTAL_DD_KILL', 8.0),
    /** HyroTrader hard limit (account terminated above) */
    dailyDdHard: num('DAILY_DD_HARD', 5.0),
    totalDdHard: num('TOTAL_DD_HARD', 10.0),
  },

  watchlist: list('WATCHLIST', [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
    'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT',
  ]),

  news: {
    feeds: list('NEWS_FEEDS', [
      'https://www.coindesk.com/arc/outboundfeeds/rss/',
      'https://cointelegraph.com/rss',
    ]),
  },
} as const;

export type Config = typeof config;

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
    defaultRiskPct: num('DEFAULT_RISK_PCT', 0.5),
    /** A+ setups (12/12 confluence in new rubric; 7-8/8 in legacy) */
    maxRiskPct: num('MAX_RISK_PCT', 1.0),
    /** 12-factor rubric: 9/12 = B+ standard minimum. Legacy fallback kept for unused paths. */
    minConfluence: num('MIN_CONFLUENCE', 9),
    minRR: num('MIN_RR', 1.5),
    /** Lower R:R allowed for A+ setups. */
    minRRAplus: num('MIN_RR_APLUS', 1.3),
    atrSlMult: num('ATR_SL_MULT', 1.0),
    trailActivateR: num('TRAIL_ACTIVATE_R', 1.5),
    maxPositions: num('MAX_POSITIONS', 5),
    maxHeatPct: num('MAX_HEAT_PCT', 5.0),
    /** Max position hold time in hours. Prefer intraday, hard close at this limit. */
    maxHoldHours: num('MAX_HOLD_HOURS', 48),
    /** Grace period (min) after opening before Claude can proactively close a position.
     *  Prevents 2–3 min whipsaw exits. Surfaced to Claude via scan-data.ts grace_remaining_min. */
    earlyExitGraceMin: num('EARLY_EXIT_GRACE_MIN', 9),
    /**
     * Fixed leverage applied to every position.
     * Minimum 8× required to satisfy HyroTrader margin+notional rules simultaneously:
     *   margin = notional / leverage ≤ 25% equity AND notional ≤ 2× initial
     *   → leverage ≥ 8×
     * Default 10× provides a buffer. Risk is controlled by qty/SL, leverage just sets margin requirement.
     */
    leverage: num('LEVERAGE', 10),
    /** HyroTrader inviolable: max margin per position as fraction of equity. */
    maxMarginPct: num('MAX_MARGIN_PCT', 0.25),
    /** HyroTrader inviolable: max notional per position as multiple of INITIAL balance. */
    maxNotionalMult: num('MAX_NOTIONAL_MULT', 2.0),
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

  /**
   * Active trading watchlist. 2026-04-21: narrowed to BTCUSDT only.
   * Rationale: HMM trained on BTC, CVD deepest on BTC, alt trades caused correlation-burn and peak-giveback
   * over 4-day sample (2026-04-17..20). Re-add alts when: (a) 2 weeks consistent BTC P&L ≥ 0.25%/day, OR
   * (b) BTC dry period < 1 A-setup/day for 5 days. See memory/feedback_btc_only.md.
   *
   * Full list kept commented for quick revert when re-enabling alts:
   *   'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT'
   * Override via WATCHLIST env var (comma-separated).
   */
  watchlist: list('WATCHLIST', ['BTCUSDT']),

  /**
   * Trading schedule — UTC hour gate. Default: DISABLED (24h trading, Claude decides).
   * Set SCHEDULE_ENABLED=true to opt back into a restricted window (legacy behaviour).
   * Quality multiplier + dead-zone discipline (+1 confluence, size ×0.7) enforce session
   * awareness without a hard block. Funding-window block is separate (see guardrails).
   */
  schedule: {
    startHourUTC: num('SCHEDULE_START_UTC', 0),
    endHourUTC: num('SCHEDULE_END_UTC', 24),
    enabled: process.env.SCHEDULE_ENABLED === 'true',
  },

  news: {
    feeds: list('NEWS_FEEDS', [
      'https://www.coindesk.com/arc/outboundfeeds/rss/',   // CoinDesk EN
      'https://cointelegraph.com/rss',                      // CoinTelegraph EN
      'https://forklog.com/feed/',                          // ForkLog RU (crypto-focused)
      'https://ru.investing.com/rss/news.rss',              // Investing.com RU (macro)
    ]),
  },
} as const;

export type Config = typeof config;

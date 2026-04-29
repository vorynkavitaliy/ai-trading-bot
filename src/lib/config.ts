import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.resolve(__dirname, '../../.env') });

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function opt(name: string, def: string): string {
  return process.env[name] ?? def;
}

function intOpt(name: string, def: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : def;
}

export const config = {
  leverage: intOpt('LEVERAGE', 10),
  pg: {
    host: opt('PG_HOST', 'localhost'),
    port: intOpt('PG_PORT', 5433),
    user: opt('PG_USER', 'trader'),
    password: opt('PG_PASS', 'trader_pass'),
    database: opt('PG_DB', 'trading'),
  },
  redis: {
    host: opt('REDIS_HOST', 'localhost'),
    port: intOpt('REDIS_PORT', 6380),
  },
  telegram: {
    botToken: opt('TELEGRAM_BOT_TOKEN', ''),
    chatId: opt('TELEGRAM_CHAT_ID', ''),
  },
  log: {
    level: opt('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  },
  env: opt('NODE_ENV', 'development'),
};

export function requireTelegram(): { botToken: string; chatId: string } {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.error('[config] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty');
    process.exit(1);
  }
  return { botToken: config.telegram.botToken, chatId: config.telegram.chatId };
}

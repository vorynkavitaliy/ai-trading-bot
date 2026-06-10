import { intEnv, listEnv, optionalEnv, requireEnv } from '../core/env';

export interface CoinglassConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly requestsPerMinute: number;
  readonly timeoutMs: number;
}

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatIds: readonly string[];
  readonly operatorChatId: string;
}

export function coinglassConfigFromEnv(): CoinglassConfig {
  return {
    apiKey: requireEnv('COINGLASS_API_KEY'),
    baseUrl: optionalEnv('COINGLASS_BASE_URL', 'https://open-api-v4.coinglass.com/api'),
    requestsPerMinute: intEnv('COINGLASS_REQUESTS_PER_MINUTE', 270),
    timeoutMs: intEnv('COINGLASS_TIMEOUT_MS', 15_000),
  };
}

export function telegramConfigFromEnv(): TelegramConfig {
  const chatIds = listEnv('TELEGRAM_CHAT_ID');
  const operatorChatId = optionalEnv('TELEGRAM_OPERATOR_CHAT_ID', chatIds[0] ?? '');

  return {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    chatIds,
    operatorChatId,
  };
}

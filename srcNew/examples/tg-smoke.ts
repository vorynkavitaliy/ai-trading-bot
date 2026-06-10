import { TelegramClient } from '../clients/telegram';
import { createLogger } from '../core/logger';
import { telegramConfigFromEnv } from '../config/clients';

async function main(): Promise<void> {
  const logger = createLogger('tg-smoke');
  const client = new TelegramClient(telegramConfigFromEnv(), { logger });

  const outcome = await client.send('srcNew Telegram client smoke test — связь установлена.');
  logger.info('broadcast result', { ok: outcome.okCount, fail: outcome.failCount });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

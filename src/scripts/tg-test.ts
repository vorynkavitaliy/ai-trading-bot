import { send } from '../lib/telegram';
import { log } from '../lib/logger';

async function main() {
  const arg = process.argv.slice(2).join(' ');
  const text =
    arg ||
    [
      '<b>Тестовое сообщение</b>',
      '',
      'Бот отправляет уведомления через этот чат.',
      `Время: ${new Date().toISOString()}`,
    ].join('\n');
  await send(text);
  log.info('telegram test sent');
}

main().catch((e) => {
  log.error('telegram test failed', { err: e?.message ?? String(e) });
  process.exit(1);
});

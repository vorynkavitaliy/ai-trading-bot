import { Telegraf } from 'telegraf';
import { config, requireTelegram } from './config';
import { log } from './logger';

let bot: Telegraf | null = null;

function getBot(): Telegraf {
  if (bot) return bot;
  const { botToken } = requireTelegram();
  bot = new Telegraf(botToken);
  return bot;
}

export async function send(text: string): Promise<void> {
  const { chatId } = requireTelegram();
  const b = getBot();
  try {
    await b.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    log.debug('telegram sent', { len: text.length });
  } catch (e: any) {
    log.error('telegram send failed', { err: e?.message ?? String(e) });
    throw e;
  }
}

export async function sendFromFile(filePath: string): Promise<void> {
  const fs = await import('node:fs');
  const text = fs.readFileSync(filePath, 'utf-8');
  await send(text);
}

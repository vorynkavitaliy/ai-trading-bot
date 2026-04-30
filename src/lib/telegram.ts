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

// Escape HTML special chars: <, >, & — required because send() uses parse_mode='HTML'.
// Without this, rationale text with `<=`, `>=`, `&` (e.g. strategy formulas) breaks parsing.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function send(text: string, opts: { raw?: boolean } = {}): Promise<void> {
  const { chatId } = requireTelegram();
  const b = getBot();
  // raw=true means caller has already escaped where needed (e.g. wants <b>...</b>).
  // Default: escape entire body — safe for any plain-text content.
  const body = opts.raw ? text : escapeHtml(text);
  try {
    await b.telegram.sendMessage(chatId, body, { parse_mode: 'HTML' });
    log.debug('telegram sent', { len: body.length });
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

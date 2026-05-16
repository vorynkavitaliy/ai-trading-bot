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
  // TELEGRAM_CHAT_ID may be a single id or comma-separated list. Broadcast to all.
  // One bad chatId (kicked, blocked) doesn't stop the others — log and continue.
  const chatIds = String(chatId).split(',').map((s) => s.trim()).filter(Boolean);
  const b = getBot();
  // raw=true means caller has already escaped where needed (e.g. wants <b>...</b>).
  // Default: escape entire body — safe for any plain-text content.
  const body = opts.raw ? text : escapeHtml(text);

  let lastErr: any = null;
  let okCount = 0;
  for (const id of chatIds) {
    try {
      await b.telegram.sendMessage(id, body, { parse_mode: 'HTML' });
      okCount++;
    } catch (e: any) {
      lastErr = e;
      log.error('telegram send failed for chatId', { chatId: id, err: e?.message ?? String(e) });
    }
  }
  log.debug('telegram sent', { chatIdsTotal: chatIds.length, ok: okCount, len: body.length });
  if (okCount === 0 && lastErr) throw lastErr;   // только если НИ ОДНОМУ не дошло — пробрасываем
}

export async function sendFromFile(filePath: string): Promise<void> {
  const fs = await import('node:fs');
  const text = fs.readFileSync(filePath, 'utf-8');
  await send(text);
}

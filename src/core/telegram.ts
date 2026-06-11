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

export interface SentRef { chatId: string; messageId: number; }

export async function send(text: string, opts: { raw?: boolean } = {}): Promise<void> {
  await sendReturningRefs(text, opts);
}

// Same as send(), but returns per-chat {chatId, messageId} so callers can later
// edit or delete the message in place (digest slots persist these → "edit the
// morning report"). One bad chatId doesn't stop the others.
export async function sendReturningRefs(text: string, opts: { raw?: boolean } = {}): Promise<SentRef[]> {
  const { chatId } = requireTelegram();
  const chatIds = String(chatId).split(',').map((s) => s.trim()).filter(Boolean);
  const b = getBot();
  const body = opts.raw ? text : escapeHtml(text);

  const refs: SentRef[] = [];
  let lastErr: any = null;
  for (const id of chatIds) {
    try {
      const msg = await b.telegram.sendMessage(id, body, { parse_mode: 'HTML' });
      refs.push({ chatId: id, messageId: (msg as any).message_id });
    } catch (e: any) {
      lastErr = e;
      log.error('telegram send failed for chatId', { chatId: id, err: e?.message ?? String(e) });
    }
  }
  log.debug('telegram sent', { chatIdsTotal: chatIds.length, ok: refs.length, len: body.length });
  if (refs.length === 0 && lastErr) throw lastErr;   // only if NONE delivered
  return refs;
}

// Edit a previously-sent message in place. messageId must be a message THIS bot
// sent (< 48h old) in that chat. Never throws — logs and returns false on failure.
export async function editMessage(chatId: string, messageId: number, text: string, opts: { raw?: boolean } = {}): Promise<boolean> {
  const b = getBot();
  const body = opts.raw ? text : escapeHtml(text);
  try {
    await b.telegram.editMessageText(chatId, messageId, undefined, body, { parse_mode: 'HTML' });
    return true;
  } catch (e: any) {
    log.warn('telegram editMessage failed', { chatId, messageId, err: e?.message ?? String(e) });
    return false;
  }
}

// Delete a message this bot sent (< 48h). Never throws.
export async function deleteMessage(chatId: string, messageId: number): Promise<boolean> {
  const b = getBot();
  try {
    await b.telegram.deleteMessage(chatId, messageId);
    return true;
  } catch (e: any) {
    log.warn('telegram deleteMessage failed (likely wrong id or >48h)', { chatId, messageId, err: e?.message ?? String(e) });
    return false;
  }
}

export async function sendFromFile(filePath: string): Promise<void> {
  const fs = await import('node:fs');
  const text = fs.readFileSync(filePath, 'utf-8');
  await send(text);
}

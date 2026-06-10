import { Telegraf } from 'telegraf';

import { TelegramConfig } from '../../config/clients';
import { ConfigError, errorMessage } from '../../core/errors';
import { Logger } from '../../core/logger';
import { BroadcastOutcome, SendOptions, SendOutcome } from './types';

export interface TelegramClientOptions {
  logger?: Logger;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class TelegramClient {
  private readonly bot: Telegraf;
  private readonly chatIds: readonly string[];
  private readonly operatorChatId: string;
  private readonly logger?: Logger;

  constructor(config: TelegramConfig, options: TelegramClientOptions = {}) {
    if (!config.botToken) throw new ConfigError('TelegramClient requires a bot token');

    this.bot = new Telegraf(config.botToken);
    this.chatIds = config.chatIds;
    this.operatorChatId = config.operatorChatId;
    this.logger = options.logger;
  }

  async send(text: string, options: SendOptions = {}): Promise<BroadcastOutcome> {
    if (this.chatIds.length === 0) {
      throw new ConfigError('TelegramClient has no chat ids configured (TELEGRAM_CHAT_ID)');
    }

    const body = options.raw ? text : escapeHtml(text);
    const outcomes = await Promise.all(
      this.chatIds.map(chatId => this.deliver(chatId, body, options))
    );

    const okCount = outcomes.filter(outcome => outcome.ok).length;
    return { outcomes, okCount, failCount: outcomes.length - okCount };
  }

  async sendToOperator(text: string, options: SendOptions = {}): Promise<SendOutcome> {
    if (!this.operatorChatId) {
      throw new ConfigError('TelegramClient has no operator chat id configured');
    }

    const body = options.raw ? text : escapeHtml(text);
    return this.deliver(this.operatorChatId, body, options);
  }

  private async deliver(chatId: string, body: string, options: SendOptions): Promise<SendOutcome> {
    try {
      await this.bot.telegram.sendMessage(chatId, body, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: options.disablePreview ?? true },
      });
      return { chatId, ok: true };
    } catch (error) {
      const message = errorMessage(error);
      this.logger?.error('telegram send failed', { chatId, error: message });
      return { chatId, ok: false, error: message };
    }
  }
}

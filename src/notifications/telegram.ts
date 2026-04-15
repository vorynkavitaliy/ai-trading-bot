import { Telegraf } from 'telegraf';
import { PositionInfo, SubAccount, WalletInfo } from '../core/types';

export class TelegramNotifier {
  private bot: Telegraf;
  private chatId: string;

  constructor(token: string, chatId: string) {
    this.bot = new Telegraf(token);
    this.chatId = chatId;
  }

  private ts(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  private async send(text: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
    } catch (err: any) {
      console.error('[Telegram] Send failed:', err.message);
    }
  }

  // ═══════════════════════════════════════════
  //  TRADE EVENTS
  // ═══════════════════════════════════════════

  async tradeOpened(params: {
    pair: string;
    direction: 'LONG' | 'SHORT';
    entry: string;
    sl: string;
    tp: string;
    rr: string;
    riskPct: string;
    riskUsd: string;
    qty: string;
    confluence: string;
    regime: string;
    accounts: number;
  }): Promise<void> {
    const icon = params.direction === 'LONG' ? '📈' : '📉';
    await this.send(
      `🤖 <b>Claude Trading Bot</b>\n` +
      `\n` +
      `📌 Новая сделка:\n` +
      `──────────────\n` +
      `\n` +
      `${icon} <b>Открыта позиция ${params.direction}</b> (${params.pair})\n` +
      `\n` +
      `💰 Вход: <code>${params.entry}</code>\n` +
      `🛑 SL: <code>${params.sl}</code>\n` +
      `🎯 TP: <code>${params.tp}</code>\n` +
      `📊 R:R: ${params.rr}\n` +
      `📐 Размер: ${params.qty} | Риск: ${params.riskPct}% ($${params.riskUsd})\n` +
      `\n` +
      `🔗 Confluence: ${params.confluence}/4 | Режим: ${params.regime}\n` +
      `👥 Аккаунтов: ${params.accounts}\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  async tradeClosed(params: {
    pair: string;
    direction: 'LONG' | 'SHORT';
    reason: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'trailing' | 'manual' | 'breakeven' | 'kill_switch';
    entry: string;
    exit: string;
    pnlUsd: string;
    pnlPct: string;
    rMultiple: string;
    duration: string;
    accounts: number;
  }): Promise<void> {
    const pnl = Number(params.pnlUsd);
    const icon = pnl > 0 ? '🚀' : pnl < 0 ? '🔥' : '➖';
    const resultText = pnl > 0 ? 'Профит' : pnl < 0 ? 'Убыток' : 'Безубыток';

    const reasonMap: Record<string, string> = {
      TP1: 'тейк-профиту (TP1 — 50%)',
      TP2: 'тейк-профиту (TP2 — 30%)',
      TP3: 'тейк-профиту (TP3 — trailing)',
      SL: 'стоп-лоссу',
      trailing: 'трейлинг-стопу',
      manual: 'ручному закрытию',
      breakeven: 'безубытку',
      kill_switch: '⚠️ KILL SWITCH (drawdown)',
    };

    await this.send(
      `🤖 <b>Claude Trading Bot</b>\n` +
      `\n` +
      `📌 Сделка закрыта:\n` +
      `──────────────\n` +
      `\n` +
      `${icon} <b>Сделка завершена по ${reasonMap[params.reason] ?? params.reason}</b> (${params.pair} ${params.direction})\n` +
      `\n` +
      `💰 Вход: <code>${params.entry}</code> → Выход: <code>${params.exit}</code>\n` +
      `${pnl >= 0 ? '✅' : '❌'} ${resultText}: <b>${params.pnlUsd} USDT</b> (${params.pnlPct}%)\n` +
      `📊 R: ${params.rMultiple}\n` +
      `⏱ Длительность: ${params.duration}\n` +
      `👥 Аккаунтов: ${params.accounts}\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  async orderFilled(params: {
    pair: string;
    direction: 'LONG' | 'SHORT';
    type: 'entry' | 'partial_tp' | 'sl_move';
    price: string;
    qty: string;
    detail: string;
  }): Promise<void> {
    const icons: Record<string, string> = {
      entry: '🎣',
      partial_tp: '🎯',
      sl_move: '🔄',
    };
    await this.send(
      `🤖 <b>Claude Trading Bot</b>\n` +
      `\n` +
      `${icons[params.type] ?? '📌'} <b>${params.detail}</b> (${params.pair} ${params.direction})\n` +
      `💰 Цена: <code>${params.price}</code> | Кол-во: ${params.qty}\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  // ═══════════════════════════════════════════
  //  RISK ALERTS
  // ═══════════════════════════════════════════

  async riskWarning(params: {
    level: 'WARNING' | 'CRITICAL' | 'HALT';
    dailyDd: string;
    totalDd: string;
    action: string;
  }): Promise<void> {
    const icons: Record<string, string> = {
      WARNING: '⚠️',
      CRITICAL: '🚨',
      HALT: '🛑',
    };
    await this.send(
      `${icons[params.level]} <b>RISK ALERT: ${params.level}</b>\n` +
      `\n` +
      `──────────────\n` +
      `📉 Daily DD: <b>${params.dailyDd}%</b> / 5%\n` +
      `📉 Total DD: <b>${params.totalDd}%</b> / 10%\n` +
      `\n` +
      `⚡ Действие: ${params.action}\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  // ═══════════════════════════════════════════
  //  SCAN REPORTS
  // ═══════════════════════════════════════════

  async scanReport(params: {
    pair: string;
    regime: string;
    regimeScore: string;
    longScore: string;
    shortScore: string;
    action: string;
    accounts: { label: string; equity: string; pnlToday: string; dailyDd: string; totalDd: string }[];
    positions: { pair: string; direction: string; entry: string; current: string; pnl: string; pnlPct: string }[];
    newsContext: string;
  }): Promise<void> {
    let msg =
      `🤖 <b>Scan Report: ${params.pair}</b>\n` +
      `\n` +
      `──────────────\n` +
      `🌐 Режим: <b>${params.regime}</b> (${params.regimeScore})\n` +
      `📊 LONG: ${params.longScore}/4 | SHORT: ${params.shortScore}/4\n` +
      `⚡ Действие: ${params.action}\n` +
      `──────────────\n`;

    // Accounts
    msg += `\n💼 <b>Аккаунты:</b>\n`;
    for (const a of params.accounts) {
      msg += `  ${a.label}: $${a.equity} | PnL: ${a.pnlToday} | DD: ${a.dailyDd}%/${a.totalDd}%\n`;
    }

    // Positions
    if (params.positions.length > 0) {
      msg += `\n📋 <b>Позиции:</b>\n`;
      for (const p of params.positions) {
        const icon = Number(p.pnl) >= 0 ? '✅' : '❌';
        msg += `  ${icon} ${p.pair} ${p.direction} | ${p.entry} → ${p.current} | ${p.pnl} (${p.pnlPct}%)\n`;
      }
    } else {
      msg += `\n📋 Позиций нет\n`;
    }

    // News
    if (params.newsContext) {
      msg += `\n📰 <b>Контекст:</b>\n${params.newsContext}\n`;
    }

    msg += `\n──────────────\n🕐 ${this.ts()}`;

    await this.send(msg);
  }

  async fullReport(params: {
    accounts: { label: string; volume: number; equity: string; pnlToday: string; pnlTotal: string; dailyDd: string; totalDd: string; positions: number; status: string }[];
    totalPnlToday: string;
    totalPositions: number;
    regime: string;
    newsHighlights: string;
  }): Promise<void> {
    let msg =
      `🤖 <b>═══ FULL REPORT ═══</b>\n` +
      `\n` +
      `🌐 Режим: <b>${params.regime}</b>\n` +
      `📊 PnL сегодня: <b>${params.totalPnlToday} USDT</b>\n` +
      `📋 Позиций: ${params.totalPositions}\n` +
      `\n` +
      `──────────────\n` +
      `💼 <b>Аккаунты:</b>\n`;

    for (const a of params.accounts) {
      const statusIcon = a.status === 'CLEAR' ? '🟢' : a.status === 'WARNING' ? '🟡' : '🔴';
      msg +=
        `\n${statusIcon} <b>${a.label}</b> ($${a.volume.toLocaleString()})\n` +
        `  Equity: $${a.equity}\n` +
        `  PnL сегодня: ${a.pnlToday} | Всего: ${a.pnlTotal}\n` +
        `  DD: ${a.dailyDd}% daily / ${a.totalDd}% total\n` +
        `  Позиций: ${a.positions}\n`;
    }

    if (params.newsHighlights) {
      msg += `\n──────────────\n📰 <b>Новости:</b>\n${params.newsHighlights}\n`;
    }

    msg += `\n──────────────\n🕐 ${this.ts()}`;

    await this.send(msg);
  }

  // ═══════════════════════════════════════════
  //  SYSTEM
  // ═══════════════════════════════════════════

  async botStarted(pair: string, accounts: number): Promise<void> {
    await this.send(
      `🤖 <b>Claude Trading Bot запущен</b>\n` +
      `\n` +
      `📌 Пара: <b>${pair}</b>\n` +
      `👥 Аккаунтов: ${accounts}\n` +
      `⏱ Интервал: 3 мин\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  async botStopped(pair: string, reason: string): Promise<void> {
    await this.send(
      `🛑 <b>Claude Trading Bot остановлен</b>\n` +
      `\n` +
      `📌 Пара: ${pair}\n` +
      `⚠️ Причина: ${reason}\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  async error(context: string, error: string): Promise<void> {
    await this.send(
      `⚠️ <b>Ошибка</b>\n` +
      `\n` +
      `📌 Контекст: ${context}\n` +
      `❌ ${error}\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  async signalSkipped(params: {
    pair: string;
    longScore: string;
    shortScore: string;
    reason: string;
  }): Promise<void> {
    await this.send(
      `🤖 <b>Сигнал пропущен</b> (${params.pair})\n` +
      `\n` +
      `📊 LONG: ${params.longScore}/4 | SHORT: ${params.shortScore}/4\n` +
      `💤 Причина: ${params.reason}\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }
}

/** Factory — reads from env */
export function createTelegramNotifier(): TelegramNotifier | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — notifications disabled');
    return null;
  }

  return new TelegramNotifier(token, chatId);
}

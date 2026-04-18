import { Telegraf } from 'telegraf';
import { PositionInfo, SubAccount, WalletInfo } from '../core/types';

export class TelegramNotifier {
  private bot: Telegraf;
  private chatIds: string[];

  /** chatId may be a single id or comma-separated list ("123,456,789") */
  constructor(token: string, chatId: string) {
    this.bot = new Telegraf(token);
    this.chatIds = chatId.split(',').map((s) => s.trim()).filter(Boolean);
    if (this.chatIds.length === 0) throw new Error('TELEGRAM_CHAT_ID is empty');
  }

  private ts(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  /** Fan out to every chat in parallel — one failure does not block the others */
  private async send(text: string): Promise<void> {
    await Promise.all(this.chatIds.map(async (id) => {
      try {
        await this.bot.telegram.sendMessage(id, text, { parse_mode: 'HTML' });
      } catch (err: any) {
        console.error(`[Telegram] Send to ${id} failed:`, err.message);
      }
    }));
  }

  // ═══════════════════════════════════════════
  //  TRADE EVENTS
  // ═══════════════════════════════════════════

  /**
   * Limit order placed (not yet filled). Less prominent than tradeOpened.
   * Fires when orchestrator places a limit order awaiting pullback.
   */
  async limitPlaced(params: {
    pair: string;
    direction: 'LONG' | 'SHORT';
    limitPrice: string;
    sl: string;
    tp: string;
    rr: string;
    confluence: string;
    regime: string;
    accounts: number;
    maxAgeMin?: number;
  }): Promise<void> {
    const icon = params.direction === 'LONG' ? '📈' : '📉';
    const ageCap = params.maxAgeMin ?? 45;
    await this.send(
      `🤖 <b>Claude Trading Bot</b>\n` +
      `\n` +
      `📝 Лимит размещён (ждёт fill'а):\n` +
      `──────────────\n` +
      `\n` +
      `${icon} <b>${params.direction} лимит</b> (${params.pair})\n` +
      `\n` +
      `💰 Лимит: <code>${params.limitPrice}</code>\n` +
      `🛑 SL (после fill'а): <code>${params.sl}</code>\n` +
      `🎯 TP (после fill'а): <code>${params.tp}</code>\n` +
      `📊 R:R: ${params.rr}\n` +
      `⏱ Auto-cancel: ${ageCap}m если не филлится\n` +
      `\n` +
      `🔗 Confluence: ${params.confluence} | Режим: ${params.regime}\n` +
      `👥 Аккаунтов: ${params.accounts}\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

  async limitCancelled(params: {
    pair: string;
    direction: 'LONG' | 'SHORT';
    limitPrice: string;
    reason: 'expired' | 'invalidated' | 'manual';
    ageMin?: number;
  }): Promise<void> {
    const icon = params.direction === 'LONG' ? '📈' : '📉';
    const reasonText =
      params.reason === 'expired'
        ? `TTL истёк${params.ageMin !== undefined ? ` (${params.ageMin} мин)` : ''}`
        : params.reason === 'invalidated'
        ? 'структура сломалась (BOS против)'
        : 'отменено вручную';
    await this.send(
      `🤖 <b>Claude Trading Bot</b>\n` +
      `\n` +
      `❌ Лимитка отменена (не была исполнена):\n` +
      `──────────────\n` +
      `\n` +
      `${icon} <b>${params.direction} лимит</b> (${params.pair})\n` +
      `\n` +
      `💰 Цена: <code>${params.limitPrice}</code>\n` +
      `🔁 Причина: ${reasonText}\n` +
      `\n` +
      `ℹ️ Позиция не открывалась — PnL = $0\n` +
      `\n` +
      `──────────────\n` +
      `🕐 ${this.ts()}`
    );
  }

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
      `🔗 Confluence: ${params.confluence} | Режим: ${params.regime}\n` +
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
      early_exit: '🧠 проактивному закрытию (условия изменились)',
      expired: '⏰ истечению макс. времени удержания',
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
    accounts: { label: string; volume: number; equity: string; pnlTodayPct: string; dailyDd: string; totalDd: string; status: string }[];
    /** Unique positions across all accounts (deduplicated by symbol) */
    positions: { symbol: string; direction: string; pnlPct: string }[];
    regime: string;
    news: {
      bias: string;
      impact: string;
      riskMultiplier: number;
      fearGreed?: { value: number; classification: string };
      triggers: string[];
      itemSummaries: string[];
    };
  }): Promise<void> {
    const posCount = params.positions.length;
    let msg =
      `🤖 <b>═══ FULL REPORT ═══</b>\n` +
      `\n` +
      `🌐 Режим: <b>${params.regime}</b>\n` +
      `📋 Позиций: ${posCount}\n`;

    // Positions list with PnL %
    if (posCount > 0) {
      for (const p of params.positions) {
        const pnl = Number(p.pnlPct);
        const icon = pnl > 0 ? '🟢' : pnl < 0 ? '🔴' : '⚪';
        msg += `${icon} ${p.symbol} ${p.direction}: <b>${pnl >= 0 ? '+' : ''}${p.pnlPct}%</b>\n`;
      }
    } else {
      msg += `— нет открытых позиций\n`;
    }

    // Accounts — compact format
    msg += `\n──────────────\n💼 <b>Аккаунты:</b>\n`;
    for (const a of params.accounts) {
      const statusIcon = a.status === 'CLEAR' ? '🟢' : a.status === 'WARNING' ? '🟡' : '🔴';
      const pnl = Number(a.pnlTodayPct);
      msg += `${statusIcon} <b>${a.label}</b>: PnL ${pnl >= 0 ? '+' : ''}${a.pnlTodayPct}% | DD ${a.dailyDd}%/${a.totalDd}%\n`;
    }

    // News — expanded with context
    msg += `\n──────────────\n📰 <b>Макро-контекст:</b>\n`;
    msg += `Bias: <b>${params.news.bias}</b> | Impact: <b>${params.news.impact}</b>`;
    if (params.news.riskMultiplier < 1) msg += ` | Risk ×${params.news.riskMultiplier}`;
    msg += `\n`;

    if (params.news.fearGreed) {
      const fg = params.news.fearGreed;
      const fgIcon = fg.value <= 25 ? '😱' : fg.value <= 45 ? '😰' : fg.value <= 55 ? '😐' : fg.value <= 75 ? '😊' : '🤑';
      msg += `${fgIcon} Fear & Greed: <b>${fg.value}</b> (${fg.classification})\n`;
    }

    if (params.news.triggers.length > 0) {
      msg += `\n<b>Триггеры:</b>\n`;
      for (const t of params.news.triggers) {
        msg += `• ${t}\n`;
      }
    }

    if (params.news.itemSummaries.length > 0) {
      msg += `\n<b>Последние новости:</b>\n`;
      for (const s of params.news.itemSummaries.slice(0, 5)) {
        msg += `• ${s}\n`;
      }
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

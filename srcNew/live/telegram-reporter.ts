import { TelegramClient } from '../clients/telegram';
import { Logger } from '../core/logger';
import { BrokerEvent } from './paper-broker';
import { PaperState } from './state';

export class PaperReporter {
  constructor(
    private readonly telegram: TelegramClient | null,
    private readonly logger: Logger,
  ) {}

  async reportEvents(events: readonly BrokerEvent[], state: PaperState): Promise<void> {
    if (events.length === 0) return;

    const lines: string[] = ['[PAPER] срабатывания контура:'];
    for (const event of events) {
      lines.push(`• ${event.pair}: ${event.detail}`);
    }
    lines.push(`Капитал (виртуальный): ${((state.equity - 1) * 100).toFixed(2)}% от старта.`);
    lines.push('Что дальше: контур продолжает наблюдение по расписанию.');

    await this.deliver(lines.join('\n'));
  }

  async reportOrderPlaced(pair: string, side: string, limitPrice: number, slPrice: number, tpPrice: number): Promise<void> {
    const lines = [
      `[PAPER] новый лимитный ордер.`,
      `Пара: ${pair}. Направление: ${side === 'long' ? 'вход BUY/LONG' : 'вход SELL/SHORT'}.`,
      `Цена входа: ${limitPrice.toFixed(2)}. Стоп: ${slPrice.toFixed(2)}. Тейк: ${tpPrice.toFixed(2)}.`,
      `Почему: сигнал стратегии на закрытии 4-часового бара.`,
      `Что дальше: ждём исполнения или истечения ордера.`,
    ];
    await this.deliver(lines.join('\n'));
  }

  private async deliver(text: string): Promise<void> {
    this.logger.info('paper report', { text });
    if (this.telegram === null) return;
    try {
      await this.telegram.send(text);
    } catch (error) {
      this.logger.error('telegram delivery failed', { error: (error as Error).message });
    }
  }
}

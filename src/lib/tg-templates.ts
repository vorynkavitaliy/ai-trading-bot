// Russian-language Telegram templates for the trading bot.
// Style rules (from CLAUDE.md § Telegram style):
//   - Allowed terms: вход, выход, стоп, тейк, доход, убыток, размер, риск,
//     регим (диапазон/тренд/переход), пара, аккаунт, ключ.
//   - Forbidden: лонг, фьюч, шорт-сетап, профит, луп, кэш-аут, лонгуем, шортуем.
//   - Every message: clear what happened, why, what next.

import { send } from './telegram';

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function dirLabel(side: 'buy' | 'sell' | 'long' | 'short'): string {
  const isLong = side === 'buy' || side === 'long';
  return isLong ? 'LONG' : 'SHORT';
}

function dirEmoji(side: 'buy' | 'sell' | 'long' | 'short'): string {
  const isLong = side === 'buy' || side === 'long';
  return isLong ? '📈' : '📉';
}

export interface OpenTradeArgs {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  entryPrice?: number;
  sl: number;
  tp1?: number;
  tp2?: number;
  riskPct?: number;
  qtyTotal: number;
  accountSummaries: string[];      // ["200000/Vitalii qty=0.32", ...]
  rationale: string;
  failedAccounts?: Array<{ label: string; error: string }>;
}

export async function notifyOpen(a: OpenTradeArgs): Promise<void> {
  const dir = dirLabel(a.side);
  const emoji = dirEmoji(a.side);
  const lines: string[] = [
    `${emoji} <b>ВХОД ${a.symbol} ${dir}</b>`,
    ``,
    a.entryPrice ? `Цена входа: ${fmtNum(a.entryPrice)}` : 'Цена входа: рыночная',
    `Стоп: ${fmtNum(a.sl)}` + (a.riskPct ? ` (риск ${a.riskPct}%)` : ''),
  ];
  if (a.tp1) lines.push(`Тейк-1: ${fmtNum(a.tp1)} (50% объёма, затем стоп → безубыток)`);
  if (a.tp2) lines.push(`Тейк-2: ${fmtNum(a.tp2)} (50% объёма)`);
  lines.push('', `Размер общий: ${a.qtyTotal} ${a.symbol.replace('USDT', '')}`);
  lines.push(`Аккаунты: ${a.accountSummaries.length} успешно`);
  for (const s of a.accountSummaries) lines.push(`  • ${s}`);
  if (a.failedAccounts && a.failedAccounts.length > 0) {
    lines.push('', '<b>Ошибки:</b>');
    for (const f of a.failedAccounts) lines.push(`  • ${f.label}: ${f.error}`);
  }
  lines.push('', `<b>Обоснование:</b>`, a.rationale.length > 1500 ? a.rationale.slice(0, 1500) + '…' : a.rationale);
  await send(lines.join('\n'));
}

export interface CloseArgs {
  symbol: string;
  side: 'buy' | 'sell';
  exitReason: 'sl' | 'tp1' | 'tp2' | 'tp1_then_sl_be' | 'manual' | 'abort' | 'time_stop' | 'external';
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlR: number;
  feesUsd?: number;
  fundingUsd?: number;
  comment?: string;
}

export async function notifyClose(a: CloseArgs): Promise<void> {
  const dir = dirLabel(a.side);
  const reasonRu: Record<CloseArgs['exitReason'], string> = {
    sl: 'стоп',
    tp1: 'тейк-1',
    tp2: 'тейк-2',
    tp1_then_sl_be: 'тейк-1, затем стоп в безубыток',
    manual: 'ручное закрытие',
    abort: 'отмена сетапа',
    time_stop: 'таймаут',
    external: 'внешнее закрытие',
  };
  const winning = a.pnlR > 0;
  const emoji = winning ? '✅' : '❌';
  const verbRu = winning ? 'доход' : 'убыток';
  const lines: string[] = [
    `${emoji} <b>ЗАКРЫТИЕ ${a.symbol} ${dir}</b> — ${reasonRu[a.exitReason]}`,
    ``,
    `Цена входа: ${fmtNum(a.entryPrice)}`,
    `Цена выхода: ${fmtNum(a.exitPrice)}`,
    `${verbRu.charAt(0).toUpperCase() + verbRu.slice(1)}: $${fmtNum(a.pnlUsd, 0)} (${a.pnlR.toFixed(2)}R)`,
  ];
  if (a.feesUsd) lines.push(`Комиссии: $${fmtNum(a.feesUsd, 2)}`);
  if (a.fundingUsd) lines.push(`Фондирование: $${fmtNum(a.fundingUsd, 2)}`);
  if (a.comment) lines.push('', a.comment);
  await send(lines.join('\n'));
}

export interface HeartbeatArgs {
  cycle: string;                   // "C0142" or "C0142-C0145"
  regime: { btc: string; eth: string };
  openPositions: number;
  pnlDayUsd: number;
  pnlDayPct: number;
  triggersInWindow: { fired: number; total: number };
  notes?: string;
}

export async function notifyHeartbeat(h: HeartbeatArgs): Promise<void> {
  const lines: string[] = [
    `✅ <b>Жив. ${h.cycle}.</b>`,
    `Регим: BTC = ${h.regime.btc}, ETH = ${h.regime.eth}.`,
    `Открытых позиций: ${h.openPositions}.`,
    `Доход дня: $${fmtNum(h.pnlDayUsd, 0)} (${h.pnlDayPct.toFixed(2)}%).`,
    `Триггеров в окне: ${h.triggersInWindow.fired}/${h.triggersInWindow.total}.`,
  ];
  if (h.notes) lines.push('', h.notes);
  await send(lines.join('\n'));
}

export type AlertKind =
  | 'kill_switch_soft'
  | 'kill_switch_hard'
  | 'wr_below_40'
  | 'consecutive_4_losses'
  | 'position_24h_no_tp1'
  | 'reconcile_divergence'
  | 'regime_flip_both_pairs'
  | 'high_impact_news_window'
  | 'pair_disabled';

export interface AlertArgs {
  kind: AlertKind;
  symbol?: string;
  detail: string;
  action?: string;                 // recommended next action
}

export async function notifyAlert(a: AlertArgs): Promise<void> {
  const titleMap: Record<AlertKind, string> = {
    kill_switch_soft: '⚠️ Дневной убыток ≥ −2.5% — мягкий стоп торговли',
    kill_switch_hard: '🛑 Дневной убыток ≥ −4% — жёсткий стоп',
    wr_below_40: '⚠️ Win rate за 20 сделок < 40%',
    consecutive_4_losses: '⚠️ 4 убытка подряд',
    position_24h_no_tp1: '⚠️ Позиция держится >24ч без тейк-1',
    reconcile_divergence: '🛑 Расхождение vault ↔ Bybit',
    regime_flip_both_pairs: '⚠️ Регим сменился на обеих парах одновременно (макро-сигнал)',
    high_impact_news_window: '⚠️ Окно высокоимпактного события',
    pair_disabled: '⚠️ Пара отключена до конца UTC-дня',
  };
  const title = titleMap[a.kind];
  const lines: string[] = [
    `<b>${title}</b>`,
    a.symbol ? `Пара: ${a.symbol}` : '',
    '',
    a.detail,
  ].filter(Boolean);
  if (a.action) lines.push('', `<b>Что делать:</b> ${a.action}`);
  await send(lines.join('\n'));
}

export interface AbortArgs {
  symbol: string;
  side: 'buy' | 'sell';
  reason: string;
  pendingOrderId?: string;
}

export async function notifyAbort(a: AbortArgs): Promise<void> {
  const dir = dirLabel(a.side);
  await send([
    `⏸️ <b>ОТМЕНА СЕТАПА ${a.symbol} ${dir}</b>`,
    ``,
    `Причина: ${a.reason}`,
    a.pendingOrderId ? `Снят лимитный ордер: ${a.pendingOrderId}` : '',
    '',
    'Открытых позиций по этой паре не было.',
  ].filter(Boolean).join('\n'));
}

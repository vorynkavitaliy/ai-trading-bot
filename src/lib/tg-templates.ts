// Russian-language Telegram templates for the trading bot.
// Style rules (from CLAUDE.md § Telegram style):
//   - Allowed terms: вход, выход, стоп, тейк, доход, убыток, размер, риск,
//     регим (диапазон/тренд/переход), пара, аккаунт, ключ.
//   - Forbidden: лонг, фьюч, шорт-сетап, профит, луп, кэш-аут, лонгуем, шортуем.
//   - Visual structure: emoji section markers, separators, indented sub-items, blank lines.
//
// Telegram parses HTML in send() with escapeHtml (lib/telegram.ts). Tags allowed: <b>, <i>, <code>.

import { send, escapeHtml } from './telegram';

const SEP = '━━━━━━━━━━━━━━━━━━━━';

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPctSigned(n: number): string {
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

function fmtUsdSigned(n: number, decimals = 0): string {
  const sign = n >= 0 ? '+' : '−';   // Unicode minus for visual clarity
  return `${sign}$${fmtNum(Math.abs(n), decimals)}`;
}

function dirLabel(side: 'buy' | 'sell' | 'long' | 'short'): string {
  const isLong = side === 'buy' || side === 'long';
  return isLong ? 'LONG' : 'SHORT';
}

function dirEmoji(side: 'buy' | 'sell' | 'long' | 'short'): string {
  const isLong = side === 'buy' || side === 'long';
  return isLong ? '🟢' : '🔴';
}

function pairTag(symbol: string): string {
  return symbol.replace(/USDT$/, '');
}

function nowUtcShort(): string {
  return new Date().toISOString().slice(11, 16) + ' UTC';
}

function pctFromPrices(entry: number, target: number, isLong: boolean): number {
  const raw = ((target - entry) / entry) * 100;
  return isLong ? raw : -raw;
}

// -----------------------------------------------------------
// OPEN
// -----------------------------------------------------------
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
  cycle?: string;
}

export async function notifyOpen(a: OpenTradeArgs): Promise<void> {
  const dir = dirLabel(a.side);
  const dot = dirEmoji(a.side);
  const isLong = a.side === 'buy';
  const tag = pairTag(a.symbol);
  const ep = a.entryPrice ?? 0;
  const slPct = ep > 0 ? pctFromPrices(ep, a.sl, isLong) : 0;
  const tp1Pct = ep > 0 && a.tp1 ? pctFromPrices(ep, a.tp1, isLong) : 0;
  const tp2Pct = ep > 0 && a.tp2 ? pctFromPrices(ep, a.tp2, isLong) : 0;

  const lines: string[] = [
    `${dot} <b>ВХОД ${dir} • ${a.symbol}</b>`,
    SEP,
    ``,
    `📍 Цена входа: <b>$${fmtNum(ep)}</b>`,
    `🛡 Стоп:       $${fmtNum(a.sl)}  (${fmtPctSigned(slPct)})`,
  ];
  if (a.tp1) lines.push(`🎯 Тейк-1:     $${fmtNum(a.tp1)}  (${fmtPctSigned(tp1Pct)}, 50% объёма → стоп в безубыток)`);
  if (a.tp2) lines.push(`🎯 Тейк-2:     $${fmtNum(a.tp2)}  (${fmtPctSigned(tp2Pct)}, 50% объёма)`);
  lines.push(``);
  lines.push(`💼 <b>Размер:</b> ${fmtNum(a.qtyTotal, 2)} ${tag}`);
  if (a.riskPct) lines.push(`⚖ <b>Риск:</b> ${a.riskPct}% от equity`);
  lines.push(``);
  lines.push(`<b>Аккаунты:</b> ${a.accountSummaries.length} ✅`);
  for (const s of a.accountSummaries) lines.push(`   • ${escapeHtml(s)}`);
  if (a.failedAccounts && a.failedAccounts.length > 0) {
    lines.push(``);
    lines.push(`<b>Не открыто:</b> ${a.failedAccounts.length} ❌`);
    for (const f of a.failedAccounts) lines.push(`   • ${escapeHtml(f.label)}: ${escapeHtml(f.error)}`);
  }
  lines.push(``);
  lines.push(`📝 <b>Обоснование:</b>`);
  const rat = a.rationale.length > 1200 ? a.rationale.slice(0, 1200) + '…' : a.rationale;
  lines.push(escapeHtml(rat));
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>VP-SMC v3 • ${escapeHtml(a.cycle ?? '')} • ${nowUtcShort()}</i>`);

  await send(lines.join('\n'), { raw: true });
}

// -----------------------------------------------------------
// CLOSE
// -----------------------------------------------------------
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
  comment?: string;          // e.g. "200000/Vitalii"
  durationMin?: number;
}

export async function notifyClose(a: CloseArgs): Promise<void> {
  const dir = dirLabel(a.side);
  const isLong = a.side === 'buy';
  const winning = a.pnlR > 0;
  const headEmoji = winning ? '🟢' : '🔴';
  const resultEmoji = winning ? '💰' : '🩸';
  const resultLabel = winning ? 'ДОХОД' : 'УБЫТОК';
  const reasonRu: Record<CloseArgs['exitReason'], string> = {
    sl: '🛡 Стоп-лосс',
    tp1: '🎯 Тейк-1',
    tp2: '🎯 Тейк-2',
    tp1_then_sl_be: '🎯 Тейк-1 → 🛡 безубыток',
    manual: '✋ Ручное закрытие',
    abort: '⏸ Отмена сетапа',
    time_stop: '⏱ Таймаут',
    external: '🔁 Внешнее закрытие',
  };
  const movePct = pctFromPrices(a.entryPrice, a.exitPrice, isLong);

  const lines: string[] = [
    `${headEmoji} <b>ВЫХОД ${dir} • ${a.symbol}</b>`,
    SEP,
    ``,
    `🚪 Причина: <b>${reasonRu[a.exitReason]}</b>`,
    ``,
    `📍 Вход:  $${fmtNum(a.entryPrice)}`,
    `📍 Выход: $${fmtNum(a.exitPrice)}  (${fmtPctSigned(movePct)})`,
    ``,
    `${resultEmoji} <b>${resultLabel}: ${fmtUsdSigned(a.pnlUsd, 0)}  (${a.pnlR >= 0 ? '+' : ''}${a.pnlR.toFixed(2)}R)</b>`,
  ];
  if (a.feesUsd != null && a.feesUsd > 0) lines.push(`   Комиссии: $${fmtNum(a.feesUsd, 2)}`);
  if (a.fundingUsd != null && a.fundingUsd !== 0) lines.push(`   Фондирование: ${fmtUsdSigned(a.fundingUsd, 2)}`);
  if (a.durationMin != null) {
    const h = Math.floor(a.durationMin / 60);
    const m = Math.round(a.durationMin % 60);
    lines.push(``);
    lines.push(`⏱ Длительность: ${h > 0 ? `${h}ч ` : ''}${m}мин`);
  }
  if (a.comment) {
    lines.push(``);
    lines.push(`<i>${escapeHtml(a.comment)}</i>`);
  }
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>VP-SMC v3 • ${nowUtcShort()}</i>`);

  await send(lines.join('\n'), { raw: true });
}

// -----------------------------------------------------------
// HEARTBEAT
// -----------------------------------------------------------
export interface HeartbeatArgs {
  cycle: string;
  regime: { btc: string; eth: string };  // .btc carries dominant text; .eth carries breakdown
  openPositions: number;
  pnlDayUsd: number;
  pnlDayPct: number;
  triggersInWindow: { fired: number; total: number };
  notes?: string;
}

export async function notifyHeartbeat(h: HeartbeatArgs): Promise<void> {
  const pnlEmoji = h.pnlDayUsd >= 0 ? '📈' : '📉';
  const lines: string[] = [
    `💓 <b>ПУЛЬС</b>  •  ${escapeHtml(h.cycle)}`,
    SEP,
    ``,
    `📊 <b>Режим рынка</b>`,
    `   ${escapeHtml(h.regime.btc)}`,
    `   ${escapeHtml(h.regime.eth)}`,
    ``,
    `💼 Открытых позиций: <b>${h.openPositions}/4</b>`,
    `${pnlEmoji} Дневной P&amp;L: <b>${fmtUsdSigned(h.pnlDayUsd, 0)} (${h.pnlDayPct >= 0 ? '+' : ''}${h.pnlDayPct.toFixed(2)}%)</b>`,
  ];
  if (h.triggersInWindow.total > 0) {
    lines.push(`🎯 Триггеров: ${h.triggersInWindow.fired}/${h.triggersInWindow.total}`);
  }
  if (h.notes) {
    lines.push(``);
    lines.push(`⚠ ${escapeHtml(h.notes)}`);
  }
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>${nowUtcShort()}</i>`);

  await send(lines.join('\n'), { raw: true });
}

// -----------------------------------------------------------
// ALERT
// -----------------------------------------------------------
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
  action?: string;
}

export async function notifyAlert(a: AlertArgs): Promise<void> {
  const titleMap: Record<AlertKind, { emoji: string; title: string }> = {
    kill_switch_soft:        { emoji: '⚠️', title: 'Мягкий стоп торговли' },
    kill_switch_hard:        { emoji: '🛑', title: 'ЖЁСТКИЙ СТОП' },
    wr_below_40:             { emoji: '⚠️', title: 'Win rate за 20 сделок < 40%' },
    consecutive_4_losses:    { emoji: '⚠️', title: '4 убытка подряд' },
    position_24h_no_tp1:     { emoji: '⚠️', title: 'Позиция держится >24ч без тейк-1' },
    reconcile_divergence:    { emoji: '🛑', title: 'Расхождение vault ↔ Bybit' },
    regime_flip_both_pairs:  { emoji: '⚠️', title: 'Глобальный разворот режима' },
    high_impact_news_window: { emoji: '📰', title: 'Высокоимпактное событие' },
    pair_disabled:           { emoji: '⚠️', title: 'Пара отключена до конца UTC-дня' },
  };
  const t = titleMap[a.kind];
  const lines: string[] = [
    `${t.emoji} <b>${t.title}</b>`,
    SEP,
    ``,
  ];
  if (a.symbol) lines.push(`Пара: <b>${escapeHtml(a.symbol)}</b>`, ``);
  lines.push(escapeHtml(a.detail));
  if (a.action) {
    lines.push(``);
    lines.push(`<b>Что делать:</b>`);
    lines.push(`   ${escapeHtml(a.action)}`);
  }
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>${nowUtcShort()}</i>`);

  await send(lines.join('\n'), { raw: true });
}

// -----------------------------------------------------------
// ABORT
// -----------------------------------------------------------
export interface AbortArgs {
  symbol: string;
  side: 'buy' | 'sell';
  reason: string;
  pendingOrderId?: string;
}

export async function notifyAbort(a: AbortArgs): Promise<void> {
  const dir = dirLabel(a.side);
  const lines: string[] = [
    `⏸ <b>ОТМЕНА СЕТАПА ${dir} • ${a.symbol}</b>`,
    SEP,
    ``,
    `Причина: ${escapeHtml(a.reason)}`,
  ];
  if (a.pendingOrderId) lines.push(`Снят ордер: <code>${escapeHtml(a.pendingOrderId)}</code>`);
  lines.push(``);
  lines.push(`<i>Открытых позиций по этой паре не было.</i>`);
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>${nowUtcShort()}</i>`);

  await send(lines.join('\n'), { raw: true });
}

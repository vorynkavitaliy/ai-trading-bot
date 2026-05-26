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
  // S5 scaled-in: per-slot grid info for display ("DCA grid"). When set the
  // open message shows entry as slot 1 + pending limit DCA slots 2..N.
  gridSlots?: Array<{ level: number; price: number; qtyTotal: number; filled: boolean }>;
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
  // Single TP case (tp1 == tp2): strategy uses one target → execute.ts places
  // ONE limit; show as a single "🎯 Тейк" line instead of two duplicates.
  const singleTp = a.tp1 != null && a.tp2 != null && Math.abs(a.tp1 - a.tp2) < 0.5;
  if (singleTp) {
    lines.push(`🎯 Тейк:       $${fmtNum(a.tp1!)}  (${fmtPctSigned(tp1Pct)})  — full position, reduce-only лимит`);
  } else {
    if (a.tp1) lines.push(`🎯 Тейк-1:     $${fmtNum(a.tp1)}  (${fmtPctSigned(tp1Pct)})  — 50% объёма, reduce-only лимит`);
    if (a.tp2) lines.push(`🎯 Тейк-2:     $${fmtNum(a.tp2)}  (${fmtPctSigned(tp2Pct)})  — 50% объёма, reduce-only лимит`);
  }
  // S5 scaled-in: show grid limit ladder if present
  if (a.gridSlots && a.gridSlots.length > 1) {
    lines.push(``);
    lines.push(`<b>🔀 Грид сетка (${a.gridSlots.length} лимиток):</b>`);
    for (const s of a.gridSlots) {
      const pct = ep > 0 ? pctFromPrices(ep, s.price, isLong) : 0;
      const status = s.filled ? '✅ filled' : '⏳ pending';
      lines.push(`   Slot ${s.level}: $${fmtNum(s.price)} (${fmtPctSigned(pct)})  ${fmtNum(s.qtyTotal, 2)} ${tag}  ${status}`);
    }
  }
  lines.push(``);
  lines.push(`💼 <b>Размер (slot 1):</b> ${fmtNum(a.qtyTotal, 2)} ${tag}`);
  if (a.gridSlots && a.gridSlots.length > 1) {
    const totalIfFull = a.gridSlots.reduce((s, x) => s + x.qtyTotal, 0);
    lines.push(`   <i>Если все ${a.gridSlots.length} slots filled: ${fmtNum(totalIfFull, 2)} ${tag}</i>`);
  }
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
  lines.push(`<i>CG-fade v4 • ${escapeHtml(a.cycle ?? '')} • ${nowUtcShort()}</i>`);

  await send(lines.join('\n'), { raw: true });
}

// -----------------------------------------------------------
// DCA FILL (scaled-in slot 2/3 filled retroactively)
// -----------------------------------------------------------
export interface DcaFillArgs {
  symbol: string;
  side: 'buy' | 'sell';
  prevSize: number;       // size in DB before fill
  newSize: number;        // size on Bybit now
  newAvgPrice: number;    // updated avg entry from Bybit
  sl: number;             // current SL
  tp: number | null;      // current TP (single — scaled-in uses one)
  accountSummaries: string[];  // ["200000/Vitalii — old:26 → new:46 ETH (+20)", ...]
}

export async function notifyDcaFill(a: DcaFillArgs): Promise<void> {
  const dir = dirLabel(a.side);
  const tag = pairTag(a.symbol);
  const delta = a.newSize - a.prevSize;
  const isLong = a.side === 'buy';
  const slPct = pctFromPrices(a.newAvgPrice, a.sl, isLong);
  const tpPct = a.tp ? pctFromPrices(a.newAvgPrice, a.tp, isLong) : 0;

  const lines: string[] = [
    `🔀 <b>DCA FILL • ${a.symbol}</b>  ${dir}`,
    SEP,
    ``,
    `Грид-лимитка сработала!`,
    ``,
    `💼 Position grew: ${fmtNum(a.prevSize, 2)} → <b>${fmtNum(a.newSize, 2)}</b> ${tag}  (+${fmtNum(delta, 2)})`,
    `📍 New avg entry: <b>$${fmtNum(a.newAvgPrice)}</b>`,
    `🛡 Stop:           $${fmtNum(a.sl)}  (${fmtPctSigned(slPct)} от новой avg)`,
  ];
  if (a.tp) lines.push(`🎯 Take:           $${fmtNum(a.tp)}  (${fmtPctSigned(tpPct)} от новой avg)`);
  lines.push(``);
  lines.push(`<b>Аккаунты:</b>`);
  for (const s of a.accountSummaries) lines.push(`   • ${escapeHtml(s)}`);
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>${nowUtcShort()}</i>`);
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
  comment?: string;
  durationMin?: number;
  // For consolidated multi-account close: per-account breakdown.
  // If provided AND accountFills.length > 1, message lists each account; else single-line.
  accountFills?: Array<{ label: string; qty: number; pnlUsd: number; pnlR: number }>;
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
  // Per-account breakdown (consolidated multi-account close)
  if (a.accountFills && a.accountFills.length > 0) {
    lines.push(``);
    lines.push(`<b>Аккаунты:</b> ${a.accountFills.length}`);
    const tag = pairTag(a.symbol);
    for (const f of a.accountFills) {
      const sign = f.pnlUsd >= 0 ? '+' : '−';
      lines.push(`   • ${escapeHtml(f.label)} — ${fmtNum(f.qty, 2)} ${tag} → ${sign}$${fmtNum(Math.abs(f.pnlUsd), 0)} (${f.pnlR >= 0 ? '+' : ''}${f.pnlR.toFixed(2)}R)`);
    }
  } else if (a.comment) {
    lines.push(``);
    lines.push(`<i>${escapeHtml(a.comment)}</i>`);
  }
  if (a.durationMin != null) {
    const h = Math.floor(a.durationMin / 60);
    const m = Math.round(a.durationMin % 60);
    lines.push(``);
    lines.push(`⏱ Длительность: ${h > 0 ? `${h}ч ` : ''}${m}мин`);
  }
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>CG-fade v4 • ${nowUtcShort()}</i>`);

  await send(lines.join('\n'), { raw: true });
}

// -----------------------------------------------------------
// HEARTBEAT
// -----------------------------------------------------------
export interface HeartbeatArgs {
  cycle: string;
  regimeCount: { range: number; trend: number; transition: number };
  dominantRegime: string;                       // 'range' | 'trend_bull' | 'trend_bear' | 'transition'
  openPositions: number;
  maxPositions: number;                         // = RISK.maxParallelPositions
  totalEquity: number;                          // sum across all accounts
  totalUpnl: number;                            // sum unrealized PnL across all positions
  dayPnlUsd: number;                            // realized + unrealized today
  dayPnlPct: number;                            // % of session-start equity
  accounts: Array<{ name: string; equity: number; uPnl: number }>;
  btcPrice?: number;                            // for market context
  triggersInWindow: { fired: number; total: number };
  notes?: string;
  // File ages from /tmp — proxy for "is the cron pipeline alive?". scan-decide should
  // refresh every top-of-hour; an age > 90 min means top-of-hour scan-decide has been
  // failing silently. Heartbeat surfaces this so the operator sees it before "no trades
  // for a day" becomes the first alarm.
  staleness?: {
    scanDecideAgeMin: number | null;
    autoExecAgeMin: number | null;
    cycleLogAgeMin: number | null;
    degraded: boolean;
    reasons: string[];
  };
}

function regimeMeaning(dominantRegime: string, count: { range: number; trend: number; transition: number }): string {
  // Total pairs derived from breakdown — auto-updates when universe changes.
  const total = count.range + count.trend + count.transition;
  if (dominantRegime === 'range') {
    return `🔄 <b>Боковик</b> — ${count.range} из ${total} пар топчутся между уровнями (хорошо для нашей стратегии)`;
  }
  if (dominantRegime.startsWith('trend')) {
    const dir = dominantRegime.includes('bull') ? 'вверх' : 'вниз';
    return `🚀 <b>Тренд ${dir}</b> — ${count.trend} из ${total} пар идут направленно (плохо для нашей стратегии — она торгует развороты)`;
  }
  return `⚪ <b>Переход</b> — рынок перестраивается (${count.range} в боковике, ${count.trend} в тренде, ${count.transition} в переходе)`;
}

function pnlStatusLine(dayPnlUsd: number, dayPnlPct: number): string {
  if (Math.abs(dayPnlUsd) < 1) return `⚪ Сегодня в нуле`;
  if (dayPnlUsd > 0) return `🟢 Сегодня <b>в плюсе</b>: ${fmtUsdSigned(dayPnlUsd, 0)} (+${dayPnlPct.toFixed(2)}%)`;
  return `🔴 Сегодня <b>в минусе</b>: ${fmtUsdSigned(dayPnlUsd, 0)} (${dayPnlPct.toFixed(2)}%)`;
}

// Russian noun pluralization helper: 1 → "слот", 2-4 → "слота", 5+ → "слотов"
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export async function notifyHeartbeat(h: HeartbeatArgs): Promise<void> {
  const slotsFree = h.maxPositions - h.openPositions;
  const slotsWordMax = pluralRu(h.maxPositions, 'слот', 'слота', 'слотов');
  const slotsWordFree = pluralRu(slotsFree, 'слот', 'слота', 'слотов');
  const positionLine = h.openPositions === 0
    ? `📭 <b>Сделок нет</b> — все ${h.maxPositions} ${slotsWordMax} свободны, бот ждёт сигнал`
    : `📂 <b>Открыто ${h.openPositions} из ${h.maxPositions} сделок</b> (свободно ${slotsFree} ${slotsWordFree})`;

  const lines: string[] = [
    `💓 <b>Бот живой — ежечасный отчёт</b>`,
    SEP,
  ];
  // Stale state warning goes at the very top: if cron pipeline pieces are silently
  // failing, that's the most important thing the operator should see this minute.
  if (h.staleness?.degraded) {
    lines.push(``);
    lines.push(`⚠️ <b>Конвейер деградировал:</b>`);
    for (const reason of h.staleness.reasons) {
      lines.push(`   • ${escapeHtml(reason)}`);
    }
  }
  lines.push(``);
  lines.push(`📊 <b>Что на рынке:</b>`);
  lines.push(`   ${regimeMeaning(h.dominantRegime, h.regimeCount)}`);
  if (h.btcPrice) {
    lines.push(`   💎 BTC: $${fmtNum(h.btcPrice, 0)}`);
  }
  lines.push(``);
  lines.push(`💼 <b>Что у бота:</b>`);
  lines.push(`   ${positionLine}`);
  if (h.openPositions > 0 && h.totalUpnl !== 0) {
    const upnlEmoji = h.totalUpnl >= 0 ? '🟢' : '🔴';
    lines.push(`   ${upnlEmoji} Текущая прибыль/убыток открытых: ${fmtUsdSigned(h.totalUpnl, 0)}`);
  }
  lines.push(``);
  lines.push(`💰 <b>Итог дня:</b>`);
  lines.push(`   ${pnlStatusLine(h.dayPnlUsd, h.dayPnlPct)}`);
  lines.push(`   💵 Капитал: <b>$${fmtNum(h.totalEquity, 0)}</b>`);
  lines.push(``);
  lines.push(`🏦 <b>По аккаунтам:</b>`);
  for (const a of h.accounts) {
    const upnlEmoji = a.uPnl > 0 ? '🟢' : a.uPnl < 0 ? '🔴' : '';
    const upnlStr = a.uPnl !== 0 ? `  ${upnlEmoji} ${fmtUsdSigned(a.uPnl, 0)}` : '';
    lines.push(`   • <b>${escapeHtml(a.name)}</b>: $${fmtNum(a.equity, 0)}${upnlStr}`);
  }
  if (h.notes) {
    lines.push(``);
    lines.push(`⚠ <b>Внимание:</b> ${escapeHtml(h.notes)}`);
  }
  lines.push(``);
  lines.push(SEP);
  lines.push(`<i>CG-fade v4 • ${nowUtcShort()}</i>`);

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

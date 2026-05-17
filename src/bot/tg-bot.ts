// Telegram command listener — long-polling, persistent process.
// Operator-only access: replies only to messages from configured chatId.
//
// Commands:
//   /status     — equity, daily P&L, open count
//   /positions  — detailed open positions (symbol, side, entry, SL, TPs, current uPnL)
//   /cycle      — last cron tick + auto-execute summary (actionable/take/skip/executed)
//   /pause      — create vault/Watchlist/PAUSE.md → auto-execute halts new entries
//   /resume     — remove PAUSE.md
//   /help       — list commands
//
// Run via: npm run tg-bot (tmux window or systemd unit). Restart on crash.

import fs from 'node:fs';
import path from 'node:path';
import { Telegraf } from 'telegraf';
import { requireTelegram } from '../core/config';
import { query, close as closePg } from '../core/db';
import { loadAccounts } from '../core/accounts';
import { getRest, withRetry } from '../core/bybit';
import { getDayPnl, formatDayPnl } from '../core/pnl';
import { RISK } from '../runtime/risk-guard';
import { log } from '../core/logger';

// PAUSE.md marker at project root (src/bot → ../.. = root). Created on /pause,
// removed on /resume. auto-execute.ts skips entries while file exists.
const PAUSE_FILE = path.resolve(__dirname, '..', '..', 'vault', 'Watchlist', 'PAUSE.md');
const SCAN_PATH = '/tmp/scan-decide-latest.json';
const AUTO_EXEC_PATH = '/tmp/auto-execute-latest.json';
const CYCLE_LOG = '/tmp/cycle.log';

function fmt(n: number, dp = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtUsd(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${fmt(Math.abs(n))}`;
}

async function cmdStatus(): Promise<string> {
  const p = await getDayPnl();
  const lines = [
    `<b>📊 Status</b> — ${p.utcDay} UTC`,
    ``,
    formatDayPnl(p),
    ``,
    `Open: ${p.openPositionsCount} pos / cap ${RISK.maxParallelPositions}`,
    fs.existsSync(PAUSE_FILE) ? `⏸ <b>PAUSED</b> — see /resume` : `▶ Active`,
  ];
  return lines.join('\n');
}

async function cmdPositions(): Promise<string> {
  const r = await query<any>(
    `SELECT account_key, symbol, side, qty, entry_price, sl, tp1, tp2, opened_at
     FROM trades WHERE status='open' ORDER BY symbol, account_key`,
    []
  );
  if (r.rows.length === 0) return '<b>📂 Positions</b>\n\nNo open positions.';

  // Group by symbol+side; aggregate qty across accounts; fetch live mark for uPnL.
  const groups = new Map<string, { symbol: string; side: string; qty: number; entry: number; sl: number; tp1: number | null; tp2: number | null; openedAt: number; accounts: string[] }>();
  for (const t of r.rows) {
    const key = `${t.symbol}-${t.side}`;
    const g = groups.get(key);
    const qty = parseFloat(t.qty);
    if (g) {
      g.qty += qty;
      g.accounts.push(t.account_key);
    } else {
      groups.set(key, {
        symbol: t.symbol, side: t.side, qty,
        entry: parseFloat(t.entry_price),
        sl: parseFloat(t.sl),
        tp1: t.tp1 != null ? parseFloat(t.tp1) : null,
        tp2: t.tp2 != null ? parseFloat(t.tp2) : null,
        openedAt: new Date(t.opened_at).getTime(),
        accounts: [t.account_key],
      });
    }
  }

  // Live mark prices via Bybit tickers (using first account only — public tickers are same for all)
  const accounts = loadAccounts();
  const c = getRest(accounts[0]);
  const symbols = [...new Set([...groups.values()].map((g) => g.symbol))];
  const liveMark = new Map<string, number>();
  for (const s of symbols) {
    try {
      const t = await withRetry(() => c.getTickers({ category: 'linear', symbol: s }), { label: `tg-tick-${s}` });
      const mark = parseFloat(t.result?.list?.[0]?.lastPrice ?? '0');
      if (mark > 0) liveMark.set(s, mark);
    } catch (e: any) {
      log.warn('tg-bot ticker fail', { symbol: s, err: e.message });
    }
  }

  const lines: string[] = [`<b>📂 Open positions</b> (${groups.size})\n`];
  for (const g of groups.values()) {
    const mark = liveMark.get(g.symbol) ?? g.entry;
    const sideMul = g.side.toLowerCase() === 'buy' || g.side.toLowerCase() === 'long' ? 1 : -1;
    const upnl = (mark - g.entry) * g.qty * sideMul;
    const upnlPct = ((mark - g.entry) / g.entry) * 100 * sideMul;
    const ageMin = Math.round((Date.now() - g.openedAt) / 60000);
    const ageStr = ageMin < 60 ? `${ageMin}m` : `${(ageMin / 60).toFixed(1)}h`;
    lines.push(
      `<b>${g.symbol}</b> ${g.side.toUpperCase()}  qty <code>${g.qty}</code>  (${g.accounts.length} acc)`,
      `  entry <code>${g.entry}</code>  mark <code>${mark}</code>`,
      `  uPnL ${fmtUsd(upnl)} (${upnlPct >= 0 ? '+' : ''}${upnlPct.toFixed(2)}%)`,
      `  SL <code>${g.sl}</code>  TP1 <code>${g.tp1 ?? '—'}</code>  TP2 <code>${g.tp2 ?? '—'}</code>`,
      `  age ${ageStr}`,
      ``,
    );
  }
  return lines.join('\n');
}

async function cmdCycle(): Promise<string> {
  const lines: string[] = [`<b>🔄 Last cycle</b>\n`];

  if (fs.existsSync(SCAN_PATH)) {
    try {
      const scan = JSON.parse(fs.readFileSync(SCAN_PATH, 'utf-8'));
      const ageMin = Math.round((Date.now() - new Date(scan.cycle.iso).getTime()) / 60000);
      lines.push(
        `<b>scan-decide</b>: ${scan.cycle.iso} (${ageMin}m ago)`,
        `  enterCount=${scan.enterCount}  open=${scan.risk.openPositionsCount}  heat=${scan.risk.totalHeatPct?.toFixed(2)}%`,
        ``
      );
    } catch (e: any) {
      lines.push(`scan-decide read failed: ${e.message}\n`);
    }
  } else {
    lines.push(`scan-decide: <i>none yet</i>\n`);
  }

  if (fs.existsSync(AUTO_EXEC_PATH)) {
    try {
      const ae = JSON.parse(fs.readFileSync(AUTO_EXEC_PATH, 'utf-8'));
      if (ae.error) {
        lines.push(`<b>auto-execute</b>: <i>${ae.error}</i>\n`);
      } else {
        lines.push(
          `<b>auto-execute</b>: ${ae.cycle?.iso ?? '?'}`,
          `  actionable=${ae.actionable ?? 0}  executed=${ae.executed ?? 0}  failed=${ae.failed ?? 0}`,
        );
        if (ae.records?.length) {
          lines.push('');
          for (const rec of ae.records) {
            const icon = rec.executed ? '✅' : '❌';
            const rrStr = rec.rrTp2 != null ? `rrTp2=${rec.rrTp2.toFixed(2)}` : '';
            lines.push(`  ${icon} ${rec.symbol} ${rec.side?.toUpperCase()} ${rrStr}${rec.error ? ' err: ' + rec.error.slice(0, 80) : ''}`);
          }
        }
      }
    } catch (e: any) {
      lines.push(`auto-execute read failed: ${e.message}`);
    }
  } else {
    lines.push(`auto-execute: <i>none yet</i>`);
  }

  // Last 5 cycle log lines
  if (fs.existsSync(CYCLE_LOG)) {
    const tail = fs.readFileSync(CYCLE_LOG, 'utf-8').split('\n').filter(Boolean).slice(-5);
    lines.push('', '<b>cycle.log tail:</b>', '<code>' + tail.join('\n') + '</code>');
  }

  return lines.join('\n');
}

function cmdPause(reason: string): string {
  fs.mkdirSync(path.dirname(PAUSE_FILE), { recursive: true });
  const body = `# PAUSE\n\nCreated: ${new Date().toISOString()}\nReason: ${reason || '(no reason)'}\n\nWhile this file exists, auto-execute.ts skips all TAKE signals.\nUse /resume to remove.\n`;
  fs.writeFileSync(PAUSE_FILE, body);
  return `⏸ <b>PAUSED</b>\n\n${body}`;
}

function cmdResume(): string {
  if (!fs.existsSync(PAUSE_FILE)) return '▶ Already active (no PAUSE.md)';
  fs.unlinkSync(PAUSE_FILE);
  return '▶ <b>RESUMED</b>\n\nPAUSE.md removed. auto-execute will take signals on next top-of-hour.';
}

function cmdHelp(): string {
  return [
    '<b>📖 Commands</b>',
    '',
    '/status — equity, daily P&L, open count',
    '/positions — detailed open positions',
    '/cycle — last cron + auto-execute summary',
    '/pause [reason] — halt new entries (PAUSE.md)',
    '/resume — remove PAUSE.md',
    '/help — this message',
  ].join('\n');
}

async function main() {
  const { botToken, chatId: allowedChatIdRaw } = requireTelegram();
  // TELEGRAM_CHAT_ID may be a single id or comma-separated list (multi-operator setups).
  const allowedChatIds = new Set(String(allowedChatIdRaw).split(',').map((s) => s.trim()).filter(Boolean));

  const bot = new Telegraf(botToken);

  // Auth middleware: ignore everyone except configured operator(s)
  bot.use(async (ctx, next) => {
    const from = String(ctx.chat?.id ?? '');
    if (!allowedChatIds.has(from)) {
      log.warn('tg-bot: rejected message from unknown chat', { from, allowed: [...allowedChatIds] });
      return;
    }
    return next();
  });

  bot.command(['start', 'help'], async (ctx) => { await ctx.reply(cmdHelp(), { parse_mode: 'HTML' }); });
  bot.command('status', async (ctx) => {
    try {
      const text = await cmdStatus();
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (e: any) {
      log.error('tg-bot /status failed', { err: e.message });
      await ctx.reply(`status failed: ${e.message}`);
    }
  });
  bot.command('positions', async (ctx) => {
    try {
      const text = await cmdPositions();
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (e: any) {
      log.error('tg-bot /positions failed', { err: e.message });
      await ctx.reply(`positions failed: ${e.message}`);
    }
  });
  bot.command('cycle', async (ctx) => {
    try {
      const text = await cmdCycle();
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (e: any) {
      log.error('tg-bot /cycle failed', { err: e.message });
      await ctx.reply(`cycle failed: ${e.message}`);
    }
  });
  bot.command('pause', async (ctx) => {
    const text = ctx.message.text ?? '';
    const reason = text.replace(/^\/pause(@\w+)?\s*/, '').trim();
    await ctx.reply(cmdPause(reason), { parse_mode: 'HTML' });
  });
  bot.command('resume', async (ctx) => {
    await ctx.reply(cmdResume(), { parse_mode: 'HTML' });
  });

  bot.catch((err: any, ctx) => {
    log.error('tg-bot handler crash', { err: err?.message ?? String(err), update: ctx.update });
  });

  log.info('tg-bot starting long-polling…', { allowedChatIds: [...allowedChatIds] });
  await bot.launch();

  // Graceful shutdown
  const stop = async () => {
    log.info('tg-bot stopping…');
    bot.stop('SIGTERM');
    try { await closePg(); } catch {}
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((e) => {
  log.error('tg-bot crashed', { err: e?.message ?? String(e) });
  process.exit(1);
});

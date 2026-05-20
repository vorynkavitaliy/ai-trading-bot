// Structure-watch: monitor open positions for structural breaks → Telegram alert.
// NOT auto-close (proven counterproductive in 2026-05-20 backtest of 6 variants).
// Operator-decision alert: when a position looks structurally hopeless, ping
// Telegram with details. Operator can then decide manual close via /close-symbol.
//
// Alert criteria (ALL must be true):
//   1. Position age ≥ 6h (give setup time to play out)
//   2. Position currently in red, drawdown ≥ 50% of stop distance
//   3. Recent 1H bars closing AGAINST the position (3+ in a row)
//   4. Optionally: price has crossed POC (intermediate target failed)
//
// Dedup: only alert once per position. Tracked via /tmp/structure-watch-alerted.json.

import fs from 'node:fs';
import { query, close as closePg } from '../core/db';
import { loadAccounts } from '../core/accounts';
import { getLiveTickers } from '../core/bybit';
import { send } from '../core/telegram';
import { log } from '../core/logger';
import { buildVolumeProfile } from '../strategies/btc-vp-smc';
import { Bar } from '../backtest/types';

const ALERT_FILE = '/tmp/structure-watch-alerted.json';
const MIN_AGE_HOURS = 6;
const MIN_DRAWDOWN_FRAC = 0.50;  // 50% of stop distance underwater
const MIN_AGAINST_BARS = 3;

interface AlertedMap {
  [tradeKey: string]: number;  // ts when alerted
}

function loadAlerted(): AlertedMap {
  try { return JSON.parse(fs.readFileSync(ALERT_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveAlerted(m: AlertedMap) {
  fs.writeFileSync(ALERT_FILE, JSON.stringify(m));
}

async function loadBars(symbol: string, tf: string, fromTs: number, toTs: number): Promise<Bar[]> {
  const r = await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text, volume::text
     FROM candles WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4 ORDER BY ts`,
    [symbol, tf, fromTs, toTs]
  );
  return r.rows.map(row => ({
    ts: Number(row.ts), open: Number(row.open), high: Number(row.high),
    low: Number(row.low), close: Number(row.close), volume: Number(row.volume),
  }));
}

async function main() {
  const positions = await query<any>(
    `SELECT DISTINCT symbol, side, entry_price, sl, tp1, tp2, MIN(opened_at) as opened_at
     FROM trades WHERE status='open' GROUP BY symbol, side, entry_price, sl, tp1, tp2`,
    []
  );
  if (positions.rows.length === 0) {
    log.info('structure-watch: no open positions');
    await closePg();
    return;
  }

  const alerted = loadAlerted();
  const now = Date.now();
  const accounts = loadAccounts();
  const tickerMap = await getLiveTickers(accounts[0], positions.rows.map(p => p.symbol));

  for (const p of positions.rows) {
    const symbol = p.symbol;
    const side = (p.side as string).toLowerCase() === 'buy' ? 'long' : 'short';
    const entry = Number(p.entry_price);
    const sl = Number(p.sl);
    const tp1 = Number(p.tp1);
    const tp2 = Number(p.tp2);
    const openedTs = new Date(p.opened_at).getTime();
    const ageHours = (now - openedTs) / 3_600_000;
    const tradeKey = `${symbol}-${openedTs}`;

    // Skip if already alerted in last 24h
    if (alerted[tradeKey] && (now - alerted[tradeKey]) < 24 * 3_600_000) continue;

    const livePrice = tickerMap.get(symbol);
    if (!livePrice) { log.warn('structure-watch: no live price', { symbol }); continue; }

    const curPnl = side === 'long' ? (livePrice - entry) : (entry - livePrice);
    const pnlPct = (curPnl / entry) * 100;
    const stopDist = Math.abs(entry - sl);
    const drawdownFrac = stopDist > 0 ? -curPnl / stopDist : 0;  // 0 = at entry, 1 = at SL

    // Gate 1: age
    if (ageHours < MIN_AGE_HOURS) continue;
    // Gate 2: drawdown
    if (drawdownFrac < MIN_DRAWDOWN_FRAC) continue;

    // Gate 3: 3+ consecutive 1H bars closing AGAINST position
    const bars1h = await loadBars(symbol, '60m', now - 6 * 3600_000, now);
    if (bars1h.length < 3) continue;
    const lastBars = bars1h.slice(-3);
    const allAgainst = lastBars.every(b => side === 'long' ? b.close < b.open : b.close > b.open);
    if (!allAgainst) continue;

    // Compute VAH/VAL/POC for context in alert
    const bars1hForVp = await loadBars(symbol, '60m', now - 36 * 3600_000, now);
    const vpBars = bars1hForVp.slice(0, -6);  // exclude recent touch window
    const vp = vpBars.length >= 12 ? buildVolumeProfile(vpBars, 24, 0.7) : null;

    // Build alert message
    const sideRu = side === 'long' ? '🟢 BUY/LONG' : '🔴 SELL/SHORT';
    const sideArrow = side === 'long' ? '▼ цена упала' : '▲ цена выросла';
    const lines: string[] = [];
    lines.push(`⚠️ <b>${symbol}</b> ${sideRu} — структурный риск`);
    lines.push(``);
    lines.push(`Вход: ${entry.toFixed(symbol === 'BTCUSDT' ? 0 : 4)}`);
    lines.push(`Сейчас: ${livePrice.toFixed(symbol === 'BTCUSDT' ? 0 : 4)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`);
    lines.push(`До SL: ${(drawdownFrac * 100).toFixed(0)}% (стоп ${sl.toFixed(symbol === 'BTCUSDT' ? 0 : 4)})`);
    lines.push(`Возраст: ${ageHours.toFixed(1)}ч`);
    lines.push(``);
    lines.push(`<b>Причины алёрта:</b>`);
    lines.push(`• ${sideArrow}, прошло ${MIN_AGE_HOURS}+ч`);
    lines.push(`• Прошли ≥${(MIN_DRAWDOWN_FRAC*100).toFixed(0)}% пути к SL`);
    lines.push(`• 3 свечи 1H закрылись против`);
    if (vp) {
      const crossedPoc = (side === 'short' && livePrice > vp.poc) || (side === 'long' && livePrice < vp.poc);
      const crossedOppVa = (side === 'short' && livePrice > vp.vah) || (side === 'long' && livePrice < vp.val);
      if (crossedPoc) lines.push(`• Цена прошла POC ${vp.poc.toFixed(symbol === 'BTCUSDT' ? 0 : 4)}`);
      if (crossedOppVa) lines.push(`• Цена пробила ${side === 'short' ? 'VAH' : 'VAL'} value-area ⚠️`);
    }
    lines.push(``);
    lines.push(`<b>Что делать:</b>`);
    lines.push(`• Закрыть: <code>npx tsx src/tools/admin/close-symbol.ts ${symbol}</code>`);
    lines.push(`• Оставить — strategy продолжит держать до SL или TP`);

    const message = lines.join('\n');
    await send(message);

    alerted[tradeKey] = now;
    log.info('structure-watch: alert sent', { symbol, drawdownFrac, ageHours });
  }

  saveAlerted(alerted);
  await closePg();
}

main().catch(async e => {
  log.error('structure-watch failed', { err: e.message, stack: e.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});

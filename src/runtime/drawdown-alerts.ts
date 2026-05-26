/**
 * Drawdown alerts — periodic-only (NOT every WS event).
 *
 * Fires Telegram alert when an aggregated (symbol+side) position has
 * unrealised PnL worse than -0.7R, throttled to one alert per 4h per pair.
 * Bot does NOT auto-close — operator decides. Backtest validation showed
 * auto-close at intermediate signals reduces PF by ~22% (see
 * position-watcher.ts history pre-TASK-006).
 *
 * Called from the cron path (5min) and from the daemon's 30s REST poll —
 * NOT from WS push handlers, since uPnL drift is a slow, mark-price-driven
 * signal that doesn't need sub-second reactions.
 */

import fs from 'node:fs';
import { notifyAlert } from '../core/tg-templates';
import { log } from '../core/logger';
import { BybitPos } from './position-events';

const R_THRESHOLD = 0.7;
const THROTTLE_MS = 4 * 3_600_000;
const STATE_PATH = '/tmp/drawdown-alerts.json';

interface Group {
  symbol: string;
  side: 'Buy' | 'Sell';
  totalUpnl: number;
  totalRisk: number;
  entry: number;
  mark: number;
  sl: number;
}

function readState(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeState(state: Record<string, number>): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {}
}

function aggregateByPair(positions: BybitPos[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const pos of positions) {
    if (pos.tp1AlreadyFilled) continue;
    const key = `${pos.symbol}-${pos.side}`;
    const stopDist = Math.abs(pos.entryPrice - pos.dbInitialSL);
    const positionRisk = stopDist * pos.dbInitialQty;
    const g = groups.get(key) ?? {
      symbol: pos.symbol,
      side: pos.side,
      totalUpnl: 0,
      totalRisk: 0,
      entry: pos.entryPrice,
      mark: pos.entryPrice + (pos.unrealisedPnl / Math.max(pos.size, 1)) * (pos.side === 'Sell' ? -1 : 1),
      sl: pos.curSL,
    };
    g.totalUpnl += pos.unrealisedPnl;
    g.totalRisk += positionRisk;
    groups.set(key, g);
  }
  return groups;
}

export async function sendDrawdownAlerts(positions: BybitPos[]): Promise<void> {
  const groups = aggregateByPair(positions);
  const state = readState();

  for (const g of groups.values()) {
    const upnlR = g.totalRisk > 0 ? g.totalUpnl / g.totalRisk : 0;
    if (upnlR >= -R_THRESHOLD) continue;
    const key = `${g.symbol}-${g.side}`;
    const lastAlertTs = state[key] ?? 0;
    if (Date.now() - lastAlertTs < THROTTLE_MS) continue;

    try {
      await notifyAlert({
        kind: 'reconcile_divergence',
        symbol: g.symbol,
        detail: `${g.symbol} ${g.side === 'Sell' ? 'SHORT' : 'LONG'}: глубокий drawdown ${upnlR.toFixed(2)}R (uPnL ${g.totalUpnl >= 0 ? '+' : ''}$${g.totalUpnl.toFixed(0)}). Entry ${g.entry.toFixed(g.entry < 10 ? 4 : 2)}, mark ${g.mark.toFixed(g.entry < 10 ? 4 : 2)}, SL ${g.sl.toFixed(g.entry < 10 ? 4 : 2)}`,
        action: `Решай: держим до SL/TP1, либо ручное закрытие. Бот авто-выход НЕ делает (вариант B).`,
      });
      state[key] = Date.now();
      log.info('drawdown alert sent', { symbol: g.symbol, side: g.side, upnlR, upnl: g.totalUpnl });
    } catch (e: any) {
      log.error('drawdown alert send failed', { symbol: g.symbol, err: e?.message });
    }
  }

  writeState(state);
}

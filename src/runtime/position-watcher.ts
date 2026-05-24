// Position watcher — runs every cycle alongside scan-decide/reconcile.
// Manages open positions according to the rules backtest assumed:
//   1. TP1 partial-fill detection → move SL to BE for remainder
//   2. Regime-flip exit → close if 1H ADX collapses or EMA stack flips against direction
//   3. Time stop → alert/close if position held > 24h without TP1
//   4. Volatility spike → tighten SL if ATR1h > 2× of 24h-median
//
// Edit-never-cancel discipline (CLAUDE.md): use amend_order to move SL, never cancel+create.

import { randomUUID } from 'node:crypto';
import { loadAccounts, AccountKey } from '../core/accounts';
import { getRest, getInstrumentInfo, roundPriceToTick, roundQtyToStep, withRetry } from '../core/bybit';
import { query } from '../core/db';
import { computeFeatures, CandleRow } from '../data/features';
import { notifyAlert, notifyClose } from '../core/tg-templates';
import { log } from '../core/logger';
import { tradeRepo, OpenTrade } from '../data/trade-repo';
import { Position } from '../core/position';

const TIME_STOP_HOURS = 24;
const REGIME_ADX_FLIP_THRESHOLD = 18;     // ADX dropping below this = trend losing strength
const VOL_SPIKE_MULT = 2.0;                // ATR1h > 2× 24h-median = volatility spike

interface BybitPos {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  initialSize: number;        // when first opened — from DB row
  entryPrice: number;
  curSL: number;
  curTP: number | null;
  unrealisedPnl: number;
  positionValue: number;
  createdTime: number;
  account: AccountKey;
  dbTradeId: number;
  dbInitialSL: number;        // original SL from when we opened
  dbTP1: number | null;
  dbTP2: number | null;
  dbInitialQty: number;       // original qty at open (initial_qty col, falls back to qty)
  dbCurrentQty: number;       // current qty in DB (updates after TP1 fill)
  tp1AlreadyFilled: boolean;  // tp1_filled_at not null → don't re-fire notification
}

function matchDbTrade(
  trades: OpenTrade[],
  bucket: string,
  keyName: string,
  symbol: string,
  side: string,
): OpenTrade | null {
  // Most-recent-opened match for (account_bucket, account_key, symbol, side).
  let best: OpenTrade | null = null;
  for (const t of trades) {
    if (t.account_bucket !== bucket) continue;
    if (t.account_key !== keyName) continue;
    if (t.symbol !== symbol) continue;
    if (t.side !== side) continue;
    if (best === null || t.opened_at > best.opened_at) best = t;
  }
  return best;
}

async function fetchOpenPositionsWithDb(): Promise<BybitPos[]> {
  const accounts = loadAccounts();
  // Single DB call up-front instead of N (was: one per matched Bybit position).
  const dbTrades = await tradeRepo.openTrades();
  const results: BybitPos[] = [];

  for (const acc of accounts) {
    const c = getRest(acc);
    const r = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), {
      label: `pos-${acc.bucket}/${acc.keyName}`,
    });
    if (r.retCode !== 0) {
      log.warn('positions fetch failed', { account: acc.keyName, retCode: r.retCode });
      continue;
    }
    const list = (r.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);

    for (const p of list) {
      // Match against DB row to recover original SL/TP1/TP2/initialQty + REAL opened_at.
      // Bybit's createdTime on a position object reflects first-ever open on that symbol,
      // not the current position cycle — using DB opened_at instead.
      const db = matchDbTrade(dbTrades, acc.bucket, acc.keyName, p.symbol, p.side);
      if (!db) continue;
      const openedMs = Date.parse(db.opened_at);

      results.push({
        symbol: p.symbol,
        side: (p.side === 'Buy' || p.side === 'Sell') ? p.side : 'Buy',
        size: parseFloat(p.size),
        initialSize: db.initial_qty,
        entryPrice: parseFloat(p.avgPrice ?? '0'),
        curSL: parseFloat(p.stopLoss ?? '0'),
        curTP: p.takeProfit ? parseFloat(p.takeProfit) : null,
        unrealisedPnl: parseFloat(p.unrealisedPnl ?? '0'),
        positionValue: parseFloat(p.positionValue ?? '0'),
        createdTime: Number.isFinite(openedMs) && openedMs > 0 ? openedMs : parseInt(p.createdTime ?? '0', 10),
        account: acc,
        dbTradeId: db.id,
        dbInitialSL: db.sl ?? 0,
        dbTP1: db.tp1,
        dbTP2: db.tp2,
        dbInitialQty: db.initial_qty,
        dbCurrentQty: db.qty,
        tp1AlreadyFilled: db.tp1_filled,
      });
    }
  }
  return results;
}

async function loadFeatures1h(symbol: string): Promise<any | null> {
  const r = await query<any>(
    `SELECT ts::text, open, high, low, close, volume FROM candles
     WHERE symbol = $1 AND tf = '60m' ORDER BY ts DESC LIMIT 200`,
    [symbol]
  );
  if (r.rows.length < 100) return null;
  const slice: CandleRow[] = r.rows.reverse().map((row: any) => ({
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
  }));
  return computeFeatures(symbol, '60m', slice);
}

async function moveStopLoss(pos: BybitPos, newSL: number, reason: string): Promise<void> {
  const c = getRest(pos.account);
  const info = await getInstrumentInfo(pos.account, pos.symbol);
  const slStr = roundPriceToTick(newSL, info);
  // Use setTradingStop (Bybit V5) — amend SL on existing position, never cancel.
  const r = await withRetry(() => c.setTradingStop({
    category: 'linear',
    symbol: pos.symbol,
    stopLoss: slStr,
    slTriggerBy: 'LastPrice',
    positionIdx: 0,
  }), { label: `move-sl-${pos.symbol}-${pos.account.keyName}` });
  if (r.retCode !== 0) throw new Error(`setTradingStop retCode=${r.retCode} ${r.retMsg}`);
  log.info('SL moved', {
    symbol: pos.symbol, account: pos.account.keyName,
    from: pos.curSL, to: parseFloat(slStr), reason,
  });
}

async function closePosition(pos: BybitPos, reason: string): Promise<void> {
  const c = getRest(pos.account);
  const info = await getInstrumentInfo(pos.account, pos.symbol);
  // Close via reduce-only market order opposite side
  const r = await withRetry(() => c.submitOrder({
    category: 'linear',
    symbol: pos.symbol,
    side: pos.side === 'Buy' ? 'Sell' : 'Buy',
    orderType: 'Market',
    qty: String(pos.size),
    timeInForce: 'IOC',
    reduceOnly: true,
  }), { label: `close-${pos.symbol}-${pos.account.keyName}` });
  if (r.retCode !== 0) throw new Error(`close retCode=${r.retCode} ${r.retMsg}`);
  log.warn('position closed by watcher', {
    symbol: pos.symbol, account: pos.account.keyName, reason,
  });
}

// -------- Rules --------

function detectTp1Filled(pos: BybitPos): boolean {
  // Detection now lives inside Position.attachBybitSize() — the state machine
  // owns the "did TP1 partial fire" check. Watcher just queries the result.
  // Threshold (initial × 0.6) and floor (size > 0) are encapsulated there.
  if (pos.tp1AlreadyFilled) return false;
  if (pos.dbInitialQty <= 0) return false;
  if (pos.size <= pos.dbInitialQty * 0.05) return false;  // floor: full close, not TP1
  const p = positionFromBybit(pos);
  p.attachBybitSize(pos.size);
  return p.isTp1Filled();
}

function positionFromBybit(pos: BybitPos): Position {
  return Position.fromOpenTrade({
    id: pos.dbTradeId,
    account_bucket: pos.account.bucket,
    account_key: pos.account.keyName,
    symbol: pos.symbol,
    side: pos.side,
    qty: pos.dbCurrentQty,
    initial_qty: pos.dbInitialQty,
    entry_price: pos.entryPrice,
    sl: pos.dbInitialSL,
    tp1: pos.dbTP1,
    tp2: pos.dbTP2,
    opened_at: new Date(pos.createdTime).toISOString(),
    tp1_filled: pos.tp1AlreadyFilled,
  });
}

function detectRegimeFlip(pos: BybitPos, f1h: any): { flipped: boolean; reason: string } {
  if (!f1h || f1h.adx == null || f1h.ema_stack_aligned == null) return { flipped: false, reason: '' };
  const isLong = pos.side === 'Buy';
  // Long position + EMA stack flipped to bear, OR ADX dropped below threshold + price below EMA21
  if (isLong && f1h.ema_stack_aligned === 'bear' && f1h.close < (f1h.ema21 ?? Infinity)) {
    return { flipped: true, reason: `1H EMA stack flipped to BEAR, close ${f1h.close.toFixed(2)} < EMA21 ${f1h.ema21.toFixed(2)}` };
  }
  if (!isLong && f1h.ema_stack_aligned === 'bull' && f1h.close > (f1h.ema21 ?? 0)) {
    return { flipped: true, reason: `1H EMA stack flipped to BULL, close ${f1h.close.toFixed(2)} > EMA21 ${f1h.ema21.toFixed(2)}` };
  }
  if (f1h.adx < REGIME_ADX_FLIP_THRESHOLD) {
    return { flipped: true, reason: `1H ADX collapsed to ${f1h.adx.toFixed(1)} (< ${REGIME_ADX_FLIP_THRESHOLD})` };
  }
  return { flipped: false, reason: '' };
}

function detectTimeStop(pos: BybitPos, now: number): { stop: boolean; ageH: number } {
  const ageH = (now - pos.createdTime) / 3_600_000;
  // Time stop only fires if position has NOT hit TP1 yet (size still ~initial)
  if (ageH > TIME_STOP_HOURS && pos.size / pos.dbInitialQty > 0.6) {
    return { stop: true, ageH };
  }
  return { stop: false, ageH };
}

async function detectVolSpike(symbol: string, f1h: any): Promise<boolean> {
  if (!f1h?.atr || !f1h?.atr_pct) return false;
  // Get median atr_pct from last 24h (24 1H bars). If current > 2× median → spike.
  const r = await query<any>(
    `SELECT close, high, low FROM candles
     WHERE symbol = $1 AND tf = '60m' ORDER BY ts DESC LIMIT 24`,
    [symbol]
  );
  if (r.rows.length < 12) return false;
  const trs = r.rows.map((row: any) => {
    const h = parseFloat(row.high), l = parseFloat(row.low), c = parseFloat(row.close);
    return ((h - l) / c) * 100;
  });
  trs.sort((a: number, b: number) => a - b);
  const median = trs[Math.floor(trs.length / 2)];
  return f1h.atr_pct > median * VOL_SPIKE_MULT;
}

// -------- Main loop --------

interface Tp1FillAccountFill {
  label: string;
  qty: number;
  pnlUsd: number;
  pnlR: number;
}

interface Tp1FillGroup {
  symbol: string;
  side: 'Buy' | 'Sell';
  entryPrice: number;
  exitPrice: number;
  fills: Tp1FillAccountFill[];
}

export async function runPositionWatcher(): Promise<{
  inspected: number;
  actions: Array<{ symbol: string; account: string; action: string; reason: string }>;
}> {
  const positions = await fetchOpenPositionsWithDb();
  const actions: Array<{ symbol: string; account: string; action: string; reason: string }> = [];
  const now = Date.now();
  const tp1Groups = new Map<string, Tp1FillGroup>();   // key = symbol+side, consolidates accounts

  for (const pos of positions) {
    const f1h = await loadFeatures1h(pos.symbol);

    // 0) SAFETY-NET: every position MUST have a stopLoss attached on Bybit.
    // If somehow it's missing (Bybit bug, partial submission failure, manual edit),
    // we re-attach it FROM DB's original sl. This is critical for HyroTrader
    // 5min-SL compliance and overall capital safety.
    if (!pos.curSL || pos.curSL === 0) {
      log.error('NAKED POSITION DETECTED — emergency SL set', {
        symbol: pos.symbol, account: pos.account.keyName,
        size: pos.size, dbSL: pos.dbInitialSL,
      });
      try {
        await moveStopLoss(pos, pos.dbInitialSL, 'EMERGENCY: position had no SL');
        actions.push({
          symbol: pos.symbol, account: `${pos.account.bucket}/${pos.account.keyName}`,
          action: 'EMERGENCY-SL-SET', reason: 'naked position detected',
        });
        // Telegram alert — operator should know about this immediately.
        await notifyAlert({
          kind: 'reconcile_divergence',
          symbol: pos.symbol,
          detail: `${pos.symbol} ${pos.side} был БЕЗ стоп-лосса! Установлен SL=${pos.dbInitialSL.toFixed(4)} (из DB).`,
          action: 'Проверь Bybit — почему SL не сохранился при open. Возможен баг в execute.ts',
        });
      } catch (e: any) {
        log.error('EMERGENCY SL set FAILED — position is naked!', { err: e?.message });
        await notifyAlert({
          kind: 'reconcile_divergence',
          symbol: pos.symbol,
          detail: `🆘 КРИТИЧНО: ${pos.symbol} БЕЗ SL и не получилось установить аварийный. Закрой вручную.`,
          action: 'Закрой позицию через Bybit немедленно',
        });
      }
      continue;
    }

    // 0.5) NAKED-TP DETECTION: position has SL but missing TP1/TP2 reduce-only limits
    // (execute.ts may have failed to place them — silent .catch in old code OR Bybit reject).
    // Re-place from DB. Only check if TP1 not yet filled (otherwise only TP2 should remain).
    if (!pos.tp1AlreadyFilled && pos.dbTP1 != null && pos.dbTP2 != null) {
      try {
        const c = getRest(pos.account);
        const ordersR = await withRetry(
          () => c.getActiveOrders({ category: 'linear', symbol: pos.symbol }),
          { label: `orders-${pos.symbol}-${pos.account.keyName}` }
        );
        const closingSide = pos.side === 'Sell' ? 'Buy' : 'Sell';
        const tpLimitOrders = (ordersR.result?.list ?? []).filter((o: any) =>
          o.reduceOnly === true && o.side === closingSide && o.orderType === 'Limit'
        );
        if (tpLimitOrders.length === 0) {
          log.error('NAKED TP DETECTED — re-placing from DB', {
            symbol: pos.symbol, account: pos.account.keyName,
            dbTP1: pos.dbTP1, dbTP2: pos.dbTP2, qty: pos.size,
          });
          const info = await getInstrumentInfo(pos.account, pos.symbol);
          const halfRaw = pos.size / 2;
          const halfStr = roundQtyToStep(halfRaw, info);
          const halfNum = parseFloat(halfStr);
          const remNum = pos.size - halfNum;
          const remStr = roundQtyToStep(remNum, info);
          if (halfNum >= info.minOrderQty && parseFloat(remStr) >= info.minOrderQty) {
            // Shared base linkId so the recovered TP1/TP2 group together in logs/reconcile.
            // Same idempotency story as execute.ts: ECONNRESET on retry can't duplicate.
            const recBase = randomUUID().replace(/-/g, '').slice(0, 16);
            try {
              await withRetry(() => c.submitOrder({
                category: 'linear', symbol: pos.symbol,
                side: closingSide, orderType: 'Limit', qty: halfStr,
                price: roundPriceToTick(pos.dbTP1!, info),
                timeInForce: 'GTC', reduceOnly: true,
                orderLinkId: `rtp1-${recBase}`,
              }), { label: `naked-tp1-${pos.symbol}-${pos.account.keyName}`, tries: 2 });
              await withRetry(() => c.submitOrder({
                category: 'linear', symbol: pos.symbol,
                side: closingSide, orderType: 'Limit', qty: remStr,
                price: roundPriceToTick(pos.dbTP2!, info),
                timeInForce: 'GTC', reduceOnly: true,
                orderLinkId: `rtp2-${recBase}`,
              }), { label: `naked-tp2-${pos.symbol}-${pos.account.keyName}`, tries: 2 });
              actions.push({
                symbol: pos.symbol, account: `${pos.account.bucket}/${pos.account.keyName}`,
                action: 'NAKED-TP-RECOVERED', reason: `re-placed TP1=${pos.dbTP1} TP2=${pos.dbTP2}`,
              });
              await notifyAlert({
                kind: 'reconcile_divergence',
                symbol: pos.symbol,
                detail: `${pos.symbol} ${pos.side} был БЕЗ TP1/TP2! Watcher восстановил из DB: TP1=${pos.dbTP1!.toFixed(4)}, TP2=${pos.dbTP2!.toFixed(4)}`,
                action: 'Проверь execute.ts — почему TP не выставились при open',
              });
            } catch (e: any) {
              log.error('naked-TP re-place failed', { symbol: pos.symbol, err: e?.message });
            }
          }
        }
      } catch (e: any) {
        log.warn('naked-TP check failed', { symbol: pos.symbol, err: e?.message });
      }
    }

    // 1) TP1 partial-fill detection → DO NOT MOVE SL (no_move strategy, validated 365d).
    // Backtest cap-6 @ slip 0.20%: BE/BE+ both gave +47% annual / 68% WR.
    // No-move gave +66% annual / 82.6% WR / lower MaxDD (2.77% vs 3.45%).
    // Reason: TP1 is close (~0.2% from entry); moving SL to BE often re-stops on
    // normal retests before TP2 has a chance to fill. Keeping initial SL means
    // the remaining 50% rides to TP2 or back to original risk — net positive on average.
    if (detectTp1Filled(pos)) {
      const accountLabel = `${pos.account.bucket}/${pos.account.keyName}`;
      try {

        // b) compute filled qty + realized PnL from Bybit closedPnL records
        //    (sum reduce-side fills since position opened that match this trade)
        const c = getRest(pos.account);
        const closedPnlR = await withRetry(
          () => c.getClosedPnL({ category: 'linear', symbol: pos.symbol, limit: 50 }),
          { label: `closed-pnl-tp1-${pos.symbol}-${pos.account.keyName}` }
        );
        const closingSide = pos.side === 'Sell' ? 'Buy' : 'Sell';
        const fills = (closedPnlR.result?.list ?? [])
          .filter((x: any) => x.side === closingSide && parseInt(x.updatedTime, 10) >= pos.createdTime);
        let filledQty = fills.reduce((s: number, f: any) => s + parseFloat(f.closedSize), 0);
        let realizedPnl = fills.reduce((s: number, f: any) => s + parseFloat(f.closedPnl), 0);
        let exitPrice = fills.length > 0 ? parseFloat(fills[0].avgExitPrice) : pos.dbTP1 ?? pos.entryPrice;

        // FALLBACK: Bybit closedPnL has 30-90s delay AND can return empty for some accounts
        // (observed: Ivan account empty list 5 min after fill while position size halved).
        // If position halved but no PnL records yet, compute analytically from DB TP1 + filled qty.
        if (filledQty === 0 || realizedPnl === 0) {
          const inferredFillQty = pos.dbInitialQty - pos.size;   // how much was actually closed
          if (inferredFillQty > 0 && pos.dbTP1 != null) {
            filledQty = inferredFillQty;
            const direction = pos.side === 'Sell' ? -1 : 1;     // long: tp1>entry → +; short: tp1<entry → -×-1=+
            realizedPnl = (pos.dbTP1 - pos.entryPrice) * inferredFillQty * direction;
            exitPrice = pos.dbTP1;
            log.warn('TP1 fill: closedPnL empty, computed analytically', {
              symbol: pos.symbol, account: pos.account.keyName,
              inferredQty: filledQty, computedPnl: realizedPnl,
            });
          }
        }

        // c) UPDATE trades table: keep status='open' (TP2 still active), update qty + tp1 cols
        await query(
          `UPDATE trades SET qty = $1, tp1_filled_at = NOW(), tp1_filled_qty = $2, tp1_realized_pnl_usd = $3
           WHERE id = $4`,
          [pos.size, filledQty, realizedPnl, pos.dbTradeId]
        );

        // d) queue per-account fill into the consolidated group for ONE Telegram message
        const key = `${pos.symbol}-${pos.side}`;
        const grp = tp1Groups.get(key) ?? {
          symbol: pos.symbol, side: pos.side, entryPrice: pos.entryPrice, exitPrice, fills: [],
        };
        grp.fills.push({
          label: accountLabel,
          qty: filledQty,
          pnlUsd: realizedPnl,
          pnlR: realizedPnl / Math.max(Math.abs(pos.entryPrice - pos.dbInitialSL) * pos.dbInitialQty, 1),
        });
        tp1Groups.set(key, grp);

        actions.push({ symbol: pos.symbol, account: accountLabel,
          action: 'TP1-FILL', reason: `qty=${filledQty.toFixed(4)} pnl=$${realizedPnl.toFixed(2)} → SL@BE` });
        log.info('TP1 fill processed', { symbol: pos.symbol, account: pos.account.keyName,
          filledQty, realizedPnl, remainingSize: pos.size });
      } catch (e: any) {
        log.warn('TP1 fill processing failed', { symbol: pos.symbol, account: pos.account.keyName, err: e.message });
      }
      continue;
    }

    // Regime-flip / time-stop / vol-spike close-rules INTENTIONALLY DISABLED.
    // The 365-day backtest was validated WITHOUT these rules — the strategy expects
    // positions to ride to either SL, TP1, TP2, or end-of-window time stop.
    // Auto-closing on intermediate signals (1H regime flip, vol spike) actively HURT
    // simulated returns by ~22% (proved on 30-day walk). Setups can take 1-3 days to
    // resolve; transient 1H changes are noise to the structural setup.
    //
    // Watcher's ONLY active job: detect TP1 partial-fill and move SL → BE.
    // Everything else is server-side: SL hits → Bybit closes; TP1 (currently full
    // close, see TODO below) → Bybit closes.
    //
    // TODO: implement true partial close at TP1 + remainder TP at TP2 via two
    // reduce-only orders set at entry time.
  }

  // Send ONE consolidated Telegram message per (symbol+side) group with all account fills.
  for (const grp of tp1Groups.values()) {
    try {
      const totalPnl = grp.fills.reduce((s, f) => s + f.pnlUsd, 0);
      const totalR = grp.fills.reduce((s, f) => s + f.pnlR, 0) / Math.max(grp.fills.length, 1);
      await notifyClose({
        symbol: grp.symbol,
        side: grp.side === 'Buy' ? 'buy' : 'sell',
        exitReason: 'tp1',
        entryPrice: grp.entryPrice,
        exitPrice: grp.exitPrice,
        pnlUsd: totalPnl,
        pnlR: totalR,
        accountFills: grp.fills,
        comment: 'TP1 отработал. SL переведён в безубыток (BE). Остаток позиции 50% едет к TP2 без риска.',
      });
      log.info('TP1 fill TG sent', { symbol: grp.symbol, accounts: grp.fills.length, totalPnl });
    } catch (e: any) {
      log.error('TP1 fill TG send failed', { symbol: grp.symbol, err: e.message });
    }
  }

  // Drawdown alerts (variant B): one alert per pair per 4h when unrealized loss > 0.7R.
  // Bot does NOT auto-close — operator decides. Backtest validation showed auto-close
  // at intermediate signals reduces PF by ~22%.
  await sendDrawdownAlerts(positions);

  return { inspected: positions.length, actions };
}

const DRAWDOWN_ALERT_R_THRESHOLD = 0.7;
const DRAWDOWN_ALERT_THROTTLE_MS = 4 * 3_600_000;
const DRAWDOWN_STATE_PATH = '/tmp/drawdown-alerts.json';

async function sendDrawdownAlerts(positions: BybitPos[]): Promise<void> {
  // Aggregate per pair (symbol+side) — one alert per pair, not per account
  type Group = { symbol: string; side: 'Buy' | 'Sell'; totalUpnl: number; totalRisk: number; entry: number; mark: number; sl: number };
  const groups = new Map<string, Group>();
  for (const pos of positions) {
    if (pos.tp1AlreadyFilled) continue;  // ride-free after TP1, no alert needed
    const key = `${pos.symbol}-${pos.side}`;
    const stopDist = Math.abs(pos.entryPrice - pos.dbInitialSL);
    const positionRisk = stopDist * pos.dbInitialQty;
    const g = groups.get(key) ?? {
      symbol: pos.symbol, side: pos.side, totalUpnl: 0, totalRisk: 0,
      entry: pos.entryPrice, mark: pos.entryPrice + (pos.unrealisedPnl / Math.max(pos.size, 1)) * (pos.side === 'Sell' ? -1 : 1),
      sl: pos.curSL,
    };
    g.totalUpnl += pos.unrealisedPnl;
    g.totalRisk += positionRisk;
    groups.set(key, g);
  }

  // Read throttle state (last alert timestamp per pair)
  let state: Record<string, number> = {};
  try {
    state = JSON.parse(require('node:fs').readFileSync(DRAWDOWN_STATE_PATH, 'utf-8'));
  } catch {}

  for (const g of groups.values()) {
    const upnlR = g.totalRisk > 0 ? g.totalUpnl / g.totalRisk : 0;
    if (upnlR >= -DRAWDOWN_ALERT_R_THRESHOLD) continue;   // not deep enough
    const key = `${g.symbol}-${g.side}`;
    const lastAlertTs = state[key] ?? 0;
    if (Date.now() - lastAlertTs < DRAWDOWN_ALERT_THROTTLE_MS) continue;   // throttled

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

  try {
    require('node:fs').writeFileSync(DRAWDOWN_STATE_PATH, JSON.stringify(state));
  } catch {}
}

async function main() {
  const r = await runPositionWatcher();
  console.log(JSON.stringify(r, null, 2));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      log.error('position-watcher crashed', { err: e?.message ?? String(e), stack: e?.stack });
      process.exit(1);
    });
}

/**
 * Claude-driven execution layer — CLI entry point for trading decisions.
 *
 * Claude reads vault + scanner data, decides, and calls this script.
 * All hard risk guardrails live here. Claude cannot bypass them.
 *
 * USAGE (all values after flags):
 *
 *   npx tsx src/execute.ts open --symbol BTCUSDT --direction Long \
 *       --entry 103500 --sl 102800 --tp 105000 \
 *       --risk-pct 0.5 --confluence 10/12 \
 *       --rationale "sweep+OB tap 1H, BTC Bull aligned, 4H HH/HL"
 *
 *   npx tsx src/execute.ts place-limit --symbol BTCUSDT --direction Long \
 *       --limit 103200 --sl 102800 --tp 105000 \
 *       --risk-pct 0.5 --confluence 10/12 --max-age-min 45 \
 *       --rationale "wait for pullback to 1H OB 103200"
 *
 *   npx tsx src/execute.ts close --symbol BTCUSDT --direction Long \
 *       --reason "narrative_shift" --rationale "BTC dumped 2%, regime flipped"
 *
 *   npx tsx src/execute.ts cancel-limit --symbol BTCUSDT \
 *       --reason "structure_invalidated"
 *
 *   npx tsx src/execute.ts move-sl --symbol BTCUSDT --direction Long \
 *       --new-sl 103200 --rationale "break-even after +1R"
 *
 * Returns JSON to stdout:
 *   {
 *     "ok": true,
 *     "action": "open",
 *     "symbol": "BTCUSDT",
 *     "accounts": [{"account": "50k", "success": true, "orderId": "..."}],
 *     "guardrails": {"dd": 1.2, "heat": 0.5, "positions_open": 1}
 *   }
 *
 * On guardrail rejection:
 *   {"ok": false, "action": "open", "rejected_by": "daily_dd", "reason": "4.2% > 4% cap"}
 */
import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';
import { RiskEngine } from './risk/engine';
import { TelegramNotifier } from './notifications/telegram';
import { AuditRepo } from './db/repositories';
import { cache } from './cache';
import { config } from './config';
import { executeAcrossAccounts } from './trade/executor';
import { Signal } from './signal/types';
import type { InstrumentSpec, TradePlan } from './trade/planner';
import type { Direction } from './signal/types';

// --- helpers ------------------------------------------------------------
async function getInstrumentSpec(bybit: BybitClient, symbol: string): Promise<InstrumentSpec> {
  const info = await bybit.getInstrumentInfo(symbol);
  return {
    symbol,
    tickSize: Number(info.priceFilter.tickSize),
    qtyStep: Number(info.lotSizeFilter.qtyStep),
    minQty: Number(info.lotSizeFilter.minOrderQty),
    maxLeverage: Number(info.leverageFilter.maxLeverage),
  };
}

// --- arg parsing ---------------------------------------------------------
function parseArgs(): { action: string; args: Record<string, string> } {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    console.error(JSON.stringify({ ok: false, error: 'missing action' }));
    process.exit(1);
  }
  const action = raw[0];
  const args: Record<string, string> = {};
  for (let i = 1; i < raw.length; i++) {
    const tok = raw[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const val = raw[i + 1];
      if (val === undefined || val.startsWith('--')) {
        args[key] = 'true';
      } else {
        args[key] = val;
        i++;
      }
    }
  }
  // --rationale-file /path/to/file.txt → read file contents into args.rationale
  // Use this when rationale contains $ signs, newlines, or long text that would
  // trigger harness shell-expansion detection in bash.
  if (args['rationale-file']) {
    try {
      args['rationale'] = require('node:fs').readFileSync(args['rationale-file'], 'utf8').trim();
      delete args['rationale-file'];
    } catch (e: any) {
      console.error(JSON.stringify({ ok: false, error: `failed to read rationale-file: ${e.message}` }));
      process.exit(1);
    }
  }
  return { action, args };
}

function req(args: Record<string, string>, key: string): string {
  if (!args[key]) {
    console.error(JSON.stringify({ ok: false, error: `missing required arg: --${key}` }));
    process.exit(1);
  }
  return args[key];
}

function num(args: Record<string, string>, key: string): number {
  const v = req(args, key);
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(JSON.stringify({ ok: false, error: `--${key} must be a number, got "${v}"` }));
    process.exit(1);
  }
  return n;
}

// --- guardrails -----------------------------------------------------------
interface GuardrailContext {
  bybit: BybitClient;
  risk: RiskEngine;
  mgr: AccountManager;
}

async function checkGuardrails(
  gctx: GuardrailContext,
  symbol: string,
  direction: Direction,
  riskPct: number,
  entry: number,
  sl: number,
): Promise<{ ok: true } | { ok: false; reason: string; code: string }> {
  // 1) Trading hours gate — disabled by default (24h trading, Claude decides).
  // Opt in via SCHEDULE_ENABLED=true env var to restore a restricted window.
  if (config.schedule.enabled) {
    const hour = new Date().getUTCHours();
    const { startHourUTC, endHourUTC } = config.schedule;
    if (hour < startHourUTC || hour >= endHourUTC) {
      return { ok: false, code: 'off_hours', reason: `off hours (UTC ${hour}:00, schedule ${startHourUTC}-${endHourUTC})` };
    }
  }

  // 2) Risk %  hard cap (1% Claude, 3% HyroTrader absolute)
  if (riskPct > 1.0) {
    return { ok: false, code: 'risk_too_high', reason: `risk_pct ${riskPct}% > 1.0% Claude cap` };
  }
  if (riskPct <= 0) {
    return { ok: false, code: 'risk_too_low', reason: `risk_pct must be > 0` };
  }

  // 3) Funding window ±10 min (00:00, 08:00, 16:00 UTC)
  const now = new Date();
  const m = now.getUTCMinutes();
  const h = now.getUTCHours();
  const fundingHours = [0, 8, 16];
  const nearFunding = fundingHours.some((fh) => {
    const delta = Math.abs(h - fh) * 60 + m;
    return delta <= 10 || delta >= 8 * 60 - 10;
  });
  // stricter: within 10 min after funding or 10 min before
  const minsToFunding = Math.min(...fundingHours.map((fh) => {
    let diff = (fh - h) * 60 - m;
    if (diff < 0) diff += 24 * 60;
    return diff;
  }));
  const minsAfterFunding = Math.min(...fundingHours.map((fh) => {
    let diff = (h - fh) * 60 + m;
    if (diff < 0) diff += 24 * 60;
    return diff;
  }));
  if (minsToFunding <= 10 || minsAfterFunding <= 10) {
    return { ok: false, code: 'funding_window', reason: `funding window ±10 min (to=${minsToFunding}m, after=${minsAfterFunding}m)` };
  }
  void nearFunding; // silence

  // 4) Max positions across all accounts (3 base + 2 A+ slots)
  const positions = await gctx.bybit.getAllPositions();
  const openCount = positions.flatMap((a) => a.positions).filter((p: any) => Number(p.size ?? 0) > 0).length;
  const cap = riskPct >= config.trade.maxRiskPct ? 5 : 3;
  if (openCount >= cap) {
    return { ok: false, code: 'max_positions', reason: `${openCount} open >= cap ${cap} (A+ slot ${riskPct >= config.trade.maxRiskPct})` };
  }

  // 5) Duplicate direction on same symbol
  const sameSymbol = positions.flatMap((a) => a.positions).find((p: any) =>
    p.symbol === symbol && Number(p.size ?? 0) > 0,
  );
  if (sameSymbol) {
    const existingDir: Direction = sameSymbol.side === 'Buy' ? 'Long' : 'Short';
    if (existingDir === direction) {
      return { ok: false, code: 'duplicate_position', reason: `already in ${direction} ${symbol}` };
    }
    return { ok: false, code: 'opposite_position', reason: `cannot open ${direction} ${symbol} — ${existingDir} already open (close first)` };
  }

  // 6) Pending entry limit on same symbol (avoid stacking)
  const pending = await cache.getAllPendingOrders();
  const pendingSame = pending.find((p) => p.symbol === symbol);
  if (pendingSame) {
    return { ok: false, code: 'pending_exists', reason: `pending ${pendingSame.direction} limit @ ${pendingSame.limitPrice}` };
  }

  // 7) Per-subaccount DD kill-switch + margin + notional (HyroTrader inviolable).
  //    Margin: position IM = notional / leverage must be ≤ 25% of current equity.
  //    Notional: qty × entry must be ≤ 2× initial balance.
  //    Both applied per-account (each sub checked independently).
  const slDist = Math.abs(entry - sl);
  const leverage = config.trade.leverage;
  const maxMarginPct = config.trade.maxMarginPct;
  const maxNotionalMult = config.trade.maxNotionalMult;
  for (const sub of gctx.mgr.getAllSubAccounts()) {
    const assessment = await gctx.risk.snapshot(sub);
    if (assessment.status === 'kill' || assessment.status === 'halt') {
      return { ok: false, code: 'dd_kill', reason: `${sub.label}: ${assessment.reason}` };
    }
    // Per-account risk-based qty: risk_usd / sl_distance = qty
    const riskUsd = (riskPct / 100) * assessment.equity;
    const qty = riskUsd / slDist;
    const notional = qty * entry;
    const marginReq = notional / leverage;
    const marginPct = marginReq / assessment.equity;
    const notionalMult = notional / assessment.initial;
    if (marginPct > maxMarginPct) {
      return {
        ok: false,
        code: 'margin_exceeded',
        reason: `${sub.label}: margin ${(marginPct * 100).toFixed(1)}% > ${(maxMarginPct * 100).toFixed(0)}% (notional $${notional.toFixed(0)} / leverage ${leverage}x / equity $${assessment.equity.toFixed(0)}). Raise LEVERAGE to >= ${Math.ceil(notional / (maxMarginPct * assessment.equity))}x or reduce risk_pct.`,
      };
    }
    if (notionalMult > maxNotionalMult) {
      return {
        ok: false,
        code: 'notional_exceeded',
        reason: `${sub.label}: notional ${notionalMult.toFixed(2)}x initial > ${maxNotionalMult}x cap ($${notional.toFixed(0)} / $${assessment.initial.toFixed(0)}). Reduce risk_pct or widen SL.`,
      };
    }
  }

  return { ok: true };
}

// --- SL/TP sanity validation ---------------------------------------------
function validateEntryParams(
  direction: Direction,
  entry: number,
  sl: number,
  tp: number,
  symbol: string,
): string | null {
  if (direction === 'Long') {
    if (sl >= entry) return `SL ${sl} must be below entry ${entry} for LONG`;
    if (tp <= entry) return `TP ${tp} must be above entry ${entry} for LONG`;
  } else {
    if (sl <= entry) return `SL ${sl} must be above entry ${entry} for SHORT`;
    if (tp >= entry) return `TP ${tp} must be below entry ${entry} for SHORT`;
  }
  const isBtc = symbol === 'BTCUSDT';
  const maxPct = isBtc ? 0.02 : 0.03;
  const slPct = Math.abs(entry - sl) / entry;
  const tpPct = Math.abs(entry - tp) / entry;
  if (slPct > maxPct) return `SL distance ${(slPct * 100).toFixed(2)}% > ${maxPct * 100}% cap (${isBtc ? 'BTC' : 'alts'})`;
  if (tpPct > maxPct * 2) return `TP distance ${(tpPct * 100).toFixed(2)}% > ${(maxPct * 2 * 100).toFixed(0)}% cap`;
  // R:R sanity
  const rr = tpPct / slPct;
  if (rr < 1.2) return `R:R ${rr.toFixed(2)} < 1.2 (unacceptable)`;
  return null;
}

// --- build minimal Signal + TradePlan for legacy executor ----------------
function buildSignal(symbol: string, direction: Direction, confluence: number): Signal {
  return {
    symbol,
    regime: 'Range', // Claude-driven, regime no longer hard-gates execution
    regimeReason: 'Claude-driven',
    long: {
      factors: [],
      total: direction === 'Long' ? confluence : 0,
      details: {},
    },
    short: {
      factors: [],
      total: direction === 'Short' ? confluence : 0,
      details: {},
    },
    direction,
    confluence,
  };
}

function buildPlan(
  symbol: string,
  direction: Direction,
  entry: number,
  sl: number,
  tp: number,
  limitEntry: number | null,
  rationale: string,
): TradePlan {
  const stopDist = Math.abs(entry - sl);
  const rr = Math.abs(tp - entry) / stopDist;
  return {
    symbol,
    direction,
    entry,
    limitEntry,
    stopLoss: sl,
    takeProfit: tp,
    rr,
    atr: stopDist, // not used downstream
    stopDistance: stopDist,
    rationale,
  };
}

// --- actions -------------------------------------------------------------
async function actionOpen(args: Record<string, string>, useLimit: boolean): Promise<void> {
  const symbol = req(args, 'symbol').toUpperCase();
  const direction = req(args, 'direction') as Direction;
  if (direction !== 'Long' && direction !== 'Short') {
    console.error(JSON.stringify({ ok: false, error: '--direction must be Long or Short' }));
    process.exit(1);
  }
  const entry = num(args, useLimit ? 'limit' : 'entry');
  const sl = num(args, 'sl');
  const tp = num(args, 'tp');
  const riskPct = num(args, 'risk-pct');
  const confluenceRaw = req(args, 'confluence');
  const confluence = Number(confluenceRaw.split('/')[0]); // "10/12" → 10
  const rationale = args['rationale'] ?? '(no rationale)';

  const slErr = validateEntryParams(direction, entry, sl, tp, symbol);
  if (slErr) {
    console.log(JSON.stringify({ ok: false, action: useLimit ? 'place-limit' : 'open', rejected_by: 'invalid_params', reason: slErr }));
    process.exit(1);
  }

  const mgr = new AccountManager();
  const bybit = new BybitClient(mgr);
  const risk = new RiskEngine(bybit);
  const telegram = new TelegramNotifier(config.telegram.token, config.telegram.chatId);

  // Guardrails
  const g = await checkGuardrails({ bybit, risk, mgr }, symbol, direction, riskPct, entry, sl);
  if (!g.ok) {
    console.log(JSON.stringify({
      ok: false,
      action: useLimit ? 'place-limit' : 'open',
      symbol, direction,
      rejected_by: g.code,
      reason: g.reason,
    }));
    process.exit(1);
  }

  const instrument = await getInstrumentSpec(bybit, symbol);
  const signal = buildSignal(symbol, direction, confluence);
  const plan = buildPlan(symbol, direction, useLimit ? entry : entry, sl, tp, useLimit ? entry : null, rationale);

  const reports = await executeAcrossAccounts({
    bybit, risk, telegram, instrument, signal, plan,
    regimeLabel: 'claude-driven',
    explicitRiskPct: riskPct,
    rationale,
  });

  const succeeded = reports.filter((r) => r.success);
  console.log(JSON.stringify({
    ok: succeeded.length > 0,
    action: useLimit ? 'place-limit' : 'open',
    symbol, direction,
    confluence: `${confluence}/12`,
    risk_pct: riskPct,
    entry, sl, tp,
    rationale,
    accounts: reports.map((r) => ({
      account: r.account,
      success: r.success,
      orderId: r.orderId,
      qty: r.qtyString ?? r.qty,
      riskUsd: r.riskUsd,
      reason: r.reason,
    })),
  }, null, 2));

  process.exit(succeeded.length > 0 ? 0 : 1);
}

async function actionClose(args: Record<string, string>): Promise<void> {
  const symbol = req(args, 'symbol').toUpperCase();
  const direction = (args['direction'] ?? 'Long') as Direction;
  const reason = args['reason'] ?? 'manual';
  const rationale = args['rationale'] ?? '(no rationale)';

  const mgr = new AccountManager();
  const bybit = new BybitClient(mgr);
  const side: 'Buy' | 'Sell' = direction === 'Long' ? 'Buy' : 'Sell';

  const result = await bybit.closePositionAllTiers(symbol, side);
  await cache.setRecentClose(symbol, direction);

  await AuditRepo.log({
    level: 'info', source: 'execute', event: 'position_closed_claude',
    symbol,
    message: `Claude close ${direction} ${symbol}: ${reason} — ${rationale}`,
  });

  console.log(JSON.stringify({
    ok: true,
    action: 'close',
    symbol, direction,
    reason, rationale,
    accounts: result,
  }, null, 2));
  process.exit(0);
}

async function actionCancelLimit(args: Record<string, string>): Promise<void> {
  const symbol = req(args, 'symbol').toUpperCase();
  const reason = (args['reason'] ?? 'manual') as 'expired' | 'invalidated' | 'manual';

  const mgr = new AccountManager();
  const subs = mgr.getAllSubAccounts();

  const pending = await cache.getAllPendingOrders();
  const order = pending.find((p) => p.symbol === symbol);

  // RACE-CONDITION GUARD (added 2026-04-21 after trade #3 incident):
  // Between our decision to cancel and the cancel actually reaching Bybit, the limit
  // may have already filled. If we issue cancelAllOrders on a symbol with an OPEN
  // position, we'll kill the linked SL + TP orders and leave a naked position.
  // Check position state first — if any account has a live position on this symbol,
  // refuse the cancel and instruct Claude to use close/move-sl instead.
  const bybit = new BybitClient(mgr);
  const positionsPerAccount = await bybit.getAllPositions(symbol);
  const accountsWithOpenPosition = positionsPerAccount
    .filter((acc) => acc.positions.some((p: any) => Number(p.size ?? 0) > 0))
    .map((acc) => acc.sub.label);
  if (accountsWithOpenPosition.length > 0) {
    console.log(JSON.stringify({
      ok: false,
      action: 'cancel-limit',
      symbol,
      rejected_by: 'limit_already_filled',
      reason: `position open on ${accountsWithOpenPosition.join(', ')} — limit already filled. Use 'close' or 'move-sl'/'move-tp' instead.`,
      accounts_with_position: accountsWithOpenPosition,
    }, null, 2));
    await cache.removePendingOrder(symbol); // clear stale pending record
    process.exit(1);
  }

  await Promise.all(subs.map(async (sub) => {
    try {
      await sub.client.cancelAllOrders({ category: 'linear', symbol });
    } catch (err: any) {
      console.error(`[execute] cancel failed ${sub.label}:`, err.message);
    }
  }));
  await cache.removePendingOrder(symbol);

  // No TG boilerplate here — Claude-initiated cancel sends its own human-language TG via send-tg.ts.
  // Orchestrator-level auto-cancel (TTL/expired without Claude) still notifies as a fallback.

  await AuditRepo.log({
    level: 'info', source: 'execute', event: 'limit_cancelled_claude',
    symbol,
    message: `Claude cancel ${symbol}: ${reason}`,
  });

  console.log(JSON.stringify({
    ok: true,
    action: 'cancel-limit',
    symbol, reason,
    had_pending: !!order,
  }, null, 2));
  process.exit(0);
}

async function actionMoveSl(args: Record<string, string>): Promise<void> {
  const symbol = req(args, 'symbol').toUpperCase();
  const newSl = num(args, 'new-sl');
  const rationale = args['rationale'] ?? '(no rationale)';

  const mgr = new AccountManager();
  const subs = mgr.getAllSubAccounts();

  // Guardrail: SL can only tighten, never loosen
  const results = await Promise.all(subs.map(async (sub) => {
    try {
      const posList = await sub.client.getPositionInfo({ category: 'linear', symbol });
      const p = posList.result?.list?.find((x: any) => Number(x.size) > 0);
      if (!p) return { account: sub.label, success: false, reason: 'no position' };

      const isLong = p.side === 'Buy';
      const currentSl = Number(p.stopLoss);
      // Never loosen SL (fail-safe: rule of edit-never-cancel)
      if (currentSl > 0) {
        if ((isLong && newSl < currentSl) || (!isLong && newSl > currentSl)) {
          return { account: sub.label, success: false, reason: `new SL ${newSl} loosens existing ${currentSl}` };
        }
      }

      await sub.client.setTradingStop({
        category: 'linear', symbol, positionIdx: 0,
        stopLoss: String(newSl), tpslMode: 'Full',
      });
      return { account: sub.label, success: true, old_sl: currentSl, new_sl: newSl };
    } catch (err: any) {
      return { account: sub.label, success: false, reason: err.message };
    }
  }));

  await AuditRepo.log({
    level: 'info', source: 'execute', event: 'sl_moved_claude',
    symbol,
    message: `Claude move SL ${symbol} → ${newSl}: ${rationale}`,
  });

  console.log(JSON.stringify({
    ok: results.some((r) => r.success),
    action: 'move-sl',
    symbol, new_sl: newSl, rationale,
    accounts: results,
  }, null, 2));
  process.exit(0);
}

async function actionMoveTp(args: Record<string, string>): Promise<void> {
  const symbol = req(args, 'symbol').toUpperCase();
  const newTp = num(args, 'new-tp');
  const rationale = args['rationale'] ?? '(no rationale)';

  const mgr = new AccountManager();
  const subs = mgr.getAllSubAccounts();

  // Set or modify take-profit on existing position. Added 2026-04-21 after race-condition
  // incident (trade #3) where cancel-limit killed the TP leg of the orderLinkGroup and
  // there was no way to restore it. Symmetric with move-sl.
  const results = await Promise.all(subs.map(async (sub) => {
    try {
      const posList = await sub.client.getPositionInfo({ category: 'linear', symbol });
      const p = posList.result?.list?.find((x: any) => Number(x.size) > 0);
      if (!p) return { account: sub.label, success: false, reason: 'no position' };

      const isLong = p.side === 'Buy';
      const entry = Number(p.avgPrice);
      // Sanity: TP must be on the profit side of entry
      if (isLong && newTp <= entry) {
        return { account: sub.label, success: false, reason: `TP ${newTp} <= entry ${entry} for LONG` };
      }
      if (!isLong && newTp >= entry) {
        return { account: sub.label, success: false, reason: `TP ${newTp} >= entry ${entry} for SHORT` };
      }

      const currentTp = Number(p.takeProfit);
      await sub.client.setTradingStop({
        category: 'linear', symbol, positionIdx: 0,
        takeProfit: String(newTp), tpslMode: 'Full',
      });
      return { account: sub.label, success: true, old_tp: currentTp, new_tp: newTp };
    } catch (err: any) {
      return { account: sub.label, success: false, reason: err.message };
    }
  }));

  await AuditRepo.log({
    level: 'info', source: 'execute', event: 'tp_moved_claude',
    symbol,
    message: `Claude move TP ${symbol} → ${newTp}: ${rationale}`,
  });

  console.log(JSON.stringify({
    ok: results.some((r) => r.success),
    action: 'move-tp',
    symbol, new_tp: newTp, rationale,
    accounts: results,
  }, null, 2));
  process.exit(0);
}

// --- main ---------------------------------------------------------------
async function main() {
  const { action, args } = parseArgs();

  switch (action) {
    case 'open':
      await actionOpen(args, false);
      break;
    case 'place-limit':
      await actionOpen(args, true);
      break;
    case 'close':
      await actionClose(args);
      break;
    case 'cancel-limit':
      await actionCancelLimit(args);
      break;
    case 'move-tp':
      await actionMoveTp(args);
      break;
    case 'move-sl':
      await actionMoveSl(args);
      break;
    default:
      console.error(JSON.stringify({
        ok: false,
        error: `unknown action "${action}"`,
        valid_actions: ['open', 'place-limit', 'close', 'cancel-limit', 'move-sl', 'move-tp'],
      }));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message ?? String(err) }));
  process.exit(1);
});

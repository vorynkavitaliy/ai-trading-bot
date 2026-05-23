import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadAccounts, AccountKey } from '../core/accounts';
import { getRest, withRetry, getInstrumentInfo, roundQtyToStep, roundPriceToTick } from '../core/bybit';
import { query } from '../core/db';
import { notifyOpen } from '../core/tg-templates';
import { precheckEntry, RISK } from './risk-guard';
import { config } from '../core/config';
import { log } from '../core/logger';
import { insertPending, markPlaced, markFailed, linkTradeId } from '../core/pending-orders';

interface CliArgs {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  qty?: number;                            // explicit qty (base asset)
  riskPct?: number;                         // alternative to qty (size from equity × riskPct)
  entryPrice?: number;                      // for limit
  sl: number;
  tp1?: number;
  tp2?: number;
  rationale: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: any = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--symbol': args.symbol = next().toUpperCase(); break;
      case '--side': args.side = next().toLowerCase(); break;
      case '--order-type': args.orderType = next().toLowerCase(); break;
      case '--qty': args.qty = parseFloat(next()); break;
      case '--risk-pct': args.riskPct = parseFloat(next()); break;
      case '--entry-price': args.entryPrice = parseFloat(next()); break;
      case '--sl': args.sl = parseFloat(next()); break;
      case '--tp1': args.tp1 = parseFloat(next()); break;
      case '--tp2': args.tp2 = parseFloat(next()); break;
      case '--rationale': args.rationale = next(); break;
      case '--rationale-file': args.rationale = fs.readFileSync(next(), 'utf-8'); break;
      case '--dry-run': args.dryRun = true; break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.symbol || !args.side || !args.orderType || !args.sl) {
    throw new Error('required: --symbol --side --order-type --sl (and either --qty or --risk-pct)');
  }
  if (!args.qty && !args.riskPct) {
    throw new Error('one of --qty or --risk-pct required');
  }
  if (args.orderType === 'limit' && !args.entryPrice) {
    throw new Error('--entry-price required for limit orders');
  }
  if (!args.rationale) args.rationale = '(no rationale provided)';
  return args as CliArgs;
}

interface AccountResult {
  bucket: string;
  keyName: string;
  ok: boolean;
  bybitOrderId?: string;
  orderLinkId?: string;            // entry-order linkId — used by persistTrade to link pending_orders → trades.id
  qty?: number;
  fillPrice?: number;
  error?: string;
}

async function fetchEquity(account: AccountKey): Promise<number> {
  const c = getRest(account);
  const r = await withRetry(() => c.getWalletBalance({ accountType: 'UNIFIED' }), {
    label: `wallet-${account.bucket}/${account.keyName}`,
  });
  if (r.retCode !== 0) throw new Error(`wallet retCode=${r.retCode} ${r.retMsg}`);
  return parseFloat(r.result?.list?.[0]?.totalEquity ?? '0');
}

async function calcQtyFromRisk(account: AccountKey, args: CliArgs): Promise<number> {
  if (args.qty !== undefined) return args.qty;
  const equity = await fetchEquity(account);
  const riskUsd = equity * (args.riskPct! / 100);
  const refPrice = args.entryPrice ?? 0;
  if (refPrice <= 0) throw new Error('cannot compute qty: entry-price unknown for market order, supply --qty');
  const stopDist = Math.abs(refPrice - args.sl);
  if (stopDist <= 0) throw new Error('SL equals entry — cannot size');
  let qty = riskUsd / stopDist;
  // Cap by leverage: notional ≤ equity × leverage
  const maxNotional = equity * config.leverage;
  const maxQty = maxNotional / refPrice;
  if (qty > maxQty) qty = maxQty;
  return qty;
}

async function placeOnAccount(account: AccountKey, args: CliArgs): Promise<AccountResult> {
  const result: AccountResult = { bucket: account.bucket, keyName: account.keyName, ok: false };
  // Shared random base for orderLinkId so entry + TP1 + TP2 from one placeOnAccount
  // share a prefix and can be correlated in reconcile/logs. Bybit V5 rejects duplicate
  // orderLinkId per account, so withRetry's ECONNRESET/ETIMEDOUT retries cannot create
  // a duplicate position even if Bybit accepted the first attempt and the response was lost.
  const linkBase = randomUUID().replace(/-/g, '').slice(0, 16);
  const entryLinkId = `e-${linkBase}`;
  const tp1LinkId = `tp1-${linkBase}`;
  const tp2LinkId = `tp2-${linkBase}`;
  // pendingId tracks the pending_orders row for THIS account's entry order. The row
  // is INSERTed just before submitOrder and updated to 'placed'/'failed' afterward;
  // a crash anywhere in between leaves a 'pending' row that reconcile or operator
  // can use to detect orphan positions on Bybit. See migrations/006_pending_orders.sql.
  let pendingId: number | null = null;
  try {
    const c = getRest(account);
    // Fetch instrument metadata (qtyStep, tickSize, minOrderQty) — cached per process.
    const info = await getInstrumentInfo(account, args.symbol);

    // Set leverage first (silently — it might already be set)
    try {
      await withRetry(() => c.setLeverage({
        category: 'linear', symbol: args.symbol,
        buyLeverage: String(config.leverage),
        sellLeverage: String(config.leverage),
      }), { label: `setLeverage-${account.keyName}`, tries: 1 });
    } catch (e: any) {
      // leverage-not-modified errors are OK
      if (!/leverage not modified/i.test(e?.message ?? '')) {
        log.debug('setLeverage non-fatal', { account: account.keyName, err: e?.message });
      }
    }

    const rawQty = await calcQtyFromRisk(account, args);
    // Clamp to per-symbol order-type max — Bybit rejects market orders > maxMktOrderQty
    // (often ~3× lower than maxOrderQty for limits, e.g. BNB 370 vs 940).
    const orderMax = args.orderType === 'market' ? info.maxMktOrderQty : info.maxOrderQty;
    let clampedQty = rawQty;
    if (clampedQty > orderMax) {
      log.warn('qty clamped to exchange max', {
        symbol: args.symbol, account: account.keyName,
        raw: rawQty, max: orderMax, orderType: args.orderType,
      });
      clampedQty = orderMax;
    }
    const qtyStr = roundQtyToStep(clampedQty, info);
    const qtyNum = parseFloat(qtyStr);
    if (qtyNum <= 0) throw new Error(`computed qty rounds to 0 (raw=${rawQty}, step=${info.qtyStep})`);
    if (qtyNum < info.minOrderQty) {
      throw new Error(`qty ${qtyNum} below minOrderQty ${info.minOrderQty} for ${args.symbol} — risk too small or stop too wide`);
    }

    // Step 1: open position with SL only. takeProfit on Bybit's order create
    // closes 100% of position when hit — but strategy v3 wants partial 50% at TP1
    // + remaining 50% at TP2 + SL→BE move after TP1 fill. So we attach SL only,
    // then place two reduce-only limit orders for TP1 + TP2 separately.
    const orderParams: any = {
      category: 'linear',
      symbol: args.symbol,
      side: args.side === 'buy' ? 'Buy' : 'Sell',
      orderType: args.orderType === 'market' ? 'Market' : 'Limit',
      qty: qtyStr,
      timeInForce: args.orderType === 'market' ? 'IOC' : 'GTC',
      reduceOnly: false,
      stopLoss: roundPriceToTick(args.sl, info),
      slTriggerBy: 'LastPrice',
      orderLinkId: entryLinkId,
    };
    if (args.orderType === 'limit') {
      orderParams.price = roundPriceToTick(args.entryPrice!, info);
    }

    // ─── Pre-submit intent: write pending_orders BEFORE the Bybit network call ───
    // If anything between this insert and persistTrade crashes, the row survives
    // and reconcile / operator can detect the orphan via orderLinkId.
    pendingId = await insertPending({
      orderLinkId: entryLinkId,
      accountBucket: account.bucket,
      accountKey: account.keyName,
      symbol: args.symbol,
      side: orderParams.side,
      orderType: orderParams.orderType,
      qty: qtyNum,
      entryPrice: args.entryPrice ?? null,
      sl: args.sl,
      tp1: args.tp1 ?? null,
      tp2: args.tp2 ?? null,
      riskPct: args.riskPct ?? null,
      rationale: args.rationale,
    });

    const r = await withRetry(() => c.submitOrder(orderParams), {
      label: `order-${args.symbol}-${account.keyName}`,
    });
    if (r.retCode !== 0) throw new Error(`submitOrder retCode=${r.retCode} ${r.retMsg}`);

    // Bybit confirmed. Mark the intent satisfied; persistTrade will later link trade_id.
    await markPlaced(pendingId, r.result?.orderId);

    // Race-condition guard: Bybit confirms entry submission but the position itself
    // may not be credited yet (we observed retCode 110017 "current position is zero,
    // cannot fix reduce-only order qty"). Poll until position.size > 0 before TP submit.
    // Limit attempts so we don't hang forever on a non-filling Limit entry order.
    const expectedSide = args.side === 'buy' ? 'Buy' : 'Sell';
    let positionReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((res) => setTimeout(res, 500));
      try {
        const pr = await c.getPositionInfo({ category: 'linear', symbol: args.symbol });
        const pos = (pr.result?.list ?? []).find((p: any) => p.symbol === args.symbol && p.side === expectedSide);
        if (pos && parseFloat(pos.size) > 0) { positionReady = true; break; }
      } catch {}
    }
    if (!positionReady) {
      log.warn('position not credited after 5s — TP submit may fail', { symbol: args.symbol, account: account.keyName });
    }

    // Step 2: place TP1 + TP2 reduce-only limit orders (50% / 50% split).
    // For market orders: position is open instantly (IOC), so we can place them now.
    // For limit orders: they may not fill immediately, but reduce-only limits can
    // sit on the book — if the open never fills, the limits are harmless.
    const closeSide = args.side === 'buy' ? 'Sell' : 'Buy';
    const tp1 = args.tp1!;
    const tp2 = args.tp2!;
    // Single-target case (tp1 == tp2): some strategies (e.g. cg-fade) emit one
    // TP level. Two reduce-only limits at the same price create the redundancy
    // we observed live 2026-05-23 — one fills, the other becomes a naked-TP-ish
    // residual. Treat as single full-position TP via setTradingStop, identical
    // to "only tp1" path below.
    const tpEqual = args.tp1 != null && args.tp2 != null
      && Math.abs(args.tp1 - args.tp2) < (info.tickSize || 0.0001);
    if (args.tp1 != null && args.tp2 != null && !tpEqual) {
      // Split half/half. Round halfQty DOWN to step; remainder gets the slack.
      const halfRaw = qtyNum / 2;
      const halfStr = roundQtyToStep(halfRaw, info);
      const halfNum = parseFloat(halfStr);
      const remNum = qtyNum - halfNum;
      const remStr = roundQtyToStep(remNum, info);

      if (halfNum >= info.minOrderQty && parseFloat(remStr) >= info.minOrderQty) {
        // Two partial reduce-only limits. CRITICAL: any failure here = naked position
        // without TP — operator must know IMMEDIATELY. We surface failures as warnings
        // with clear identifying info so position-watcher / reconcile can detect.
        let tp1Ok = false, tp2Ok = false;
        try {
          const r1 = await withRetry(() => c.submitOrder({
            category: 'linear', symbol: args.symbol,
            side: closeSide, orderType: 'Limit', qty: halfStr,
            price: roundPriceToTick(tp1, info),
            timeInForce: 'GTC', reduceOnly: true,
            orderLinkId: tp1LinkId,
          }), { label: `tp1-${args.symbol}-${account.keyName}`, tries: 3 });
          if (r1.retCode === 0) { tp1Ok = true; }
          else { log.error('TP1 SUBMIT REJECTED', { symbol: args.symbol, account: account.keyName, retCode: r1.retCode, retMsg: r1.retMsg, qty: halfStr, price: tp1 }); }
        } catch (e: any) {
          log.error('TP1 SUBMIT THREW', { symbol: args.symbol, account: account.keyName, err: e?.message ?? String(e), qty: halfStr, price: tp1 });
        }
        try {
          const r2 = await withRetry(() => c.submitOrder({
            category: 'linear', symbol: args.symbol,
            side: closeSide, orderType: 'Limit', qty: remStr,
            price: roundPriceToTick(tp2, info),
            timeInForce: 'GTC', reduceOnly: true,
            orderLinkId: tp2LinkId,
          }), { label: `tp2-${args.symbol}-${account.keyName}`, tries: 3 });
          if (r2.retCode === 0) { tp2Ok = true; }
          else { log.error('TP2 SUBMIT REJECTED', { symbol: args.symbol, account: account.keyName, retCode: r2.retCode, retMsg: r2.retMsg, qty: remStr, price: tp2 }); }
        } catch (e: any) {
          log.error('TP2 SUBMIT THREW', { symbol: args.symbol, account: account.keyName, err: e?.message ?? String(e), qty: remStr, price: tp2 });
        }
        if (!tp1Ok || !tp2Ok) {
          // Naked position — open with server-side SL but at least one TP missing.
          // The pino log.error lines above already capture (symbol, account, retCode,
          // retMsg, qty, price) per leg; position-watcher.ts does the actual recovery
          // by checking Bybit /open-orders for missing reduce-only Limits and
          // re-placing from DB (see position-watcher.ts §0.5 NAKED-TP DETECTION).
          // We log one consolidated error so it's grep-able as a single event.
          log.error('NAKED TP — execute.ts placed entry but TP leg(s) missing; watcher will recover', {
            symbol: args.symbol, account: account.keyName, side: args.side,
            qty: qtyNum, tp1Failed: !tp1Ok, tp2Failed: !tp2Ok,
          });
        }
      } else {
        // Position too small to split (e.g. 1 contract). Set single full-size TP1.
        await withRetry(() => c.setTradingStop({
          category: 'linear', symbol: args.symbol,
          takeProfit: roundPriceToTick(tp1, info),
          tpTriggerBy: 'LastPrice', positionIdx: 0,
        }), { label: `setTp-${args.symbol}-${account.keyName}`, tries: 2 }).catch((e) => {
          log.warn('single-TP setTradingStop failed', { err: e?.message });
        });
      }
    } else if (args.tp1 != null) {
      // Only one TP given — set it as full-position TP via setTradingStop.
      await withRetry(() => c.setTradingStop({
        category: 'linear', symbol: args.symbol,
        takeProfit: roundPriceToTick(args.tp1!, info),
        tpTriggerBy: 'LastPrice', positionIdx: 0,
      }), { label: `setTp-${args.symbol}-${account.keyName}`, tries: 2 }).catch((e) => {
        log.warn('single-TP setTradingStop failed', { err: e?.message });
      });
    }

    result.ok = true;
    result.bybitOrderId = r.result?.orderId;
    result.orderLinkId = entryLinkId;
    result.qty = parseFloat(qtyStr);
    result.fillPrice = args.orderType === 'market' ? undefined : args.entryPrice;
    return result;
  } catch (e: any) {
    // Flip pending_orders to 'failed' so reconcile can investigate. If pendingId is
    // null we never reached the insert — meaning no Bybit call happened either, so
    // there's nothing to recover; just propagate the error to the caller.
    if (pendingId != null) {
      try { await markFailed(pendingId, e?.message ?? String(e)); } catch (mfe: any) {
        log.warn('markFailed pending_orders failed', { pendingId, err: mfe?.message });
      }
    }
    result.error = e?.message ?? String(e);
    return result;
  }
}

async function persistTrade(args: CliArgs, results: AccountResult[]): Promise<void> {
  const succ = results.filter(r => r.ok);
  if (succ.length === 0) return;
  const sumQty = succ.reduce((s, r) => s + (r.qty ?? 0), 0);
  const date = new Date().toISOString().slice(0, 10);
  const dir = args.side === 'buy' ? 'LONG' : 'SHORT';
  const tradeFile = path.join('vault/Trades', `${date}_${args.symbol}_${dir}.md`);
  fs.mkdirSync(path.dirname(tradeFile), { recursive: true });
  const fm = [
    '---',
    `symbol: ${args.symbol}`,
    `side: ${args.side}`,
    `order_type: ${args.orderType}`,
    `entry_price: ${args.entryPrice ?? ''}`,
    `sl: ${args.sl}`,
    `tp1: ${args.tp1 ?? ''}`,
    `tp2: ${args.tp2 ?? ''}`,
    `risk_pct: ${args.riskPct ?? ''}`,
    `total_qty: ${sumQty}`,
    `accounts: ${JSON.stringify(succ.map(r => `${r.bucket}/${r.keyName}=${r.qty}`))}`,
    `opened_at: ${new Date().toISOString()}`,
    `status: open`,
    '---',
    '',
    '## Rationale',
    '',
    args.rationale,
    '',
  ].join('\n');
  fs.writeFileSync(tradeFile, fm);

  // Persist per-account row in trades table, then link pending_orders.trade_id so the
  // intent row is fully resolved (status='placed' AND trade_id IS NOT NULL).
  for (const r of succ) {
    const ins = await query<{ id: string }>(
      `INSERT INTO trades (
        account_bucket, account_key, symbol, side, order_type, qty,
        entry_price, sl, tp1, tp2, status, rationale,
        bybit_order_id, vault_trade_file, opened_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
      RETURNING id`,
      [
        r.bucket, r.keyName, args.symbol, args.side === 'buy' ? 'Buy' : 'Sell',
        args.orderType === 'market' ? 'Market' : 'Limit', r.qty,
        args.entryPrice ?? null, args.sl, args.tp1 ?? null, args.tp2 ?? null,
        'open', args.rationale.slice(0, 4000),
        r.bybitOrderId ?? null, tradeFile,
      ]
    );
    if (r.orderLinkId) {
      const tradeId = parseInt(ins.rows[0].id, 10);
      try { await linkTradeId(r.orderLinkId, tradeId); } catch (e: any) {
        log.warn('linkTradeId failed (pending row stays un-linked; reconcile will see orphan)', {
          orderLinkId: r.orderLinkId, tradeId, err: e?.message,
        });
      }
    }
  }
  log.info('trade persisted', { tradeFile, accounts: succ.length });
}

async function notifyTelegram(args: CliArgs, results: AccountResult[]): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) return;
  const succ = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  // Don't send OPEN message if NO account succeeded — that's an error, not an entry.
  // Failed-only result is logged + exits non-zero, which is enough signal for ops.
  if (succ.length === 0) return;
  const qtyTotal = succ.reduce((s, r) => s + (r.qty ?? 0), 0);
  await notifyOpen({
    symbol: args.symbol,
    side: args.side,
    orderType: args.orderType,
    entryPrice: args.entryPrice,
    sl: args.sl,
    tp1: args.tp1,
    tp2: args.tp2,
    riskPct: args.riskPct,
    qtyTotal,
    accountSummaries: succ.map(r => `${r.bucket}/${r.keyName} — ${r.qty} ${args.symbol.replace(/USDT$/, '')}`),
    failedAccounts: fail.map(r => ({ label: `${r.bucket}/${r.keyName}`, error: r.error ?? 'unknown' })),
    rationale: args.rationale,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log.info('execute start', {
    symbol: args.symbol, side: args.side, orderType: args.orderType,
    riskPct: args.riskPct, qty: args.qty, entry: args.entryPrice, sl: args.sl,
  });

  // Pre-trade risk check
  const check = await precheckEntry(args.symbol, args.riskPct ?? RISK.riskPctBase);
  if (!check.allowed) {
    log.error('execute blocked by risk-guard', { reason: check.reason });
    console.error(`BLOCKED: ${check.reason}`);
    process.exit(2);
  }

  if (args.dryRun) {
    log.info('dry-run: would place order', { args, check });
    console.log(JSON.stringify({ dryRun: true, allowed: true }, null, 2));
    process.exit(0);
  }

  const accounts = loadAccounts();
  const results = await Promise.all(accounts.map(a => placeOnAccount(a, args)));

  await persistTrade(args, results);
  await notifyTelegram(args, results).catch(e => log.warn('telegram notify failed', { err: e?.message }));

  console.log(JSON.stringify({ ok: results.every(r => r.ok), results }, null, 2));
  if (!results.every(r => r.ok)) process.exit(3);
}

main().catch(e => {
  log.error('execute crashed', { err: e?.message ?? String(e), stack: e?.stack });
  process.exit(1);
});

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadAccounts, AccountKey } from '../core/accounts';
import { getRest, withRetry, getInstrumentInfo, roundPriceToTick } from '../core/bybit';
import { normalizeQty } from '../core/qty-normalizer';
import { query } from '../core/db';
import { notifyOpen, OpenTradeArgs } from '../core/tg-templates';
import { precheckEntry, RISK } from './risk-guard';
import { config } from '../core/config';
import { log } from '../core/logger';
import { insertPending, markPlaced, markFailed, linkTradeId, getLinkedTradeId } from '../core/pending-orders';
import { tpPlanner } from './tp-planner';
import { writeTradeJournal } from './trade-journal';

// S5 scaled-in entry config — when present, execute places 3 ATR-spaced limit
// orders with dca-boost qty allocation. Serialized as JSON via --scaled-in CLI arg.
interface ScaledInArgs {
  nEntries: number;
  spacingAtr: number;
  atr: number;
  tpAtrMult: number;
  sizingMode?: 'equal_r' | 'dca_boost' | 'custom_weights';
  dcaBoostDecay?: number;
  customWeights?: number[];
  tpRecomputeOnFill?: boolean;
}

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
  skipRiskCheck?: boolean;                  // operator-authorized manual override (bypass cooldowns/heat/kill)
  scaledIn?: ScaledInArgs;                  // S5 multi-entry config
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
      case '--skip-risk-check': args.skipRiskCheck = true; break;
      case '--scaled-in': args.scaledIn = JSON.parse(next()); break;
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
  // Limit slot 1 placed but not yet credited (actualFilledQty===0). ok stays true
  // (placement succeeded); callers branch on pendingOnly, not ok. The trades row is
  // deferred until promotion (pending-promoter.ts) sees Bybit credit the position.
  pendingOnly?: boolean;
  plannedQty?: number;
  plannedEntry?: number;
  // S5 scaled-in: per-slot ladder info for Telegram message display
  gridSlots?: Array<{ level: number; price: number; qty: number; filled: boolean }>;
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

    // ─── S5 scaled-in branch: place N ATR-spaced limit orders ───────────────────
    // dca_boost sizing: slot[0] = riskPct, slot[i] = riskPct × decay^i.
    // Slot 0 carries the position-level SL (stopLoss attached to its order).
    // Subsequent slots are plain limit orders (Bybit one-way mode aggregates them
    // into the same position). TP placed at signal+tpAtrMult·ATR with TOTAL qty.
    if (args.scaledIn) {
      return await placeScaledIn(account, args, info, c, entryLinkId, tp1LinkId, pendingId);
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
    const { qtyStr, qtyNum, valid } = normalizeQty(clampedQty, info);
    if (!valid) {
      throw new Error(`qty ${qtyNum} invalid for ${args.symbol} (step ${info.qtyStep}, min ${info.minOrderQty}, raw ${rawQty})`);
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

    // Step 2: TP placement delegated to TpPlanner. It picks between DualLimit
    // (tp1!=tp2 + splittable), SingleLimit (tp1==tp2 or tiny position), and
    // NativeTpFallback (when the SingleLimit submit is rejected). All naked-TP
    // logging happens inside the planner so this site stays small.
    await tpPlanner.place({
      client: c,
      symbol: args.symbol,
      account: account.keyName,
      closeSide: args.side === 'buy' ? 'Sell' : 'Buy',
      qtyStr,
      qtyNum,
      tp1: args.tp1 ?? null,
      tp2: args.tp2 ?? null,
      tp1LinkId,
      tp2LinkId,
      instrumentInfo: info,
    });

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

// S5 scaled-in: place N ATR-spaced limit orders + a single TP at signal+tpAtrMult·ATR.
// Returns an AccountResult representing the FIRST slot (the entry that anchors the
// trade record). Subsequent slot orderIds are not surfaced — reconcile/position-watcher
// will see them via Bybit position aggregation.
async function placeScaledIn(
  account: AccountKey,
  args: CliArgs,
  info: any,
  c: any,
  entryLinkId: string,
  tp1LinkId: string,
  pendingId: number | null
): Promise<AccountResult> {
  const result: AccountResult = { bucket: account.bucket, keyName: account.keyName, ok: false };
  const cfg = args.scaledIn!;
  if (cfg.nEntries < 1) throw new Error(`scaledIn.nEntries < 1`);
  if (!cfg.atr || cfg.atr <= 0) throw new Error(`scaledIn.atr missing or non-positive`);

  // Set leverage (silently)
  try {
    await withRetry(() => c.setLeverage({
      category: 'linear', symbol: args.symbol,
      buyLeverage: String(config.leverage),
      sellLeverage: String(config.leverage),
    }), { label: `setLeverage-${account.keyName}`, tries: 1 });
  } catch (e: any) {
    if (!/leverage not modified/i.test(e?.message ?? '')) {
      log.debug('setLeverage non-fatal', { account: account.keyName, err: e?.message });
    }
  }

  // Equity for sizing
  const equity = await fetchEquity(account);
  if (equity <= 0) throw new Error(`account equity=${equity}`);
  if (args.entryPrice == null) throw new Error(`scaled-in requires entryPrice`);

  // Per-slot risk percentages (3 modes — see engine.ts for canonical doc)
  const sizingMode = cfg.sizingMode ?? 'dca_boost';
  const decay = cfg.dcaBoostDecay ?? 0.5;
  const baseRiskPct = args.riskPct ?? 0.5;
  const slotRiskPcts: number[] = [];
  if (sizingMode === 'custom_weights') {
    const weights = cfg.customWeights ?? [];
    for (let i = 0; i < cfg.nEntries; i++) slotRiskPcts.push(baseRiskPct * (weights[i] ?? 0));
  } else if (sizingMode === 'equal_r') {
    for (let i = 0; i < cfg.nEntries; i++) slotRiskPcts.push(baseRiskPct / cfg.nEntries);
  } else {
    for (let i = 0; i < cfg.nEntries; i++) slotRiskPcts.push(baseRiskPct * Math.pow(decay, i));
  }

  // Direction: limits below entry for long, above for short
  const direction = args.side === 'buy' ? -1 : +1;
  const slPrice = args.sl;

  // Build slot prices + qty
  interface SlotPlan { level: number; priceStr: string; priceNum: number; qtyStr: string; qtyNum: number; orderLinkId: string; }
  const slots: SlotPlan[] = [];
  for (let i = 0; i < cfg.nEntries; i++) {
    const slotPrice = args.entryPrice + direction * i * cfg.spacingAtr * cfg.atr;
    // Skip levels that would be beyond SL (cannot fill before SL triggers in live either)
    const onCorrectSide = args.side === 'buy' ? slotPrice > slPrice : slotPrice < slPrice;
    if (!onCorrectSide) continue;
    const slotRiskUsd = equity * (slotRiskPcts[i] / 100);
    const slotDist = Math.abs(slotPrice - slPrice);
    if (slotDist <= 0) continue;
    let rawQty = slotRiskUsd / slotDist;
    // Leverage cap per slot
    const maxQtyByLev = (equity * config.leverage) / slotPrice;
    if (rawQty > maxQtyByLev) rawQty = maxQtyByLev;
    if (rawQty > info.maxOrderQty) rawQty = info.maxOrderQty;
    const { qtyStr, qtyNum, valid } = normalizeQty(rawQty, info);
    if (!valid) {
      log.warn('scaled-in slot qty invalid — skipping', { slot: i + 1, rawQty, sym: args.symbol });
      continue;
    }
    const priceStr = roundPriceToTick(slotPrice, info);
    slots.push({
      level: i + 1,
      priceStr, priceNum: parseFloat(priceStr),
      qtyStr, qtyNum,
      orderLinkId: i === 0 ? entryLinkId : `${entryLinkId}-s${i + 1}`,
    });
  }

  if (slots.length === 0) throw new Error('no valid scaled-in slots after sizing');

  log.info('scaled-in slots planned', {
    symbol: args.symbol, account: account.keyName, nSlots: slots.length,
    slots: slots.map(s => ({ level: s.level, price: s.priceStr, qty: s.qtyStr })),
  });

  // Persist pending intent for slot 1 (the anchor entry — DB row tracks the whole trade)
  if (pendingId == null) {
    pendingId = await insertPending({
      orderLinkId: entryLinkId,
      accountBucket: account.bucket,
      accountKey: account.keyName,
      symbol: args.symbol,
      side: args.side === 'buy' ? 'Buy' : 'Sell',
      orderType: 'Limit',
      qty: slots[0].qtyNum,
      entryPrice: slots[0].priceNum,
      sl: slPrice,
      tp1: args.tp1 ?? null,
      tp2: args.tp2 ?? null,
      riskPct: baseRiskPct,
      rationale: args.rationale,
    });
  }

  // TP price for the position-level take-profit attached to slot 1 (see below).
  const tpPriceAttached = args.entryPrice + (args.side === 'buy' ? +1 : -1) * cfg.tpAtrMult * cfg.atr;

  // Place all slots. Slot 1 (level=1) carries BOTH stopLoss AND takeProfit as
  // position-level conditionals — set atomically with the fill (no separate TP
  // placement, no naked-TP race). Slot 1 is MARKET in prod (auto-execute sends
  // 'market' for scaled-in) → immediate fill, matches backtest fill-at-signal.
  // Position-level TP/SL auto-cover the full position as DCA slots 2/3 fill
  // (Bybit one-way mode). Slots 2..N are plain Limit (the DCA ladder).
  let firstOrderResp: any = null;
  for (const slot of slots) {
    const isFirst = slot.level === 1;
    const useMarket = isFirst && args.orderType === 'market';
    const orderParams: any = {
      category: 'linear',
      symbol: args.symbol,
      side: args.side === 'buy' ? 'Buy' : 'Sell',
      orderType: useMarket ? 'Market' : 'Limit',
      qty: slot.qtyStr,
      timeInForce: useMarket ? 'IOC' : 'GTC',
      reduceOnly: false,
      orderLinkId: slot.orderLinkId,
    };
    if (!useMarket) orderParams.price = slot.priceStr;
    if (isFirst) {
      orderParams.stopLoss = roundPriceToTick(slPrice, info);
      orderParams.slTriggerBy = 'LastPrice';
      // TP attached to the entry order — position-level, market-on-trigger (same
      // mechanism as SL). Covers full position as DCA fills. Trade-off vs a
      // reduce-only limit TP: taker fee on exit, but eliminates the naked-TP race.
      orderParams.takeProfit = roundPriceToTick(tpPriceAttached, info);
      orderParams.tpTriggerBy = 'LastPrice';
    }
    const r: any = await withRetry(() => c.submitOrder(orderParams), {
      label: `scaledIn-slot${slot.level}-${args.symbol}-${account.keyName}`,
    });
    if (r.retCode !== 0) throw new Error(`scaledIn slot ${slot.level} retCode=${r.retCode} ${r.retMsg}`);
    if (isFirst) firstOrderResp = r;
  }

  // Mark pending placed (anchor order confirmed)
  if (pendingId != null && firstOrderResp) {
    await markPlaced(pendingId, firstOrderResp.result?.orderId);
  }

  // TP + SL are now attached to the slot-1 order above (position-level, atomic
  // with fill — no separate placement, no naked-TP race). We only READ the filled
  // qty here for accurate Telegram reporting + pendingOnly state. Market slot-1
  // fills immediately; a short poll covers any testnet credit lag. Even if the
  // read times out, TP/SL are already live on the order, so there's no risk.
  const expectedSide = args.side === 'buy' ? 'Buy' : 'Sell';
  let actualFilledQty = 0;
  for (let attempt = 0; attempt < 20; attempt++) {   // 10s — market IOC fills fast
    await new Promise((res) => setTimeout(res, 500));
    try {
      const pr: any = await c.getPositionInfo({ category: 'linear', symbol: args.symbol });
      const pos = (pr.result?.list ?? []).find((p: any) => p.symbol === args.symbol && p.side === expectedSide);
      if (pos && parseFloat(pos.size) > 0) {
        actualFilledQty = parseFloat(pos.size);
        break;
      }
    } catch {}
  }

  if (actualFilledQty === 0) {
    // Unexpected for a market slot-1 (should fill instantly). TP/SL are attached
    // to the order regardless, so no risk — promotion/reconcile reconciles state.
    log.warn('scaled-in: market slot-1 not credited after 10s (TP/SL attached to order, no risk)', {
      symbol: args.symbol, account: account.keyName,
    });
  }

  result.ok = true;
  result.bybitOrderId = firstOrderResp?.result?.orderId;
  result.orderLinkId = entryLinkId;

  const slot1Filled = actualFilledQty > 0;
  result.qty = actualFilledQty;
  result.fillPrice = slot1Filled ? slots[0].priceNum : undefined;
  result.pendingOnly = !slot1Filled;
  result.plannedQty = slots[0].qtyNum;
  result.plannedEntry = slots[0].priceNum;

  result.gridSlots = slots.map(s => ({
    level: s.level,
    price: s.priceNum,
    qty: s.qtyNum,
    filled: s.level === 1 && slot1Filled,
  }));
  return result;
}

async function persistTrade(args: CliArgs, results: AccountResult[]): Promise<void> {
  const filled = results.filter(r => r.ok && !r.pendingOnly && (r.qty ?? 0) > 0);
  if (filled.length === 0) return;
  const sumQty = filled.reduce((s, r) => s + (r.qty ?? 0), 0);
  const tradeFile = writeTradeJournal({
    symbol: args.symbol,
    side: args.side,
    orderType: args.orderType,
    entryPrice: args.entryPrice ?? null,
    sl: args.sl,
    tp1: args.tp1 ?? null,
    tp2: args.tp2 ?? null,
    riskPct: args.riskPct ?? null,
    totalQty: sumQty,
    accounts: filled.map(r => `${r.bucket}/${r.keyName}=${r.qty}`),
    rationale: args.rationale,
  });

  // Persist per-account row in trades table. Idempotent-with-promoter:
  // if the WS daemon (account-monitor) already saw a position-credit event and
  // promoted the pending_orders intent into a trades row, we DO NOT insert a
  // second row — that was the 2026-05-28 stack-and-sum bug (ARB/BNB/SOL had
  // twin trade rows for the same Bybit position because both code paths fired).
  // Instead we update the existing row's qty to the latest filled size we
  // observed locally; the promoter's initial qty is also from the position-info
  // poll, so any small drift just gets resyncd on the next position event.
  for (const r of filled) {
    let existingTradeId: number | null = null;
    if (r.orderLinkId) {
      try { existingTradeId = await getLinkedTradeId(r.orderLinkId); } catch (e: any) {
        log.warn('getLinkedTradeId failed — proceeding with INSERT', {
          orderLinkId: r.orderLinkId, err: e?.message,
        });
      }
    }

    if (existingTradeId != null) {
      // Promoter won the race. Refresh qty (best-effort) and skip the duplicate INSERT.
      try {
        await query(
          `UPDATE trades SET qty = $1, initial_qty = GREATEST(initial_qty, $1)
             WHERE id = $2 AND status = 'open'`,
          [r.qty, existingTradeId]
        );
      } catch (e: any) {
        log.warn('refresh promoted trade qty failed (non-fatal)', {
          tradeId: existingTradeId, err: e?.message,
        });
      }
      log.info('trade already promoted by daemon — skipped duplicate INSERT', {
        symbol: args.symbol, account: `${r.bucket}/${r.keyName}`,
        tradeId: existingTradeId, qty: r.qty,
      });
      continue;
    }

    const ins = await query<{ id: string }>(
      `INSERT INTO trades (
        account_bucket, account_key, symbol, side, order_type, qty, initial_qty,
        entry_price, sl, tp1, tp2, status, rationale,
        bybit_order_id, vault_trade_file, opened_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
      RETURNING id`,
      [
        r.bucket, r.keyName, args.symbol, args.side === 'buy' ? 'Buy' : 'Sell',
        args.orderType === 'market' ? 'Market' : 'Limit', r.qty, r.qty,
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
  log.info('trade persisted', { tradeFile, accounts: filled.length });
}

async function notifyTelegram(args: CliArgs, results: AccountResult[]): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) return;
  const succ = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  if (succ.length === 0) return;

  const allPending = succ.every(r => r.pendingOnly);
  const status: 'filled' | 'pending' = allPending ? 'pending' : 'filled';
  const qtyForResult = (r: AccountResult): number =>
    allPending ? (r.plannedQty ?? 0) : (r.qty ?? 0);
  const qtyTotal = succ.reduce((s, r) => s + qtyForResult(r), 0);
  // Aggregate grid slots across accounts: sum qty per slot level so message
  // shows total ladder qty (not per-account, which would be cluttered).
  let gridSlots: OpenTradeArgs['gridSlots'] | undefined;
  const firstWithSlots = succ.find(r => r.gridSlots && r.gridSlots.length > 0);
  if (firstWithSlots && firstWithSlots.gridSlots) {
    const sumByLevel = new Map<number, { price: number; qty: number; filled: boolean }>();
    for (const r of succ) {
      for (const s of r.gridSlots ?? []) {
        const prev = sumByLevel.get(s.level);
        if (prev) {
          sumByLevel.set(s.level, { price: s.price, qty: prev.qty + s.qty, filled: prev.filled && s.filled });
        } else {
          sumByLevel.set(s.level, { price: s.price, qty: s.qty, filled: s.filled });
        }
      }
    }
    gridSlots = Array.from(sumByLevel.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, v]) => ({ level, price: v.price, qtyTotal: v.qty, filled: v.filled }));
  }
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
    status,
    accountSummaries: succ.map(r => `${r.bucket}/${r.keyName} — ${qtyForResult(r)} ${args.symbol.replace(/USDT$/, '')}`),
    failedAccounts: fail.map(r => ({ label: `${r.bucket}/${r.keyName}`, error: r.error ?? 'unknown' })),
    rationale: args.rationale,
    gridSlots,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log.info('execute start', {
    symbol: args.symbol, side: args.side, orderType: args.orderType,
    riskPct: args.riskPct, qty: args.qty, entry: args.entryPrice, sl: args.sl,
  });

  // Pre-trade risk check. --skip-risk-check is an explicit operator-authorized
  // override (e.g. testing manual entry during a pair cooldown). Logs prominently
  // so the audit trail makes the bypass intent obvious.
  if (args.skipRiskCheck) {
    log.warn('⚠ MANUAL OVERRIDE — risk-guard bypassed by --skip-risk-check', {
      symbol: args.symbol, side: args.side, riskPct: args.riskPct,
    });
    console.warn(`⚠ Risk-guard bypassed (--skip-risk-check). Operator-authorized.`);
  } else {
    const check = await precheckEntry(args.symbol, args.riskPct ?? RISK.riskPctBase);
    if (!check.allowed) {
      log.error('execute blocked by risk-guard', { reason: check.reason });
      console.error(`BLOCKED: ${check.reason}`);
      process.exit(2);
    }
  }

  if (args.dryRun) {
    log.info('dry-run: would place order', { args });
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

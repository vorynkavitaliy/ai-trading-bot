import fs from 'node:fs';
import path from 'node:path';
import { loadAccounts, AccountKey } from './lib/accounts';
import { getRest, withRetry, getInstrumentInfo, roundQtyToStep, roundPriceToTick } from './lib/bybit';
import { query } from './lib/db';
import { notifyOpen } from './lib/tg-templates';
import { precheckEntry, RISK } from './risk-guard';
import { config } from './lib/config';
import { log } from './lib/logger';

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
    };
    if (args.orderType === 'limit') {
      orderParams.price = roundPriceToTick(args.entryPrice!, info);
    }
    if (args.tp1) {
      orderParams.takeProfit = roundPriceToTick(args.tp1, info);
      orderParams.tpTriggerBy = 'LastPrice';
    }

    const r = await withRetry(() => c.submitOrder(orderParams), {
      label: `order-${args.symbol}-${account.keyName}`,
    });
    if (r.retCode !== 0) throw new Error(`submitOrder retCode=${r.retCode} ${r.retMsg}`);

    result.ok = true;
    result.bybitOrderId = r.result?.orderId;
    result.qty = parseFloat(qtyStr);
    result.fillPrice = args.orderType === 'market' ? undefined : args.entryPrice;
    return result;
  } catch (e: any) {
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

  // Persist per-account row in trades table
  for (const r of succ) {
    await query(
      `INSERT INTO trades (
        account_bucket, account_key, symbol, side, order_type, qty,
        entry_price, sl, tp1, tp2, status, rationale,
        bybit_order_id, vault_trade_file, opened_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())`,
      [
        r.bucket, r.keyName, args.symbol, args.side === 'buy' ? 'Buy' : 'Sell',
        args.orderType === 'market' ? 'Market' : 'Limit', r.qty,
        args.entryPrice ?? null, args.sl, args.tp1 ?? null, args.tp2 ?? null,
        'open', args.rationale.slice(0, 4000),
        r.bybitOrderId ?? null, tradeFile,
      ]
    );
  }
  log.info('trade persisted', { tradeFile, accounts: succ.length });
}

async function notifyTelegram(args: CliArgs, results: AccountResult[]): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) return;
  const succ = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
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

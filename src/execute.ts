import fs from 'node:fs';
import path from 'node:path';
import { loadAccounts, AccountKey } from './lib/accounts';
import { getRest, withRetry } from './lib/bybit';
import { query } from './lib/db';
import { send } from './lib/telegram';
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

function roundQty(symbol: string, qty: number): string {
  // BTCUSDT 0.001 step, ETHUSDT 0.01 step (Bybit defaults). Round down.
  const step = symbol === 'BTCUSDT' ? 0.001 : symbol === 'ETHUSDT' ? 0.01 : 0.001;
  const rounded = Math.floor(qty / step) * step;
  return rounded.toFixed(symbol === 'BTCUSDT' ? 3 : 2);
}

function roundPrice(symbol: string, price: number): string {
  // BTCUSDT tick 0.1, ETHUSDT tick 0.01
  const tick = symbol === 'BTCUSDT' ? 0.1 : symbol === 'ETHUSDT' ? 0.01 : 0.1;
  const rounded = Math.round(price / tick) * tick;
  return rounded.toFixed(symbol === 'BTCUSDT' ? 1 : 2);
}

async function placeOnAccount(account: AccountKey, args: CliArgs): Promise<AccountResult> {
  const result: AccountResult = { bucket: account.bucket, keyName: account.keyName, ok: false };
  try {
    const c = getRest(account);
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

    const qty = await calcQtyFromRisk(account, args);
    const qtyStr = roundQty(args.symbol, qty);
    if (parseFloat(qtyStr) <= 0) throw new Error(`computed qty rounds to 0 (${qty})`);

    const orderParams: any = {
      category: 'linear',
      symbol: args.symbol,
      side: args.side === 'buy' ? 'Buy' : 'Sell',
      orderType: args.orderType === 'market' ? 'Market' : 'Limit',
      qty: qtyStr,
      timeInForce: args.orderType === 'market' ? 'IOC' : 'GTC',
      reduceOnly: false,
      stopLoss: roundPrice(args.symbol, args.sl),         // server-side SL within 5 min
      slTriggerBy: 'LastPrice',
    };
    if (args.orderType === 'limit') {
      orderParams.price = roundPrice(args.symbol, args.entryPrice!);
    }
    if (args.tp1) {
      orderParams.takeProfit = roundPrice(args.symbol, args.tp1);
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
  const dir = args.side === 'buy' ? 'LONG' : 'SHORT';
  const lines = [
    `📈 ВХОД ${args.symbol} ${dir}`,
    '',
    `Цена входа: ${args.entryPrice?.toFixed(2) ?? 'market'}`,
    `Стоп-лосс: ${args.sl.toFixed(2)}` + (args.riskPct ? ` (риск ${args.riskPct}%)` : ''),
    args.tp1 ? `Тейк-1: ${args.tp1.toFixed(2)}` : '',
    args.tp2 ? `Тейк-2: ${args.tp2.toFixed(2)}` : '',
    '',
    `Аккаунты: ${succ.length}/${results.length} успешно`,
    ...succ.map(r => `  ${r.bucket}/${r.keyName} qty=${r.qty}`),
    ...(fail.length > 0 ? ['', 'Ошибки:'] : []),
    ...fail.map(r => `  ${r.bucket}/${r.keyName}: ${r.error}`),
    '',
    'Обоснование:',
    args.rationale.length > 1500 ? args.rationale.slice(0, 1500) + '…' : args.rationale,
  ].filter(Boolean).join('\n');
  await send(lines);
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

import { loadAccounts, AccountKey } from './lib/accounts';
import { getRest, withRetry } from './lib/bybit';
import { query } from './lib/db';
import { notifyClose } from './lib/tg-templates';
import { log } from './lib/logger';

type Divergence =
  | { type: 'bybit_without_db'; account: string; symbol: string; size: number }
  | { type: 'db_without_bybit'; account: string; symbol: string; trade_id: number; qty: number }
  | { type: 'size_mismatch'; account: string; symbol: string; trade_id: number; db_qty: number; bybit_size: number };

interface ReconcileResult {
  aligned: boolean;
  ts: string;
  bybitPositionsCount: number;
  dbOpenTradesCount: number;
  divergences: Divergence[];
}

interface BybitPos {
  account: string;
  symbol: string;
  side: string;
  size: number;
  entry: number;
}

async function fetchAccountPositions(a: AccountKey): Promise<BybitPos[]> {
  const c = getRest(a);
  const r = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), {
    label: `positions-${a.bucket}/${a.keyName}`,
  });
  if (r.retCode !== 0) throw new Error(`positions retCode=${r.retCode} ${r.retMsg}`);
  const list = r.result?.list ?? [];
  return list
    .filter((p: any) => parseFloat(p.size) > 0)
    .map((p: any) => ({
      account: `${a.bucket}/${a.keyName}`,
      symbol: p.symbol,
      side: p.side,
      size: parseFloat(p.size),
      entry: parseFloat(p.avgPrice ?? '0'),
    }));
}

interface DbOpenTrade {
  id: number;
  account_key: string;
  account_bucket: string;
  symbol: string;
  side: string;
  qty: number;
  entry_price: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  opened_at: string;
}

async function fetchDbOpenTrades(): Promise<DbOpenTrade[]> {
  const r = await query<any>(
    `SELECT id, account_bucket, account_key, symbol, side, qty::text,
            entry_price::text, sl::text, tp1::text, tp2::text,
            opened_at::text
     FROM trades WHERE status = 'open'`
  );
  return r.rows.map((row) => ({
    id: row.id,
    account_bucket: row.account_bucket,
    account_key: row.account_key,
    symbol: row.symbol,
    side: row.side,
    qty: parseFloat(row.qty),
    entry_price: row.entry_price ? parseFloat(row.entry_price) : null,
    sl: row.sl ? parseFloat(row.sl) : null,
    tp1: row.tp1 ? parseFloat(row.tp1) : null,
    tp2: row.tp2 ? parseFloat(row.tp2) : null,
    opened_at: row.opened_at,
  }));
}

interface ClosedFill {
  symbol: string;
  side: string;
  closedSize: number;
  avgEntryPrice: number;
  avgExitPrice: number;
  closedPnl: number;
  closedTime: number;
}

async function fetchRecentClosedPnL(a: AccountKey, symbol: string): Promise<ClosedFill[]> {
  const c = getRest(a);
  const r = await withRetry(() => c.getClosedPnL({
    category: 'linear', symbol, limit: 20,
  }), { label: `closed-pnl-${a.bucket}/${a.keyName}` });
  if (r.retCode !== 0) {
    log.warn('getClosedPnL failed', { account: a.keyName, symbol, retCode: r.retCode, msg: r.retMsg });
    return [];
  }
  return (r.result?.list ?? []).map((p: any) => ({
    symbol: p.symbol,
    side: p.side,
    closedSize: parseFloat(p.closedSize ?? p.qty ?? '0'),
    avgEntryPrice: parseFloat(p.avgEntryPrice ?? '0'),
    avgExitPrice: parseFloat(p.avgExitPrice ?? '0'),
    closedPnl: parseFloat(p.closedPnl ?? '0'),
    closedTime: parseInt(p.updatedTime ?? p.createdTime ?? '0', 10),
  }));
}

function inferExitReason(t: DbOpenTrade, exitPrice: number): 'sl' | 'tp1' | 'tp2' | 'manual' {
  // Exit price closest to which level?
  const isLong = t.side.toLowerCase() === 'buy' || t.side.toLowerCase() === 'long';
  const candidates: Array<{ name: 'sl' | 'tp1' | 'tp2'; price: number }> = [];
  if (t.sl != null) candidates.push({ name: 'sl', price: t.sl });
  if (t.tp1 != null) candidates.push({ name: 'tp1', price: t.tp1 });
  if (t.tp2 != null) candidates.push({ name: 'tp2', price: t.tp2 });
  if (candidates.length === 0) return 'manual';
  // For each level, distance in fractional terms; pick min if within 1% of exit
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(exitPrice - c.price) / Math.max(c.price, 1);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  if (bestDist > 0.01) return 'manual';   // > 1% away from any level → manual exit
  // Sanity: SL must be on the loss side of entry; TP on profit side
  if (best.name === 'sl') {
    if (isLong && exitPrice >= (t.entry_price ?? 0)) return 'manual';
    if (!isLong && exitPrice <= (t.entry_price ?? Infinity)) return 'manual';
  }
  return best.name;
}

async function autoCloseTrade(t: DbOpenTrade, fills: ClosedFill[]): Promise<boolean> {
  // Match by symbol+side (most recent within 24h)
  const sideUpper = t.side.toLowerCase() === 'buy' ? 'Buy' : 'Sell';
  // Bybit closedPnl reports the side that OPENED the position; ours matches DB side.
  const candidates = fills
    .filter((f) => f.symbol === t.symbol && f.side === sideUpper)
    .filter((f) => Math.abs(f.closedSize - t.qty) / Math.max(t.qty, 1) < 0.05)
    .sort((a, b) => b.closedTime - a.closedTime);
  if (candidates.length === 0) return false;
  const fill = candidates[0];

  const exitReason = inferExitReason(t, fill.avgExitPrice);
  // R-multiple: pnlUsd / riskedUsd
  const stopDist = t.sl != null && t.entry_price != null ? Math.abs(t.entry_price - t.sl) : 0;
  const riskedUsd = stopDist * t.qty;
  const pnlR = riskedUsd > 0 ? fill.closedPnl / riskedUsd : 0;

  await query(
    `UPDATE trades SET status = 'closed',
       exit_price = $1, closed_at = to_timestamp($2 / 1000.0),
       realized_r = $3, pnl_usd = $4, exit_reason = $5
     WHERE id = $6`,
    [fill.avgExitPrice, fill.closedTime, pnlR, fill.closedPnl, exitReason, t.id]
  );

  log.info('auto-closed trade', {
    id: t.id, symbol: t.symbol, account: `${t.account_bucket}/${t.account_key}`,
    exitPrice: fill.avgExitPrice, exitReason, pnlUsd: fill.closedPnl, pnlR: pnlR.toFixed(2),
  });

  // Telegram exit notification
  try {
    await notifyClose({
      symbol: t.symbol,
      side: t.side.toLowerCase() === 'buy' ? 'buy' : 'sell',
      exitReason,
      entryPrice: t.entry_price ?? fill.avgEntryPrice,
      exitPrice: fill.avgExitPrice,
      pnlUsd: fill.closedPnl,
      pnlR,
      comment: `${t.account_bucket}/${t.account_key}`,
    });
  } catch (e: any) {
    log.warn('exit telegram failed', { err: e?.message ?? String(e) });
  }
  return true;
}

export async function runReconcile(): Promise<ReconcileResult> {
  const accounts = loadAccounts();
  const [allBybit, dbOpen] = await Promise.all([
    Promise.all(accounts.map(a => fetchAccountPositions(a))).then(arr => arr.flat()),
    fetchDbOpenTrades(),
  ]);

  const divergences: Divergence[] = [];

  // Build account lookup
  for (const pos of allBybit) {
    const match = dbOpen.find(t =>
      `${t.account_bucket}/${t.account_key}` === pos.account &&
      t.symbol === pos.symbol &&
      t.side.toLowerCase() === pos.side.toLowerCase()
    );
    if (!match) {
      divergences.push({ type: 'bybit_without_db', account: pos.account, symbol: pos.symbol, size: pos.size });
    } else {
      const diff = Math.abs(match.qty - pos.size);
      const tolerance = match.qty * 0.01;
      if (diff > tolerance) {
        divergences.push({
          type: 'size_mismatch', account: pos.account, symbol: pos.symbol,
          trade_id: match.id, db_qty: match.qty, bybit_size: pos.size,
        });
      }
    }
  }
  // For DB-open trades without Bybit pos: position closed externally (SL/TP/manual).
  // Auto-resolve: fetch closed PnL from Bybit, update DB row, notify Telegram.
  const accountByLabel = new Map(accounts.map((a) => [`${a.bucket}/${a.keyName}`, a]));
  const closedFillsCache = new Map<string, ClosedFill[]>();   // key = `${label}|${symbol}`

  for (const t of dbOpen) {
    const label = `${t.account_bucket}/${t.account_key}`;
    const has = allBybit.find(p =>
      label === p.account &&
      t.symbol === p.symbol &&
      t.side.toLowerCase() === p.side.toLowerCase()
    );
    if (has) continue;

    // Try to auto-close from Bybit closed-PnL history
    const acc = accountByLabel.get(label);
    if (acc) {
      const cacheKey = `${label}|${t.symbol}`;
      let fills = closedFillsCache.get(cacheKey);
      if (!fills) {
        fills = await fetchRecentClosedPnL(acc, t.symbol);
        closedFillsCache.set(cacheKey, fills);
      }
      const closed = await autoCloseTrade(t, fills);
      if (closed) continue;   // resolved — no divergence
    }

    // Could not auto-resolve — surface as divergence for trader to inspect
    divergences.push({
      type: 'db_without_bybit',
      account: label,
      symbol: t.symbol, trade_id: t.id, qty: t.qty,
    });
  }

  return {
    aligned: divergences.length === 0,
    ts: new Date().toISOString(),
    bybitPositionsCount: allBybit.length,
    dbOpenTradesCount: dbOpen.length,
    divergences,
  };
}

async function main() {
  const r = await runReconcile();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.aligned ? 0 : 4);
}

if (require.main === module) {
  main().catch(e => {
    log.error('reconcile crashed', { err: e?.message ?? String(e), stack: e?.stack });
    process.exit(1);
  });
}

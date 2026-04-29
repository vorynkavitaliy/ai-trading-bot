import { loadAccounts, AccountKey } from './lib/accounts';
import { getRest, withRetry } from './lib/bybit';
import { query } from './lib/db';
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
}

async function fetchDbOpenTrades(): Promise<DbOpenTrade[]> {
  const r = await query<any>(
    `SELECT id, account_bucket, account_key, symbol, side, qty::text
     FROM trades WHERE status = 'open'`
  );
  return r.rows.map((row) => ({
    id: row.id,
    account_bucket: row.account_bucket,
    account_key: row.account_key,
    symbol: row.symbol,
    side: row.side,
    qty: parseFloat(row.qty),
  }));
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
  for (const t of dbOpen) {
    const has = allBybit.find(p =>
      `${t.account_bucket}/${t.account_key}` === p.account &&
      t.symbol === p.symbol &&
      t.side.toLowerCase() === p.side.toLowerCase()
    );
    if (!has) {
      divergences.push({
        type: 'db_without_bybit',
        account: `${t.account_bucket}/${t.account_key}`,
        symbol: t.symbol, trade_id: t.id, qty: t.qty,
      });
    }
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

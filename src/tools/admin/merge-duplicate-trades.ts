/**
 * One-off repair: merge twin open-trade rows created by the 2026-05-28
 * stack-and-sum bug.
 *
 * Symptom: execute.ts persistTrade() and account-monitor's tryPromotePending()
 * BOTH ran for scaled-in fills and each inserted a trades row. The DB ends up
 * with two open rows per (account, symbol, side) — same Bybit position split
 * across two records → reconcile flags size_mismatch every cycle.
 *
 * Strategy (read-only by default, --apply to mutate):
 *   1. Pull every Bybit live position size per (account, symbol, side).
 *   2. Group open trade rows by the same key.
 *   3. If a group has > 1 rows AND one row's qty equals Bybit position size
 *      within tolerance → that row is the "survivor". Mark the other(s)
 *      status='dup_merged' (status filter 'open' will exclude them; risk
 *      math + reconcile + position-watcher all become correct again).
 *   4. If no row matches Bybit size cleanly → SUM of qtys matches Bybit →
 *      mark all but the newest as 'dup_merged', then set the survivor's
 *      qty/initial_qty to Bybit's. Logs the choice so the operator can audit.
 *   5. If neither — leave alone, print a warning. Operator must investigate
 *      (a true position/DB drift not explained by stack-and-sum).
 *
 * Forward fix (execute.ts persistTrade + pending-orders.ts linkTradeId in
 * the same commit) prevents new duplicates from being created. This tool
 * only cleans up rows that already exist.
 *
 * Usage:
 *   npx tsx src/tools/admin/merge-duplicate-trades.ts          # dry-run
 *   npx tsx src/tools/admin/merge-duplicate-trades.ts --apply  # mutate DB
 */

import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { query, close as closePg } from '../../core/db';

const QTY_TOLERANCE_FRAC = 0.01;

interface BybitPos { account: string; symbol: string; side: string; size: number; }
interface TradeRow { id: number; account: string; symbol: string; side: string; qty: number; opened_at: string; }

async function fetchBybitPositions(): Promise<BybitPos[]> {
  const accounts = loadAccounts();
  const out: BybitPos[] = [];
  for (const a of accounts) {
    const c = getRest(a);
    const r: any = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), {
      label: `merge-dup-getPositions-${a.keyName}`,
    });
    if (r.retCode !== 0) throw new Error(`positions retCode=${r.retCode} ${r.retMsg}`);
    for (const p of (r.result?.list ?? [])) {
      const size = parseFloat(p.size);
      if (size > 0) out.push({
        account: `${a.bucket}/${a.keyName}`, symbol: p.symbol, side: p.side, size,
      });
    }
  }
  return out;
}

async function fetchOpenTrades(): Promise<TradeRow[]> {
  const r = await query<any>(
    `SELECT id, account_bucket || '/' || account_key AS account, symbol, side,
            qty::text AS qty, opened_at::text AS opened_at
       FROM trades WHERE status = 'open' ORDER BY symbol, account_bucket, account_key, id`,
    []
  );
  return r.rows.map((row) => ({
    id: typeof row.id === 'string' ? parseInt(row.id, 10) : row.id,
    account: row.account,
    symbol: row.symbol,
    side: row.side,
    qty: parseFloat(row.qty),
    opened_at: row.opened_at,
  }));
}

function groupKey(t: { account: string; symbol: string; side: string }): string {
  return `${t.account}|${t.symbol}|${t.side}`;
}

async function markDup(id: number, reason: string): Promise<void> {
  await query(
    `UPDATE trades SET status='dup_merged',
                       closed_at = COALESCE(closed_at, NOW()),
                       exit_reason = $2
       WHERE id = $1 AND status = 'open'`,
    [id, reason]
  );
}

async function setSurvivorQty(id: number, qty: number): Promise<void> {
  await query(
    `UPDATE trades SET qty = $1, initial_qty = GREATEST(initial_qty, $1)
       WHERE id = $2 AND status = 'open'`,
    [qty, id]
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`[merge-duplicate-trades] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  const [bybit, trades] = await Promise.all([fetchBybitPositions(), fetchOpenTrades()]);

  const bybitByKey = new Map<string, BybitPos>();
  for (const p of bybit) bybitByKey.set(groupKey(p), p);

  const groups = new Map<string, TradeRow[]>();
  for (const t of trades) {
    const k = groupKey(t);
    const arr = groups.get(k) ?? [];
    arr.push(t);
    groups.set(k, arr);
  }

  let mergedCount = 0;
  let untouchedSingletons = 0;
  let unexplained = 0;

  for (const [k, rows] of groups.entries()) {
    if (rows.length === 1) { untouchedSingletons++; continue; }

    const pos = bybitByKey.get(k);
    if (!pos) {
      console.log(`[${k}] N=${rows.length}, NO Bybit position — broker closed all; mark all as dup_merged is unsafe — investigate manually`);
      unexplained++;
      continue;
    }

    // Try exact-match strategy first
    const tol = pos.size * QTY_TOLERANCE_FRAC;
    const survivor = rows.find((r) => Math.abs(r.qty - pos.size) <= tol);

    if (survivor) {
      const losers = rows.filter((r) => r.id !== survivor.id);
      console.log(`[${k}] N=${rows.length} bybit_size=${pos.size} survivor=id=${survivor.id} (qty=${survivor.qty}) dup_ids=${losers.map((l) => l.id).join(',')}`);
      if (apply) {
        for (const l of losers) await markDup(l.id, `stack-and-sum-dup of trade ${survivor.id} (Bybit size ${pos.size})`);
        mergedCount += losers.length;
      }
      continue;
    }

    // Fall back to sum-match strategy
    const sum = rows.reduce((s, r) => s + r.qty, 0);
    const sumDiff = Math.abs(sum - pos.size);
    if (sumDiff <= pos.size * QTY_TOLERANCE_FRAC) {
      const newest = rows.reduce((a, b) => (a.id > b.id ? a : b));
      const losers = rows.filter((r) => r.id !== newest.id);
      console.log(`[${k}] N=${rows.length} bybit_size=${pos.size} sum_qty=${sum} → SUM strategy: survivor id=${newest.id} (will be set to ${pos.size}), dup_ids=${losers.map((l) => l.id).join(',')}`);
      if (apply) {
        for (const l of losers) await markDup(l.id, `stack-and-sum-dup; merged sum into trade ${newest.id}`);
        await setSurvivorQty(newest.id, pos.size);
        mergedCount += losers.length;
      }
      continue;
    }

    console.log(`[${k}] N=${rows.length} bybit_size=${pos.size} sum_qty=${sum} — neither exact-match nor sum-match. Manual investigation needed.`);
    unexplained++;
  }

  console.log(`\n--- summary ---`);
  console.log(`groups inspected:    ${groups.size}`);
  console.log(`untouched singletons: ${untouchedSingletons}`);
  console.log(`duplicate rows ${apply ? 'merged' : 'WOULD be merged'}: ${mergedCount}`);
  console.log(`unexplained groups:  ${unexplained}`);
  if (!apply) console.log(`\nDRY-RUN — rerun with --apply to mutate the DB.`);

  await closePg();
}

main().catch(async (e) => {
  console.error('merge-duplicate-trades crashed', e);
  try { await closePg(); } catch {}
  process.exit(1);
});

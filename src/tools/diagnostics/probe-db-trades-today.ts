import { query, close } from '../../core/db';

async function main() {
  const sql = `
    SELECT
      id,
      account_key,
      symbol,
      side,
      status,
      qty,
      initial_qty,
      entry_price,
      sl,
      tp2,
      exit_price,
      exit_reason,
      pnl_usd,
      realized_r,
      opened_at,
      closed_at
    FROM trades
    WHERE (opened_at >= TIMESTAMP '2026-06-03 00:00:00' AT TIME ZONE 'UTC')
       OR (closed_at >= TIMESTAMP '2026-06-03 00:00:00' AT TIME ZONE 'UTC'
           AND closed_at < TIMESTAMP '2026-06-04 00:00:00' AT TIME ZONE 'UTC')
       OR (status = 'open' AND opened_at >= TIMESTAMP '2026-06-02 00:00:00' AT TIME ZONE 'UTC')
    ORDER BY opened_at ASC, id ASC
  `;
  const { rows } = await query<any>(sql);

  const toNum = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const toStr = (v: any): string | null => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };

  const trades = rows.map((r) => ({
    id: Number(r.id),
    account_key: String(r.account_key),
    symbol: String(r.symbol),
    side: String(r.side),
    status: String(r.status),
    qty: toNum(r.qty) ?? 0,
    initial_qty: toNum(r.initial_qty) ?? toNum(r.qty) ?? 0,
    entry_price: toNum(r.entry_price) ?? 0,
    sl: toNum(r.sl) ?? 0,
    tp: toNum(r.tp2) ?? 0,
    exit_price: toNum(r.exit_price),
    exit_reason: r.exit_reason ?? null,
    pnl_usd: toNum(r.pnl_usd),
    realized_r: toNum(r.realized_r),
    opened_at: toStr(r.opened_at) ?? '',
    closed_at: toStr(r.closed_at),
  }));

  let realized_total = 0;
  let open_count = 0;
  let closed_count = 0;
  for (const t of trades) {
    if (t.status === 'closed') {
      closed_count += 1;
      if (t.pnl_usd != null) realized_total += t.pnl_usd;
    } else if (t.status === 'open') {
      open_count += 1;
    }
  }

  const out = {
    today_trades: trades,
    realized_total,
    open_count,
    closed_count,
  };
  process.stdout.write(JSON.stringify(out));
  await close();
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e));
  process.exit(1);
});

import { query } from '../lib/db';

// Buy-and-hold baseline: what would 1 unit of capital do
// invested at startTs and held until endTs? Reports total return + MaxDD.

export interface BaselineResult {
  symbol: string;
  startPrice: number;
  endPrice: number;
  totalReturnPct: number;
  maxDDPct: number;
  startTs: number;
  endTs: number;
}

export async function buyAndHold(symbol: string, startTs: number, endTs: number): Promise<BaselineResult> {
  const r = await query<any>(
    `SELECT ts::text, close FROM candles
     WHERE symbol = $1 AND tf = '60m' AND ts >= $2 AND ts <= $3
     ORDER BY ts ASC`,
    [symbol, startTs, endTs]
  );
  const rows = r.rows.map((row) => ({ ts: parseInt(row.ts, 10), close: parseFloat(row.close) }));
  if (rows.length === 0) {
    throw new Error(`baseline: no candles for ${symbol}`);
  }
  const start = rows[0];
  const end = rows[rows.length - 1];
  const totalReturnPct = ((end.close - start.close) / start.close) * 100;

  // MaxDD: track equity = price / start.close
  let peak = start.close;
  let maxDD = 0;
  for (const row of rows) {
    if (row.close > peak) peak = row.close;
    const dd = ((peak - row.close) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return {
    symbol,
    startPrice: start.close,
    endPrice: end.close,
    totalReturnPct,
    maxDDPct: maxDD,
    startTs: start.ts,
    endTs: end.ts,
  };
}

export function formatBaseline(r: BaselineResult): string {
  return [
    `=== buy-and-hold ${r.symbol} ===`,
    `start: $${r.startPrice.toFixed(2)} on ${new Date(r.startTs).toISOString().slice(0, 10)}`,
    `end:   $${r.endPrice.toFixed(2)} on ${new Date(r.endTs).toISOString().slice(0, 10)}`,
    `return: ${r.totalReturnPct.toFixed(2)}%`,
    `MaxDD:  ${r.maxDDPct.toFixed(2)}%`,
  ].join('\n');
}

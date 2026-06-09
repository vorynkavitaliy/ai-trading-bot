import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';

const SYMBOLS = ['ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

interface OutPos {
  account: string;
  symbol: string;
  side: string;
  size: number;
  avg_price: number;
  mark_price: number;
  unrealized_pnl: number;
  sl: number | null;
  tp: number | null;
}

async function main() {
  const accounts = loadAccounts();
  const positions: OutPos[] = [];
  let totalUnrealized = 0;
  let totalEquity = 0;

  for (const acct of accounts) {
    const c = getRest(acct);

    try {
      const w = await withRetry(() => c.getWalletBalance({ accountType: 'UNIFIED' }), {
        label: `wallet-${acct.label}`,
      });
      if (w.retCode === 0) {
        const eq = parseFloat(w.result?.list?.[0]?.totalEquity ?? '0');
        totalEquity += eq;
        console.error(`[equity] ${acct.label} = ${eq}`);
      } else {
        console.error(`[equity] ${acct.label} FAIL retCode=${w.retCode} ${w.retMsg}`);
      }
    } catch (e: any) {
      console.error(`[equity] ${acct.label} err: ${e?.message ?? e}`);
    }

    for (const symbol of SYMBOLS) {
      try {
        const r = await withRetry(
          () => c.getPositionInfo({ category: 'linear', symbol }),
          { label: `pos-${acct.label}-${symbol}` }
        );
        if (r.retCode !== 0) {
          console.error(`[pos] ${acct.label} ${symbol} FAIL retCode=${r.retCode} ${r.retMsg}`);
          continue;
        }
        const list = r.result?.list ?? [];
        for (const p of list) {
          const size = parseFloat(p.size ?? '0');
          if (!(size > 0)) continue;
          const sl = p.stopLoss && parseFloat(p.stopLoss) > 0 ? parseFloat(p.stopLoss) : null;
          const tp = p.takeProfit && parseFloat(p.takeProfit) > 0 ? parseFloat(p.takeProfit) : null;
          const pnl = parseFloat(p.unrealisedPnl ?? '0');
          positions.push({
            account: acct.label,
            symbol,
            side: p.side,
            size,
            avg_price: parseFloat(p.avgPrice ?? '0'),
            mark_price: parseFloat(p.markPrice ?? '0'),
            unrealized_pnl: pnl,
            sl,
            tp,
          });
          totalUnrealized += pnl;
        }
      } catch (e: any) {
        console.error(`[pos] ${acct.label} ${symbol} err: ${e?.message ?? e}`);
      }
    }
  }

  const out = { positions, total_unrealized: totalUnrealized, total_equity: totalEquity };
  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});

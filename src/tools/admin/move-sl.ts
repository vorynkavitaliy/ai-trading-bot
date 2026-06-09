import { loadAccounts } from '../../core/accounts';
import { getRest, getInstrumentInfo, roundPriceToTick } from '../../core/bybit';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

interface PosRow {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  avgPrice: number;
  stopLoss: number;
}

async function fetchPosition(account: ReturnType<typeof loadAccounts>[number], symbol: string): Promise<PosRow | null> {
  const c = getRest(account);
  const r = await c.getPositionInfo({ category: 'linear', symbol });
  if (r.retCode !== 0) throw new Error(`getPositionInfo retCode=${r.retCode} ${r.retMsg}`);
  const list = r.result?.list ?? [];
  const p = list.find((x: any) => parseFloat(x.size) > 0);
  if (!p) return null;
  if (p.side !== 'Buy' && p.side !== 'Sell') return null;
  return {
    symbol: p.symbol,
    side: p.side,
    size: parseFloat(p.size),
    avgPrice: parseFloat(p.avgPrice),
    stopLoss: parseFloat(p.stopLoss || '0'),
  };
}

async function main() {
  const symbol = process.argv[2];
  const newSL = parseFloat(process.argv[3]);
  if (!symbol || !Number.isFinite(newSL) || newSL <= 0) {
    console.error('usage: npx tsx src/tools/admin/move-sl.ts <SYMBOL> <new_sl_price>');
    process.exit(1);
  }

  const accounts = loadAccounts();
  console.log(`\n==== move-sl ${symbol} → ${newSL} ====`);
  const results: { account: string; ok: boolean; from: number; to: number; reason?: string }[] = [];

  for (const account of accounts) {
    const tag = account.keyName;
    let pos: PosRow | null;
    try {
      pos = await fetchPosition(account, symbol);
    } catch (e: any) {
      results.push({ account: tag, ok: false, from: 0, to: 0, reason: `fetch failed: ${e.message}` });
      continue;
    }
    if (!pos) {
      results.push({ account: tag, ok: false, from: 0, to: 0, reason: 'no open position' });
      continue;
    }

    if (pos.side === 'Sell' && newSL <= pos.avgPrice) {
      const tooLow = pos.size && newSL <= 0;
      if (tooLow) {
        results.push({ account: tag, ok: false, from: pos.stopLoss, to: newSL, reason: 'invalid SL' });
        continue;
      }
    }
    if (pos.side === 'Sell' && newSL >= pos.stopLoss && pos.stopLoss > 0) {
      results.push({ account: tag, ok: false, from: pos.stopLoss, to: newSL, reason: `SHORT: new SL ${newSL} not tighter than current ${pos.stopLoss}` });
      continue;
    }
    if (pos.side === 'Buy' && newSL <= pos.stopLoss && pos.stopLoss > 0) {
      results.push({ account: tag, ok: false, from: pos.stopLoss, to: newSL, reason: `LONG: new SL ${newSL} not tighter than current ${pos.stopLoss}` });
      continue;
    }

    const info = await getInstrumentInfo(account, symbol);
    const slStr = roundPriceToTick(newSL, info);
    const c = getRest(account);
    try {
      const r = await c.setTradingStop({
        category: 'linear',
        symbol,
        stopLoss: slStr,
        slTriggerBy: 'LastPrice',
        positionIdx: 0,
      });
      if (r.retCode !== 0) {
        results.push({ account: tag, ok: false, from: pos.stopLoss, to: parseFloat(slStr), reason: `retCode=${r.retCode} ${r.retMsg}` });
        continue;
      }
      log.info('SL moved (operator manual)', { symbol, account: tag, from: pos.stopLoss, to: parseFloat(slStr) });
      results.push({ account: tag, ok: true, from: pos.stopLoss, to: parseFloat(slStr) });
    } catch (e: any) {
      results.push({ account: tag, ok: false, from: pos.stopLoss, to: parseFloat(slStr), reason: e.message });
    }
  }

  console.log('');
  for (const r of results) {
    const flag = r.ok ? '✅' : '❌';
    const detail = r.reason ? ` (${r.reason})` : '';
    console.log(`  ${flag} ${r.account.padEnd(20)} ${r.from} → ${r.to}${detail}`);
  }

  const okCount = results.filter(r => r.ok).length;
  console.log(`\n=== ${okCount}/${results.length} amended ===\n`);

  await closePg();
  process.exit(okCount === results.filter(r => !r.reason?.includes('no open position')).length ? 0 : 2);
}

main().catch(async (e) => {
  log.error('move-sl crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});

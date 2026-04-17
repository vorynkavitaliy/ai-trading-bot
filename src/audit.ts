import { RestClientV5 } from 'bybit-api';
import * as fs from 'fs';
import * as path from 'path';

const accountsPath = path.join(__dirname, '..', 'accounts.json');
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));

type Sub = { tier: string; label: string; apiKey: string; apiSecret: string; testnet: boolean; demoTrading: boolean };

const subs: Sub[] = [];
for (const [tier, cfg] of Object.entries(accounts)) {
  const c = cfg as any;
  for (let i = 0; i < c.apiKey.length; i++) {
    subs.push({
      tier,
      label: c.label ?? tier,
      apiKey: c.apiKey[i],
      apiSecret: c.apiSecret[i],
      testnet: c.testnet,
      demoTrading: c.demoTrading,
    });
  }
}

(async () => {
  for (const s of subs) {
    const c = new RestClientV5({
      key: s.apiKey,
      secret: s.apiSecret,
      testnet: s.testnet,
      demoTrading: s.demoTrading,
    });
    const pos = await c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' });
    const orders = await c.getActiveOrders({ category: 'linear', settleCoin: 'USDT', openOnly: 0 });
    console.log(`\n=== ${s.label} ===`);
    const live = (pos.result?.list ?? []).filter((p: any) => Number(p.size) > 0);
    for (const p of live) {
      console.log(
        `  POS ${p.symbol} ${p.side} qty=${p.size} entry=${p.avgPrice} mark=${p.markPrice} pnl=${p.unrealisedPnl} sl=${p.stopLoss} tp=${p.takeProfit}`
      );
    }
    for (const o of orders.result?.list ?? []) {
      const ageMin = Math.round((Date.now() - Number(o.createdTime)) / 60000);
      console.log(
        `  ORD ${o.symbol} ${o.side} ${o.orderType} qty=${o.qty} price=${o.price} trig=${o.triggerPrice} reduceOnly=${o.reduceOnly} age=${ageMin}m`
      );
    }
  }
})();

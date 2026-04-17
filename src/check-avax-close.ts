import { RestClientV5 } from 'bybit-api';
import * as fs from 'fs';
import * as path from 'path';

const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'accounts.json'), 'utf8'));
type Sub = { tier: string; label: string; apiKey: string; apiSecret: string; testnet: boolean; demoTrading: boolean };
const subs: Sub[] = [];
for (const [tier, cfg] of Object.entries(accounts)) {
  const c = cfg as any;
  for (let i = 0; i < c.apiKey.length; i++) {
    subs.push({ tier, label: c.label ?? tier, apiKey: c.apiKey[i], apiSecret: c.apiSecret[i], testnet: c.testnet, demoTrading: c.demoTrading });
  }
}

(async () => {
  for (const s of subs) {
    const c = new RestClientV5({ key: s.apiKey, secret: s.apiSecret, testnet: s.testnet, demoTrading: s.demoTrading });
    const r = await c.getClosedPnL({ category: 'linear', symbol: 'AVAXUSDT', limit: 3 });
    console.log(`\n=== ${s.label} ===`);
    for (const p of (r.result?.list ?? [])) {
      const t = new Date(Number(p.createdTime)).toISOString();
      console.log(`  ${t} side=${p.side} qty=${p.qty} entry=${p.avgEntryPrice} exit=${p.avgExitPrice} closedPnl=${p.closedPnl}`);
    }
  }
})();

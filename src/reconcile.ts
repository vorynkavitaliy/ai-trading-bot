/**
 * Vault ↔ Bybit reconciliation.
 *
 * Emits a JSON diff so /trade-scan Phase 1 can halt on divergence.
 * Divergence modes:
 *   bybit_without_vault — live position with no open vault/Trades/ file (ungovernable)
 *   vault_without_bybit — vault file says open but no matching Bybit position (stale)
 *
 * Exit codes: 0 aligned, 1 divergence, 2 script error.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';

interface VaultTrade {
  file: string;
  symbol: string;
  direction: string;      // long | short
  side: 'Buy' | 'Sell';   // derived for Bybit comparison
  entry: number | null;
  sl: number | null;
  tp: number | null;
}

interface BybitPos {
  account: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  size: string;
  entry: string;
  mark: string;
  pnl: string;
  sl: string;
  tp: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const raw of match[1].split('\n')) {
    const kv = raw.match(/^([a-zA-Z_][\w-]*):\s*(.*?)\s*$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.replace(/^["']|["']$/g, '');       // strip quotes
    if (v === '' || v === 'null') continue;
    out[k] = v;
  }
  return out;
}

async function main() {
  const vaultDir = path.join(__dirname, '..', 'vault', 'Trades');
  const files = fs.existsSync(vaultDir)
    ? fs.readdirSync(vaultDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    : [];

  const vaultTrades: VaultTrade[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(vaultDir, file), 'utf-8');
    const fm = parseFrontmatter(content);
    if (fm.status !== 'open') continue;

    const direction = (fm.direction || '').toLowerCase();
    const side: 'Buy' | 'Sell' = direction === 'long' ? 'Buy' : 'Sell';
    vaultTrades.push({
      file,
      symbol: (fm.symbol || '').toUpperCase(),
      direction,
      side,
      entry: fm.entry ? Number(fm.entry) : null,
      sl: fm.sl ? Number(fm.sl) : null,
      tp: fm.tp ? Number(fm.tp) : null,
    });
  }

  const mgr = new AccountManager();
  const client = new BybitClient(mgr);
  const allPos = await client.getAllPositions();

  // Dedupe by symbol+side — a single strategy position spans all sub-accounts.
  const bybitMap = new Map<string, BybitPos>();
  for (const { sub, positions } of allPos) {
    for (const p of positions) {
      const key = `${p.symbol}|${p.side}`;
      if (bybitMap.has(key)) continue;
      bybitMap.set(key, {
        account: sub.label,
        symbol: p.symbol,
        side: p.side as 'Buy' | 'Sell',
        size: String(p.size),
        entry: String(p.entryPrice),
        mark: String(p.markPrice),
        pnl: String(p.unrealisedPnl),
        sl: String(p.stopLoss ?? ''),
        tp: String(p.takeProfit ?? ''),
      });
    }
  }

  const vaultMap = new Map<string, VaultTrade>();
  for (const t of vaultTrades) vaultMap.set(`${t.symbol}|${t.side}`, t);

  const bybit_without_vault: BybitPos[] = [];
  for (const [key, pos] of bybitMap.entries()) {
    if (!vaultMap.has(key)) bybit_without_vault.push(pos);
  }

  const vault_without_bybit: VaultTrade[] = [];
  for (const [key, trade] of vaultMap.entries()) {
    if (!bybitMap.has(key)) vault_without_bybit.push(trade);
  }

  const aligned = bybit_without_vault.length === 0 && vault_without_bybit.length === 0;

  const output = {
    timestamp: new Date().toISOString(),
    aligned,
    bybit_positions: Array.from(bybitMap.values()),
    vault_open_trades: vaultTrades,
    divergences: { bybit_without_vault, vault_without_bybit },
    action_required: aligned ? null : [
      bybit_without_vault.length
        ? `Reconstruct vault/Trades/ file(s) for: ${bybit_without_vault.map((p) => `${p.symbol} ${p.side}`).join(', ')}`
        : null,
      vault_without_bybit.length
        ? `Close-out vault/Trades/ file(s) for: ${vault_without_bybit.map((t) => `${t.symbol} ${t.direction}`).join(', ')} + write Postmortem`
        : null,
    ].filter(Boolean),
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(aligned ? 0 : 1);
}

main().catch((err) => {
  console.error('[reconcile] error:', err.message || err);
  process.exit(2);
});

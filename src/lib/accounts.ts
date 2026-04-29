import fs from 'node:fs';
import path from 'node:path';

export interface AccountKey {
  bucket: string;          // '200000', '50000'
  keyName: string;         // 'key1', 'key2'
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  demoTrading: boolean;
  label: string;
}

interface AccountFileEntry {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  demoTrading?: boolean;
  label?: string;
}

type AccountFile = Record<string, Record<string, AccountFileEntry>>;

const ACCOUNTS_PATH = path.resolve(__dirname, '../../accounts.json');

let cache: AccountKey[] | null = null;

export function loadAccounts(): AccountKey[] {
  if (cache) return cache;
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    console.error(`[accounts] missing accounts.json at ${ACCOUNTS_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as AccountFile;
  const out: AccountKey[] = [];
  for (const [bucket, keys] of Object.entries(parsed)) {
    if (typeof keys !== 'object' || keys === null) continue;
    for (const [keyName, entry] of Object.entries(keys)) {
      if (!entry?.apiKey || !entry?.apiSecret) {
        console.error(`[accounts] bucket=${bucket} key=${keyName} missing apiKey/apiSecret`);
        process.exit(1);
      }
      out.push({
        bucket,
        keyName,
        apiKey: entry.apiKey,
        apiSecret: entry.apiSecret,
        testnet: entry.testnet ?? true,
        demoTrading: entry.demoTrading ?? true,
        label: entry.label ?? `${bucket}/${keyName}`,
      });
    }
  }
  if (out.length === 0) {
    console.error(`[accounts] no valid keys found in accounts.json`);
    process.exit(1);
  }
  cache = out;
  return cache;
}

export function summary(): string {
  const accs = loadAccounts();
  const lines = accs.map(a =>
    `  ${a.bucket}/${a.keyName} → ${a.label} (testnet=${a.testnet}, demo=${a.demoTrading})`
  );
  return `accounts.json: ${accs.length} key(s)\n${lines.join('\n')}`;
}

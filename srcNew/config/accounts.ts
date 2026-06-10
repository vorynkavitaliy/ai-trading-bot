import fs from 'node:fs';
import path from 'node:path';

import { ConfigError } from '../core/errors';

export interface BybitAccountConfig {
  readonly id: string;
  readonly bucket: string;
  readonly keyName: string;
  readonly label: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly testnet: boolean;
  readonly demoTrading: boolean;
}

interface RawAccountEntry {
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean;
  demoTrading?: boolean;
  label?: string;
}

type RawAccountFile = Record<string, Record<string, RawAccountEntry>>;

const DEFAULT_ACCOUNTS_PATH = path.resolve(__dirname, 'accounts.json');

export function loadAccounts(filePath: string = DEFAULT_ACCOUNTS_PATH): BybitAccountConfig[] {
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(
      `srcNew accounts file not found at ${filePath}. ` +
        `Copy srcNew/config/accounts.example.json to srcNew/config/accounts.json and fill in keys. ` +
        `This loader never reads the live root accounts.json.`,
    );
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RawAccountFile;
  const accounts: BybitAccountConfig[] = [];

  for (const [bucket, keys] of Object.entries(raw)) {
    if (typeof keys !== 'object' || keys === null) continue;

    for (const [keyName, entry] of Object.entries(keys)) {
      if (!entry?.apiKey || !entry?.apiSecret) {
        throw new ConfigError(`account ${bucket}/${keyName} is missing apiKey or apiSecret`);
      }

      accounts.push({
        id: `${bucket}/${keyName}`,
        bucket,
        keyName,
        label: entry.label ?? `${bucket}/${keyName}`,
        apiKey: entry.apiKey,
        apiSecret: entry.apiSecret,
        testnet: entry.testnet ?? true,
        demoTrading: entry.demoTrading ?? true,
      });
    }
  }

  if (accounts.length === 0) {
    throw new ConfigError(`no valid accounts found in ${filePath}`);
  }

  return accounts;
}

export function summarizeAccounts(accounts: readonly BybitAccountConfig[]): string {
  const lines = accounts.map(
    (account) => `  ${account.id} → ${account.label} (testnet=${account.testnet}, demo=${account.demoTrading})`,
  );
  return `srcNew accounts: ${accounts.length} key(s)\n${lines.join('\n')}`;
}

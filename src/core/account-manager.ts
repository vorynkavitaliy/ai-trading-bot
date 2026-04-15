import { RestClientV5 } from 'bybit-api';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AccountsFile, SubAccount, VolumeTier } from './types';

/**
 * Loads accounts.json and creates RestClientV5 instances for every sub-account.
 *
 * Structure reminder:
 *   "200000": {
 *     "apiKey": ["key1", "key2"],     ← 2 sub-accounts
 *     "apiSecret": ["sec1", "sec2"],
 *     ...
 *   }
 */
export class AccountManager {
  private tiers: VolumeTier[] = [];

  constructor(accountsPath?: string) {
    const filePath = accountsPath ?? resolve(process.cwd(), 'accounts.json');
    const raw = readFileSync(filePath, 'utf-8');
    const data: AccountsFile = JSON.parse(raw);

    for (const [volumeStr, config] of Object.entries(data)) {
      const volume = Number(volumeStr);

      if (config.apiKey.length !== config.apiSecret.length) {
        throw new Error(
          `[${config.label}] apiKey count (${config.apiKey.length}) !== apiSecret count (${config.apiSecret.length})`
        );
      }

      const subAccounts: SubAccount[] = config.apiKey.map((key, i) => {
        const client = new RestClientV5({
          key,
          secret: config.apiSecret[i],
          testnet: config.testnet,
          demoTrading: config.demoTrading,
        });

        return {
          volume,
          index: i,
          apiKey: key,
          apiSecret: config.apiSecret[i],
          testnet: config.testnet,
          demoTrading: config.demoTrading,
          label: config.apiKey.length > 1
            ? `${config.label} #${i + 1}`
            : config.label,
          client,
        };
      });

      this.tiers.push({
        volume,
        label: config.label,
        testnet: config.testnet,
        demoTrading: config.demoTrading,
        subAccounts,
      });
    }

    const totalSubs = this.tiers.reduce((s, t) => s + t.subAccounts.length, 0);
    console.log(
      `[AccountManager] Loaded ${this.tiers.length} tier(s), ${totalSubs} sub-account(s)`
    );
  }

  /** All volume tiers */
  getTiers(): VolumeTier[] {
    return this.tiers;
  }

  /** Flat list of every sub-account across all tiers */
  getAllSubAccounts(): SubAccount[] {
    return this.tiers.flatMap((t) => t.subAccounts);
  }

  /** Get a specific tier by volume */
  getTier(volume: number): VolumeTier | undefined {
    return this.tiers.find((t) => t.volume === volume);
  }

  /** Total count of sub-accounts */
  get totalAccounts(): number {
    return this.tiers.reduce((s, t) => s + t.subAccounts.length, 0);
  }
}

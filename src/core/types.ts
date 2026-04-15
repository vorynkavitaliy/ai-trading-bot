import { RestClientV5 } from 'bybit-api';

// ─── accounts.json shape ───

export interface AccountConfig {
  apiKey: string[];
  apiSecret: string[];
  testnet: boolean;
  demoTrading: boolean;
  label: string;
}

/** Key = volume (starting balance as string), value = account config */
export type AccountsFile = Record<string, AccountConfig>;

// ─── Runtime models ───

/** One sub-account within a volume tier */
export interface SubAccount {
  volume: number;
  index: number;
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  demoTrading: boolean;
  label: string;
  client: RestClientV5;
}

/** A volume tier with all its sub-accounts */
export interface VolumeTier {
  volume: number;
  label: string;
  testnet: boolean;
  demoTrading: boolean;
  subAccounts: SubAccount[];
}

// ─── Trade types ───

export type OrderSide = 'Buy' | 'Sell';
export type OrderType = 'Market' | 'Limit';
export type PositionDirection = 'Long' | 'Short';

export interface TradeParams {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  qty: string;
  price?: string;
  stopLoss?: string;
  takeProfit?: string;
  tpslMode?: 'Full' | 'Partial';
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'PostOnly';
  orderLinkId?: string;
}

export interface TradeResult {
  subAccount: SubAccount;
  success: boolean;
  orderId?: string;
  error?: string;
}

export interface PositionInfo {
  symbol: string;
  side: string;
  size: string;
  entryPrice: string;
  markPrice: string;
  unrealisedPnl: string;
  leverage: string;
  stopLoss: string;
  takeProfit: string;
  trailingStop: string;
}

export interface WalletInfo {
  equity: string;
  availableBalance: string;
  totalWalletBalance: string;
  unrealisedPnl: string;
}

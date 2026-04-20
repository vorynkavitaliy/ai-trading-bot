import type { KlineIntervalV3 } from 'bybit-api';
import {
  SubAccount,
  VolumeTier,
  TradeParams,
  TradeResult,
  PositionInfo,
  WalletInfo,
} from './types';
import { AccountManager } from './account-manager';

/**
 * Multi-account Bybit client.
 * All trade operations execute across sub-accounts via Promise.all.
 * Public data uses the first available client (data is identical for all).
 */
export class BybitClient {
  private manager: AccountManager;

  constructor(manager: AccountManager) {
    this.manager = manager;
  }

  // ═══════════════════════════════════════════
  //  PUBLIC DATA (any single client works)
  // ═══════════════════════════════════════════

  private get publicClient() {
    return this.manager.getAllSubAccounts()[0].client;
  }

  async getPrice(symbol: string) {
    const res = await this.publicClient.getTickers({ category: 'linear', symbol });
    const ticker = res.result.list[0];
    return {
      lastPrice: ticker.lastPrice,
      bid1Price: ticker.bid1Price,
      ask1Price: ticker.ask1Price,
      highPrice24h: ticker.highPrice24h,
      lowPrice24h: ticker.lowPrice24h,
      volume24h: ticker.volume24h,
      turnover24h: ticker.turnover24h,
      fundingRate: ticker.fundingRate,
      nextFundingTime: ticker.nextFundingTime,
      openInterest: ticker.openInterest,
    };
  }

  async getKlines(symbol: string, interval: KlineIntervalV3, limit = 200) {
    const res = await this.publicClient.getKline({
      category: 'linear',
      symbol,
      interval,
      limit,
    });
    // Bybit returns newest first — reverse to chronological order
    return res.result.list.reverse().map((k) => ({
      timestamp: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      turnover: Number(k[6]),
    }));
  }

  async getOrderbook(symbol: string, limit = 25) {
    const res = await this.publicClient.getOrderbook({
      category: 'linear',
      symbol,
      limit,
    });
    return {
      bids: res.result.b.map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
      asks: res.result.a.map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
      timestamp: res.result.ts,
    };
  }

  /**
   * Fetch recent public trades (aggregator of taker prints).
   * Bybit V5 `/v5/market/recent-trade` — max limit 1000 for linear.
   * Returns raw `list` entries (time/price/size/side in string form).
   * Callers (see `analysis/orderflow.ts`) map to numeric + typed aggressor side.
   */
  async getRecentTrades(symbol: string, limit = 1000) {
    const res = await this.publicClient.getPublicTradingHistory({
      category: 'linear',
      symbol,
      limit,
    });
    return res.result.list;
  }

  async getInstrumentInfo(symbol: string) {
    const res = await this.publicClient.getInstrumentsInfo({
      category: 'linear',
      symbol,
    });
    return res.result.list[0];
  }

  // ═══════════════════════════════════════════
  //  PER-ACCOUNT: wallet, positions
  // ═══════════════════════════════════════════

  /** Get wallet balance for a single sub-account */
  async getWallet(sub: SubAccount): Promise<WalletInfo> {
    const res = await sub.client.getWalletBalance({ accountType: 'UNIFIED' });
    const acct = res.result.list[0];
    return {
      equity: acct.totalEquity,
      availableBalance: acct.totalAvailableBalance,
      totalWalletBalance: acct.totalWalletBalance,
      unrealisedPnl: acct.totalPerpUPL,
    };
  }

  /** Get wallet for ALL sub-accounts */
  async getAllWallets(): Promise<{ sub: SubAccount; wallet: WalletInfo }[]> {
    const subs = this.manager.getAllSubAccounts();
    const results = await Promise.all(
      subs.map(async (sub) => {
        try {
          const wallet = await this.getWallet(sub);
          return { sub, wallet };
        } catch (err) {
          console.error(`[${sub.label}] Failed to get wallet:`, err);
          return {
            sub,
            wallet: { equity: '0', availableBalance: '0', totalWalletBalance: '0', unrealisedPnl: '0' },
          };
        }
      })
    );
    return results;
  }

  /** Get open positions for a single sub-account */
  async getPositions(sub: SubAccount, symbol?: string): Promise<PositionInfo[]> {
    const params: any = { category: 'linear' as const, settleCoin: 'USDT' };
    if (symbol) params.symbol = symbol;

    const res = await sub.client.getPositionInfo(params);
    return res.result.list
      .filter((p) => Number(p.size) > 0)
      .map((p) => ({
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.avgPrice,
        markPrice: p.markPrice,
        unrealisedPnl: p.unrealisedPnl,
        leverage: p.leverage ?? '0',
        stopLoss: p.stopLoss ?? '0',
        takeProfit: p.takeProfit ?? '0',
        trailingStop: p.trailingStop ?? '0',
      }));
  }

  /** Get ALL open positions across ALL sub-accounts */
  async getAllPositions(symbol?: string): Promise<{ sub: SubAccount; positions: PositionInfo[] }[]> {
    const subs = this.manager.getAllSubAccounts();
    return Promise.all(
      subs.map(async (sub) => {
        try {
          const positions = await this.getPositions(sub, symbol);
          return { sub, positions };
        } catch (err) {
          console.error(`[${sub.label}] Failed to get positions:`, err);
          return { sub, positions: [] };
        }
      })
    );
  }

  // ═══════════════════════════════════════════
  //  TRADE EXECUTION — Promise.all across accounts
  // ═══════════════════════════════════════════

  /**
   * Place a trade on ALL sub-accounts in a volume tier.
   * Position size should be pre-calculated and scaled per account.
   */
  async executeTrade(tier: VolumeTier, params: TradeParams): Promise<TradeResult[]> {
    return Promise.all(
      tier.subAccounts.map(async (sub) => {
        try {
          const res = await sub.client.submitOrder({
            category: 'linear',
            symbol: params.symbol,
            side: params.side,
            orderType: params.orderType,
            qty: params.qty,
            price: params.price,
            stopLoss: params.stopLoss,
            takeProfit: params.takeProfit,
            tpslMode: params.tpslMode,
            timeInForce: params.timeInForce ?? 'GTC',
            orderLinkId: params.orderLinkId,
          });

          return {
            subAccount: sub,
            success: res.retCode === 0,
            orderId: res.result?.orderId,
            error: res.retCode !== 0 ? res.retMsg : undefined,
          };
        } catch (err: any) {
          return {
            subAccount: sub,
            success: false,
            error: err.message ?? String(err),
          };
        }
      })
    );
  }

  /**
   * Execute a trade on ALL tiers, scaling qty per tier's volume.
   * qtyCalculator receives the volume and returns the qty string for that tier.
   */
  async executeTradeAllTiers(
    params: Omit<TradeParams, 'qty'>,
    qtyCalculator: (volume: number) => string
  ): Promise<TradeResult[]> {
    const tiers = this.manager.getTiers();
    const allResults = await Promise.all(
      tiers.map((tier) =>
        this.executeTrade(tier, {
          ...params,
          qty: qtyCalculator(tier.volume),
        })
      )
    );
    return allResults.flat();
  }

  /** Set SL/TP on an existing position — ALL sub-accounts in a tier */
  async setTradingStop(
    tier: VolumeTier,
    symbol: string,
    stopLoss?: string,
    takeProfit?: string
  ): Promise<TradeResult[]> {
    return Promise.all(
      tier.subAccounts.map(async (sub) => {
        try {
          const params: any = {
            category: 'linear' as const,
            symbol,
            positionIdx: 0,
          };
          if (stopLoss) params.stopLoss = stopLoss;
          if (takeProfit) params.takeProfit = takeProfit;

          const res = await sub.client.setTradingStop(params);
          return {
            subAccount: sub,
            success: res.retCode === 0,
            error: res.retCode !== 0 ? res.retMsg : undefined,
          };
        } catch (err: any) {
          return { subAccount: sub, success: false, error: err.message ?? String(err) };
        }
      })
    );
  }

  /** Set SL/TP on ALL tiers */
  async setTradingStopAllTiers(
    symbol: string,
    stopLoss?: string,
    takeProfit?: string
  ): Promise<TradeResult[]> {
    const tiers = this.manager.getTiers();
    const results = await Promise.all(
      tiers.map((tier) => this.setTradingStop(tier, symbol, stopLoss, takeProfit))
    );
    return results.flat();
  }

  /** Cancel an order on ALL sub-accounts in a tier */
  async cancelOrder(
    tier: VolumeTier,
    symbol: string,
    orderId?: string,
    orderLinkId?: string
  ): Promise<TradeResult[]> {
    return Promise.all(
      tier.subAccounts.map(async (sub) => {
        try {
          const params: any = { category: 'linear' as const, symbol };
          if (orderId) params.orderId = orderId;
          if (orderLinkId) params.orderLinkId = orderLinkId;

          const res = await sub.client.cancelOrder(params);
          return {
            subAccount: sub,
            success: res.retCode === 0,
            error: res.retCode !== 0 ? res.retMsg : undefined,
          };
        } catch (err: any) {
          return { subAccount: sub, success: false, error: err.message ?? String(err) };
        }
      })
    );
  }

  /** Cancel ALL open orders for symbol — ALL tiers */
  async cancelAllOrdersAllTiers(symbol: string): Promise<TradeResult[]> {
    const tiers = this.manager.getTiers();
    const results = await Promise.all(
      tiers.map((tier) =>
        Promise.all(
          tier.subAccounts.map(async (sub) => {
            try {
              const res = await sub.client.cancelAllOrders({
                category: 'linear',
                symbol,
              });
              return { subAccount: sub, success: res.retCode === 0, error: res.retCode !== 0 ? res.retMsg : undefined };
            } catch (err: any) {
              return { subAccount: sub, success: false, error: err.message ?? String(err) };
            }
          })
        )
      )
    );
    return results.flat();
  }

  /** Close a position via market order — ALL sub-accounts in a tier */
  async closePosition(tier: VolumeTier, symbol: string, side: 'Buy' | 'Sell'): Promise<TradeResult[]> {
    // To close: if we're Long (side=Buy), we Sell. If Short (side=Sell), we Buy.
    const closeSide = side === 'Buy' ? 'Sell' : 'Buy';

    return Promise.all(
      tier.subAccounts.map(async (sub) => {
        try {
          // Get current position size
          const positions = await this.getPositions(sub, symbol);
          const pos = positions.find((p) => p.side === side);
          if (!pos || Number(pos.size) === 0) {
            return { subAccount: sub, success: true, error: 'No position to close' };
          }

          const res = await sub.client.submitOrder({
            category: 'linear',
            symbol,
            side: closeSide,
            orderType: 'Market',
            qty: pos.size,
            reduceOnly: true,
          });

          return {
            subAccount: sub,
            success: res.retCode === 0,
            orderId: res.result?.orderId,
            error: res.retCode !== 0 ? res.retMsg : undefined,
          };
        } catch (err: any) {
          return { subAccount: sub, success: false, error: err.message ?? String(err) };
        }
      })
    );
  }

  /** Close position on ALL tiers */
  async closePositionAllTiers(symbol: string, side: 'Buy' | 'Sell'): Promise<TradeResult[]> {
    const tiers = this.manager.getTiers();
    const results = await Promise.all(
      tiers.map((tier) => this.closePosition(tier, symbol, side))
    );
    return results.flat();
  }

  /** Get closed PnL records for a sub-account */
  async getClosedPnl(sub: SubAccount, symbol?: string, limit = 50) {
    const params: any = { category: 'linear' as const, limit };
    if (symbol) params.symbol = symbol;
    const res = await sub.client.getClosedPnL(params);
    return res.result.list;
  }

  /** Get open orders for a sub-account */
  async getOpenOrders(sub: SubAccount, symbol?: string) {
    const params: any = { category: 'linear' as const, settleCoin: 'USDT' };
    if (symbol) params.symbol = symbol;
    const res = await sub.client.getActiveOrders(params);
    return res.result.list;
  }

  /** Set leverage for symbol — ALL tiers */
  async setLeverageAllTiers(symbol: string, leverage: string): Promise<void> {
    const subs = this.manager.getAllSubAccounts();
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await sub.client.setLeverage({
            category: 'linear',
            symbol,
            buyLeverage: leverage,
            sellLeverage: leverage,
          });
        } catch (err: any) {
          // 110043 = leverage not changed — ignore
          if (!err.message?.includes('110043')) {
            console.error(`[${sub.label}] Failed to set leverage:`, err.message);
          }
        }
      })
    );
  }

  // ═══════════════════════════════════════════
  //  ACCESSORS
  // ═══════════════════════════════════════════

  getManager(): AccountManager {
    return this.manager;
  }

  getTiers(): VolumeTier[] {
    return this.manager.getTiers();
  }

  getAllSubAccounts(): SubAccount[] {
    return this.manager.getAllSubAccounts();
  }
}

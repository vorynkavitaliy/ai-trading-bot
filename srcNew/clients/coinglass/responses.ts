export type CgNumeric = number | string;

export interface CgOhlcBar {
  time: number;
  open: CgNumeric;
  high: CgNumeric;
  low: CgNumeric;
  close: CgNumeric;
}

export interface CgPriceOhlcBar extends CgOhlcBar {
  volume_usd: CgNumeric;
}

export interface CgGlobalAccountRatioPoint {
  time: number;
  global_account_long_percent: CgNumeric;
  global_account_short_percent: CgNumeric;
  global_account_long_short_ratio: CgNumeric;
}

export interface CgTopAccountRatioPoint {
  time: number;
  top_account_long_percent: CgNumeric;
  top_account_short_percent: CgNumeric;
  top_account_long_short_ratio: CgNumeric;
}

export interface CgTopPositionRatioPoint {
  time: number;
  top_position_long_percent: CgNumeric;
  top_position_short_percent: CgNumeric;
  top_position_long_short_ratio: CgNumeric;
}

export interface CgLiquidationHistoryPoint {
  time: number;
  long_liquidation_usd: CgNumeric;
  short_liquidation_usd: CgNumeric;
}

export interface CgOrderbookHistoryPoint {
  time: number;
  bids_usd: CgNumeric;
  bids_quantity: CgNumeric;
  asks_usd: CgNumeric;
  asks_quantity: CgNumeric;
}

export interface CgLiquidationCoin {
  symbol: string;
  liquidation_usd_24h: CgNumeric;
  long_liquidation_usd_24h: CgNumeric;
  short_liquidation_usd_24h: CgNumeric;
  liquidation_usd_12h: CgNumeric;
  long_liquidation_usd_12h: CgNumeric;
  short_liquidation_usd_12h: CgNumeric;
  liquidation_usd_4h: CgNumeric;
  long_liquidation_usd_4h: CgNumeric;
  short_liquidation_usd_4h: CgNumeric;
  liquidation_usd_1h: CgNumeric;
  long_liquidation_usd_1h: CgNumeric;
  short_liquidation_usd_1h: CgNumeric;
}

export interface CgLiquidationExchange {
  exchange: string;
  liquidation_usd: CgNumeric;
  long_liquidation_usd: CgNumeric;
  short_liquidation_usd: CgNumeric;
}

export interface CgOpenInterestExchange {
  exchange: string;
  symbol: string;
  open_interest_usd: CgNumeric;
  open_interest_quantity: CgNumeric;
  open_interest_by_stable_coin_margin: CgNumeric;
  open_interest_quantity_by_coin_margin: CgNumeric;
  open_interest_quantity_by_stable_coin_margin: CgNumeric;
  open_interest_change_percent_5m: CgNumeric;
  open_interest_change_percent_15m: CgNumeric;
  open_interest_change_percent_30m: CgNumeric;
  open_interest_change_percent_1h: CgNumeric;
  open_interest_change_percent_4h: CgNumeric;
  open_interest_change_percent_24h: CgNumeric;
}

export interface CgTakerVolumeExchangeRow {
  exchange: string;
  buy_ratio: CgNumeric;
  sell_ratio: CgNumeric;
  buy_vol_usd: CgNumeric;
  sell_vol_usd: CgNumeric;
}

export interface CgTakerVolumeSnapshot {
  symbol: string;
  buy_ratio: CgNumeric;
  sell_ratio: CgNumeric;
  buy_vol_usd: CgNumeric;
  sell_vol_usd: CgNumeric;
  exchange_list: CgTakerVolumeExchangeRow[];
}

export interface CgInstrument {
  instrument_id: string;
  base_asset: string;
  quote_asset: string;
  settlement_currency?: string;
  max_leverage?: CgNumeric;
  funding_interval?: CgNumeric;
  price_tick_size?: CgNumeric;
}

export interface CgCoinMarket {
  symbol: string;
  current_price: CgNumeric;
  avg_funding_rate_by_oi: CgNumeric;
  avg_funding_rate_by_vol: CgNumeric;
  market_cap_usd: CgNumeric;
  open_interest_usd: CgNumeric;
  open_interest_quantity: CgNumeric;
  open_interest_market_cap_ratio: CgNumeric;
  open_interest_volume_ratio: CgNumeric;
}

export interface CgPairMarket {
  instrument_id: string;
  exchange_name: string;
  symbol: string;
  current_price: CgNumeric;
  index_price: CgNumeric;
  volume_usd: CgNumeric;
  open_interest_usd: CgNumeric;
  open_interest_quantity: CgNumeric;
  funding_rate: CgNumeric;
  next_funding_time?: number;
  long_liquidation_usd_24h: CgNumeric;
  short_liquidation_usd_24h: CgNumeric;
}

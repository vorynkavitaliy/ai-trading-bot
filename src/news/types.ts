export type NewsImpact = 'high' | 'medium' | 'low' | 'noise';

export type NewsCategory =
  | 'fomc'
  | 'cpi'
  | 'nfp'
  | 'rate_decision'
  | 'etf_flow'
  | 'regulation'
  | 'hack'
  | 'geopolitics'
  | 'whale'
  | 'stablecoin'
  | 'exchange_event'
  | 'protocol_upgrade'
  | 'macro_event'
  | 'other';

export interface NewsItem {
  ts: number;                     // unix ms
  source: 'cryptopanic' | 'forexfactory' | 'investing' | 'websearch';
  category: NewsCategory;
  impact: NewsImpact;
  symbolsAffected: string[];      // ['BTC', 'ETH'] etc, empty if macro
  title: string;
  url?: string;
  rawPayload?: Record<string, unknown>;
}

export interface CalendarEvent {
  ts: number;                     // event time, unix ms
  country: string;                // 'USD' | 'EUR' | 'CNY' etc (FF currency code)
  title: string;
  impact: 'high' | 'medium' | 'low';
  forecast?: string;
  previous?: string;
  source: 'forexfactory';
}

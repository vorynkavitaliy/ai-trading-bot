import { NewsCategory, NewsImpact, NewsItem } from './types';

interface Pattern {
  pattern: RegExp;
  category: NewsCategory;
  impact: NewsImpact;
}

// Patterns ordered: most specific first. The first match wins.
const PATTERNS: Pattern[] = [
  // Macro — high impact
  { pattern: /\bFOMC\b|\bfederal\s+reserve\b|\bfed\s+(rate|decision|chair|powell)/i, category: 'fomc', impact: 'high' },
  { pattern: /\bCPI\b|\binflation\s+(report|data|reading|prints?)/i, category: 'cpi', impact: 'high' },
  { pattern: /\bNFP\b|\bnonfarm\s+payrolls\b|\bjobs\s+report\b/i, category: 'nfp', impact: 'high' },
  { pattern: /\b(ECB|BOE|BOJ|PBOC)\s+(rate|decision|cuts?|hikes?)/i, category: 'rate_decision', impact: 'high' },
  { pattern: /\bPCE\b|\bGDP\s+(report|data|prints?)/i, category: 'macro_event', impact: 'high' },

  // ETF — high impact (BlackRock IBIT, Fidelity FBTC, etc)
  { pattern: /\b(IBIT|FBTC|GBTC|ARKB|BITB|HODL|BRRR|BTCO|EZBC|DEFI)\b/i, category: 'etf_flow', impact: 'high' },
  { pattern: /\bspot\s+(bitcoin|btc|ether|eth)\s+ETF\b|\b(bitcoin|btc|ether|eth)\s+spot\s+ETF\b/i, category: 'etf_flow', impact: 'high' },
  { pattern: /\b(BlackRock|Fidelity|Grayscale|Ark\s+Invest)\b.*\b(inflow|outflow|holdings|btc|bitcoin|eth|ether)/i, category: 'etf_flow', impact: 'high' },

  // Regulation — medium-high
  { pattern: /\b(SEC|CFTC)\b.*(crypto|bitcoin|ether|approves|rejects|sues|charges)/i, category: 'regulation', impact: 'high' },
  { pattern: /\b(MiCA|tax|regulator|enforcement)\b.*(crypto|bitcoin|ether)/i, category: 'regulation', impact: 'medium' },
  { pattern: /\b(Senate|House|Congress|Treasury|White\s+House)\b.*(crypto|bitcoin|ether)/i, category: 'regulation', impact: 'medium' },

  // Hacks / Exploits — high impact
  { pattern: /\b(hack(ed)?|exploit(ed)?|drain(ed)?|stolen|breach|rug\s+pull)\b/i, category: 'hack', impact: 'high' },
  { pattern: /\bbridge\s+(hack|exploit|drained)\b/i, category: 'hack', impact: 'high' },

  // Geopolitics — medium-high
  { pattern: /\b(war|invasion|sanctions|missile|nuclear|conflict)\b.*(Russia|China|Iran|Israel|Ukraine|Taiwan|North\s+Korea)/i, category: 'geopolitics', impact: 'high' },
  { pattern: /\b(Russia|China|Iran|Israel|Ukraine|Taiwan|North\s+Korea)\b.*(war|invasion|sanctions|missile)/i, category: 'geopolitics', impact: 'high' },
  { pattern: /\btariffs?\b|\btrade\s+war\b/i, category: 'geopolitics', impact: 'medium' },

  // Whale moves — medium impact
  { pattern: /\b(whale|large\s+holder)\b.*(transfer|moved|sold|bought|deposit|withdraw)/i, category: 'whale', impact: 'medium' },
  { pattern: /\b\d{3,5}\s+(BTC|ETH)\s+(transferred|moved|sent|deposited|withdrawn)/i, category: 'whale', impact: 'medium' },

  // Stablecoin flows
  { pattern: /\b(USDT|USDC|Tether|Circle)\b.*(mint(ed)?|burn(ed)?|issuance|inflow|outflow|supply)/i, category: 'stablecoin', impact: 'medium' },

  // Exchange events
  { pattern: /\b(Binance|OKX|Bybit|Coinbase|Kraken|Bitfinex|Bitget)\b.*(outage|down|hack|halts?|delist|listing|withdrawal|deposit|suspend|resume)/i, category: 'exchange_event', impact: 'medium' },

  // Protocol upgrades
  { pattern: /\b(Ethereum|Bitcoin|Solana)\b.*(upgrade|hard\s+fork|halving|merge|update)/i, category: 'protocol_upgrade', impact: 'medium' },

  // Memecoin / hype noise
  { pattern: /\b(meme|memecoin|elon|trump\s+coin|TRUMP|PEPE|SHIB|DOGE)\b.*(pump|dump|moon|tweet)/i, category: 'other', impact: 'noise' },
  { pattern: /\binfluencer\b|\b(\w+\s+coin)\s+(launches|debuts)/i, category: 'other', impact: 'noise' },
];

export function classify(text: string, source: NewsItem['source']): { category: NewsCategory; impact: NewsImpact } {
  for (const p of PATTERNS) {
    if (p.pattern.test(text)) {
      return { category: p.category, impact: p.impact };
    }
  }
  return { category: 'other', impact: 'low' };
}

const SYMBOL_PATTERNS: Array<{ re: RegExp; sym: string }> = [
  { re: /\b(bitcoin|btc)\b/i, sym: 'BTC' },
  { re: /\b(ether(eum)?|eth)\b/i, sym: 'ETH' },
];

export function extractSymbols(text: string): string[] {
  const found = new Set<string>();
  for (const { re, sym } of SYMBOL_PATTERNS) {
    if (re.test(text)) found.add(sym);
  }
  return [...found];
}

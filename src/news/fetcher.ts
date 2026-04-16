import { config } from '../config';

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  pubDate: number;
  summary?: string;
}

export interface FearGreedData {
  value: number;          // 0-100
  classification: string; // "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
}

export interface MacroAssessment {
  bias: 'risk-on' | 'risk-off' | 'neutral';
  impact: 'high' | 'medium' | 'low';
  /** Risk multiplier: 1.0 = normal, 0.5 = halve size during high-impact, 0.25 = extreme caution */
  riskMultiplier: number;
  fearGreed?: FearGreedData;
  reason: string;
  triggers: string[];
  items: NewsItem[];
}

const HIGH_IMPACT_KEYWORDS = [
  'fed', 'fomc', 'rate decision', 'rate hike', 'rate cut', 'powell',
  'cpi', 'inflation', 'jobs report', 'nfp', 'unemployment',
  'blackrock', 'etf approval', 'etf outflow', 'etf inflow', 'sec', 'lawsuit',
  'hack', 'exploit', 'collapse', 'bankruptcy', 'liquidation',
  'war', 'sanction', 'china', 'tariff', 'iran', 'blockade',
  'peace talks', 'ceasefire', 'missile', 'nuclear',
  'default', 'debt ceiling', 'shutdown',
];

const RISK_OFF_KEYWORDS = [
  'hike', 'collapse', 'crash', 'hack', 'exploit', 'lawsuit', 'sanction',
  'war', 'bankruptcy', 'liquidation', 'risk-off', 'outflow', 'sell-off',
  'bear', 'plunge', 'dump', 'fear', 'panic', 'blockade', 'missile',
  'escalat', 'tariff', 'default', 'shutdown', 'hawkish',
];

const RISK_ON_KEYWORDS = [
  'cut', 'approval', 'inflow', 'launch', 'partnership', 'adoption',
  'bullish', 'rally', 'surge', 'pump', 'breakout', 'recovery',
  'ceasefire', 'peace', 'dovish', 'stimulus', 'easing',
];

/**
 * Multi-source news fetcher:
 *   1. RSS feeds (CoinDesk, CoinTelegraph)
 *   2. Google News RSS (crypto + bitcoin)
 *   3. CryptoPanic API (free, with sentiment)
 *   4. Fear & Greed Index (Alternative.me)
 */
export class NewsFetcher {
  private cache: NewsItem[] = [];
  private lastFetched = 0;
  private fearGreedCache: FearGreedData | null = null;
  private fearGreedLastAt = 0;
  private readonly minIntervalMs = 5 * 60 * 1000;

  async fetchAll(): Promise<NewsItem[]> {
    if (Date.now() - this.lastFetched < this.minIntervalMs && this.cache.length) {
      return this.cache;
    }

    const sources = await Promise.all([
      // RSS feeds from config
      ...config.news.feeds.map((url) => this.fetchFeed(url).catch(() => [])),
      // Google News RSS — broad crypto coverage
      this.fetchFeed('https://news.google.com/rss/search?q=bitcoin+crypto+market&hl=en&gl=US&ceid=US:en').catch(() => []),
      this.fetchFeed('https://news.google.com/rss/search?q=crypto+crash+OR+rally+OR+fed+OR+tariff&hl=en&gl=US&ceid=US:en').catch(() => []),
      // CryptoPanic (free public API)
      this.fetchCryptoPanic().catch(() => []),
    ]);

    // Deduplicate by title similarity
    const flat = sources.flat().sort((a, b) => b.pubDate - a.pubDate);
    const seen = new Set<string>();
    const deduped: NewsItem[] = [];
    for (const item of flat) {
      const key = item.title.toLowerCase().slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
      if (deduped.length >= 80) break;
    }

    this.cache = deduped;
    this.lastFetched = Date.now();
    return deduped;
  }

  private async fetchFeed(url: string): Promise<NewsItem[]> {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'claude-trading-bot/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml);
  }

  /** CryptoPanic free API — real-time crypto news with sentiment */
  private async fetchCryptoPanic(): Promise<NewsItem[]> {
    const url = 'https://cryptopanic.com/api/free/v1/posts/?public=true&kind=news';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'claude-trading-bot/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    if (!data.results) return [];
    return data.results.slice(0, 30).map((r: any) => ({
      title: r.title ?? '',
      source: 'cryptopanic',
      link: r.url ?? '',
      pubDate: Date.parse(r.published_at) || Date.now(),
      summary: r.title,
    }));
  }

  /** Fear & Greed Index from Alternative.me */
  async fetchFearGreed(): Promise<FearGreedData | null> {
    if (this.fearGreedCache && Date.now() - this.fearGreedLastAt < 30 * 60_000) {
      return this.fearGreedCache;
    }
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=1', {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return this.fearGreedCache;
      const data = await res.json() as any;
      const entry = data?.data?.[0];
      if (!entry) return this.fearGreedCache;
      this.fearGreedCache = {
        value: Number(entry.value),
        classification: entry.value_classification,
      };
      this.fearGreedLastAt = Date.now();
      return this.fearGreedCache;
    } catch {
      return this.fearGreedCache;
    }
  }

  /** Assess news from the last `windowMin` minutes for macro impact */
  async assess(windowMin = 60): Promise<MacroAssessment> {
    const [items, fearGreed] = await Promise.all([
      this.fetchAll(),
      this.fetchFearGreed(),
    ]);

    const cutoff = Date.now() - windowMin * 60_000;
    const recent = items.filter((i) => i.pubDate >= cutoff);

    const triggers: string[] = [];
    let riskOff = 0, riskOn = 0, high = 0;

    for (const it of recent) {
      const t = (it.title + ' ' + (it.summary ?? '')).toLowerCase();
      const matchedHigh = HIGH_IMPACT_KEYWORDS.filter((k) => t.includes(k));
      if (matchedHigh.length) { high++; triggers.push(`${matchedHigh[0]}: ${it.title.slice(0, 80)}`); }
      if (RISK_OFF_KEYWORDS.some((k) => t.includes(k))) riskOff++;
      if (RISK_ON_KEYWORDS.some((k) => t.includes(k))) riskOn++;
    }

    // Fear & Greed adds weight to bias
    if (fearGreed) {
      if (fearGreed.value <= 25) { riskOff += 2; triggers.push(`Fear&Greed: ${fearGreed.value} (${fearGreed.classification})`); }
      else if (fearGreed.value <= 40) { riskOff += 1; }
      else if (fearGreed.value >= 75) { riskOn += 2; triggers.push(`Fear&Greed: ${fearGreed.value} (${fearGreed.classification})`); }
      else if (fearGreed.value >= 60) { riskOn += 1; }
    }

    let bias: MacroAssessment['bias'] = 'neutral';
    if (riskOff > riskOn + 1) bias = 'risk-off';
    else if (riskOn > riskOff + 1) bias = 'risk-on';

    const impact: MacroAssessment['impact'] = high >= 3 ? 'high' : high >= 1 ? 'medium' : 'low';

    // Risk multiplier — scale down position size based on news intensity
    // Not a block — we still trade, but adjust size to match the environment
    let riskMultiplier = 1.0;
    if (impact === 'high') riskMultiplier = 0.25;               // extreme caution
    else if (impact === 'medium') riskMultiplier = 0.5;          // reduce size
    if (fearGreed && fearGreed.value <= 15) riskMultiplier *= 0.5; // extreme fear = extra caution

    return {
      bias,
      impact,
      riskMultiplier,
      fearGreed: fearGreed ?? undefined,
      reason: `sources=${items.length}, recent=${recent.length}, high=${high}, off=${riskOff}, on=${riskOn}` +
        (fearGreed ? `, F&G=${fearGreed.value}` : '') +
        (riskMultiplier < 1 ? `, risk×${riskMultiplier}` : ''),
      triggers: triggers.slice(0, 8),
      items: recent.slice(0, 15),
    };
  }
}

// ─── Minimal RSS/Atom parser (no external dep) ───
function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const isAtom = /<feed[\s>]/.test(xml);

  if (isAtom) {
    const entryRegex = /<entry[\s\S]*?<\/entry>/g;
    for (const m of xml.match(entryRegex) ?? []) {
      const title = pick(m, 'title');
      const link = /<link[^>]*href="([^"]+)"/.exec(m)?.[1] ?? '';
      const updated = pick(m, 'updated') ?? pick(m, 'published') ?? '';
      const summary = pick(m, 'summary') ?? pick(m, 'content') ?? '';
      if (title) items.push({ title: stripTags(title), source: 'atom', link, pubDate: Date.parse(updated) || Date.now(), summary: stripTags(summary).slice(0, 300) });
    }
  } else {
    const itemRegex = /<item[\s\S]*?<\/item>/g;
    for (const m of xml.match(itemRegex) ?? []) {
      const title = pick(m, 'title');
      const link = pick(m, 'link') ?? '';
      const pub = pick(m, 'pubDate') ?? pick(m, 'dc:date') ?? '';
      const desc = pick(m, 'description') ?? '';
      if (title) items.push({ title: stripTags(title), source: 'rss', link: stripTags(link), pubDate: Date.parse(pub) || Date.now(), summary: stripTags(desc).slice(0, 300) });
    }
  }
  return items;
}

function pick(s: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(s);
  return m?.[1]?.trim();
}

function stripTags(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

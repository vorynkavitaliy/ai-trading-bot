import { NewsItem } from './types';
import { classify, extractSymbols } from './classifier';
import { log } from '../lib/logger';

// CryptoPanic v1 free endpoint. With CRYPTOPANIC_API_KEY in .env: 1000 req/day.
// Without key: 50 req/day public endpoint, fallback.
const BASE = 'https://cryptopanic.com/api/free/v1/posts/';

interface CpPost {
  id: number;
  kind: string;
  title: string;
  published_at: string;
  url: string;
  source?: { title: string; domain: string };
  currencies?: Array<{ code: string; title: string }>;
  votes?: { positive: number; negative: number; important: number };
}

interface CpResponse {
  count: number;
  results: CpPost[];
}

export async function fetchCryptopanic(opts: { currencies?: string[]; filter?: 'rising' | 'hot' | 'bullish' | 'bearish' | 'important' | 'saved' | 'lol'; pages?: number } = {}): Promise<NewsItem[]> {
  const apiKey = process.env.CRYPTOPANIC_API_KEY;
  const params = new URLSearchParams();
  if (apiKey) params.set('auth_token', apiKey);
  params.set('public', 'true');
  if (opts.currencies?.length) params.set('currencies', opts.currencies.join(','));
  if (opts.filter) params.set('filter', opts.filter);

  const all: NewsItem[] = [];
  const pages = opts.pages ?? 1;
  let nextUrl: string | null = `${BASE}?${params.toString()}`;
  let pageNum = 0;

  while (nextUrl && pageNum < pages) {
    let res: Response;
    try {
      res = await fetch(nextUrl, { headers: { Accept: 'application/json' } });
    } catch (e: any) {
      log.warn('cryptopanic fetch failed', { err: e?.message ?? String(e) });
      break;
    }
    if (!res.ok) {
      // 404/401 commonly mean: free public endpoint requires CRYPTOPANIC_API_KEY now.
      // Don't fail the cycle — let the operator set the key when convenient. The
      // calendar source still works.
      if (!apiKey) {
        log.info('cryptopanic free public endpoint unavailable; set CRYPTOPANIC_API_KEY in .env to enable', {
          status: res.status,
        });
      } else {
        log.warn('cryptopanic non-200', { status: res.status });
      }
      break;
    }
    const json = (await res.json()) as CpResponse & { next?: string | null };
    for (const post of json.results) {
      const ts = new Date(post.published_at).getTime();
      const { category, impact } = classify(post.title, 'cryptopanic');
      const symbolsFromCp = (post.currencies ?? []).map(c => c.code.toUpperCase());
      const symbolsFromText = extractSymbols(post.title);
      const symbols = [...new Set([...symbolsFromCp, ...symbolsFromText])];
      all.push({
        ts,
        source: 'cryptopanic',
        category,
        impact,
        symbolsAffected: symbols,
        title: post.title,
        url: post.url,
        rawPayload: { id: post.id, kind: post.kind, source: post.source?.domain, votes: post.votes },
      });
    }
    nextUrl = json.next ?? null;
    pageNum++;
  }
  return all;
}

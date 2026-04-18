/**
 * Тонкий переводчик заголовков новостей на русский через бесплатный
 * Google Translate endpoint. Кэширует в Redis на 24 часа по hash строки.
 *
 * Не требует API-ключа. Graceful fallback: если endpoint недоступен, возвращает исходный текст.
 */
import { createHash } from 'crypto';
import { cache } from '../cache';

const CACHE_TTL_SEC = 24 * 60 * 60; // 24h

function hash(s: string): string {
  return createHash('md5').update(s).digest('hex').slice(0, 12);
}

async function translateOne(text: string): Promise<string> {
  if (!text || text.length < 3) return text;
  // Пропускаем чисто-ASCII строки короче 10 символов (тикеры, цифры)
  if (text.length < 10 && /^[\x20-\x7E]+$/.test(text)) return text;

  const key = `tx:ru:${hash(text)}`;
  try {
    const cached = await cache.getRaw(key);
    if (cached) return cached;
  } catch {
    // cache unavailable — proceed
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return text;
    const data = (await res.json()) as any;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return text;
    const translated = (data[0] as any[])
      .map((seg: any[]) => seg[0])
      .filter(Boolean)
      .join('');
    const result = translated || text;
    try {
      await cache.setRaw(key, result, CACHE_TTL_SEC);
    } catch {
      /* ignore cache write errors */
    }
    return result;
  } catch {
    return text;
  }
}

/**
 * Перевод массива заголовков на русский. Параллельно.
 * Возвращает массив той же длины. На ошибку → исходный текст.
 */
export async function translateHeadlines(headlines: string[]): Promise<string[]> {
  if (headlines.length === 0) return [];
  return Promise.all(headlines.map(translateOne));
}

export { translateOne };

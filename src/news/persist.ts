import { query } from '../lib/db';
import { NewsItem } from './types';

export async function persistNews(items: NewsItem[]): Promise<number> {
  if (items.length === 0) return 0;
  // Use (ts, source, title) as logical dedup key — DB has no unique index on it, so we
  // explicitly check before insert. Trade-off: O(N) lookups; OK for batches < 200.
  let inserted = 0;
  for (const it of items) {
    const exists = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM news_events WHERE ts = $1 AND source = $2 AND title = $3`,
      [it.ts, it.source, it.title]
    );
    if (parseInt(exists.rows[0]?.c ?? '0', 10) > 0) continue;
    await query(
      `INSERT INTO news_events (ts, source, category, impact, symbols_affected, title, url, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        it.ts, it.source, it.category, it.impact,
        it.symbolsAffected.length > 0 ? it.symbolsAffected : null,
        it.title.slice(0, 1000),
        it.url ?? null,
        it.rawPayload ? JSON.stringify(it.rawPayload) : null,
      ]
    );
    inserted++;
  }
  return inserted;
}

export async function recentHighImpact(sinceMs: number, untilMs: number = Date.now()): Promise<Array<{
  ts: number; impact: string; category: string; title: string; symbols: string[] | null;
}>> {
  const r = await query<any>(
    `SELECT ts::text, impact, category, title, symbols_affected
     FROM news_events
     WHERE impact IN ('high', 'medium') AND ts BETWEEN $1 AND $2
     ORDER BY ts DESC LIMIT 50`,
    [sinceMs, untilMs]
  );
  return r.rows.map((row) => ({
    ts: parseInt(row.ts, 10),
    impact: row.impact,
    category: row.category,
    title: row.title,
    symbols: row.symbols_affected,
  }));
}

import fs from 'node:fs';
import path from 'node:path';
import { fetchCryptopanic } from './cryptopanic';
import { fetchForexFactory, nearestEvents, inHighImpactWindow } from './calendar';
import { persistNews } from './persist';
import { CalendarEvent } from './types';
import { log } from '../lib/logger';

const VAULT_WATCHLIST = path.resolve(__dirname, '../../vault/Watchlist');

function fmtTime(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function writeCatalysts(events: CalendarEvent[]): void {
  fs.mkdirSync(VAULT_WATCHLIST, { recursive: true });
  const target = path.join(VAULT_WATCHLIST, 'catalysts.md');
  const now = new Date();
  const upcoming = nearestEvents(events, now, 72)
    .filter(e => e.impact === 'high' || e.impact === 'medium');     // skip low-impact noise

  const lines: string[] = [
    `# Forward Calendar — High/Medium-impact events`,
    ``,
    `_Last updated: ${now.toISOString()}_`,
    `_Source: ForexFactory weekly RSS (faireconomy mirror)_`,
    ``,
    `## Next 72 hours (medium + high impact only)`,
    ``,
  ];
  if (upcoming.length === 0) {
    lines.push('_No events scheduled in window._', '');
  } else {
    lines.push(
      '| Time (UTC) | Country | Impact | Event | Forecast | Previous |',
      '|---|---|---|---|---|---|'
    );
    for (const e of upcoming) {
      const impactIcon = e.impact === 'high' ? '🔴 high' : e.impact === 'medium' ? '🟠 med' : '⚪ low';
      lines.push(`| ${fmtTime(e.ts)} | ${e.country} | ${impactIcon} | ${e.title} | ${e.forecast ?? ''} | ${e.previous ?? ''} |`);
    }
    lines.push('');
  }
  // Mark currently-active high impact window
  const activeHi = inHighImpactWindow(events, now);
  if (activeHi) {
    lines.push(
      `## ⚠️ Active high-impact window`, ``,
      `**${activeHi.title}** (${activeHi.country}) at ${fmtTime(activeHi.ts)} — within ±30 min.`,
      `Action: skip new entries; tighten open SLs to breakeven if in profit.`,
      ``
    );
  }
  fs.writeFileSync(target, lines.join('\n'));
  log.info('catalysts written', { path: target, upcoming: upcoming.length, activeHigh: activeHi?.title ?? null });
}

export async function runNewsFetch(): Promise<{ newsInserted: number; calendarEvents: number; activeHighImpact: string | null }> {
  log.info('news fetch start');
  // Crypto news for BTC and ETH (also general macro will leak through)
  const cryptoNews = await fetchCryptopanic({ currencies: ['BTC', 'ETH'], pages: 1 });
  log.info('cryptopanic fetched', { count: cryptoNews.length });
  const inserted = await persistNews(cryptoNews);
  log.info('cryptopanic persisted', { newRows: inserted });

  // Macro calendar
  const calendar = await fetchForexFactory();
  log.info('forexfactory fetched', { events: calendar.length });
  writeCatalysts(calendar);

  const active = inHighImpactWindow(calendar, new Date());
  return {
    newsInserted: inserted,
    calendarEvents: calendar.length,
    activeHighImpact: active?.title ?? null,
  };
}

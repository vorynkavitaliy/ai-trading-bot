import { CalendarEvent } from './types';
import { log } from '../lib/logger';

// ForexFactory weekly RSS via faireconomy mirror (XML, no auth).
const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';

interface FfRawEvent {
  title: string;
  country: string;
  date: string;
  impact: string;     // 'High' | 'Medium' | 'Low' | 'Holiday' | 'Holiday Mention'
  forecast?: string;
  previous?: string;
}

// Naive XML parser sufficient for FF's flat structure.
function parseFf(xml: string): FfRawEvent[] {
  const out: FfRawEvent[] = [];
  const eventRegex = /<event>([\s\S]*?)<\/event>/g;
  let m: RegExpExecArray | null;
  while ((m = eventRegex.exec(xml))) {
    const block = m[1];
    const get = (tag: string) => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
      if (!r) return undefined;
      // Strip CDATA wrapper if present
      return r[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
    };
    out.push({
      title: get('title') ?? '',
      country: get('country') ?? '',
      date: get('date') ?? '',
      impact: get('impact') ?? 'Low',
      forecast: get('forecast'),
      previous: get('previous'),
    });
  }
  return out;
}

export async function fetchForexFactory(): Promise<CalendarEvent[]> {
  let res: Response;
  try {
    res = await fetch(FF_URL, { headers: { Accept: 'application/xml' } });
  } catch (e: any) {
    log.warn('forexfactory fetch failed', { err: e?.message ?? String(e) });
    return [];
  }
  if (!res.ok) {
    log.warn('forexfactory non-200', { status: res.status });
    return [];
  }
  const xml = await res.text();
  const raw = parseFf(xml);

  const events: CalendarEvent[] = [];
  for (const r of raw) {
    const impactMap: Record<string, CalendarEvent['impact'] | undefined> = {
      High: 'high', Medium: 'medium', Low: 'low',
    };
    const impact = impactMap[r.impact];
    if (!impact) continue;                              // skip Holiday entries
    const ts = new Date(r.date).getTime();
    if (!Number.isFinite(ts)) continue;
    events.push({
      ts,
      country: r.country,
      title: r.title,
      impact,
      forecast: r.forecast,
      previous: r.previous,
      source: 'forexfactory',
    });
  }
  return events;
}

export function nearestEvents(events: CalendarEvent[], now: Date, windowHours = 36): CalendarEvent[] {
  const nowMs = now.getTime();
  const horizon = nowMs + windowHours * 3600_000;
  return events
    .filter(e => e.ts >= nowMs - 30 * 60_000 && e.ts <= horizon)   // include events that started within last 30 min
    .sort((a, b) => a.ts - b.ts);
}

export function inHighImpactWindow(events: CalendarEvent[], now: Date, beforeMin = 30, afterMin = 30): CalendarEvent | null {
  const nowMs = now.getTime();
  for (const e of events) {
    if (e.impact !== 'high') continue;
    const start = e.ts - beforeMin * 60_000;
    const end = e.ts + afterMin * 60_000;
    if (nowMs >= start && nowMs <= end) return e;
  }
  return null;
}

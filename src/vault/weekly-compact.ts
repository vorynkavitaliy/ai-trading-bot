import fs from 'node:fs';
import path from 'node:path';
import { log } from '../lib/logger';

const VAULT_JOURNAL = path.resolve(__dirname, '../../vault/Journal');
const WEEKLY_DIR = path.join(VAULT_JOURNAL, '_weekly');

// ISO 8601 week number (Mon-start, Mon=1; per ISO Sun is end of week).
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;          // Mon = 0, Sun = 6
  t.setUTCDate(t.getUTCDate() - dayNum + 3);       // nearest Thursday
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: t.getUTCFullYear(), week };
}

function dateForFile(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
}

export interface CompactResult {
  weekKey: string;                  // 'YYYY-Www'
  filesCompacted: number;
  weeklyFile: string;
  removedDailyFiles: string[];
}

/**
 * Compact closed-week dailies into a single weekly file. By default operates on
 * the week ending on the Sunday before `now`. Dailies from the **current** ISO week
 * are NEVER touched.
 */
export async function compactClosedWeek(now: Date = new Date()): Promise<CompactResult | null> {
  if (!fs.existsSync(VAULT_JOURNAL)) {
    log.warn('vault/Journal does not exist — nothing to compact');
    return null;
  }
  fs.mkdirSync(WEEKLY_DIR, { recursive: true });

  const currentWeek = isoWeek(now);
  // Find dailies belonging to a closed week (ISO week strictly before current)
  const allFiles = fs.readdirSync(VAULT_JOURNAL).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  const grouped = new Map<string, string[]>();        // weekKey → file names
  for (const f of allFiles) {
    const d = dateForFile(f);
    if (!d) continue;
    const w = isoWeek(d);
    const isCurrentWeek = w.year === currentWeek.year && w.week === currentWeek.week;
    if (isCurrentWeek) continue;
    const isFutureWeek = w.year > currentWeek.year || (w.year === currentWeek.year && w.week > currentWeek.week);
    if (isFutureWeek) continue;
    const key = `${w.year}-W${String(w.week).padStart(2, '0')}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(f);
  }

  if (grouped.size === 0) {
    log.info('weekly-compact: no closed-week dailies to compact');
    return null;
  }

  // Pick the most recent closed week first (only one weekly per run is enough; cron will catch up).
  const sortedKeys = [...grouped.keys()].sort();
  const weekKey = sortedKeys[sortedKeys.length - 1];
  const files = grouped.get(weekKey)!.sort();

  const weeklyFile = path.join(WEEKLY_DIR, `${weekKey}.md`);
  if (fs.existsSync(weeklyFile)) {
    log.warn('weekly-compact: target weekly already exists, refusing overwrite', { weeklyFile });
    return null;
  }

  const lines: string[] = [
    `# Weekly Journal — ${weekKey}`,
    '',
    `_Compacted from ${files.length} daily files on ${now.toISOString()}._`,
    '',
  ];
  for (const f of files) {
    const dailyContent = fs.readFileSync(path.join(VAULT_JOURNAL, f), 'utf-8').trim();
    lines.push(`## ${f.replace('.md', '')}`, '', dailyContent, '');
  }
  fs.writeFileSync(weeklyFile, lines.join('\n'));
  log.info('weekly compacted', { weekKey, files: files.length, weeklyFile });

  const removed: string[] = [];
  for (const f of files) {
    const p = path.join(VAULT_JOURNAL, f);
    fs.unlinkSync(p);
    removed.push(f);
  }
  return { weekKey, filesCompacted: files.length, weeklyFile, removedDailyFiles: removed };
}

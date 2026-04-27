/**
 * Archive vault runtime files older than N days into {dir}/archive/{YYYY-MM}/ subdirs.
 *
 * Run monthly (or as needed) to keep the working directories small while preserving
 * full history in git.
 *
 * Usage:
 *   npx tsx src/archive-vault.ts                    # default: archive >60 days old
 *   npx tsx src/archive-vault.ts --days 90          # archive >90 days old
 *   npx tsx src/archive-vault.ts --dry-run          # preview only, no moves
 *
 * Convention: filenames must start with YYYY-MM-DD prefix to be considered.
 *   Journal/2026-04-17.md → Journal/archive/2026-04/2026-04-17.md
 *   Trades/2026-04-17_BTCUSDT_long.md → Trades/archive/2026-04/2026-04-17_BTCUSDT_long.md
 *   Postmortem/2026-04-17_BTCUSDT_long.md → Postmortem/archive/2026-04/2026-04-17_BTCUSDT_long.md
 *
 * Files without YYYY-MM-DD prefix (templates, _index.md, etc.) are left untouched.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const VAULT_DIRS = ['Journal', 'Trades', 'Postmortem'];
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function parseArgs() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 60;
  const dryRun = args.includes('--dry-run');
  return { days, dryRun };
}

async function archiveDir(rootDir: string, dir: string, cutoffMs: number, dryRun: boolean) {
  const fullDir = path.join(rootDir, 'vault', dir);
  let entries: string[];
  try {
    entries = await fs.readdir(fullDir);
  } catch {
    return { moved: 0, skipped: 0 };
  }

  let moved = 0;
  let skipped = 0;

  for (const name of entries) {
    if (name === 'archive' || name.startsWith('_')) { skipped++; continue; }
    const m = DATE_PREFIX.exec(name);
    if (!m) { skipped++; continue; }
    const fileDate = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
    if (fileDate >= cutoffMs) { skipped++; continue; }

    const yearMonth = `${m[1]}-${m[2]}`;
    const archiveDirPath = path.join(fullDir, 'archive', yearMonth);
    const oldPath = path.join(fullDir, name);
    const newPath = path.join(archiveDirPath, name);

    if (dryRun) {
      console.log(`[dry-run] ${dir}/${name} → ${dir}/archive/${yearMonth}/${name}`);
    } else {
      await fs.mkdir(archiveDirPath, { recursive: true });
      await fs.rename(oldPath, newPath);
      console.log(`moved: ${dir}/${name} → archive/${yearMonth}/`);
    }
    moved++;
  }
  return { moved, skipped };
}

async function main() {
  const { days, dryRun } = parseArgs();
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
  const rootDir = process.cwd();

  console.log(`Archiving files older than ${days} days (cutoff: ${cutoffDate})${dryRun ? ' [dry-run]' : ''}`);
  console.log('');

  let totalMoved = 0;
  let totalSkipped = 0;
  for (const dir of VAULT_DIRS) {
    const { moved, skipped } = await archiveDir(rootDir, dir, cutoffMs, dryRun);
    totalMoved += moved;
    totalSkipped += skipped;
    console.log(`${dir}: ${moved} moved, ${skipped} kept`);
  }
  console.log('');
  console.log(`Total: ${totalMoved} files ${dryRun ? 'would be ' : ''}moved, ${totalSkipped} kept`);

  if (!dryRun && totalMoved > 0) {
    console.log('');
    console.log('Next: review with `git status`, then commit as `chore(vault): archive {YYYY-MM} files >Nd old`');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

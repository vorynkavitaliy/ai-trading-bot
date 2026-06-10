import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.resolve(__dirname, 'cache');

export function cachePath(name: string): string {
  return path.join(CACHE_DIR, `${name}.ndjson`);
}

export function hasCache(name: string): boolean {
  return fs.existsSync(cachePath(name));
}

export function writeNdjson<T>(name: string, rows: readonly T[]): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = cachePath(name);
  const body = rows.map(row => JSON.stringify(row)).join('\n');
  fs.writeFileSync(file, body + '\n');
  return file;
}

export function readNdjson<T>(name: string): T[] {
  const file = cachePath(name);
  if (!fs.existsSync(file)) {
    throw new Error(`cache file not found: ${file} — run the downloader CLI first`);
  }
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const rows: T[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    rows.push(JSON.parse(trimmed) as T);
  }
  return rows;
}

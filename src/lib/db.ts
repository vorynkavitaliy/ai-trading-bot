import { Pool, PoolClient } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { log } from './logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => log.error('pg pool error', { err: err.message }));
  return pool;
}

export async function query<T = any>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const p = getPool();
  const res = await p.query(text, params as any);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  const dir = path.resolve(__dirname, '../../migrations');
  if (!fs.existsSync(dir)) {
    log.warn('migrations dir not found', { dir });
    return;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await query(`CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  for (const file of files) {
    const { rows } = await query<{ name: string }>(
      `SELECT name FROM migrations WHERE name = $1`,
      [file]
    );
    if (rows.length > 0) {
      log.debug('migration already applied', { file });
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
    await tx(async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO migrations (name) VALUES ($1)`, [file]);
    });
    log.info('migration applied', { file });
  }
}

export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

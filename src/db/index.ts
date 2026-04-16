import { Pool, PoolClient } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config';

/**
 * Thin Postgres wrapper.
 * - Single shared pool
 * - `query` for ad-hoc SQL
 * - `tx` for transactions
 * - `init` runs schema.sql idempotently
 *
 * If PG is disabled (`PG_ENABLED=false`), all methods become no-ops returning empty results,
 * so the bot can run in dry-mode without a database.
 */
export class DB {
  private pool: Pool | null = null;
  readonly enabled: boolean;

  constructor() {
    this.enabled = config.pg.enabled;
    if (!this.enabled) {
      console.log('[DB] disabled (PG_ENABLED=false) — running without persistence');
      return;
    }
    this.pool = new Pool({
      host: config.pg.host,
      port: config.pg.port,
      user: config.pg.user,
      password: config.pg.password,
      database: config.pg.database,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    this.pool.on('error', (err) => console.error('[DB] pool error:', err.message));
  }

  async init(): Promise<void> {
    if (!this.pool) return;
    const sqlPath = resolve(__dirname, 'schema.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    await this.pool.query(sql);
    console.log('[DB] schema initialised');
  }

  async query<T extends Record<string, any> = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.pool) return [];
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends Record<string, any> = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) return undefined as unknown as T;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

export const db = new DB();

/**
 * DESTRUCTIVE one-shot: wipes all trading state for a clean /loop restart.
 *
 * Flushes:
 *   1. Redis DB (FLUSHDB)  — positions, heat, pending, locks, telegram rate-limit
 *   2. PostgreSQL tables   — trades, equity_snapshots, daily_peaks, audit_log, signals
 *   3. vault/Trades/*.md   — removes active/closed trade files (keeps _template.md)
 *
 * Does NOT touch:
 *   - Bybit live state (positions, orders)  → must be empty beforehand
 *   - vault/Playbook, Thesis, Journal, Postmortem, Watchlist  → keep history
 *   - .claude/, CLAUDE.md, src/  → keep code & rules
 *
 * Intended use: after all positions are closed and all orders cancelled,
 * run this to reset counters and caches before a fresh /loop cycle.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { config } from './config';

async function main() {
  console.log('\n═══ DESTRUCTIVE WIPE — confirm Bybit is clean first ═══\n');

  // 1) Redis
  if (config.redis.enabled) {
    const r = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    await r.connect();
    const before = await r.dbsize();
    await r.flushdb();
    const after = await r.dbsize();
    console.log(`[Redis] FLUSHDB on db=${config.redis.db}: ${before} keys → ${after}`);
    await r.quit();
  } else {
    console.log('[Redis] disabled in config — skipping');
  }

  // 2) PostgreSQL
  const pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
  });

  const tables = ['trades', 'equity_snapshots', 'daily_peaks', 'audit_log', 'signals'];
  for (const t of tables) {
    try {
      const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      const n = countRes.rows[0].n;
      await pool.query(`TRUNCATE ${t} RESTART IDENTITY CASCADE`);
      console.log(`[DB] TRUNCATE ${t}: ${n} rows cleared`);
    } catch (err: any) {
      console.error(`[DB] ${t} failed: ${err.message}`);
    }
  }
  await pool.end();

  // 3) vault/Trades
  const tradesDir = path.join(__dirname, '..', 'vault', 'Trades');
  if (fs.existsSync(tradesDir)) {
    const files = fs.readdirSync(tradesDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    for (const f of files) {
      fs.unlinkSync(path.join(tradesDir, f));
      console.log(`[vault] removed Trades/${f}`);
    }
    if (files.length === 0) console.log('[vault] Trades/ already clean');
  }

  console.log('\n═══ Wipe complete — ready for fresh /loop start ═══\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Wipe error:', err);
  process.exit(1);
});

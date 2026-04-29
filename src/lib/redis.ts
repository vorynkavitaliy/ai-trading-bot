import IORedis, { Redis } from 'ioredis';
import { config } from './config';
import { log } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  client = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  client.on('error', (err) => log.error('redis error', { err: err.message }));
  return client;
}

export async function close(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

import { ConfigError } from './errors';

const ENV_PATH = path.resolve(__dirname, '../../.env');

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loadDotenv({ path: ENV_PATH });
  loaded = true;
}

export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new ConfigError(`missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  loadEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function intEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function listEnv(name: string, fallback: readonly string[] = []): string[] {
  loadEnv();
  const value = process.env[name];
  if (value === undefined || value === '') return [...fallback];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

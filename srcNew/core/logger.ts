import { optionalEnv } from './env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveThreshold(): number {
  const configured = optionalEnv('LOG_LEVEL', 'info') as LogLevel;
  return LEVEL_WEIGHT[configured] ?? LEVEL_WEIGHT.info;
}

export function createLogger(scope?: string): Logger {
  const threshold = resolveThreshold();

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < threshold) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      scope: scope ?? undefined,
      msg: message,
      ...(fields ?? {}),
    };

    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}

export const log: Logger = createLogger();

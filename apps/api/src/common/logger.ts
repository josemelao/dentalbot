import { redactContext } from './redact';

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(level = 'info'): Logger {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (
    levelName: 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>,
  ): void => {
    if (LEVELS[levelName] < threshold) return;

    const line = JSON.stringify({
      level: levelName,
      time: new Date().toISOString(),
      message,
      ...redactContext(context),
    });
    process.stdout.write(`${line}\n`);
  };

  return {
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

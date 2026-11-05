import { loadEnv } from './env';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.port).toBe(3000);
    expect(env.aiProvider).toBe('fake');
    expect(env.slaMinutes).toBe(15);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('requires a secret when the Telegram token is set', () => {
    expect(() => loadEnv({ ...base, TELEGRAM_BOT_TOKEN: '123:abc' })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
  });
});

import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { getTestPool } from './helpers/db';

describe('calendar configuration', () => {
  it('refuses to start in production without a real calendar adapter', async () => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: process.env.DATABASE_URL,
    });

    await expect(createApp({ env, pool: getTestPool() })).rejects.toThrow(
      /Calendar adapter is not configured/,
    );
  });
});

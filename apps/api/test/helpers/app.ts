import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { createApp } from '../../src/app';
import { FakeChannelAdapter } from '../../src/channels/fake/fake-channel.adapter';
import { getTestPool } from './db';

export interface TestApp {
  app: INestApplication;
  pool: Pool;
  fakeChannel: FakeChannelAdapter;
}

export async function buildTestApp(options: { pool?: Pool } = {}): Promise<TestApp> {
  const pool = options.pool ?? getTestPool();
  const fakeChannel = new FakeChannelAdapter();
  const app = await createApp({ pool, channelAdapter: fakeChannel });
  await app.init();
  return { app, pool, fakeChannel };
}

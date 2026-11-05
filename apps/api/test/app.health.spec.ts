import request from 'supertest';
import { createApp } from '../src/app';
import { getTestPool } from './helpers/db';

describe('app bootstrap', () => {
  it('returns health with database up', async () => {
    const app = await createApp({ pool: getTestPool() });
    await app.init();
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
    await app.close();
  });

  it('reuses an incoming correlation id', async () => {
    const app = await createApp({ pool: getTestPool() });
    await app.init();
    const res = await request(app.getHttpServer()).get('/health').set('x-correlation-id', 'corr-123');
    expect(res.headers['x-correlation-id']).toBe('corr-123');
    await app.close();
  });

  it('generates a correlation id when absent', async () => {
    const app = await createApp({ pool: getTestPool() });
    await app.init();
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });
});

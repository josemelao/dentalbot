import { FakeCalendarAdapter } from '../src/calendar/fake-calendar.adapter';
import { FakeChannelAdapter } from '../src/channels/fake/fake-channel.adapter';
import { loadEnv } from '../src/config/env';
import { withAdvisoryLock } from '../src/worker/advisory-lock';
import { buildJobs } from '../src/worker/jobs';
import { getTestPool } from './helpers/db';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/dental_assistant_test',
});

describe('worker', () => {
  it('exposes the three recurring jobs', () => {
    const jobs = buildJobs({
      pool: getTestPool(),
      env,
      channel: new FakeChannelAdapter(),
      calendar: new FakeCalendarAdapter(),
    });

    expect(jobs.map((job) => job.name)).toEqual([
      'sla',
      'reminders',
      'idle',
      'calendar',
      'reconcile',
    ]);
  });

  it('runs a job only once while the advisory lock is held', async () => {
    const pool = getTestPool();
    const key = 'test:worker-job';

    const holder = await pool.connect();
    try {
      await holder.query('select pg_advisory_lock(hashtext($1))', [key]);

      const blocked = await withAdvisoryLock(pool, key, async () => 'ran');
      expect(blocked).toEqual({ skipped: true });
    } finally {
      await holder.query('select pg_advisory_unlock(hashtext($1))', [key]);
      holder.release();
    }

    const free = await withAdvisoryLock(pool, key, async () => 'ran');
    expect(free).toBe('ran');
  });

  it('releases the lock even when the job throws', async () => {
    const pool = getTestPool();
    const key = 'test:worker-throws';

    await expect(
      withAdvisoryLock(pool, key, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const free = await withAdvisoryLock(pool, key, async () => 'ran');
    expect(free).toBe('ran');
  });
});

import { Pool } from 'pg';

/**
 * Runs a job while holding a Postgres advisory lock. Two workers may start, but
 * only one runs a given job at a time, so no patient gets two reminders.
 */
export async function withAdvisoryLock<T>(
  pool: Pool,
  key: string,
  run: () => Promise<T>,
): Promise<T | { skipped: true }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(
      'select pg_try_advisory_lock(hashtext($1)) as ok',
      [key],
    );
    if (!rows[0]?.ok) return { skipped: true };

    try {
      return await run();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [key]);
    }
  } finally {
    client.release();
  }
}

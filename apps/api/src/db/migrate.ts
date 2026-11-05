import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const ADVISORY_LOCK_ID = 727001;

export async function runMigrations(pool: Pool, dir: string): Promise<string[]> {
  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied: string[] = [];
  const client = await pool.connect();

  try {
    await client.query(`select pg_advisory_lock(${ADVISORY_LOCK_ID})`);
    const { rows } = await client.query<{ version: string }>('select version from schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.version));

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query(`select pg_advisory_unlock(${ADVISORY_LOCK_ID})`);
    client.release();
  }

  return applied;
}

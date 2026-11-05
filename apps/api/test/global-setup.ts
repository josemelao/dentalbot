import path from 'node:path';
import { Client, Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/dental_assistant_test';

function splitAdminUrl(connectionString: string): { adminUrl: string; dbName: string } {
  const url = new URL(connectionString);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'dental_assistant_test';
  url.pathname = '/postgres';
  return { adminUrl: url.toString(), dbName };
}

export default async function globalSetup(): Promise<void> {
  const { adminUrl, dbName } = splitAdminUrl(TEST_DATABASE_URL);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
    if (!rowCount) {
      const safeName = dbName.replace(/"/g, '""');
      await admin.query(`create database "${safeName}"`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
    const applied = await runMigrations(pool, migrationsDir);
    if (applied.length > 0) {
      process.stdout.write(`[test] applied migrations: ${applied.join(', ')}\n`);
    }
  } finally {
    await pool.end();
  }
}

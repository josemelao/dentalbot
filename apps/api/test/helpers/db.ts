import { Pool } from 'pg';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/dental_assistant_test';

let pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  }
  return pool;
}

export function resetTestPool(): void {
  pool = null;
}

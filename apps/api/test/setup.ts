import { getTestPool } from './helpers/db';
import { setMessageRandom } from '../src/common/message-style';

// Deterministic wording in tests: always the first variant.
setMessageRandom(() => 0);

beforeEach(async () => {
  const pool = getTestPool();
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables
     where schemaname = 'public' and tablename <> 'schema_migrations'`,
  );
  if (rows.length === 0) return;
  const tableList = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await pool.query(`truncate ${tableList} restart identity cascade`);
});

afterAll(async () => {
  await getTestPool().end();
});

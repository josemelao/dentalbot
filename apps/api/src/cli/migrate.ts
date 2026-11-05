import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { runMigrations } from '../db/migrate';

function findMigrationsDir(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'supabase', 'migrations');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find supabase/migrations');
}

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);
  try {
    const applied = await runMigrations(pool, findMigrationsDir(process.cwd()));
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

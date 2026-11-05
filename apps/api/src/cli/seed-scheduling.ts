import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { seedSchedulingFixture } from '../seed/scheduling-fixture';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);

  try {
    const { rows } = await pool.query<{ id: string }>(
      `select id from clinics where name = 'Clínica Piloto' limit 1`,
    );
    const clinic = rows[0];
    if (!clinic) {
      throw new Error('Run npm run seed first to create the pilot clinic');
    }

    const result = await seedSchedulingFixture(pool, clinic.id);
    console.log('Scheduling seed complete', result);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

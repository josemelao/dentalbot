import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { linkDemoPatient } from '../seed/demo';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  if (env.nodeEnv === 'production') {
    throw new Error('demo:link-patient refuses to run in production');
  }

  const externalUserId = process.argv[2];
  if (!externalUserId) {
    throw new Error(
      'Usage: npm run demo:link-patient -- <externalUserId> [fullName] [birthDate YYYY-MM-DD]',
    );
  }

  const fullName = process.argv[3] ?? 'Maria Silva';
  const birthDate = process.argv[4] ?? '1990-05-10';

  const pool = createPool(env.databaseUrl);
  try {
    const result = await linkDemoPatient(pool, externalUserId, fullName, birthDate);
    console.log('Demo patient linked', result);
    console.log(
      `Identity prompt answer: "${result.fullName}, ${result.birthDate.split('-').reverse().join('/')}"`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

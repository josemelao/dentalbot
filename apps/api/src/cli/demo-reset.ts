import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { resetDemoConversation } from '../seed/demo';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  if (env.nodeEnv === 'production') {
    throw new Error('demo:reset is destructive and refuses to run in production');
  }

  const externalUserId = process.argv[2];
  if (!externalUserId) {
    throw new Error('Usage: npm run demo:reset -- <externalUserId>');
  }

  const pool = createPool(env.databaseUrl);
  try {
    const result = await resetDemoConversation(pool, externalUserId);
    console.log('Demo conversation reset', result);
    if (result.openAppointments > 0) {
      console.log(
        `Note: ${result.openAppointments} future appointment(s) kept. Reschedule/cancel will find them.`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '../config/env';
import { createPool } from '../db/pool';
import { ClinicUsersRepository } from '../db/repositories/clinic-users.repository';
import { PanelAuthService } from '../panel/panel-auth.service';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadEnv();

  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Usage: npm run user:password -- <email> <senha>');
  }
  if (password.length < 8) {
    throw new Error('Use a password with at least 8 characters');
  }

  const pool = createPool(env.databaseUrl);
  try {
    const users = new ClinicUsersRepository(pool);
    const user = await users.findByEmail(email);
    if (!user) {
      throw new Error(`No clinic user with email ${email}. Run npm run seed first.`);
    }

    const auth = new PanelAuthService({ users, secret: env.sessionSecret, now: () => new Date() });
    await users.setPasswordHash(user.id, auth.hashPassword(password));

    console.log(`password set for ${user.name} <${user.email}>`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

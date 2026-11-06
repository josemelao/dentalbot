import 'reflect-metadata';
import 'dotenv/config';
import { createApp } from './app';
import { createLogger } from './common/logger';
import { loadEnv } from './config/env';
import { DB_POOL } from './db/tokens';
import { loadTemplates } from './messages/load-templates';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.logLevel);
  const app = await createApp({ env });

  await app.init();
  const templates = await loadTemplates(app.get(DB_POOL));
  logger.info('templates.loaded', { count: templates });

  await app.listen(env.port);
  logger.info('api.started', { port: env.port, nodeEnv: env.nodeEnv });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

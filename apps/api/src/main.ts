import 'reflect-metadata';
import 'dotenv/config';
import { createApp } from './app';
import { createLogger } from './common/logger';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.logLevel);
  const app = await createApp({ env });

  await app.listen(env.port);
  logger.info('api.started', { port: env.port, nodeEnv: env.nodeEnv });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

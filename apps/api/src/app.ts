import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AiGateway } from './ai/ai-gateway';
import { AppModule } from './app.module';
import { ChannelAdapter } from './channels/channel-adapter';
import { OwnerNotifier } from './channels/owner-notifier';
import { CalendarAdapter } from './calendar/calendar-adapter';
import { correlationMiddleware } from './common/correlation';
import { AppEnv, loadEnv } from './config/env';

export interface CreateAppOptions {
  env?: AppEnv;
  pool?: Pool;
  channelAdapter?: ChannelAdapter;
  calendarAdapter?: CalendarAdapter;
  aiGateway?: AiGateway;
  notifier?: OwnerNotifier;
}

export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
  const env = options.env ?? loadEnv();
  const app = await NestFactory.create(
    AppModule.register({
      env,
      pool: options.pool,
      channelAdapter: options.channelAdapter,
      calendarAdapter: options.calendarAdapter,
      aiGateway: options.aiGateway,
      notifier: options.notifier,
    }),
    { logger: false },
  );

  app.use(correlationMiddleware);
  app.enableShutdownHooks();
  return app;
}

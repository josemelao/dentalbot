import { DynamicModule, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AppEnv } from './config/env';
import { createPool } from './db/pool';
import { DB_POOL, ENV } from './db/tokens';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  static register(options: { env: AppEnv; pool?: Pool }): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: options.env },
        {
          provide: DB_POOL,
          useValue: options.pool ?? createPool(options.env.databaseUrl),
        },
      ],
    };
  }
}

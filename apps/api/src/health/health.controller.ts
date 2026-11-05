import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../db/tokens';

@Controller()
export class HealthController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @Get('health')
  async health(): Promise<{ status: string; database: string }> {
    try {
      await this.pool.query('select 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }
  }
}

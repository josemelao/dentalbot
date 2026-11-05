import { Queryable } from '../pool';
import { AvailabilityLock } from './rows';

const LOCK_COLUMNS = `id, tenant_id as "tenantId", professional_id as "professionalId",
  start_at as "startAt", end_at as "endAt", expires_at as "expiresAt",
  operation_id as "operationId", status`;

export interface CreateLockInput {
  tenantId: string;
  professionalId: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
  operationId?: string | null;
}

export class LocksRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateLockInput): Promise<AvailabilityLock> {
    const { rows } = await this.db.query(
      `insert into availability_locks
         (tenant_id, professional_id, start_at, end_at, expires_at, operation_id)
       values ($1, $2, $3, $4, $5, $6)
       returning ${LOCK_COLUMNS}`,
      [
        input.tenantId,
        input.professionalId,
        input.startAt,
        input.endAt,
        input.expiresAt,
        input.operationId ?? null,
      ],
    );
    return rows[0] as AvailabilityLock;
  }

  async release(tenantId: string, id: string): Promise<void> {
    await this.db.query(
      `update availability_locks set status = 'RELEASED'
       where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
  }

  async releaseExpired(now: Date): Promise<number> {
    const result = await this.db.query(
      `update availability_locks set status = 'EXPIRED'
       where status = 'ACTIVE' and expires_at <= $1`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  async findActive(
    tenantId: string,
    professionalId: string,
    startAt: Date,
    endAt: Date,
    now: Date,
  ): Promise<AvailabilityLock | null> {
    const { rows } = await this.db.query(
      `select ${LOCK_COLUMNS} from availability_locks
       where tenant_id = $1 and professional_id = $2
         and status = 'ACTIVE' and expires_at > $5
         and start_at < $4 and end_at > $3
       limit 1`,
      [tenantId, professionalId, startAt, endAt, now],
    );
    return (rows[0] as AvailabilityLock | undefined) ?? null;
  }
}

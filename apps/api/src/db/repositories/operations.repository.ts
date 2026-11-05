import { Queryable } from '../pool';
import { AppointmentOperation } from './rows';

const OPERATION_COLUMNS = `id, tenant_id as "tenantId",
  idempotency_key as "idempotencyKey", operation_type as "operationType",
  status, request_payload as "requestPayload", result_payload as "resultPayload",
  external_reference as "externalReference",
  created_at as "createdAt", updated_at as "updatedAt"`;

export interface CreateOperationInput {
  tenantId: string;
  idempotencyKey: string;
  operationType: 'BOOK' | 'RESCHEDULE' | 'CANCEL';
  requestPayload?: Record<string, unknown>;
}

export class OperationsRepository {
  constructor(private readonly db: Queryable) {}

  async createOrGet(
    input: CreateOperationInput,
  ): Promise<{ operation: AppointmentOperation; created: boolean }> {
    const { rows } = await this.db.query(
      `insert into appointment_operations
         (tenant_id, idempotency_key, operation_type, request_payload)
       values ($1, $2, $3, $4)
       on conflict (tenant_id, idempotency_key) do nothing
       returning ${OPERATION_COLUMNS}`,
      [
        input.tenantId,
        input.idempotencyKey,
        input.operationType,
        input.requestPayload ?? {},
      ],
    );

    if (rows[0]) {
      return { operation: rows[0] as AppointmentOperation, created: true };
    }

    const { rows: existing } = await this.db.query(
      `select ${OPERATION_COLUMNS} from appointment_operations
       where tenant_id = $1 and idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey],
    );

    if (!existing[0]) {
      throw new Error('Failed to create or find the appointment operation');
    }

    return { operation: existing[0] as AppointmentOperation, created: false };
  }

  async mark(
    tenantId: string,
    id: string,
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN',
    resultPayload?: Record<string, unknown>,
    externalReference?: string | null,
  ): Promise<void> {
    await this.db.query(
      `update appointment_operations
       set status = $3, result_payload = $4, external_reference = $5, updated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantId, id, status, resultPayload ?? {}, externalReference ?? null],
    );
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<AppointmentOperation | null> {
    const { rows } = await this.db.query(
      `select ${OPERATION_COLUMNS} from appointment_operations
       where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
    return (rows[0] as AppointmentOperation | undefined) ?? null;
  }

  async listUnknown(tenantId: string): Promise<AppointmentOperation[]> {
    const { rows } = await this.db.query(
      `select ${OPERATION_COLUMNS} from appointment_operations
       where tenant_id = $1 and status = 'UNKNOWN'
       order by created_at`,
      [tenantId],
    );
    return rows as AppointmentOperation[];
  }
}
